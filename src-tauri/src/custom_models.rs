//! Custom model registry: users can add Hugging Face model URLs and Vox
//! downloads them for speech-to-text (STT) or text enhancement (LLM).
//!
//! Capability detection inspects the URL's file extension and model family to
//! decide which pipeline a model belongs to, with an explicit override.

use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// Which pipeline a model feeds: speech-to-text (whisper.cpp / Parakeet) or
/// text enhancement (the local LLM sidecar).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CustomModelKind {
    Stt,
    Enhance,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomModel {
    /// File name derived from the URL (e.g. "qwen2.5-3b-instruct-q4_k_m.gguf").
    pub name: String,
    pub url: String,
    pub kind: CustomModelKind,
    pub size: u64,
    pub downloaded: bool,
}

fn registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("custom-models.json"))
}

pub fn load_registry(app: &AppHandle) -> Vec<CustomModel> {
    let Ok(path) = registry_path(app) else {
        return Vec::new();
    };
    let Ok(data) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    serde_json::from_str(&data).unwrap_or_default()
}

fn save_registry(app: &AppHandle, models: &[CustomModel]) -> Result<(), String> {
    let path = registry_path(app)?;
    let data = serde_json::to_string_pretty(models).map_err(|error| error.to_string())?;
    fs::write(&path, data).map_err(|error| error.to_string())
}

/// Resolve the on-disk file for a custom model.
pub fn model_file_path(
    app: &AppHandle,
    name: &str,
    kind: CustomModelKind,
) -> Result<PathBuf, String> {
    let dir = match kind {
        CustomModelKind::Stt => app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("models"),
        CustomModelKind::Enhance => app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("text-models"),
    };
    Ok(dir.join(name))
}

/// Resolution helper for whisper.rs: a custom STT model lives directly in the
/// models dir under its file name.
pub fn stt_model_path(models_dir: &Path, name: &str) -> PathBuf {
    models_dir.join(name)
}

/// Whether any user-added whisper.cpp-compatible model file exists in
/// `models_dir` (`.bin`/`.ggml`). GGUF files belong to the Parakeet engine and
/// are deliberately not counted here.
#[allow(dead_code)]
pub fn has_downloaded_stt_models(models_dir: &Path) -> bool {
    fs::read_dir(models_dir)
        .map(|entries| {
            entries.flatten().any(|entry| {
                entry
                    .path()
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| matches!(extension, "bin" | "ggml"))
            })
        })
        .unwrap_or(false)
}

/// Resolution helper for text_enhancement.rs: a custom LLM lives directly in
/// the text-models dir under its file name.
pub fn enhance_model_path(models_dir: &Path, name: &str) -> PathBuf {
    models_dir.join(name)
}

fn validate_url(url: &str) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Only https:// URLs are supported".to_string());
    }
    Ok(())
}

fn model_name_from_url(url: &str) -> Result<String, String> {
    let file_name = url
        .rsplit('/')
        .next()
        .filter(|part| !part.is_empty())
        .ok_or_else(|| "URL must point to a model file".to_string())?;
    if !file_name.contains('.') {
        return Err("URL must point to a model file (e.g. model.gguf)".to_string());
    }
    Ok(file_name.to_string())
}

/// LLM model families that the text-enhancement sidecar can load.
const LLM_FAMILIES: &[&str] = &[
    "qwen",
    "llama",
    "mistral",
    "phi",
    "gemma",
    "deepseek",
    "olmo",
    "falcon",
    "yi-",
    "baichuan",
    "internlm",
    "granite",
    "smollm",
    "stablelm",
    "gpt",
    "aya",
    "command-r",
    "nemotron",
    "minicpm",
    "glm",
    "starcoder",
    "codellama",
    "dbrx",
    "jais",
    "mpt",
];

