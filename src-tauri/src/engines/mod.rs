//! Common transcription-engine abstraction.
//!
//! Every speech-to-text backend (whisper.cpp, Parakeet, Apple Speech, …) is
//! isolated behind the [`TranscriptionEngine`] trait. The rest of the app talks
//! to a single entry point — [`transcribe`] — which routes the resolved model
//! path to the engine that owns it. Callers never branch on engine specifics.
//!
//! Roadmap (per the multi-engine architecture spec):
//!   1. ✅ Engine trait + router with Whisper and Parakeet engines
//!   2. Apple Speech engine (Speech framework sidecar)
//!   3. Auto-selection / fallback routing on top of [`engine_for_model`]

// Engine metadata (kind/id/display_name/availability) is exercised by the unit
// tests today and wired into Tauri commands (engine listing, auto-selection,
// fallback) in the next step of the multi-engine migration.
#![allow(dead_code)]

pub mod apple_speech;
pub mod audio;
pub mod parakeet_engine;
pub mod whisper_engine;

use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::Serialize;

/// Identifies an ASR engine. Serialized lowercase so frontend code can treat
/// `engine` as the plain string `"whisper" | "parakeet" | "apple"`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineKind {
    Whisper,
    Parakeet,
    Apple,
}

/// Whether an engine is usable right now, with an optional human-readable
/// reason when it is not (missing runtime binary, unsupported macOS version,
/// unsupported language, …).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineAvailability {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl EngineAvailability {
    pub fn available() -> Self {
        Self {
            available: true,
            reason: None,
        }
    }

    pub fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            available: false,
            reason: Some(reason.into()),
        }
    }
}

/// Everything an engine may need to produce a transcript from a recording.
/// Engines ignore fields they do not support (e.g. Parakeet ignores the
/// dictionary/context prompt).
pub struct TranscriptionRequest<'a> {
    /// `None` for engines that need no model file (e.g. Apple Speech, which
    /// uses the OS-provided recognizers).
    pub model_path: Option<&'a Path>,
    pub audio_path: &'a Path,
    pub dictionary: Option<&'a str>,
    pub context: Option<&'a str>,
    /// User's preferred language code ("en", "hi", "auto", "hinglish") or
    /// `None` for auto-detection.
    pub language: Option<&'a str>,
    /// Vocabulary Packs: engine-specific contextual strings (Apple Speech
    /// `contextualStrings`). Other engines ignore this field; Whisper/Parakeet
    /// biasing flows through `dictionary`/`context` prompts and the shared
    /// post-correction pass instead.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub contextual_strings: Vec<String>,
}

/// Normalized engine output. `language` is the language actually used
/// (auto-detected or pinned), when the engine can report it. `engine` is the
/// stable engine id that produced the transcript ("whisper", "parakeet", …).
pub struct TranscriptionOutput {
    pub text: String,
    pub language: Option<String>,
    pub engine: &'static str,
}

impl TranscriptionOutput {
    pub fn new(engine: &'static str, text: String, language: Option<String>) -> Self {
        Self {
            text,
            language,
            engine,
        }
    }
}

/// What a single engine exposes to the frontend (spec §3). Engines SHOULD NOT
/// leak implementation details beyond availability + display metadata.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub id: &'static str,
    pub display_name: &'static str,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// A single interchangeable speech-to-text backend.
pub trait TranscriptionEngine: Sync {
    fn kind(&self) -> EngineKind;

    /// Stable lowercase identifier ("whisper", "parakeet", "apple").
    fn id(&self) -> &'static str {
        match self.kind() {
            EngineKind::Whisper => "whisper",
            EngineKind::Parakeet => "parakeet",
            EngineKind::Apple => "apple",
        }
    }

    fn display_name(&self) -> &'static str;

    /// Whether this engine's runtime can drive the model at `model_path`.
    /// Used by the router to pick the owner engine for a resolved model file.
    fn handles_model(&self, model_path: &Path) -> bool;

    /// Whether the engine could run at all right now (runtime present, OS
    /// support, permissions). `models_dir` lets file-based engines report
    /// whether any usable model exists.
    fn availability(&self, models_dir: &Path) -> EngineAvailability;

    /// Resolve which model file this engine should drive. `requested` is a
    /// user-named model hint (honored when usable); `None` lets the engine pick
    /// its preferred downloaded model. When the engine itself drives model
    /// choice, the result must have the engine's own file format.
    fn pick_model(
        &self,
        models_dir: &Path,
        requested: Option<&str>,
    ) -> Result<Option<PathBuf>, String>;

    fn transcribe(&self, request: &TranscriptionRequest) -> Result<TranscriptionOutput, String>;
}

