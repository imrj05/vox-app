use std::{
    io::{self, Read, Write},
    num::NonZeroU32,
    path::Path,
    process,
};

use encoding_rs::UTF_8;
use llama_cpp_2::{
    context::params::LlamaContextParams,
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, AddBos, LlamaModel},
    sampling::LlamaSampler,
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct SidecarRequest {
    model_path: String,
    prompt: String,
}

#[derive(Serialize)]
struct SidecarResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn main() {
    if let Err(error) = run() {
        write_response(SidecarResponse {
            ok: false,
            text: None,
            error: Some(error),
        });
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| error.to_string())?;
    let request: SidecarRequest = serde_json::from_str(&input)
        .map_err(|error| format!("Invalid sidecar request: {error}"))?;

    let text = generate_with_llama(Path::new(&request.model_path), &request.prompt)?;
    write_response(SidecarResponse {
        ok: true,
        text: Some(text),
        error: None,
    });
    Ok(())
}

fn write_response(response: SidecarResponse) {
    let Ok(payload) = serde_json::to_string(&response) else {
        eprintln!("Failed to serialize sidecar response");
        return;
    };
    let mut stdout = io::stdout().lock();
    let _ = stdout.write_all(payload.as_bytes());
    let _ = stdout.write_all(b"\n");
}

fn generate_with_llama(model_path: &Path, prompt: &str) -> Result<String, String> {
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
