use std::{
    io::{self, BufRead, Read, Write},
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
    /// Correlates a response with its request in `--serve` mode. One-shot mode
    /// still works without it.
    #[serde(default)]
    id: Option<u64>,
    model_path: String,
    prompt: String,
}

#[derive(Serialize)]
struct SidecarResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn main() {
    if std::env::args().any(|arg| arg == "--serve") {
        // Serve mode: per-request failures are reported as normal error
        // responses; only an unreadable stdin ends the loop.
        if let Err(error) = run_serve() {
            eprintln!("vox-text-enhance serve failed: {error}");
            process::exit(1);
        }
        return;
    }

    if let Err(error) = run_one_shot() {
        write_response(SidecarResponse {
            ok: false,
            id: None,
            text: None,
            error: Some(error),
        });
        process::exit(1);
    }
}

fn run_one_shot() -> Result<(), String> {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| error.to_string())?;
    let request: SidecarRequest = serde_json::from_str(&input)
        .map_err(|error| format!("Invalid sidecar request: {error}"))?;

    let text = generate(Path::new(&request.model_path), &request.prompt)?;
    write_response(SidecarResponse {
        ok: true,
        id: request.id,
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
    let _ = stdout.flush();
}

// ── Persistent serve mode ─────────────────────────────────────────────────────
//
// One-shot mode loads the GGUF model and compiles Metal kernels on every
// request, which costs seconds per dictation. `--serve` keeps the process (and
// the loaded model) alive: requests arrive as line-delimited JSON on stdin,
// responses go back as line-delimited JSON on stdout. The model is reloaded
// lazily only when the requested path differs from the loaded one.

struct ServeState {
    backend: LlamaBackend,
    model: Option<(String, LlamaModel)>,
}

fn run_serve() -> Result<(), String> {
    let backend = LlamaBackend::init().map_err(|error| error.to_string())?;
    let mut state = ServeState {
        backend,
        model: None,
    };

    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let line = line.map_err(|error| error.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let request: SidecarRequest = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(error) => {
                write_response(SidecarResponse {
                    ok: false,
                    id: None,
                    text: None,
                    error: Some(format!("Invalid sidecar request: {error}")),
                });
                continue;
            }
        };

        if let Err(error) = ensure_model_loaded(&mut state, &request.model_path) {
            write_response(SidecarResponse {
                ok: false,
                id: request.id,
                text: None,
                error: Some(error),
            });
            continue;
        }
        let result = state
            .model
            .as_ref()
            .ok_or_else(|| "Model failed to load".to_string())
            .and_then(|(_, model)| generate_with_model(&state.backend, model, &request.prompt));
        let (ok, text, error) = match result {
            Ok(text) => (true, Some(text), None),
            Err(error) => (false, None, Some(error)),
        };
        write_response(SidecarResponse {
            ok,
            id: request.id,
            text,
            error,
        });
    }
    Ok(())
}

/// Load the model on first use and whenever the path changes; otherwise reuse
/// the warm model (the whole point of serve mode). A load failure leaves the
/// cache empty so a later request can retry (e.g. after a re-download).
fn ensure_model_loaded(state: &mut ServeState, model_path: &str) -> Result<(), String> {
    if state
        .model
        .as_ref()
        .map(|(loaded_path, _)| loaded_path.as_str())
        != Some(model_path)
    {
        let started = std::time::Instant::now();
        let model = LlamaModel::load_from_file(
            &state.backend,
            Path::new(model_path),
            &LlamaModelParams::default(),
        )
        .map_err(|error| error.to_string())?;
        eprintln!(
            "model {model_path} loaded in {}ms",
            started.elapsed().as_millis()
        );
        state.model = Some((model_path.to_string(), model));
    }
    Ok(())
}

fn generate_with_model(
    backend: &LlamaBackend,
    model: &LlamaModel,
    prompt: &str,
) -> Result<String, String> {
    let mut context = model
        .new_context(
            backend,
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

/// One-shot path (kept for direct CLI use): init a backend, load the model,
/// generate, exit.
fn generate(model_path: &Path, prompt: &str) -> Result<String, String> {
    let backend = LlamaBackend::init().map_err(|error| error.to_string())?;
    let model = LlamaModel::load_from_file(&backend, model_path, &LlamaModelParams::default())
        .map_err(|error| error.to_string())?;
    generate_with_model(&backend, &model, prompt)
}
