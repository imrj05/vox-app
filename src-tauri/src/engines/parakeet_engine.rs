//! Parakeet engine — NVIDIA Parakeet FastConformer + TDT models (GGUF), run
//! through the bundled `transcribe-cli` sidecar (`src-tauri/bin/`) in its
//! `--serve` mode (added by the local `transcribe-cli-serve.patch`).
//!
//! The sidecar process stays alive with the model (and Metal kernels) warm,
//! so per-dictation cost is just the decode — model load is paid once instead
//! of per utterance. Recordings are still resampled (via the shared audio
//! helpers) into a temp 16 kHz mono WAV because the runtime expects that
//! format. Language is auto-detected by the model; the CLI does not report it
//! back.

use std::{
    fs,
    io::{BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Mutex, OnceLock},
};

use super::audio::resample_to_16khz_mono_wav;
use super::{
    EngineAvailability, EngineKind, TranscriptionEngine, TranscriptionOutput, TranscriptionRequest,
};

/// The first request also loads the model into the sidecar, so this covers a
/// cold start; it exists to break a wedged runtime, not to cap real work.
const RESPONSE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);

pub struct ParakeetEngine;

/// Whether a Parakeet model file is English-only: v2 and the small 110M model
/// are; v3 and Ultra cover the 25 European languages.
fn is_english_only_model(lowercased_file_name: &str) -> bool {
    lowercased_file_name.contains("-v2") || lowercased_file_name.contains("110m")
}

/// Languages supported by Parakeet TDT 0.6B v3 and Ultra (the 25 European
/// languages they were trained on). v2 and the 110M model are English-only. Notably absent: Hindi and other Indic
/// languages — dictating those through Parakeet produces garbage, so the
/// router must reroute to Whisper/Apple Speech instead.
const PARAKEET_V3_LANGUAGES: &[&str] = &[
    "bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu", "it", "lv", "lt", "mt",
    "pl", "pt", "ro", "sk", "sl", "es", "sv", "uk", "ru",
];

// ── Persistent sidecar session ────────────────────────────────────────────────
//
// Same pattern as the Apple Speech engine's serve session. One global session
// serializes requests; an exited sidecar is transparently respawned once.

struct ParakeetServeSession {
    model_path: PathBuf,
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

fn serve_session_cell() -> &'static Mutex<Option<ParakeetServeSession>> {
    static SERVE_SESSION: OnceLock<Mutex<Option<ParakeetServeSession>>> = OnceLock::new();
    SERVE_SESSION.get_or_init(|| Mutex::new(None))
}

fn spawn_serve_session(cli: &Path, model_path: &Path) -> Result<ParakeetServeSession, String> {
    let model_arg = model_path
        .to_str()
        .ok_or_else(|| "Model path contains invalid UTF-8".to_string())?;
    let mut child = Command::new(cli)
        .arg("--serve")
        .arg("-m")
        .arg(model_arg)
        .arg("-q")
        .arg("--timestamps")
        .arg("none")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Failed to run Parakeet runtime: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Parakeet runtime stdin unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Parakeet runtime stdout unavailable".to_string())?;
    Ok(ParakeetServeSession {
        model_path: model_path.to_path_buf(),
        child,
        stdin,
        stdout: BufReader::new(stdout),
    })
}