/// All registered engines. The router consults this list in order; the first
/// engine that claims the model handles it.
fn registry() -> &'static [&'static dyn TranscriptionEngine] {
    &[
        &whisper_engine::WhisperEngine,
        &parakeet_engine::ParakeetEngine,
        &apple_speech::AppleSpeechEngine,
    ]
}

/// Pick the engine that owns the given model file.
pub fn engine_for_model(model_path: &Path) -> Result<&'static dyn TranscriptionEngine, String> {
    registry()
        .iter()
        .copied()
        .find(|engine| engine.handles_model(model_path))
        .ok_or_else(|| {
            format!(
                "No transcription engine supports model: {}",
                model_path.display()
            )
        })
}

/// List every registered engine with its current availability, for the
/// frontend settings UI. NEW engines become visible just by joining the
/// registry — no frontend change required.
pub fn describe_engines(models_dir: &Path) -> Vec<EngineStatus> {
    registry()
        .iter()
        .map(|engine| {
            let availability = engine.availability(models_dir);
            EngineStatus {
                id: engine.id(),
                display_name: engine.display_name(),
                available: availability.available,
                reason: availability.reason,
            }
        })
        .collect()
}

/// Where the engine picked by the router failed and a fallback engine was
/// used instead (spec §8).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineFallback {
    pub from: &'static str,
    pub to: &'static str,
    pub reason: &'static str,
}

/// User-driven engine selection (spec §6/§7/§8).
#[derive(Clone, Debug)]
pub struct EngineSelection<'a> {
    /// "auto" or an engine id ("whisper", "parakeet", …).
    pub preferred: &'a str,
    /// Whether falling back to another engine after a failure is allowed.
    pub fallback_enabled: bool,
    /// Preferred fallback engine when `fallback_enabled` is true.
    pub preferred_fallback: Option<&'a str>,
}

/// Locate a bundled sidecar binary by file-name prefix, next to the running
/// executable (packaged app) or in the dev `src-tauri/bin` directory.
pub(crate) fn find_sidecar(prefix: &str) -> Result<PathBuf, String> {
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(dir) = current_exe.parent() {
            if let Some(path) = find_sidecar_in_dir(dir, prefix) {
                return Ok(path);
            }
        }
    }

    let dev_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin");
    if let Some(path) = find_sidecar_in_dir(&dev_dir, prefix) {
        return Ok(path);
    }

    Err(format!(
        "Runtime binary {prefix} not found. Rebuild the app (or run its `build:` script) and try again."
    ))
}

fn find_sidecar_in_dir(dir: &Path, prefix: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if file_name.starts_with(prefix) && entry.path().is_file() {
            return Some(entry.path());
        }
    }
    None
}

/// Sidecar CLIs print a `text: <transcript>` line amid a diagnostics header.
/// Extract just the transcript text so the app pastes clean output.
pub(crate) fn extract_transcript(stdout: &str) -> String {
    for line in stdout.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix("text:") else {
            continue;
        };
        let rest = rest.trim();
        if rest.is_empty() || rest == "(empty)" {
            return String::new();
        }
        return rest.to_string();
    }
    String::new()
}

fn engine_by_id(id: &str) -> Option<&'static dyn TranscriptionEngine> {
    registry().iter().copied().find(|engine| engine.id() == id)
}

/// Run one engine with timing instrumentation so latency shows up in logs.
fn timed_transcribe(
    engine: &'static dyn TranscriptionEngine,
    request: &TranscriptionRequest<'_>,
) -> Result<TranscriptionOutput, String> {
    let started = Instant::now();
    let result = engine.transcribe(request);
    eprintln!(
        "[VOX][ASR] engine {} took {}ms ({} | {}s audio)",
        engine.id(),
        started.elapsed().as_millis(),
        if result.is_ok() { "ok" } else { "failed" },
        request
            .audio_path
            .metadata()
            .map(|meta| meta.len())
            .map(|bytes| format!("{}KB", bytes / 1024))
            .unwrap_or_else(|_| "unknown size".to_string()),
    );
    result
}

