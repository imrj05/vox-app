use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use tokio::{fs::File, io::AsyncWriteExt};

use serde::Serialize;
use whisper_rs::{
    convert_integer_to_float_audio, convert_stereo_to_mono_audio, FullParams, SamplingStrategy,
    WhisperContext, WhisperContextParameters,
};

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

pub fn transcribe(
    models_dir: &Path,
    audio_path: &Path,
    model_name: Option<&str>,
    dictionary: Option<&str>,
    context: Option<&str>,
) -> Result<String, String> {
    let model_path = selected_model_path(models_dir, model_name)?;

    // Parakeet is a different architecture (FastConformer + TDT) than Whisper and
    // cannot be loaded by whisper.cpp. Route it to the bundled transcribe.cpp CLI.
    if is_parakeet_path(&model_path) {
        return transcribe_with_parakeet(&model_path, audio_path);
    }

    transcribe_with_backend(&model_path, audio_path, dictionary, context)
}

fn is_parakeet_path(path: &Path) -> bool {
    path.extension()
        .map(|extension| extension == "gguf")
        .unwrap_or(false)
}

fn parakeet_cli_path() -> Result<PathBuf, String> {
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(dir) = current_exe.parent() {
            if let Some(path) = find_cli_in_dir(dir) {
                return Ok(path);
            }
        }
    }

    let dev_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin");
    if let Some(path) = find_cli_in_dir(&dev_dir) {
        return Ok(path);
    }

    Err(
        "Parakeet runtime not found. Run `pnpm build:parakeet-asr` and rebuild the app."
            .to_string(),
    )
}

