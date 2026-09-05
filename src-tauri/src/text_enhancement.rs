use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::Instant,
};

use serde::{Deserialize, Serialize};
use tokio::{fs::File, io::AsyncWriteExt};

pub const DEFAULT_TEXT_ENHANCEMENT_MODEL: &str = "qwen2.5-1.5b-instruct-q4-k-m";

/// Aggressiveness of automatic AI cleanup applied to dictated transcripts.
/// `None` keeps the raw transcription; higher levels rephrase more.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CleanupLevel {
    None,
    Light,
    Medium,
    High,
}

impl CleanupLevel {
    pub fn is_enabled(self) -> bool {
        self != CleanupLevel::None
    }
}

impl Default for CleanupLevel {
    fn default() -> Self {
        CleanupLevel::None
    }
}

/// Preset transform applied to selected text via the AI Transform overlay.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransformPreset {
    Polish,
    Concise,
    Professional,
    Casual,
    Summarize,
    FixGrammar,
    PromptEngine,
}

impl TransformPreset {
    fn instruction(self) -> &'static str {
        match self {
            TransformPreset::Polish => "Fix grammar, spelling, punctuation, and flow while preserving the original meaning and language. Return only the rewritten text.",
            TransformPreset::Concise => "Shorten the text, remove redundancy, and preserve the original meaning and language. Return only the rewritten text.",
            TransformPreset::Professional => "Rewrite the text in a formal, polite, workplace-ready tone while preserving the original meaning and language. Return only the rewritten text.",
            TransformPreset::Casual => "Rewrite the text in a friendly, relaxed, conversational tone while preserving the original meaning and language. Return only the rewritten text.",
            TransformPreset::Summarize => "Summarize the text into a brief bullet list of key points. Preserve the original language. Return only the summary.",
            TransformPreset::FixGrammar => "Fix grammar, spelling, and punctuation only. Do not rephrase or change tone. Preserve the original meaning and language. Return only the corrected text.",
            TransformPreset::PromptEngine => "Restructure the text into a clear, well-scoped AI prompt: start with a concise goal statement, then list requirements and constraints as bullet points. Preserve the original language. Return only the prompt.",
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextEnhancementModelInfo {
    pub name: &'static str,
    pub display_name: &'static str,
    pub size: u64,
    pub url: &'static str,
    pub downloaded: bool,
    pub recommended: bool,
}

const MODELS: &[TextEnhancementModelInfo] = &[
    TextEnhancementModelInfo {
        name: DEFAULT_TEXT_ENHANCEMENT_MODEL,
        display_name: "Qwen2.5 1.5B Instruct Q4",
        size: 986_000_000,
        url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
        downloaded: false,
        recommended: true,
    },
    TextEnhancementModelInfo {
        name: "qwen2.5-0.5b-instruct-q4_k_m",
        display_name: "Qwen2.5 0.5B Instruct Q4",
        size: 397_000_000,
        url: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
        downloaded: false,
        recommended: false,
    },
    TextEnhancementModelInfo {
        name: "qwen2.5-3b-instruct-q4_k_m",
        display_name: "Qwen2.5 3B Instruct Q4",
        size: 1_980_000_000,
        url: "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
        downloaded: false,
        recommended: false,
    },
];

pub fn models_dir(app_data_dir: PathBuf) -> PathBuf {
    app_data_dir.join("text-models")
}

pub fn list_models(models_dir: &Path) -> Vec<TextEnhancementModelInfo> {
    MODELS
        .iter()
        .map(|model| TextEnhancementModelInfo {
            downloaded: model_path(models_dir, model.name).exists(),
            ..model.clone()
        })
        .collect()
}

pub async fn download_model(
    models_dir: &Path,
    model_name: &str,
    mut on_progress: impl FnMut(u64, u64) + Send + 'static,
) -> Result<TextEnhancementModelInfo, String> {
    let model = find_model(model_name)?;
    fs::create_dir_all(models_dir).map_err(|error| error.to_string())?;

    let path = model_path(models_dir, model.name);
    if path.exists() {
        let mut model = model.clone();
        model.downloaded = true;
        return Ok(model);
    }

    let tmp_path = path.with_extension("part");
    let mut response = reqwest::get(model.url)
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Enhancement model download failed with HTTP {}",
            response.status()
        ));
    }

    let total = response
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(model.size);

    let mut file = File::create(&tmp_path)
        .await
        .map_err(|error| error.to_string())?;
    let mut downloaded = 0_u64;

    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        downloaded += chunk.len() as u64;
        on_progress(downloaded, total);
    }

    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);

    let downloaded_size = fs::metadata(&tmp_path)
        .map_err(|error| error.to_string())?
        .len();
    if downloaded_size < model.size / 2 {
        let _ = fs::remove_file(&tmp_path);
        return Err("Downloaded enhancement model is unexpectedly small".to_string());
    }

    fs::rename(&tmp_path, &path).map_err(|error| error.to_string())?;
    let mut model = model.clone();
    model.downloaded = true;
    Ok(model)
}