/// Run an engine end-to-end: resolve its model, transcribe, normalize output.
fn run_engine(
    engine: &'static dyn TranscriptionEngine,
    models_dir: &Path,
    audio_path: &Path,
    dictionary: Option<&str>,
    context: Option<&str>,
    language: &str,
    contextual_strings: &[String],
) -> Result<(String, Option<String>, &'static str), String> {
    let model_path = engine.pick_model(models_dir, None)?;
    let request = TranscriptionRequest {
        model_path: model_path.as_deref(),
        audio_path,
        dictionary,
        context,
        language: Some(language),
        contextual_strings: contextual_strings.to_vec(),
    };
    timed_transcribe(engine, &request).map(|output| (output.text, output.language, output.engine))
}

/// Transcribe an already-resolved model file (used for explicit model
/// requests): the file format decides the engine, no auto-selection.
fn transcribe_resolved(
    model_path: &Path,
    audio_path: &Path,
    dictionary: Option<&str>,
    context: Option<&str>,
    language: &str,
    contextual_strings: &[String],
) -> Result<(String, Option<String>, &'static str), String> {
    let engine = engine_for_model(model_path)?;
    let request = TranscriptionRequest {
        model_path: Some(model_path),
        audio_path,
        dictionary,
        context,
        language: Some(language),
        contextual_strings: contextual_strings.to_vec(),
    };
    timed_transcribe(engine, &request).map(|output| (output.text, output.language, output.engine))
}

/// Auto-mode primary-engine strategy (spec §7).
fn choose_auto_engine(models_dir: &Path, language: &str) -> &'static dyn TranscriptionEngine {
    let whisper = engine_by_id("whisper");
    let parakeet = engine_by_id("parakeet");

    // English + Parakeet installed → prefer Parakeet (fastest on Apple
    // Silicon). "auto" language stays on Whisper because Parakeet models
    // cannot handle other languages and we don't know what will be spoken.
    if language == "en" {
        if let Some(parakeet) = parakeet {
            if parakeet.availability(models_dir).available {
                return parakeet;
            }
        }
    }

    // Default: Whisper (multilingual). If no Whisper model is downloaded but
    // Parakeet is available, use Parakeet rather than hard-failing.
    if let Some(whisper) = whisper {
        if whisper.availability(models_dir).available {
            return whisper;
        }
    }
    if let Some(parakeet) = parakeet {
        if parakeet.availability(models_dir).available {
            return parakeet;
        }
    }

    // No third-party model installed — Apple Speech needs no download.
    if let Some(apple) = engine_by_id("apple") {
        if apple.availability(models_dir).available {
            return apple;
        }
    }

    whisper.expect("whisper engine is registered")
}

/// Ordered fallback candidates after a primary engine failed: the user's
/// preferred fallback first, then every other registered engine.
fn fallback_candidates(
    preferred_fallback: Option<&str>,
    failed_id: &str,
) -> Vec<&'static dyn TranscriptionEngine> {
    let mut candidates = Vec::new();
    if let Some(engine) = preferred_fallback
        .and_then(|id| engine_by_id(id))
        .filter(|engine| engine.id() != failed_id)
    {
        candidates.push(engine);
    }
    for engine in registry() {
        if engine.id() != failed_id && !candidates.iter().any(|c| c.id() == engine.id()) {
            candidates.push(*engine);
        }
    }
    candidates
}

