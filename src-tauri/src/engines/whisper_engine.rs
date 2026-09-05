//! Whisper engine — whisper.cpp backend (whisper-rs, Metal GPU on Apple
//! Silicon with automatic CPU fallback). Supports GGML `.bin` models, custom
//! dictionary/context prompts, language pinning and auto-detection.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState,
};

use super::audio::read_wav_as_16khz_mono;
use super::{
    EngineAvailability, EngineKind, TranscriptionEngine, TranscriptionOutput, TranscriptionRequest,
};

pub struct WhisperEngine;

impl TranscriptionEngine for WhisperEngine {
    fn kind(&self) -> EngineKind {
        EngineKind::Whisper
    }

    fn display_name(&self) -> &'static str {
        "Whisper"
    }

    /// whisper.cpp drives the bundled GGML `.bin` models and any custom
    /// `.bin`/`.ggml` file. `.gguf` belongs to Parakeet.
    fn handles_model(&self, model_path: &Path) -> bool {
        matches!(
            model_path.extension().and_then(|e| e.to_str()),
            Some("bin") | Some("ggml")
        )
    }

    fn availability(&self, models_dir: &Path) -> EngineAvailability {
        // Usable if any bundled model has been downloaded. Custom models added
        // via the Models page also count.
        let bundled = crate::whisper::list_models(models_dir)
            .iter()
            .any(|model| model.downloaded && !model.name.starts_with("parakeet"));
        let custom = crate::custom_models::has_downloaded_stt_models(models_dir);
        if bundled || custom {
            EngineAvailability::available()
        } else {
            EngineAvailability::unavailable("No Whisper model downloaded")
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

        // Engine-driven choice: recommended downloaded model first, then any
        // downloaded whisper.cpp model, then user-added custom models.
        let bundled: Vec<_> = crate::whisper::list_models(models_dir)
            .into_iter()
            .filter(|model| !model.name.starts_with("parakeet"))
            .collect();
        let recommended = bundled
            .iter()
            .find(|model| model.recommended && model.downloaded);
        let any = bundled.iter().find(|model| model.downloaded);
        if let Some(model) = recommended.or(any) {
            let path = crate::whisper::bundled_model_path(models_dir, model.name)
                .ok_or_else(|| format!("Model is not downloaded: {}", model.display_name))?;
            return Ok(Some(path));
        }

        // No bundled model — fall back to any user-added STT model.
        if let Some(path) = find_custom_model(models_dir) {
            return Ok(Some(path));
        }

        Err("Download a Whisper model before transcribing".to_string())
    }

    fn transcribe(&self, request: &TranscriptionRequest) -> Result<TranscriptionOutput, String> {
        transcribe_with_whisper(request)
    }
}

/// `true` for whisper.cpp English-only models (names ending in `.en`).
pub fn is_english_only_model(model_path: &str) -> bool {
    let name = model_path.rsplit(['/', '\\']).next().unwrap_or(model_path);
    name.to_ascii_lowercase().contains(".en.") || name.to_ascii_lowercase().ends_with(".en")
}

fn transcribe_with_whisper(request: &TranscriptionRequest) -> Result<TranscriptionOutput, String> {
    let model_path = request
        .model_path
        .ok_or_else(|| "Whisper engine requires a model file".to_string())?;
    let model_path = model_path
        .to_str()
        .ok_or_else(|| "Model path contains invalid UTF-8".to_string())?;
    // English-only models (tiny.en, base.en, …) cannot transcribe other
    // languages; fail fast with a helpful message instead of garbage output.
    let requested = request.language.map(str::trim).filter(|v| !v.is_empty());
    if let Some(requested) = requested {
        if requested != "auto" && requested != "en" && is_english_only_model(model_path) {
            return Err(
                "The selected model is English-only. Download a multilingual model (Whisper Large v3, Turbo, or Parakeet v3) to dictate in other languages."
                    .to_string(),
            );
        }
    }

    // Language pinning / auto-detection: "auto" / "hinglish" → None so
    // whisper.cpp auto-detects the language; explicit codes ("en", "hi", …)
    // pin the language.
    let whisper_language = match requested {
        Some("auto") | Some("hinglish") | None => None,
        Some(code) => Some(code),
    };
    let prompt = dictionary_prompt(request.dictionary, request.context);

    // Decoding runs on the cached context's fresh state each time — the
    // expensive part (model load + GPU kernel compile) happens once.
    let mut state = cached_whisper_state(model_path)?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(whisper_language);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_suppress_blank(true);
    if let Some(prompt) = prompt.as_deref() {
        params.set_initial_prompt(prompt);
    }
    params.set_n_threads(
        std::thread::available_parallelism()
            .map(|threads| threads.get().saturating_sub(1).max(1) as i32)
            .unwrap_or(4),
    );

    let audio = read_wav_as_16khz_mono(request.audio_path)?;
    if audio.len() < 8_000 {
        return Err("Recording too short to transcribe".to_string());
    }

    state
        .full(params, &audio)
        .map_err(|error| error.to_string())?;

    let mut text = String::new();
    for segment in state.as_iter() {
        text.push_str(&segment.to_string());
        text.push(' ');
    }

    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Whisper returned an empty transcript".to_string());
    }

    // Report the language whisper.cpp actually used (auto-detected or pinned).
    let detected = whisper_rs::get_lang_str(state.full_lang_id_from_state()).map(str::to_string);

    Ok(TranscriptionOutput::new("whisper", text, detected))
}