/// Detect which pipeline a model URL belongs to based on file extension and
/// model family. Returns an error when the type is ambiguous.
pub fn detect_model_kind(url: &str) -> Result<CustomModelKind, String> {
    let lower = url.to_lowercase();
    let file_name = url.rsplit('/').next().unwrap_or("");
    let ext = file_name.rsplit('.').next().unwrap_or("").to_lowercase();

    match ext.as_str() {
        // whisper.cpp GGML binaries are always speech-to-text.
        "bin" | "ggml" => Ok(CustomModelKind::Stt),
        "gguf" => {
            if lower.contains("parakeet") || lower.contains("whisper") {
                Ok(CustomModelKind::Stt)
            } else if LLM_FAMILIES.iter().any(|family| lower.contains(family)) {
                Ok(CustomModelKind::Enhance)
            } else {
                Err(
                    "Ambiguous GGUF model — specify whether it is for speech-to-text or text enhancement."
                        .to_string(),
                )
            }
        }
        other => Err(format!("Unsupported model file type: .{other}")),
    }
}

/// Download a file from `url` to `dest` with progress callbacks. Reuses the
/// same streaming pattern as the built-in model downloads.
async fn download_to(
    url: &str,
    dest: &Path,
    on_progress: impl Fn(u64, u64),
) -> Result<u64, String> {
    let client = reqwest::Client::builder()
        .user_agent("Vox/0.0.6 (local dictation; macOS/Windows/Linux)")
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;

    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Model download failed with HTTP {}",
            response.status()
        ));
    }

    let total = response
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);

    let temp_path = dest.with_extension("download");
    let mut file = tokio::fs::File::create(&temp_path)
        .await
        .map_err(|error| error.to_string())?;
    let mut downloaded: u64 = 0;
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        use tokio::io::AsyncWriteExt;
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        downloaded += chunk.len() as u64;
        on_progress(downloaded, total);
    }
    use tokio::io::AsyncWriteExt;
    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);

    let size = fs::metadata(&temp_path)
        .map_err(|error| error.to_string())?
        .len();
    if total > 0 && size < total / 2 {
        let _ = fs::remove_file(&temp_path);
        return Err("Downloaded file is unexpectedly small".to_string());
    }
    fs::rename(&temp_path, dest).map_err(|error| error.to_string())?;
    Ok(size)
}

/// Validate the URL, detect (or accept) the model kind, download the file, and
/// persist it in the registry.
pub async fn add_custom_model(
    app: &AppHandle,
    url: &str,
    kind: Option<CustomModelKind>,
) -> Result<CustomModel, String> {
    let url = url.trim();
    validate_url(url)?;
    let name = model_name_from_url(url)?;
    let kind = match kind {
        Some(kind) => kind,
        None => detect_model_kind(url)?,
    };

    let mut registry = load_registry(app);
    if registry.iter().any(|model| model.name == name) {
        return Err(format!("Model \"{name}\" is already added"));
    }

    let dest = model_file_path(app, &name, kind)?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let progress_name = name.clone();
    let app_progress = app.clone();
    let size = download_to(url, &dest, move |downloaded, total| {
        let _ = app_progress.emit(
            "vox-custom-model-download-progress",
            serde_json::json!({
                "modelName": progress_name,
                "downloaded": downloaded,
                "total": total,
            }),
        );
    })
    .await?;

    let model = CustomModel {
        name,
        url: url.to_string(),
        kind,
        size,
        downloaded: true,
    };
    registry.push(model.clone());
    save_registry(app, &registry)?;
    Ok(model)
}

/// Remove a custom model's file and registry entry.
pub fn delete_custom_model(app: &AppHandle, name: &str) -> Result<(), String> {
    let mut registry = load_registry(app);
    let Some(index) = registry.iter().position(|model| model.name == name) else {
        return Err(format!("Unknown custom model: {name}"));
    };
    let model = registry.remove(index);
    if let Ok(path) = model_file_path(app, &name, model.kind) {
        if path.exists() {
            fs::remove_file(&path).map_err(|error| error.to_string())?;
        }
    }
    save_registry(app, &registry)
}
