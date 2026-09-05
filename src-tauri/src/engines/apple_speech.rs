//! Apple Speech engine — OS-native speech-to-text through the bundled
//! `apple-speech` Swift sidecar (Speech framework, on-device recognition).
//!
//! Unlike Whisper/Parakeet this engine has **no model file**: the recognizers
//! ship with the OS. Language support follows the user's installed speech
//! resources (English, Hindi, … as enabled in System Settings).
//!
//! Privacy: `requiresOnDeviceRecognition` is always set, so audio is never
//! uploaded to Apple servers.

use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::Instant,
};

use serde_json::{json, Value};

use super::{
    find_sidecar, EngineAvailability, EngineKind, TranscriptionEngine, TranscriptionOutput,
    TranscriptionRequest,
};

// MARK: - Persistent sidecar session
//
// The sidecar stays alive in `--serve` mode with warm recognizers, which
// removes the per-dictation XPC + Speech-framework warmup cost (the dominant
// latency on macOS 26: 2-5s per cold call). One global session serializes
// requests; an exited sidecar is transparently respawned once.

struct ServeSession {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_request_id: u64,
}

fn serve_session_cell() -> &'static Mutex<Option<ServeSession>> {
    static SERVE_SESSION: OnceLock<Mutex<Option<ServeSession>>> = OnceLock::new();
    SERVE_SESSION.get_or_init(|| Mutex::new(None))
}

fn spawn_serve_session() -> Result<ServeSession, String> {
    let cli = find_sidecar("apple-speech")?;
    let mut child = Command::new(&cli)
        .arg("--serve")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Failed to run Apple Speech runtime: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Apple Speech runtime stdin unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Apple Speech runtime stdout unavailable".to_string())?;
    Ok(ServeSession {
        child,
        stdin,
        stdout: BufReader::new(stdout),
        next_request_id: 0,
    })
}

fn stop_serve_session(session: ServeSession) {
    let mut session = session;
    let _ = session.child.kill();
    let _ = session.child.wait();
}

/// Kills the persistent sidecar process, if one is running. Called on app exit
/// so the child is not orphaned.
pub fn shutdown_serve_session() {
    let lock = serve_session_cell();
    if let Ok(mut guard) = lock.lock() {
        if let Some(session) = guard.take() {
            stop_serve_session(session);
        }
    }
}

/// Sends one transcription request over the persistent session.
/// `Ok(response)` includes application-level errors (`ok: false`); a
/// transport-level `Err` means the sidecar is gone and the request never
/// completed.
fn request_transcription(
    session: &mut ServeSession,
    audio_path: &str,
    locale: Option<&str>,
    contextual_strings: &[String],
) -> Result<Value, String> {
    session.next_request_id += 1;
    let id = session.next_request_id;
    // Vocabulary Packs (spec §12): contextual strings bias Apple's on-device
    // recognizer toward active vocabulary terms. Capped by the adapter.
    let request = if contextual_strings.is_empty() {
        json!({ "id": id, "audio": audio_path, "locale": locale })
    } else {
        json!({
            "id": id,
            "audio": audio_path,
            "locale": locale,
            "contextualStrings": contextual_strings,
        })
    };
    let mut line = serde_json::to_string(&request)
        .map_err(|error| format!("Apple Speech request encoding failed: {error}"))?;
    line.push('\n');

    session
        .stdin
        .write_all(line.as_bytes())
        .map_err(|error| format!("Apple Speech runtime stopped accepting requests: {error}"))?;
    session
        .stdin
        .flush()
        .map_err(|error| format!("Apple Speech runtime stopped accepting requests: {error}"))?;

    loop {
        let mut response = String::new();
        let bytes = session
            .stdout
            .read_line(&mut response)
            .map_err(|error| format!("Apple Speech runtime failed: {error}"))?;
        if bytes == 0 {
            return Err("Apple Speech runtime exited unexpectedly".to_string());
        }
        let parsed: Value = match serde_json::from_str(response.trim()) {
            Ok(value) => value,
            Err(_) => continue, // diagnostics line from the sidecar — skip
        };
        if parsed.get("id").and_then(Value::as_i64) == Some(id as i64) {
            return Ok(parsed);
        }
        // A response for an older attempt — skip.
    }
}

fn map_sidecar_error(code: i64, message: &str) -> String {
    match code {
        4 => message.to_string(), // permission message is already user-facing
        _ => format!("Apple Speech failed: {message}"),
    }
}

