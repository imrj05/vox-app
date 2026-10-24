use std::{
    io::{self, BufRead, Read, Write},
    num::NonZeroU32,
    path::Path,
    process,
};

use encoding_rs::UTF_8;
use llama_cpp_2::{
    context::{params::LlamaContextParams, LlamaContext},
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, AddBos, LlamaModel},
    sampling::LlamaSampler,
    token::LlamaToken,
};
use self_cell::self_cell;
use serde::{Deserialize, Serialize};

/// Context window shared by every request. The prompt and the generated tokens
/// must both fit inside this.
const N_CTX: u32 = 2048;
/// Extra output tokens allowed beyond the input length, so a faithful rewrite
/// has room to grow slightly without letting the model ramble.
const OUTPUT_HEADROOM: usize = 128;
/// Hard ceiling on generated tokens regardless of input length.
const MAX_NEW_TOKENS: usize = 768;

#[derive(Deserialize)]
struct SidecarRequest {
    /// Correlates a response with its request in `--serve` mode. One-shot mode
    /// still works without it.
    #[serde(default)]
    id: Option<u64>,
    model_path: String,
    prompt: String,
    /// Load the model and initialize the backend without generating output.
    /// Used to move cold-start work off the first visible enhancement action.
    #[serde(default)]
    warm: bool,
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

self_cell!(
    /// A loaded GGUF model together with its persistent llama context. Every
    /// prompt is prefilled into the same context, so the KV cache for the
    /// shared system instruction survives across requests. The context borrows
    /// the model, so the two are stored and dropped as one unit.
    pub struct LoadedModel {
        owner: LlamaModel,
        #[covariant]
        dependent: LlamaContext,
    }
);

struct ServeState {
    backend: LlamaBackend,
    /// `(model path, warm model + context, prompt tokens held in the KV cache)`.
    model: Option<(String, LoadedModel, Vec<LlamaToken>)>,
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
        let result = if request.warm {
            Ok(None)
        } else {
            match state.model.as_mut() {
                Some((_, loaded, cached)) => {
                    generate_with_model(loaded, cached, &request.prompt).map(Some)
                }
                None => Err("Model failed to load".to_string()),
            }
        };
        let (ok, text, error) = match result {
            Ok(text) => (true, text, None),
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
    let model_file = Path::new(model_path);
    if !model_file.is_file() {
        return Err(format!("enhancement model file not found: {model_path}"));
    }

    let already_loaded = state
        .model
        .as_ref()
        .is_some_and(|(loaded_path, _, _)| loaded_path == model_path);
    if already_loaded {
        return Ok(());
    }

    let started = std::time::Instant::now();
    let model =
        LlamaModel::load_from_file(&state.backend, model_file, &LlamaModelParams::default())
            .map_err(|error| error.to_string())?;

    let backend = &state.backend;
    let loaded = LoadedModel::try_new(model, |model| {
        model
            .new_context(backend, context_params())
            .map_err(|error| error.to_string())
    })?;

    eprintln!(
        "model {model_path} loaded in {}ms",
        started.elapsed().as_millis()
    );
    state.model = Some((model_path.to_string(), loaded, Vec::new()));
    Ok(())
}

fn context_params() -> LlamaContextParams {
    LlamaContextParams::default()
        .with_n_ctx(Some(NonZeroU32::new(N_CTX).expect("N_CTX is non-zero")))
}

fn generate_with_model(
    loaded: &mut LoadedModel,
    cached_tokens: &mut Vec<LlamaToken>,
    prompt: &str,
) -> Result<String, String> {
    loaded
        .with_dependent_mut(|_model, context| generate_with_context(context, cached_tokens, prompt))
}

fn generate_with_context(
    context: &mut LlamaContext,
    cached_tokens: &mut Vec<LlamaToken>,
    prompt: &str,
) -> Result<String, String> {
    let model = context.model;
    let tokens = model
        .str_to_token(prompt, AddBos::Always)
        .map_err(|error| error.to_string())?;
    if tokens.is_empty() {
        return Err("Enhancement prompt was empty".to_string());
    }

    let n_ctx = context.n_ctx() as usize;
    if tokens.len() + 8 >= n_ctx {
        return Err("Input is too long to enhance with the local model".to_string());
    }

    // Reuse the KV cache for the longest shared prefix. Prompts for the same
    // cleanup level and style share the entire system instruction, so only the
    // changing user text is prefilled on the second and later requests.
    let shared = cached_tokens
        .iter()
        .zip(tokens.iter())
        .take_while(|(left, right)| left == right)
        .count();
    // Always leave at least one token to decode so the sampler has logits.
    let shared = shared.min(tokens.len().saturating_sub(1));

    let cache_ready = matches!(
        context.clear_kv_cache_seq(Some(0), Some(shared as u32), None),
        Ok(true)
    );
    let (start, to_decode): (usize, &[LlamaToken]) = if cache_ready {
        (shared, &tokens[shared..])
    } else {
        context.clear_kv_cache();
        (0, &tokens[..])
    };

    let available = n_ctx - tokens.len();
    let max_new = tokens
        .len()
        .saturating_add(OUTPUT_HEADROOM)
        .min(MAX_NEW_TOKENS)
        .min(available);
    let limit = tokens.len() + max_new;

    let mut batch = LlamaBatch::new(to_decode.len().max(1), 1);
    let last = to_decode.len().saturating_sub(1);
    for (offset, token) in to_decode.iter().enumerate() {
        batch
            .add(*token, (start + offset) as i32, &[0], offset == last)
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
    let mut cursor = tokens.len();

    while cursor < limit {
        let token = sampler.sample(context, batch.n_tokens() - 1);
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
            .add(token, cursor as i32, &[0], true)
            .map_err(|error| error.to_string())?;
        cursor += 1;
        context
            .decode(&mut batch)
            .map_err(|error| error.to_string())?;
    }

    // Keep only the prompt in the cache so the next request can extend the same
    // prefix; the generated tokens are discarded.
    if matches!(
        context.clear_kv_cache_seq(Some(0), Some(tokens.len() as u32), None),
        Ok(true)
    ) {
        *cached_tokens = tokens;
    } else {
        context.clear_kv_cache();
        cached_tokens.clear();
    }

    Ok(output)
}

/// One-shot path (kept for direct CLI use): init a backend, load the model,
/// generate, exit.
fn generate(model_path: &Path, prompt: &str) -> Result<String, String> {
    let backend = LlamaBackend::init().map_err(|error| error.to_string())?;
    let model = LlamaModel::load_from_file(&backend, model_path, &LlamaModelParams::default())
        .map_err(|error| error.to_string())?;
    let mut context = model
        .new_context(&backend, context_params())
        .map_err(|error| error.to_string())?;
    let mut cached_tokens = Vec::new();
    generate_with_context(&mut context, &mut cached_tokens, prompt)
}