fn find_cli_in_dir(dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if file_name.starts_with("transcribe-cli") {
            let path = entry.path();
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

fn transcribe_with_parakeet(model_path: &Path, audio_path: &Path) -> Result<String, String> {
    let cli = parakeet_cli_path()?;
    let model_arg = model_path
        .to_str()
        .ok_or_else(|| "Model path contains invalid UTF-8".to_string())?;

    // transcribe.cpp v1 only accepts 16 kHz mono WAV input, but Vox records at
    // the device's native rate (commonly 48 kHz). Resample to a temp 16 kHz mono
    // WAV before invoking the runtime.
    let temp_wav = temp_16khz_wav_path();
    let resample_result = resample_to_16khz_mono_wav(audio_path, &temp_wav);
    if let Err(error) = resample_result {
        let _ = fs::remove_file(&temp_wav);
        return Err(error);
    }
    let audio_arg = temp_wav
        .to_str()
        .ok_or_else(|| "Temp audio path contains invalid UTF-8".to_string())?;

    let output = Command::new(&cli)
        .arg("-m")
        .arg(model_arg)
        .arg("-q")
        .arg("--timestamps")
        .arg("none")
        .arg(audio_arg)
        .output()
        .map_err(|error| format!("Failed to run Parakeet runtime: {error}"));

    let _ = fs::remove_file(&temp_wav);
    let output = output?;

    if !output.status.success() {
        // transcribe-cli writes diagnostics (e.g. "gguf load error") to stdout
        // rather than stderr, so combine both for a useful message.
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(if detail.is_empty() {
            format!("Parakeet runtime exited with {}", output.status)
        } else {
            format!("Parakeet runtime failed: {detail}")
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let text = extract_transcript(&stdout);
    if text.is_empty() {
        return Err("Parakeet returned an empty transcript".to_string());
    }

    Ok(text)
}

/// transcribe-cli prints a `text: <transcript>` line amid a header block. Extract
/// just the transcript text so the app pastes clean output.
fn extract_transcript(stdout: &str) -> String {
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

fn temp_16khz_wav_path() -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("vox-parakeet-{}-{nanos}.wav", std::process::id()))
}

/// Read any WAV and write a fresh 16 kHz mono, 16-bit PCM WAV in its place. This
/// is required because transcribe.cpp (unlike whisper.cpp) does not resample.
fn resample_to_16khz_mono_wav(input: &Path, output: &Path) -> Result<(), String> {
    let audio = read_wav_as_16khz_mono(input)?;
    if audio.len() < 8_000 {
        return Err("Recording too short to transcribe".to_string());
    }

    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16_000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(output, spec).map_err(|error| error.to_string())?;
    for sample in audio {
        let value = (sample * 32767.0).round().clamp(-32768.0, 32767.0) as i16;
        writer
            .write_sample(value)
            .map_err(|error| error.to_string())?;
    }
    writer.finalize().map_err(|error| error.to_string())
}

fn transcribe_with_backend(
    model_path: &Path,
    audio_path: &Path,
    dictionary: Option<&str>,
    context: Option<&str>,
) -> Result<String, String> {
    let model_path = model_path
        .to_str()
        .ok_or_else(|| "Model path contains invalid UTF-8".to_string())?;
    let mut ctx_params = WhisperContextParameters::default();
    ctx_params.use_gpu(true);

    let whisper_context = WhisperContext::new_with_params(model_path, ctx_params)
        .or_else(|_| {
            let mut cpu_params = WhisperContextParameters::default();
            cpu_params.use_gpu(false);
            WhisperContext::new_with_params(model_path, cpu_params)
        })
        .map_err(|error| error.to_string())?;

    let audio = read_wav_as_16khz_mono(audio_path)?;
    if audio.len() < 8_000 {
        return Err("Recording too short to transcribe".to_string());
    }

    let mut params = FullParams::new(SamplingStrategy::BeamSearch {
        beam_size: 5,
        patience: -1.0,
    });
    params.set_language(Some("en"));
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_suppress_blank(true);
    let prompt = dictionary_prompt(dictionary, context);
    if let Some(prompt) = prompt.as_deref() {
        params.set_initial_prompt(prompt);
    }
    params.set_n_threads(
        std::thread::available_parallelism()
            .map(|threads| threads.get().saturating_sub(1).max(1) as i32)
            .unwrap_or(4),
    );

    let mut state = whisper_context
        .create_state()
        .map_err(|error| error.to_string())?;
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

    Ok(text)
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

fn find_model(model_name: &str) -> Result<&'static WhisperModelInfo, String> {
    MODELS
        .iter()
        .find(|model| model.name == model_name)
        .ok_or_else(|| format!("Unknown model: {model_name}"))
}

fn selected_model_path(models_dir: &Path, model_name: Option<&str>) -> Result<PathBuf, String> {
    if let Some(model_name) = model_name {
        let model = find_model(model_name)?;
        let path = model_path(models_dir, model.name);
        return path
            .exists()
            .then_some(path)
            .ok_or_else(|| format!("Model is not downloaded: {}", model.display_name));
    }

    for model in MODELS.iter().filter(|model| model.recommended) {
        let path = model_path(models_dir, model.name);
        if path.exists() {
            return Ok(path);
        }
    }

    for model in MODELS {
        let path = model_path(models_dir, model.name);
        if path.exists() {
            return Ok(path);
        }
    }

    Err("Download a Whisper model before transcribing".to_string())
}

fn model_path(models_dir: &Path, model_name: &str) -> PathBuf {
    models_dir.join(format!("{model_name}.{}", model_extension(model_name)))
}

fn read_wav_as_16khz_mono(audio_path: &Path) -> Result<Vec<f32>, String> {
    let mut reader = hound::WavReader::open(audio_path).map_err(|error| error.to_string())?;
    let spec = reader.spec();

    if spec.bits_per_sample != 16 {
        return Err(format!(
            "Unsupported WAV bit depth: {}. Expected 16-bit PCM.",
            spec.bits_per_sample
        ));
    }

    let samples_i16 = reader
        .samples::<i16>()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let mut audio = vec![0.0; samples_i16.len()];
    convert_integer_to_float_audio(&samples_i16, &mut audio).map_err(|error| error.to_string())?;

    let audio = match spec.channels {
        1 => audio,
        2 => convert_stereo_to_mono_audio(&audio).map_err(|error| error.to_string())?,
        channels => average_channels_to_mono(&audio, channels as usize),
    };

    if spec.sample_rate == 16_000 {
        Ok(audio)
    } else {
        Ok(linear_resample(&audio, spec.sample_rate, 16_000))
    }
}

fn average_channels_to_mono(samples: &[f32], channels: usize) -> Vec<f32> {
    samples
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
        .collect()
}

fn linear_resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if samples.is_empty() || from_rate == to_rate {
        return samples.to_vec();
    }

    let output_len = samples.len() * to_rate as usize / from_rate as usize;
    let ratio = from_rate as f64 / to_rate as f64;

    (0..output_len)
        .map(|index| {
            let source = index as f64 * ratio;
            let left = source.floor() as usize;
            let right = (left + 1).min(samples.len() - 1);
            let fraction = (source - left as f64) as f32;
            samples[left] * (1.0 - fraction) + samples[right] * fraction
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resamples_48khz_stereo_to_16khz_mono() {
        let dir = std::env::temp_dir();
        let input = dir.join("vox-resample-test-in.wav");
        let output = dir.join("vox-resample-test-out.wav");

        // 1s of 48 kHz stereo, 16-bit PCM (48000 frames, 96000 samples).
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 48_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&input, spec).unwrap();
        for index in 0..48000 {
            let value = (index % 1000) as i16;
            writer.write_sample(value).unwrap();
            writer.write_sample(value).unwrap();
        }
        writer.finalize().unwrap();

        resample_to_16khz_mono_wav(&input, &output).unwrap();

        let reader = hound::WavReader::open(&output).unwrap();
        let out_spec = reader.spec();
        assert_eq!(out_spec.sample_rate, 16_000);
        assert_eq!(out_spec.channels, 1);
        assert_eq!(out_spec.bits_per_sample, 16);

        // 48000 frames at 48 kHz -> 16000 samples at 16 kHz mono.
        let samples: Vec<i16> = reader.into_samples().map(|s| s.unwrap()).collect();
        assert_eq!(samples.len(), 16000);

        let _ = std::fs::remove_file(&input);
        let _ = std::fs::remove_file(&output);
    }

    #[test]
    fn extracts_transcript_from_cli_output() {
        let stdout = "\
audio: /tmp/foo.wav\n\
  samples: 32000\n\
  duration: 2.000 s\n\
model: /path/model.gguf -> ok\n\
  backend: MTL0\n\
run: ok\n\
text: I want to just check it's working or not.\n\
  realtime: 27x\n";
        assert_eq!(
            extract_transcript(stdout),
            "I want to just check it's working or not."
        );

        let empty = "run: ok\ntext: (empty)\n  realtime: 5x\n";
        assert_eq!(extract_transcript(empty), "");
    }
}