pub fn delete_model(models_dir: &Path, model_name: &str) -> Result<(), String> {
    let model = find_model(model_name)?;
    let path = model_path(models_dir, model.name);
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn enhance_text(
    models_dir: &Path,
    model_name: Option<&str>,
    text: &str,
) -> Result<String, String> {
    let model_name = model_name.unwrap_or(DEFAULT_TEXT_ENHANCEMENT_MODEL);
    let path = resolve_model_path(models_dir, model_name)?;
    if !path.exists() {
        return Err(format!("Download {model_name} before enhancing text"));
    }

    let prompt = enhancement_prompt(text);
    run_sidecar(&path, &prompt)
        .map(clean_model_output)
        .and_then(|output| {
            if output.trim().is_empty() {
                Err("Enhancement returned empty text".to_string())
            } else {
                Ok(output)
            }
        })
}

/// Run AI cleanup on a transcript at the requested level. Falls back to the
/// original text if the model is unavailable or returns empty output, so the
/// auto-cleanup path never blocks transcription.
///
/// `style` is an optional app-context writing-style instruction (e.g. "write in
/// a professional email style") derived from the active application.
pub fn enhance_text_with_level(
    models_dir: &Path,
    model_name: Option<&str>,
    text: &str,
    level: CleanupLevel,
    style: Option<&str>,
) -> Result<String, String> {
    if !level.is_enabled() {
        return Ok(text.to_string());
    }

    let model_name = model_name.unwrap_or(DEFAULT_TEXT_ENHANCEMENT_MODEL);
    let path = resolve_model_path(models_dir, model_name)?;
    if !path.exists() {
        return Err(format!(
            "Download {model_name} before cleaning up transcripts"
        ));
    }

    let prompt = cleanup_prompt(text, level, style);
    match run_sidecar(&path, &prompt).map(clean_model_output) {
        Ok(output) if !output.trim().is_empty() => Ok(output),
        // Never let a failed/empty cleanup block transcription.
        _ => Ok(text.to_string()),
    }
}

/// Transform selected text using a preset or custom instruction.
pub fn transform_text(
    models_dir: &Path,
    model_name: Option<&str>,
    text: &str,
    preset: Option<TransformPreset>,
    custom_instruction: Option<&str>,
) -> Result<String, String> {
    let model_name = model_name.unwrap_or(DEFAULT_TEXT_ENHANCEMENT_MODEL);
    let path = resolve_model_path(models_dir, model_name)?;
    if !path.exists() {
        return Err(format!("Download {model_name} before transforming text"));
    }

    let prompt = transform_prompt(text, preset, custom_instruction);
    run_sidecar(&path, &prompt)
        .map(clean_model_output)
        .and_then(|output| {
            if output.trim().is_empty() {
                Err("Transform returned empty text".to_string())
            } else {
                Ok(output)
            }
        })
}

fn find_model(model_name: &str) -> Result<&'static TextEnhancementModelInfo, String> {
    MODELS
        .iter()
        .find(|model| model.name == model_name)
        .ok_or_else(|| format!("Unknown enhancement model: {model_name}"))
}

/// Resolve the on-disk path for an enhancement model, supporting both built-in
/// models and custom models added via URL (which live in the dir under their
/// file name).
fn resolve_model_path(models_dir: &Path, model_name: &str) -> Result<PathBuf, String> {
    if let Ok(model) = find_model(model_name) {
        return Ok(model_path(models_dir, model.name));
    }
    let custom_path = crate::custom_models::enhance_model_path(models_dir, model_name);
    if custom_path.exists() {
        return Ok(custom_path);
    }
    Err(format!("Unknown enhancement model: {model_name}"))
}

fn model_path(models_dir: &Path, model_name: &str) -> PathBuf {
    // Custom models carry their own extension in the name (e.g. "x.gguf").
    if model_name.ends_with(".gguf") {
        models_dir.join(model_name)
    } else {
        models_dir.join(format!("{model_name}.gguf"))
    }
}

