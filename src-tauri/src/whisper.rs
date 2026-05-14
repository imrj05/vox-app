use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use serde::Serialize;
use whisper_rs::{
    convert_integer_to_float_audio, convert_stereo_to_mono_audio, FullParams, SamplingStrategy,
    WhisperContext, WhisperContextParameters,
};

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
];

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

pub fn download_model(
    models_dir: &Path,
    model_name: &str,
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

    let temp_path = path.with_extension("download");
    let mut response = reqwest::blocking::get(model.url).map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Model download failed with HTTP {}",
            response.status()
        ));
    }

    let total = response
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(model.size);

    let mut file = File::create(&temp_path).map_err(|error| error.to_string())?;
    let mut downloaded: u64 = 0;
    let mut buf = vec![0u8; 65_536];
    loop {
        let n = response.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        downloaded += n as u64;
        on_progress(downloaded, total);
    }

    let downloaded_size = fs::metadata(&temp_path)
        .map_err(|error| error.to_string())?
        .len();
    if downloaded_size < model.size / 2 {
        let _ = fs::remove_file(&temp_path);
        return Err("Downloaded model is unexpectedly small".to_string());
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
) -> Result<String, String> {
    let model_path = selected_model_path(models_dir, model_name)?;

    transcribe_with_backend(&model_path, audio_path)
}

fn transcribe_with_backend(model_path: &Path, audio_path: &Path) -> Result<String, String> {
    let model_path = model_path
        .to_str()
        .ok_or_else(|| "Model path contains invalid UTF-8".to_string())?;
    let mut ctx_params = WhisperContextParameters::default();
    ctx_params.use_gpu(true);

    let context = WhisperContext::new_with_params(model_path, ctx_params)
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
    params.set_n_threads(
        std::thread::available_parallelism()
            .map(|threads| threads.get().saturating_sub(1).max(1) as i32)
            .unwrap_or(4),
    );

    let mut state = context.create_state().map_err(|error| error.to_string())?;
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
    models_dir.join(format!("{model_name}.bin"))
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