fn response_to_result(response: Value) -> Result<String, String> {
    if response.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        return Ok(response
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string());
    }
    let code = response.get("code").and_then(Value::as_i64).unwrap_or(7);
    let message = response
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("recognition failed")
        .trim()
        .to_string();
    Err(map_sidecar_error(code, &message))
}

fn serve_transcribe(
    audio_path: &str,
    locale: Option<&str>,
    contextual_strings: &[String],
) -> Result<String, String> {
    let lock = serve_session_cell();
    // A poisoned lock only matters if a panic happened mid-request; recover so
    // transcription never gets permanently wedged.
    let mut guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    let mut attempts = 0;
    loop {
        attempts += 1;
        if guard.is_none() {
            *guard = Some(spawn_serve_session()?);
        }
        let session = guard.as_mut().unwrap();
        match request_transcription(session, audio_path, locale, contextual_strings) {
            Ok(response) => return response_to_result(response),
            Err(transport_error) => {
                if let Some(session) = guard.take() {
                    stop_serve_session(session);
                }
                if attempts >= 2 {
                    return Err(format!("Apple Speech failed: {transport_error}"));
                }
                eprintln!("[VOX][ASR] apple-speech session died ({transport_error}); respawning");
            }
        }
    }
}

/// File-format mapping from Vox's language codes to BCP-47 recognizer locales.
/// "auto"/"hinglish" use the system default recognizer.
fn locale_code(language: Option<&str>) -> Option<String> {
    match language.map(str::trim).filter(|value| !value.is_empty()) {
        None | Some("auto") | Some("hinglish") => None,
        Some("en") => Some("en-US".to_string()),
        Some("hi") => Some("hi-IN".to_string()),
        Some(code) => Some(code.to_string()),
    }
}

pub struct AppleSpeechEngine;

impl TranscriptionEngine for AppleSpeechEngine {
    fn kind(&self) -> EngineKind {
        EngineKind::Apple
    }

    fn display_name(&self) -> &'static str {
        "Apple Speech"
    }

    /// Apple Speech has no model files — it is driven purely by explicit
    /// engine selection (settings / auto mode), never by model lookup.
    fn handles_model(&self, _model_path: &Path) -> bool {
        false
    }

    fn availability(&self, _models_dir: &Path) -> EngineAvailability {
        // Static checks only: platform + sidecar binary. Speech Recognition
        // authorization is deliberately NOT probed here — requesting it would
        // trigger a TCC permission prompt just by opening Settings.
        if !cfg!(target_os = "macos") {
            return EngineAvailability::unavailable("Apple Speech is only available on macOS");
        }
        match find_sidecar("apple-speech") {
            Ok(_) => EngineAvailability::available(),
            Err(reason) => EngineAvailability::unavailable(reason),
        }
    }

    fn pick_model(
        &self,
        _models_dir: &Path,
        _requested: Option<&str>,
    ) -> Result<Option<PathBuf>, String> {
        // OS-provided recognizers — nothing to resolve.
        Ok(None)
    }

    fn transcribe(&self, request: &TranscriptionRequest) -> Result<TranscriptionOutput, String> {
        let audio_path = request
            .audio_path
            .to_str()
            .ok_or_else(|| "Audio path contains invalid UTF-8".to_string())?;

        let locale = locale_code(request.language);
        let started = Instant::now();
        let text = serve_transcribe(audio_path, locale.as_deref(), &request.contextual_strings)?;
        eprintln!(
            "[VOX][ASR] apple-speech transcription finished in {}ms",
            started.elapsed().as_millis()
        );

        if text.is_empty() {
            return Err("Apple Speech returned an empty transcript".to_string());
        }

        // File-based recognition reports no language id back; report what was
        // requested when pinned so transcripts keep their language label.
        let detected = locale.map(|code| code.split('-').next().unwrap_or("en").to_string());

        Ok(TranscriptionOutput::new("apple", text, detected))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_language_codes_to_bcp47_locales() {
        assert_eq!(locale_code(None), None);
        assert_eq!(locale_code(Some("auto")), None);
        assert_eq!(locale_code(Some("hinglish")), None);
        assert_eq!(locale_code(Some("en")), Some("en-US".to_string()));
        assert_eq!(locale_code(Some("hi")), Some("hi-IN".to_string()));
        assert_eq!(locale_code(Some("fr")), Some("fr".to_string()));
    }

    #[test]
    fn apple_engine_never_claims_model_files() {
        let engine = AppleSpeechEngine;
        assert!(!engine.handles_model(Path::new("m/ggml-base.en.bin")));
        assert!(!engine.handles_model(Path::new("m/model.gguf")));
    }
}