/// Strong instruction that keeps the model from translating the input. The
/// Qwen2.5 model defaults to English output, so this must be explicit.
const PRESERVE_LANGUAGE: &str = "Respond in the EXACT SAME language as the input text. If the input is in Hindi, write in Hindi (Devanagari script). If it is Hinglish (Hindi-English mix), keep the same mix. Never translate to English or any other language.";

fn enhancement_prompt(text: &str) -> String {
    format!(
        "<|im_start|>system\nYou rewrite dictated text. {PRESERVE_LANGUAGE} Remove filler words (um, uh, like, you know), fix grammar, spelling, punctuation, and clarity, and make the text read naturally. Keep formatting where possible. Return only the rewritten text.<|im_end|>\n<|im_start|>user\nRewrite this text clearly and naturally:\n\n{}<|im_end|>\n<|im_start|>assistant\n",
        text.trim()
    )
}

fn transform_prompt(
    text: &str,
    preset: Option<TransformPreset>,
    custom_instruction: Option<&str>,
) -> String {
    let instruction = if let Some(preset) = preset {
        preset.instruction()
    } else {
        custom_instruction.unwrap_or("Rewrite the following text while preserving its meaning and language. Return only the rewritten text.")
    };
    format!(
        "<|im_start|>system\n{instruction}\n{PRESERVE_LANGUAGE}\n<|im_end|>\n<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n",
        text.trim()
    )
}

/// Build a cleanup prompt for the given level. The prompt instructs the model to
/// preserve meaning, language, technical terms, code, names, paths, and URLs,
/// while removing filler words and self-corrections and fixing
/// grammar/punctuation. Higher levels rephrase and format more aggressively.
///
/// `style` is an optional app-context writing-style instruction appended to the
/// system prompt (e.g. professional email, casual chat, structured document).
fn cleanup_prompt(text: &str, level: CleanupLevel, style: Option<&str>) -> String {
    let instruction = match level {
        CleanupLevel::Light => "Lightly clean up dictated text. Preserve the original meaning and language. Only fix obvious spelling, capitalization, and punctuation, and remove only clear filler words such as 'um' and 'uh'. Do not rephrase, restructure, or rewrite. Keep all technical terms, code, names, paths, and formatting verbatim.",
        CleanupLevel::Medium => "Clean up dictated speech. Preserve the original meaning and language. Remove filler words (um, uh, like) and remove false starts and self-corrections: when the speaker corrects themselves, keep only the final corrected version (for example 'let's meet at 2... actually 3 PM' becomes 'Let's meet at 3 PM.'). Fix grammar, spelling, capitalization, and punctuation, and make sentences concise without changing meaning. Keep all technical terms, code, names, paths, and formatting verbatim.",
        CleanupLevel::High => "Aggressively but faithfully clean up dictated speech. Preserve the original meaning and language. Remove filler words, false starts, and self-corrections (keep only the corrected version), fix grammar, spelling, capitalization, and punctuation, rephrase for clarity and conciseness, and organize into clean paragraphs and lists where appropriate, without changing meaning. Also remove meta-commentary: sentences that describe the dictation or writing process itself (for example 'there is lots of noise and some other text that should not be there' or 'I want to write an essay about my life') — keep only the actual content. Keep all technical terms, code, names, paths, and URLs verbatim.",
        CleanupLevel::None => "",
    };
    let instruction = format!("{instruction} {PRESERVE_LANGUAGE}");
    let style_instruction = style
        .map(|style| format!("\nStyle: {style}"))
        .unwrap_or_default();
    format!(
        "<|im_start|>system\n{}{} Return only the cleaned text, with no commentary.<|im_end|>\n<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n",
        instruction,
        style_instruction,
        text.trim()
    )
}

fn clean_model_output(output: String) -> String {
    output
        .replace("<|im_end|>", "")
        .replace("<|endoftext|>", "")
        .trim()
        .trim_matches('"')
        .trim()
        .to_string()
}

// ── Persistent sidecar session ─────────────────────────────────────...
// The sidecar stays alive in `--serve` mode with the GGUF model (and compiled
// Metal kernels) kept warm, which removes the per-request model-load cost —
// seconds per call when spawning a fresh process each time. One global session
// serializes requests; an exited sidecar is transparently respawned once.
struct EnhanceServeSession {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_request_id: u64,
}

fn serve_session_cell() -> &'static Mutex<Option<EnhanceServeSession>> {
    static SERVE_SESSION: OnceLock<Mutex<Option<EnhanceServeSession>>> = OnceLock::new();
    SERVE_SESSION.get_or_init(|| Mutex::new(None))
}

