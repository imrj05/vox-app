//! Shared audio decoding/normalization helpers.
//!
//! Every engine receives the same normalized input: any 16-bit PCM WAV is
//! decoded to mono f32 samples at 16 kHz (or re-encoded into a 16 kHz mono
//! 16-bit WAV for runtimes that cannot decode themselves).

use std::path::Path;

use whisper_rs::{convert_integer_to_float_audio, convert_stereo_to_mono_audio};

/// Read any WAV as mono f32 samples at 16 kHz.
pub(crate) fn read_wav_as_16khz_mono(audio_path: &Path) -> Result<Vec<f32>, String> {
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

pub(crate) fn average_channels_to_mono(samples: &[f32], channels: usize) -> Vec<f32> {
    samples
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
        .collect()
}

pub(crate) fn linear_resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
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

/// Write mono f32 samples as a 16 kHz, 16-bit PCM WAV.
pub(crate) fn write_16khz_mono_wav(samples: &[f32], output: &Path) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16_000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(output, spec).map_err(|error| error.to_string())?;
    for sample in samples {
        let value = (sample * 32767.0).round().clamp(-32768.0, 32767.0) as i16;
        writer
            .write_sample(value)
            .map_err(|error| error.to_string())?;
    }
    writer.finalize().map_err(|error| error.to_string())
}

/// Read any WAV and write a fresh 16 kHz mono, 16-bit PCM WAV in its place.
/// Required for runtimes (unlike whisper.cpp) that do not resample.
pub(crate) fn resample_to_16khz_mono_wav(input: &Path, output: &Path) -> Result<(), String> {
    let audio = read_wav_as_16khz_mono(input)?;
    if audio.len() < 8_000 {
        return Err("Recording too short to transcribe".to_string());
    }
    write_16khz_mono_wav(&audio, output)
}

/// Peak amplitude above which a recording is considered to contain usable
/// audio (≈ -54 dBFS — far below quiet speech, far above digital silence).
const SILENCE_PEAK_THRESHOLD: f32 = 0.002;

/// Detect a recording that contains nothing but digital silence. This is what
/// macOS feeds the stream when the wrong default input device is selected
/// (AirPods, virtual audio devices), the mic input volume is 0, or another app
/// holds the device — transcribing such input wastes several seconds and ends
/// in an empty/blank result with no hint about the real cause.
pub(crate) fn detect_silent_recording(audio_path: &Path) -> Option<String> {
    // Only a decode error means "cannot judge" — the engine layer surfaces
    // any real problem; silence detection is best-effort.
    let samples = read_wav_as_16khz_mono(audio_path).ok()?;
    if samples.len() < 8_000 {
        return None; // too short to judge; engines reject short input themselves
    }
    let peak = samples
        .iter()
        .fold(0.0f32, |max, sample| max.max(sample.abs()));
    (peak < SILENCE_PEAK_THRESHOLD).then(|| {
        "The recording contains only silence — the microphone delivered no signal. Check that the correct microphone is selected in System Settings → Sound → Input and that its level meter moves when you speak."
            .to_string()
    })
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
    fn linear_resample_is_noop_for_matching_rates() {
        let samples = vec![0.1f32, 0.2, 0.3];
        assert_eq!(linear_resample(&samples, 16_000, 16_000), samples);
    }

    /// 16-bit PCM mono WAV helper for the silence-detection test.
    fn write_test_wav(path: &Path, samples: &[i16]) {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(path, spec).unwrap();
        for &value in samples {
            writer.write_sample(value).unwrap();
        }
        writer.finalize().unwrap();
    }

    #[test]
    fn flags_pure_silence_and_passes_realistic_audio() {
        let dir = std::env::temp_dir();
        let path = dir.join("vox-silence-test.wav");

        // Pure digital silence — what a wrong/muted input device delivers.
        write_test_wav(&path, &vec![0i16; 16_000]);
        assert!(detect_silent_recording(&path).is_some());

        // Quiet speech-level signal (rms ≈ 420 in real recordings).
        let voice: Vec<i16> = (0..16_000)
            .map(|i| ((i as f32 * 0.05).sin() * 500.0) as i16)
            .collect();
        write_test_wav(&path, &voice);
        assert!(detect_silent_recording(&path).is_none());

        std::fs::remove_file(&path).unwrap();
    }
}