fn stop_serve_session(session: ParakeetServeSession) {
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

/// Sends one wav path over the persistent session and reads back its JSONL
/// response. `Ok(response)` includes application-level errors (`error` field);
/// a transport-level `Err` means the sidecar is gone.
fn request_transcription(
    session: &mut ParakeetServeSession,
    audio_path: &str,
) -> Result<serde_json::Value, String> {
    let mut line = audio_path.to_string();
    line.push('\n');

    session
        .stdin
        .write_all(line.as_bytes())
        .map_err(|error| format!("Parakeet runtime stopped accepting requests: {error}"))?;
    session
        .stdin
        .flush()
        .map_err(|error| format!("Parakeet runtime stopped accepting requests: {error}"))?;

    loop {
        let response = match super::read_line_timeout(&mut session.stdout, RESPONSE_TIMEOUT)
            .map_err(|error| format!("Parakeet runtime failed: {error}"))?
        {
            super::SidecarRead::Line(line) => line,
            super::SidecarRead::Eof => {
                return Err("Parakeet runtime exited unexpectedly".to_string())
            }
            super::SidecarRead::TimedOut => {
                return Err(format!(
                    "Parakeet stopped responding after {}s",
                    RESPONSE_TIMEOUT.as_secs()
                ))
            }
        };
        let parsed: serde_json::Value = match serde_json::from_str(response.trim()) {
            Ok(value) => value,
            Err(_) => continue, // diagnostics line from the sidecar — skip
        };
        if parsed.get("type").and_then(serde_json::Value::as_str) == Some("serve") {
            return Ok(parsed);
        }
        // Unrelated stdout line — skip.
    }
}

impl TranscriptionEngine for ParakeetEngine {
    fn kind(&self) -> EngineKind {
        EngineKind::Parakeet
    }

    fn display_name(&self) -> &'static str {
        "Parakeet"
    }

    /// Parakeet models are distributed as GGUF; whisper.cpp cannot load them.
    fn handles_model(&self, model_path: &Path) -> bool {
        matches!(
            model_path.extension().and_then(|e| e.to_str()),
            Some("gguf")
        )
    }

    fn availability(&self, models_dir: &Path) -> EngineAvailability {
        let runtime = match parakeet_cli_path() {
            Ok(_) => true,
            Err(reason) => {
                return EngineAvailability::unavailable(reason);
            }
        };
        let has_model = fs::read_dir(models_dir)
            .map(|entries| {
                entries.flatten().any(|entry| {
                    entry
                        .path()
                        .extension()
                        .is_some_and(|extension| extension == "gguf")
                })
            })
            .unwrap_or(false);
        if runtime && has_model {
            EngineAvailability::available()
        } else if !runtime {
            EngineAvailability::unavailable(
                "Parakeet runtime not found. Run `pnpm build:parakeet-asr` and rebuild the app.",
            )
        } else {
            EngineAvailability::unavailable("No Parakeet model downloaded")
        }
    }

    fn pick_model(
        &self,
        models_dir: &Path,
        requested: Option<&str>,
    ) -> Result<Option<PathBuf>, String> {
        if let Some(name) = requested {
            let path = crate::whisper::resolve_model_file(models_dir, name)?;
            if !self.handles_model(&path) {
                return Err(format!(
                    "Model {} belongs to another engine",
                    path.display()
                ));
            }
            return Ok(Some(path));
        }

        // Engine-driven choice: the Models page order — Ultra, then v3, then
        // v2 — and finally any user-added GGUF in the models dir.
        for name in [
            "parakeet-ultra",
            "parakeet-tdt-0.6b-v3",
            "parakeet-tdt-0.6b-v2",
        ] {
            let path = models_dir.join(format!("{name}.gguf"));
            if path.exists() {
                return Ok(Some(path));
            }
        }
        if let Some(path) = fs::read_dir(models_dir)
            .map_err(|error| error.to_string())?
            .flatten()
            .map(|entry| entry.path())
            .find(|path| path.is_file() && path.extension().is_some_and(|e| e == "gguf"))
        {
            return Ok(Some(path));
        }

        Err("Download a Parakeet model to use the Parakeet engine".to_string())
    }

    fn transcribe(&self, request: &TranscriptionRequest) -> Result<TranscriptionOutput, String> {
        let model_path = request
            .model_path
            .ok_or_else(|| "Parakeet engine requires a model file".to_string())?;
        // English-only Parakeet models (v2 and the 110M model). Fail fast with
        // a helpful message (which triggers engine fallback) instead of garbage
        // output for other languages — mirrors the whisper engine's `.en` check.
        let model_name = model_path
            .file_name()
            .map(|name| name.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if is_english_only_model(&model_name) {
            let requested = request.language.map(str::trim).filter(|v| !v.is_empty());
            if let Some(requested) = requested {
                if requested != "auto" && requested != "en" {
                    return Err(format!(
                        "The downloaded {model_name} model is English-only. Switch to Whisper, Parakeet Ultra or Parakeet v3 to dictate in other languages."
                    ));
                }
            }
        }
        let (text, _language) = transcribe_with_parakeet(model_path, request.audio_path)?;
        Ok(TranscriptionOutput::new("parakeet", text, None))
    }

    /// Parakeet v3 understands 25 European languages only. "auto" is allowed
    /// (the model auto-detects among those), but explicit codes outside the
    /// list — Hindi, Hinglish, etc. — are rejected so the router picks a
    /// multilingual engine instead of emitting garbage.
    fn supports_language(&self, language: &str) -> bool {
        match language.trim().to_ascii_lowercase().as_str() {
            "auto" => true,
            code => PARAKEET_V3_LANGUAGES.contains(&code),
        }
    }
}

fn parakeet_cli_path() -> Result<PathBuf, String> {
    super::find_sidecar("transcribe-cli")
}

/// Runs one transcription against the persistent sidecar session. Requests
/// for a different model path transparently restart the session; a dead
/// sidecar is respawned and the request retried once.
fn transcribe_with_parakeet(
    model_path: &Path,
    audio_path: &Path,
) -> Result<(String, Option<String>), String> {
    let cli = parakeet_cli_path()?;

    // transcribe-cli expects 16 kHz mono WAV input, but Vox records at the
    // device's native rate (commonly 48 kHz). Resample to a temp 16 kHz mono
    // WAV before handing the path to the runtime.
    let temp_wav = temp_16khz_wav_path();
    let resample_result = resample_to_16khz_mono_wav(audio_path, &temp_wav);
    let result = match resample_result {
        Err(error) => Err(error),
        Ok(()) => {
            let audio_arg = temp_wav
                .to_str()
                .ok_or_else(|| "Temp audio path contains invalid UTF-8".to_string())?
                .to_string();
            transcribe_via_serve(&cli, model_path, &audio_arg)
        }
    };
    let _ = fs::remove_file(&temp_wav);
    result
}

fn transcribe_via_serve(
    cli: &Path,
    model_path: &Path,
    audio_arg: &str,
) -> Result<(String, Option<String>), String> {
    let lock = serve_session_cell();
    // A poisoned lock only matters if a panic happened mid-request; recover so
    // transcription never gets permanently wedged.
    let mut guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    let mut attempts = 0;
    loop {
        attempts += 1;
        let needs_spawn = match guard.as_ref() {
            None => true,
            // A different model (e.g. the user switched Parakeet versions)
            // requires a restart: the model is loaded at process spawn.
            Some(session) => session.model_path != model_path,
        };
        if needs_spawn {
            if let Some(old) = guard.take() {
                stop_serve_session(old);
            }
            *guard = Some(spawn_serve_session(cli, model_path)?);
        }
        let session = guard.as_mut().unwrap();
        match request_transcription(session, audio_arg) {
            Ok(response) => {
                if let Some(error) = response.get("error").and_then(serde_json::Value::as_str) {
                    return Err(format!("Parakeet runtime failed: {error}"));
                }
                let text = response
                    .get("text")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if text.is_empty() {
                    return Err("Parakeet returned an empty transcript".to_string());
                }
                return Ok((text, None));
            }
            Err(transport_error) => {
                if let Some(session) = guard.take() {
                    stop_serve_session(session);
                }
                if attempts >= 2 {
                    return Err(format!("Parakeet runtime failed: {transport_error}"));
                }
                eprintln!("[VOX][ASR] parakeet session died ({transport_error}); respawning");
            }
        }
    }
}

fn temp_16khz_wav_path() -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("vox-parakeet-{}-{nanos}.wav", std::process::id()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_transcript_from_cli_output() {
        let stdout = "\
audio: /tmp/foo.wav\n\
  samples: 32000\n\
  duration: 2.000 s\n\
model: /path/model.gguf -> ok\n\
  backend: MTL0\n\
run: ok\n\
text: I want to just check it's working or not.\n\
  realtime: 27x\n";
        assert_eq!(
            crate::engines::extract_transcript(stdout),
            "I want to just check it's working or not."
        );

        let empty = "run: ok\ntext: (empty)\n  realtime: 5x\n";
        assert_eq!(crate::engines::extract_transcript(empty), "");
    }

    #[test]
    fn parakeet_engine_claims_gguf_only() {
        let engine = ParakeetEngine;
        assert!(engine.handles_model(Path::new("m/parakeet-tdt-0.6b-v3-Q8_0.gguf")));
        assert!(!engine.handles_model(Path::new("m/ggml-base.en.bin")));
        assert!(!engine.handles_model(Path::new("m/model.txt")));
    }
}
