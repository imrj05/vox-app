use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use serde::{Deserialize, Serialize};
use tokio::{fs::File, io::AsyncWriteExt};

pub const DEFAULT_TEXT_ENHANCEMENT_MODEL: &str = "qwen2.5-1.5b-instruct-q4-k-m";

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

const MODELS: &[TextEnhancementModelInfo] = &[TextEnhancementModelInfo {
    name: DEFAULT_TEXT_ENHANCEMENT_MODEL,
    display_name: "Qwen2.5 1.5B Instruct Q4",
    size: 986_000_000,
    url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
    downloaded: false,
    recommended: true,
}];

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
    let model = find_model(model_name)?;
    let path = model_path(models_dir, model.name);
    if !path.exists() {
        return Err(format!(
            "Download {} before enhancing text",
            model.display_name
        ));
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

fn find_model(model_name: &str) -> Result<&'static TextEnhancementModelInfo, String> {
    MODELS
        .iter()
        .find(|model| model.name == model_name)
        .ok_or_else(|| format!("Unknown enhancement model: {model_name}"))
}

fn model_path(models_dir: &Path, model_name: &str) -> PathBuf {
    models_dir.join(format!("{model_name}.gguf"))
}

fn enhancement_prompt(text: &str) -> String {
    format!(
        "<|im_start|>system\nYou rewrite text. Preserve the original meaning and language. Fix grammar, punctuation, and clarity. Keep formatting where possible. Return only the rewritten text.<|im_end|>\n<|im_start|>user\nRewrite this text clearly and naturally:\n\n{}<|im_end|>\n<|im_start|>assistant\n",
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

#[derive(Serialize)]
struct SidecarRequest {
    model_path: String,
    prompt: String,
}

#[derive(Deserialize)]
struct SidecarResponse {
    ok: bool,
    text: Option<String>,
    error: Option<String>,
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

fn run_sidecar(model_path: &Path, prompt: &str) -> Result<String, String> {
    let sidecar = sidecar_path()?;
    let request = SidecarRequest {
        model_path: model_path.to_string_lossy().into_owned(),
        prompt: prompt.to_string(),
    };
    let input = serde_json::to_string(&request).map_err(|error| error.to_string())?;

    let mut child = Command::new(&sidecar)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start text enhancement sidecar: {error}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(input.as_bytes())
            .map_err(|error| format!("Failed to write to text enhancement sidecar: {error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Failed to run text enhancement sidecar: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stderr.is_empty() {
            format!(
                "Text enhancement sidecar exited with status {}",
                output.status
            )
        } else {
            stderr
        };
        return Err(message);
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|error| format!("Text enhancement sidecar returned invalid UTF-8: {error}"))?;
    let response: SidecarResponse = serde_json::from_str(stdout.trim())
        .map_err(|error| format!("Text enhancement sidecar returned invalid JSON: {error}"))?;
    if response.ok {
        response
            .text
            .ok_or_else(|| "Text enhancement sidecar returned no text".to_string())
    } else {
        Err(response
            .error
            .unwrap_or_else(|| "Text enhancement sidecar failed".to_string()))
    }
}