fn spawn_serve_session() -> Result<EnhanceServeSession, String> {
    let sidecar = sidecar_path()?;
    let mut child = Command::new(&sidecar)
        .arg("--serve")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start text enhancement sidecar: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Text enhancement sidecar stdin unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Text enhancement sidecar stdout unavailable".to_string())?;
    Ok(EnhanceServeSession {
        child,
        stdin,
        stdout: BufReader::new(stdout),
        next_request_id: 0,
    })
}

fn stop_serve_session(session: EnhanceServeSession) {
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

/// Sends one enhancement request over the persistent session. `Ok(response)`
/// includes application-level errors (`ok: false`); a transport-level `Err`
/// means the sidecar is gone and the request never completed.
fn request_enhancement(
    session: &mut EnhanceServeSession,
    model_path: &str,
    prompt: &str,
) -> Result<serde_json::Value, String> {
    session.next_request_id += 1;
    let id = session.next_request_id;
    let request = serde_json::json!({
        "id": id,
        "model_path": model_path,
        "prompt": prompt,
    });
    let mut line = serde_json::to_string(&request)
        .map_err(|error| format!("Text enhancement request encoding failed: {error}"))?;
    line.push('\n');

    session
        .stdin
        .write_all(line.as_bytes())
        .map_err(|error| format!("Text enhancement sidecar stopped accepting requests: {error}"))?;
    session
        .stdin
        .flush()
        .map_err(|error| format!("Text enhancement sidecar stopped accepting requests: {error}"))?;

    loop {
        let mut response = String::new();
        let bytes = session
            .stdout
            .read_line(&mut response)
            .map_err(|error| format!("Text enhancement sidecar failed: {error}"))?;
        if bytes == 0 {
            return Err("Text enhancement sidecar exited unexpectedly".to_string());
        }
        let parsed: serde_json::Value = match serde_json::from_str(response.trim()) {
            Ok(value) => value,
            Err(_) => continue, // diagnostics line from the sidecar — skip
        };
        if parsed.get("id").and_then(serde_json::Value::as_u64) == Some(id) {
            return Ok(parsed);
        }
        // A response for an older attempt — skip.
    }
}

fn sidecar_output(response: serde_json::Value) -> Result<String, String> {
    if response
        .get("ok")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
    {
        return response
            .get("text")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "Text enhancement sidecar returned no text".to_string());
    }
    Err(response
        .get("error")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("Text enhancement sidecar failed")
        .to_string())
}

/// Runs one enhancement request against the persistent sidecar session.
/// A dead sidecar is transparently respawned and the request retried once.
fn run_sidecar(model_path: &Path, prompt: &str) -> Result<String, String> {
    let started = Instant::now();
    let lock = serve_session_cell();
    // A poisoned lock only matters if a panic happened mid-request; recover so
    // enhancement never gets permanently wedged.
    let mut guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    let model_arg = model_path.to_string_lossy().into_owned();
    let mut attempts = 0;
    loop {
        attempts += 1;
        if guard.is_none() {
            *guard = Some(spawn_serve_session()?);
        }
        let session = guard.as_mut().unwrap();
        match request_enhancement(session, &model_arg, prompt) {
            Ok(response) => {
                let result = sidecar_output(response);
                // First cold request includes process spawn + model load; log
                // it so warm vs cold requests are distinguishable in logs.
                eprintln!(
                    "[VOX][AI] text-enhance request finished in {}ms (attempt {})",
                    started.elapsed().as_millis(),
                    attempts
                );
                return result;
            }
            Err(transport_error) => {
                if let Some(session) = guard.take() {
                    stop_serve_session(session);
                }
                if attempts >= 2 {
                    return Err(format!(
                        "Text enhancement sidecar failed: {transport_error}"
                    ));
                }
                eprintln!("[VOX][AI] text-enhance session died ({transport_error}); respawning");
            }
        }
    }
}

fn sidecar_path() -> Result<PathBuf, String> {
    if let Ok(current_exe) = tauri::utils::platform::current_exe() {
        if let Some(dir) = current_exe.parent() {
            if let Some(path) = find_sidecar_in_dir(dir) {
                return Ok(path);
            }
        }
    }

    let dev_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin");
    if let Some(path) = find_sidecar_in_dir(&dev_dir) {
        return Ok(path);
    }

    Err(
        "Text enhancement sidecar not found. Run `pnpm build:text-enhance-sidecar` and rebuild the app."
            .to_string(),
    )
}

fn find_sidecar_in_dir(dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if file_name.starts_with("vox-text-enhance-") {
            let path = entry.path();
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}
