use std::{
    fs,
    num::NonZeroU32,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::Serialize;
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

#[derive(Default)]
pub struct TextEnhancementEngineState {
    engine: Mutex<Option<LoadedTextEnhancementEngine>>,
}

struct LoadedTextEnhancementEngine {
    model_name: String,
    model_path: PathBuf,
}

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
    state: &TextEnhancementEngineState,
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
    let mut guard = state
        .engine
        .lock()
        .map_err(|_| "Text enhancement engine unavailable".to_string())?;
    let reload = guard
        .as_ref()
        .map(|loaded| loaded.model_name != model.name || loaded.model_path != path)
        .unwrap_or(true);
    if reload {
        *guard = Some(LoadedTextEnhancementEngine {
            model_name: model.name.to_string(),
            model_path: path.clone(),
        });
    }

    let loaded = guard
        .as_ref()
        .ok_or_else(|| "Text enhancement engine unavailable".to_string())?;
    generate_with_llama(&loaded.model_path, &prompt)
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

fn generate_with_llama(model_path: &Path, prompt: &str) -> Result<String, String> {
    use encoding_rs::UTF_8;
    use llama_cpp_2::{
        context::params::LlamaContextParams,
        llama_backend::LlamaBackend,
        llama_batch::LlamaBatch,
        model::{params::LlamaModelParams, AddBos, LlamaModel},
        sampling::LlamaSampler,
    };

    let backend = LlamaBackend::init().map_err(|error| error.to_string())?;
    let model = LlamaModel::load_from_file(&backend, model_path, &LlamaModelParams::default())
        .map_err(|error| error.to_string())?;
    let mut context = model
        .new_context(
            &backend,
            LlamaContextParams::default().with_n_ctx(Some(
                NonZeroU32::new(2048)
                    .ok_or_else(|| "Invalid enhancement context size".to_string())?,
            )),
        )
        .map_err(|error| error.to_string())?;
    let tokens = model
        .str_to_token(prompt, AddBos::Always)
        .map_err(|error| error.to_string())?;
    if tokens.is_empty() {
        return Err("Enhancement prompt was empty".to_string());
    }

    let max_tokens = (tokens.len() + 384).min(2048);
    if tokens.len() >= max_tokens {
        return Err("Input is too long to enhance with the local model".to_string());
    }

    let mut batch = LlamaBatch::new(512, 1);
    let last_index = tokens.len().saturating_sub(1) as i32;
    for (index, token) in (0_i32..).zip(tokens.into_iter()) {
        batch
            .add(token, index, &[0], index == last_index)
            .map_err(|error| error.to_string())?;
    }
    context
        .decode(&mut batch)
        .map_err(|error| error.to_string())?;

    let mut decoder = UTF_8.new_decoder();
    let mut sampler = LlamaSampler::chain_simple([
        LlamaSampler::temp(0.2),
        LlamaSampler::top_p(0.85, 1),
        LlamaSampler::greedy(),
    ]);
    let mut output = String::new();
    let mut cursor = batch.n_tokens();

    while (cursor as usize) <= max_tokens {
        let token = sampler.sample(&context, batch.n_tokens() - 1);
        sampler.accept(token);
        if model.is_eog_token(token) {
            break;
        }

        let piece = model
            .token_to_piece(token, &mut decoder, true, None)
            .map_err(|error| error.to_string())?;
        output.push_str(&piece);
        if output.contains("<|im_end|>") {
            break;
        }

        batch.clear();
        batch
            .add(token, cursor, &[0], true)
            .map_err(|error| error.to_string())?;
        cursor += 1;
        context
            .decode(&mut batch)
            .map_err(|error| error.to_string())?;
    }

    Ok(output)
}
