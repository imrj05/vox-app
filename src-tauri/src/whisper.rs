//! Whisper model management: the bundled model catalog, download pipeline and
//! model-path resolution.
//!
//! Transcription itself lives behind the engine abstraction in
//! [`crate::engines`]: [`transcribe`] resolves the selected model to a path and
//! hands it to the router, which dispatches to the whisper.cpp engine, the
//! Parakeet engine, or (later) Apple Speech based on the model format.

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use tokio::{fs::File, io::AsyncWriteExt};

use serde::Serialize;

/// Kept reachable at the historical `whisper::is_english_only_model` path; the
/// implementation lives with the whisper engine.
#[allow(unused_imports)]
pub use crate::engines::whisper_engine::is_english_only_model;

/// Per-model cancellation/pause flags shared with the frontend. Toggling `pause`
/// makes the download loop stop pulling from the stream; toggling `cancel` aborts
/// the download and deletes the partial file.
#[derive(Default)]
pub struct DownloadControl {
    pub cancel: AtomicBool,
    pub pause: AtomicBool,
}

/// Registry of in-flight downloads keyed by model name.
pub type DownloadRegistry = Mutex<HashMap<String, Arc<DownloadControl>>>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelInfo {
    pub name: &'static str,
    pub display_name: &'static str,
    pub size: u64,
    pub url: &'static str,
    pub downloaded: bool,
    pub recommended: bool,
}

const MODELS: &[WhisperModelInfo] = &[
    WhisperModelInfo {
        name: "tiny.en",
        display_name: "Whisper Tiny",
        size: 77_691_392,
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
        downloaded: false,
        recommended: false,
    },
    WhisperModelInfo {
        name: "base.en",
        display_name: "Whisper Base",
        size: 148_897_792,
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
        downloaded: false,
        recommended: true,
    },
    WhisperModelInfo {
        name: "small.en",
        display_name: "Whisper Small",
        size: 488_505_344,
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
        downloaded: false,
        recommended: false,
    },
    WhisperModelInfo {
        name: "medium.en",
        display_name: "Whisper Medium",
        size: 1_533_116_416,
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin",
        downloaded: false,
        recommended: false,
    },
    WhisperModelInfo {
        name: "tiny",
        display_name: "Whisper Tiny (multilingual)",
        size: 77_691_392,
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
        downloaded: false,
        recommended: false,
    },
    WhisperModelInfo {
        name: "base",
        display_name: "Whisper Base (multilingual)",
        size: 148_897_792,
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        downloaded: false,
        recommended: false,
    },
    WhisperModelInfo {
        name: "small",
        display_name: "Whisper Small (multilingual)",
        size: 488_505_344,
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
        downloaded: false,
        recommended: false,
    },
    WhisperModelInfo {
        name: "medium",
        display_name: "Whisper Medium (multilingual)",
        size: 1_533_116_416,
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
        downloaded: false,
        recommended: false,
    },
    WhisperModelInfo {
        name: "large-v3",
        display_name: "Whisper Large v3",
        size: 3_094_347_776,
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
        downloaded: false,
        recommended: false,
    },
    WhisperModelInfo {
        name: "distil-large-v3",
        display_name: "Distil-Whisper Large v3",
        size: 1_445_068_800,
        url: "https://huggingface.co/distil-whisper/distil-large-v3-ggml/resolve/main/ggml-distil-large-v3.bin",
        downloaded: false,
        recommended: false,
    },
    WhisperModelInfo {
        name: "large-v3-turbo",
        display_name: "Whisper Large v3 Turbo",
        size: 1_583_281_152,
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
        downloaded: false,
        recommended: false,
    },
    WhisperModelInfo {
        name: "parakeet-tdt-0.6b-v2",
        display_name: "Parakeet TDT 0.6B v2",
        size: 729_574_912,
        url: "https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v2-gguf/resolve/main/parakeet-tdt-0.6b-v2-Q8_0.gguf",
        downloaded: false,
        recommended: false,
    },
    WhisperModelInfo {
        name: "parakeet-tdt-0.6b-v3",
        display_name: "Parakeet TDT 0.6B v3",
        size: 739_508_576,
        url: "https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v3-gguf/resolve/main/parakeet-tdt-0.6b-v3-Q8_0.gguf",
        downloaded: false,
        recommended: false,
    },
];

/// Parakeet models are distributed as GGUF and require the Parakeet runtime.
/// Whisper models are GGML `.bin` files loaded by whisper.cpp.
fn model_extension(model_name: &str) -> &'static str {
    if model_name.starts_with("parakeet") {
        "gguf"
    } else {
        "bin"
    }
}

/// Resolve the on-disk path for a model by name, honoring its file extension.
pub fn model_path_for(models_dir: &Path, model_name: &str) -> PathBuf {
    model_path(models_dir, model_name)
}

pub fn models_dir(app_data_dir: PathBuf) -> PathBuf {
    app_data_dir.join("models")
}

pub fn list_models(models_dir: &Path) -> Vec<WhisperModelInfo> {
    MODELS
        .iter()
        .map(|model| WhisperModelInfo {
            downloaded: model_path(models_dir, model.name).exists(),
            ..model.clone()
        })
        .collect()
}