/// Top-level transcription entry point (spec §31): resolves engine + model
/// from user selection and runs the pipeline.
/// Returns `(text, detected_language, engine_id)`.
///
/// Routing rules:
///   1. Explicit `model_name` (Models page) — that model decides the engine.
///   2. Explicit engine selection — pick that engine's preferred model.
///   3. "auto" — language- and availability-aware choice (spec §7).
/// If the chosen engine fails to resolve a model or to transcribe and fallback
/// is enabled, other engines are tried in order and `on_fallback` reports each
/// switch (callers must emit an event/log so failures are never silent).
pub fn route_transcribe(
    models_dir: &Path,
    audio_path: &Path,
    model_name: Option<&str>,
    dictionary: Option<&str>,
    context: Option<&str>,
    language: Option<&str>,
    selection: EngineSelection,
    mut on_fallback: impl FnMut(&'static str, &'static str, &'static str),
) -> Result<(String, Option<String>, &'static str), String> {
    route_transcribe_with_vocabulary(
        models_dir,
        audio_path,
        model_name,
        dictionary,
        context,
        language,
        selection,
        &mut on_fallback,
        &[],
    )
}

/// Like [`route_transcribe`], with Vocabulary Packs contextual strings for
/// engines that support them (Apple Speech). Engines that don't support them
/// ignore the field.
#[allow(clippy::too_many_arguments)]
pub fn route_transcribe_with_vocabulary(
    models_dir: &Path,
    audio_path: &Path,
    model_name: Option<&str>,
    dictionary: Option<&str>,
    context: Option<&str>,
    language: Option<&str>,
    selection: EngineSelection,
    mut on_fallback: impl FnMut(&'static str, &'static str, &'static str),
    contextual_strings: &[String],
) -> Result<(String, Option<String>, &'static str), String> {
    let language = language
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("auto");

    // 1. Explicit model request (the user picked a specific model — honor it
    //    exactly, no auto-selection and no fallback).
    if let Some(model_name) = model_name {
        let model_path = crate::whisper::resolve_model_file(models_dir, model_name)?;
        return transcribe_resolved(
            &model_path,
            audio_path,
            dictionary,
            context,
            language,
            contextual_strings,
        );
    }

    // 2. Decide the primary engine.
    let preferred_engine = if selection.preferred == "auto" {
        choose_auto_engine(models_dir, language)
    } else {
        engine_by_id(selection.preferred)
            .ok_or_else(|| format!("Unknown transcription engine: {}", selection.preferred))?
    };

    match run_engine(
        preferred_engine,
        models_dir,
        audio_path,
        dictionary,
        context,
        language,
        contextual_strings,
    ) {
        Ok(result) => Ok(result),
        Err(primary_error) => {
            if !selection.fallback_enabled {
                return Err(primary_error);
            }

            // Fallback (spec §8): try the user's preferred fallback engine
            // first, then every other registered engine. Primary failures are
            // never hidden — the switch reason is reported upward.
            let mut last_error = primary_error;
            for candidate in
                fallback_candidates(selection.preferred_fallback, preferred_engine.id())
            {
                match run_engine(
                    candidate,
                    models_dir,
                    audio_path,
                    dictionary,
                    context,
                    language,
                    contextual_strings,
                ) {
                    Ok(result) => {
                        let reason = if last_error.contains("not downloaded")
                            || last_error.contains("Download")
                        {
                            "model_unavailable"
                        } else {
                            "engine_failed"
                        };
                        on_fallback(preferred_engine.id(), candidate.id(), reason);
                        return Ok(result);
                    }
                    Err(error) => {
                        eprintln!(
                            "[VOX][ASR] fallback engine {} also failed: {error}",
                            candidate.id()
                        );
                        last_error = error;
                    }
                }
            }
            Err(last_error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn path(name: &str) -> std::path::PathBuf {
        std::path::PathBuf::from(name)
    }

    #[test]
    fn routes_gguf_to_parakeet() {
        let engine = engine_for_model(&path("models/parakeet-tdt-0.6b-v3-Q8_0.gguf")).unwrap();
        assert_eq!(engine.id(), "parakeet");
    }

    #[test]
    fn routes_ggml_to_whisper() {
        let engine = engine_for_model(&path("models/ggml-base.en.bin")).unwrap();
        assert_eq!(engine.id(), "whisper");
    }

    #[test]
    fn errors_for_unsupported_model_format() {
        assert!(engine_for_model(&path("models/model.txt")).is_err());
    }

    #[test]
    fn engine_ids_are_stable() {
        for engine in registry() {
            match engine.kind() {
                EngineKind::Whisper => assert_eq!(engine.id(), "whisper"),
                EngineKind::Parakeet => assert_eq!(engine.id(), "parakeet"),
                EngineKind::Apple => assert_eq!(engine.id(), "apple"),
            }
        }
    }

    /// Fake downloaded models: one whisper `.bin` and one Parakeet `.gguf`.
    fn models_with_both(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("base.en.bin"), b"fake").unwrap();
        std::fs::write(dir.join("parakeet-tdt-0.6b-v3.gguf"), b"fake").unwrap();
    }

    #[test]
    fn auto_english_prefers_downloaded_parakeet() {
        let dir = std::env::temp_dir().join("vox-router-en-parakeet");
        models_with_both(&dir);
        assert_eq!(choose_auto_engine(&dir, "en").id(), "parakeet");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn auto_auto_language_prefers_whisper() {
        let dir = std::env::temp_dir().join("vox-router-auto-whisper");
        models_with_both(&dir);
        // "auto" language could be anything — Parakeet is English-only, so
        // Whisper is the safe default even when Parakeet is installed.
        assert_eq!(choose_auto_engine(&dir, "auto").id(), "whisper");
        assert_eq!(choose_auto_engine(&dir, "hi").id(), "whisper");
        assert_eq!(choose_auto_engine(&dir, "hinglish").id(), "whisper");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn auto_falls_back_to_parakeet_without_whisper_models() {
        let dir = std::env::temp_dir().join("vox-router-only-parakeet");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("parakeet-tdt-0.6b-v2.gguf"), b"fake").unwrap();
        assert_eq!(choose_auto_engine(&dir, "auto").id(), "parakeet");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn auto_english_missing_parakeet_uses_whisper() {
        let dir = std::env::temp_dir().join("vox-router-en-whisper-only");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("base.en.bin"), b"fake").unwrap();
        assert_eq!(choose_auto_engine(&dir, "en").id(), "whisper");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn fallback_candidates_prefer_user_choice() {
        // User's preferred fallback comes first, the failed engine is skipped.
        let candidates = fallback_candidates(Some("parakeet"), "whisper");
        assert_eq!(candidates.first().map(|e| e.id()), Some("parakeet"));
        assert!(candidates.iter().all(|e| e.id() != "whisper"));

        // Preferred fallback equal to the failed engine is skipped; the other
        // engines follow in registry order.
        let candidates = fallback_candidates(Some("whisper"), "whisper");
        assert_eq!(candidates.first().map(|e| e.id()), Some("parakeet"));

        // Every other registered engine appears exactly once.
        for id in ["whisper", "parakeet", "apple"] {
            let count = fallback_candidates(None, "x-none")
                .iter()
                .filter(|e| e.id() == id)
                .count();
            assert_eq!(count, 1, "engine {id} must appear exactly once");
        }
    }

    #[test]
    fn explicit_engine_without_model_surfaces_error_without_fallback() {
        let dir = std::env::temp_dir().join("vox-router-explicit-no-fallback");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("base.en.bin"), b"fake").unwrap();
        let audio = dir.join("audio.wav");
        std::fs::write(&audio, b"fake").unwrap();

        let result = route_transcribe(
            &dir,
            &audio,
            None,
            None,
            None,
            Some("en"),
            EngineSelection {
                preferred: "parakeet",
                fallback_enabled: false,
                preferred_fallback: None,
            },
            |_, _, _| panic!("fallback must not fire when disabled"),
        );
        assert!(
            result.unwrap_err().contains("Download a Parakeet model"),
            "missing-model failure should surface the reason"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn explicit_engine_missing_model_attempts_fallback_when_enabled() {
        let dir = std::env::temp_dir().join("vox-router-explicit-fallback");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("base.en.bin"), b"fake").unwrap();
        let audio = dir.join("audio.wav");
        std::fs::write(&audio, b"fake").unwrap();

        let switches = Mutex::new(Vec::new());
        let result = route_transcribe(
            &dir,
            &audio,
            None,
            None,
            None,
            Some("en"),
            EngineSelection {
                preferred: "parakeet",
                fallback_enabled: true,
                preferred_fallback: Some("whisper"),
            },
            |from, to, reason| {
                switches.lock().unwrap().push((
                    from.to_string(),
                    to.to_string(),
                    reason.to_string(),
                ));
            },
        );
        // The fake whisper model cannot actually load, so the overall request
        // still fails — and no switch is reported until a fallback succeeds.
        let switches = switches.into_inner().unwrap();
        assert!(switches.is_empty(), "no switch until a fallback succeeds");
        assert!(result.is_err());
        std::fs::remove_dir_all(&dir).unwrap_or_else(|_| ());
    }
}