/// Cache keyed by model file path. Dictation is single-user, so holding the
/// lock for the whole transcription is fine and serializes access naturally.
type WhisperContextCache = Mutex<Option<(PathBuf, WhisperContext)>>;

fn whisper_context_cache() -> &'static WhisperContextCache {
    static CACHE: OnceLock<WhisperContextCache> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

/// Load the requested model (or reuse the cached context when the path is
/// unchanged) and create a fresh decode state. Loading a large-v3-turbo model
/// from disk plus Metal kernel compilation takes many seconds — doing that on
/// every dictation was the dominant transcription latency.
fn cached_whisper_state(model_path: &str) -> Result<WhisperState, String> {
    let mut cache = whisper_context_cache()
        .lock()
        .map_err(|_| "Whisper context cache is unavailable".to_string())?;

    if cache.as_ref().map(|(path, _)| path.as_path()) != Some(Path::new(model_path)) {
        eprintln!("[VOX][ASR] whisper: loading model {model_path}");
        let context = load_whisper_context(model_path)?;
        *cache = Some((PathBuf::from(model_path), context));
        eprintln!("[VOX][ASR] whisper: model loaded (cached for reuse)");
    }

    let (_, context) = cache.as_ref().expect("context is present after load");
    context.create_state().map_err(|error| error.to_string())
}

fn load_whisper_context(model_path: &str) -> Result<WhisperContext, String> {
    let mut ctx_params = WhisperContextParameters::default();
    ctx_params.use_gpu(true);

    WhisperContext::new_with_params(model_path, ctx_params)
        .or_else(|gpu_error| {
            eprintln!("[VOX][ASR] whisper: GPU init failed ({gpu_error}), falling back to CPU");
            let mut cpu_params = WhisperContextParameters::default();
            cpu_params.use_gpu(false);
            WhisperContext::new_with_params(model_path, cpu_params)
        })
        .map_err(|error| error.to_string())
}

/// First user-added whisper.cpp-compatible model file in `models_dir`.
fn find_custom_model(models_dir: &Path) -> Option<PathBuf> {
    fs::read_dir(models_dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| {
            path.is_file()
                && matches!(
                    path.extension().and_then(|e| e.to_str()),
                    Some("bin") | Some("ggml")
                )
        })
}

fn dictionary_prompt(dictionary: Option<&str>, context: Option<&str>) -> Option<String> {
    let entries: Vec<String> = dictionary
        .into_iter()
        .flat_map(|dictionary| dictionary.lines())
        .flat_map(dictionary_entries_from_line)
        .take(100)
        .collect();

    let context = context.and_then(|context| {
        let context = context.trim();
        (!context.is_empty()).then_some(context)
    });

    if entries.is_empty() && context.is_none() {
        return None;
    }

    let mut prompt = String::new();
    if let Some(context) = context {
        prompt.push_str(context);
        prompt.push(' ');
    }

    if !entries.is_empty() {
        prompt.push_str("Prefer these vocabulary terms when relevant: ");
        prompt.push_str(&entries.join(", "));
        prompt.push('.');
    }

    Some(prompt)
}

fn dictionary_entries_from_line(line: &str) -> Vec<String> {
    if line.contains('|') {
        let parts: Vec<&str> = line.split('|').map(str::trim).collect();
        let word = parts.first().copied().unwrap_or_default();
        let hint = parts.get(1).copied().unwrap_or_default();
        if word.is_empty() {
            Vec::new()
        } else if hint.is_empty() {
            vec![word.to_string()]
        } else {
            vec![format!("{word} (pronounced {hint})")]
        }
    } else {
        line.split(',')
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .map(str::to_string)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_english_only_models() {
        assert!(is_english_only_model("/models/ggml-base.en.bin"));
        assert!(is_english_only_model("ggml-small.en.bin"));
        assert!(!is_english_only_model("ggml-large-v3.bin"));
        assert!(!is_english_only_model("parakeet-tdt-0.6b-v3-Q8_0.gguf"));
    }

    #[test]
    fn builds_prompt_from_dictionary_and_context() {
        let prompt = dictionary_prompt(
            Some("Supabase\nTauri | tow-ree"),
            Some("You are in VS Code."),
        )
        .unwrap();
        assert!(prompt.starts_with("You are in VS Code."));
        assert!(prompt.contains("Tauri (pronounced tow-ree)"));
        assert!(prompt.contains("Supabase"));
    }

    #[test]
    fn no_prompt_without_dictionary_or_context() {
        assert!(dictionary_prompt(None, None).is_none());
        assert!(dictionary_prompt(Some(""), Some("  ")).is_none());
    }

    #[test]
    fn whisper_engine_claims_ggml_bin_only() {
        let engine = WhisperEngine;
        assert!(engine.handles_model(Path::new("m/ggml-base.en.bin")));
        assert!(engine.handles_model(Path::new("m/custom.ggml")));
        assert!(!engine.handles_model(Path::new("m/model.gguf")));
        assert!(!engine.handles_model(Path::new("m/notes.txt")));
    }
}