pub async fn download_model(
    models_dir: &Path,
    model_name: &str,
    control: &DownloadControl,
    on_progress: impl Fn(u64, u64),
) -> Result<WhisperModelInfo, String> {
    let model = find_model(model_name)?;
    fs::create_dir_all(models_dir).map_err(|error| error.to_string())?;

    let path = model_path(models_dir, model.name);
    if path.exists() {
        let mut model = model.clone();
        model.downloaded = true;
        return Ok(model);
    }

    if control.cancel.load(Ordering::Relaxed) {
        return Err("Download cancelled".to_string());
    }
    let temp_path = path.with_extension("download");

    // Some CDNs (HuggingFace in particular) throttle or block anonymous, unlabeled
    // clients. A descriptive User-Agent plus a connect timeout avoids receiving a
    // tiny HTML block/challenge page in place of the real model file.
    let client = reqwest::Client::builder()
        .user_agent("Vox/0.0.6 (local dictation; macOS/Windows/Linux)")
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;

    let mut response = client
        .get(model.url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Model download failed with HTTP {} for {}",
            response.status(),
            model.display_name
        ));
    }

    let total = response
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(model.size);

    let mut file = File::create(&temp_path)
        .await
        .map_err(|error| error.to_string())?;
    let mut downloaded: u64 = 0;
    loop {
        if control.cancel.load(Ordering::Relaxed) {
            drop(file);
            let _ = fs::remove_file(&temp_path);
            return Err("Download cancelled".to_string());
        }
        if control.pause.load(Ordering::Relaxed) {
            tokio::time::sleep(std::time::Duration::from_millis(120)).await;
            continue;
        }
        let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? else {
            break;
        };
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        downloaded += chunk.len() as u64;
        on_progress(downloaded, total);
    }

    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);

    let downloaded_size = fs::metadata(&temp_path)
        .map_err(|error| error.to_string())?
        .len();
    if downloaded_size < total / 2 {
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "Download interrupted — received {} of ~{} bytes for {}. \
             Check your internet connection and try again.",
            downloaded_size, total, model.display_name
        ));
    }

    fs::rename(&temp_path, &path).map_err(|error| error.to_string())?;

    let mut model = model.clone();
    model.downloaded = true;
    Ok(model)
}

fn find_model(model_name: &str) -> Result<&'static WhisperModelInfo, String> {
    MODELS
        .iter()
        .find(|model| model.name == model_name)
        .ok_or_else(|| format!("Unknown model: {model_name}"))
}

/// Resolve a model by name — bundled catalog first, then custom models — and
/// require it to exist on disk. Used when the user (or the Models page test
/// widget) explicitly names a model.
pub fn resolve_model_file(models_dir: &Path, model_name: &str) -> Result<PathBuf, String> {
    if let Ok(model) = find_model(model_name) {
        let path = model_path(models_dir, model.name);
        return path
            .exists()
            .then_some(path)
            .ok_or_else(|| format!("Model is not downloaded: {}", model.display_name));
    }
    let custom_path = crate::custom_models::stt_model_path(models_dir, model_name);
    return custom_path
        .exists()
        .then_some(custom_path)
        .ok_or_else(|| format!("Unknown model: {model_name}"));
}

/// Model file for a specific bundled model, if downloaded.
#[allow(dead_code)]
pub fn bundled_model_path(models_dir: &Path, model_name: &str) -> Option<PathBuf> {
    let path = model_path(models_dir, model_name);
    path.exists().then_some(path)
}

fn model_path(models_dir: &Path, model_name: &str) -> PathBuf {
    // Custom models carry their own extension in the name (e.g. "x.gguf").
    if model_name.ends_with(".gguf")
        || model_name.ends_with(".bin")
        || model_name.ends_with(".ggml")
    {
        models_dir.join(model_name)
    } else {
        models_dir.join(format!("{model_name}.{}", model_extension(model_name)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selected_prefers_requested_bundled_model() {
        let dir = std::env::temp_dir().join("vox-model-select-test");
        fs::create_dir_all(&dir).unwrap();
        let target = model_path(&dir, "small");
        fs::write(&target, b"fake").unwrap();

        assert_eq!(
            resolve_model_file(&dir, "small").unwrap(),
            target,
            "explicit model selection should resolve even with other models present"
        );

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn missing_requested_model_is_an_error() {
        let dir = std::env::temp_dir().join("vox-model-missing-test");
        fs::create_dir_all(&dir).unwrap();
        fs::write(model_path(&dir, "base"), b"fake").unwrap();

        assert!(resolve_model_file(&dir, "medium").is_err());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn custom_model_names_keep_their_extension() {
        let dir = std::env::temp_dir().join("vox-model-custom-test");
        fs::create_dir_all(&dir).unwrap();
        let path = model_path(&dir, "my-model.gguf");
        fs::write(&path, b"fake").unwrap();

        assert_eq!(resolve_model_file(&dir, "my-model.gguf").unwrap(), path);

        fs::remove_dir_all(&dir).unwrap();
    }
}
