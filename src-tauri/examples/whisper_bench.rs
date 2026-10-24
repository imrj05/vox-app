//! One-off benchmark: large-v3-turbo load cost vs cached-state decode cost.
//! Emulates old behavior (reload model every transcription) vs new behavior
//! (context cached, fresh decode state per transcription).
//!
//! Usage: cargo run --release --example whisper_bench -- <model> <wav>

use std::time::Instant;

use whisper_rs::{
    convert_integer_to_float_audio, convert_stereo_to_mono_audio, FullParams, SamplingStrategy,
    WhisperContext, WhisperContextParameters,
};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (model_path, wav_path) = (&args[1], &args[2]);

    let audio = read_wav_16k_mono(wav_path);
    println!(
        "audio: {:.1}s of speech, model: {}",
        audio.len() as f32 / 16_000.0,
        model_path
    );

    // ---- OLD: cold model load + decode (per-transcription cost) ----
    let t = Instant::now();
    let context = new_context(model_path);
    let load = t.elapsed();
    let text = decode(&context, &audio);
    println!("OLD  (load + decode): {:.2?}  →  {:?}", load, short(&text));

    // ---- NEW: cached context, fresh state + decode only ----
    let t = Instant::now();
    let text1 = {
        let mut state = context.create_state().expect("state");
        run(&mut state, &audio)
    };
    let warm1 = t.elapsed();
    println!(
        "NEW  (decode only):   {:.2?}  →  {:?}",
        warm1,
        short(&text1)
    );

    let t = Instant::now();
    let text2 = {
        let mut state = context.create_state().expect("state");
        run(&mut state, &audio)
    };
    println!(
        "NEW  (2nd decode):    {:.2?}  →  {:?}",
        t.elapsed(),
        short(&text2)
    );
    // ---- OLD sampling: BeamSearch(5) on cached context ----
    let t = Instant::now();
    let text_beam = {
        let mut state = context.create_state().expect("state");
        run_beam(&mut state, &audio)
    };
    println!(
        "BEAM (beam=5 decode): {:.2?}  \u{2192}  {:?}",
        t.elapsed(),
        short(&text_beam)
    );
    std::process::exit(if text1 == text { 0 } else { 1 });
}

fn new_context(model_path: &str) -> WhisperContext {
    let mut params = WhisperContextParameters::default();
    params.use_gpu(true);
    WhisperContext::new_with_params(model_path, params).expect("context (GPU)")
}

fn decode(context: &WhisperContext, audio: &[f32]) -> String {
    let mut state = context.create_state().expect("state");
    run(&mut state, audio)
}

fn run(state: &mut whisper_rs::WhisperState, audio: &[f32]) -> String {
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_suppress_blank(true);
    state.full(params, audio).expect("full");
    state
        .as_iter()
        .map(|segment| segment.to_string())
        .collect::<Vec<_>>()
        .join(" ")
}

fn short(text: &str) -> String {
    let text = text.trim();
    if text.len() > 60 {
        format!("{}…", &text[..60])
    } else {
        text.to_string()
    }
}

fn read_wav_16k_mono(path: &str) -> Vec<f32> {
    let mut reader = hound::WavReader::open(path).expect("wav");
    let spec = reader.spec();
    assert_eq!(spec.bits_per_sample, 16, "16-bit PCM expected");
    let samples_i16: Vec<i16> = reader.samples::<i16>().map(|s| s.unwrap()).collect();
    let mut audio = vec![0.0f32; samples_i16.len()];
    convert_integer_to_float_audio(&samples_i16, &mut audio).expect("f32");
    match spec.channels {
        1 => {
            if spec.sample_rate == 16_000 {
                audio
            } else {
                linear_resample(&audio, spec.sample_rate, 16_000)
            }
        }
        2 => convert_stereo_to_mono_audio(&audio).expect("mono"),
        channels => panic!("unexpected channel count: {channels}"),
    }
}

fn linear_resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    let output_len = samples.len() * to_rate as usize / from_rate as usize;
    let ratio = from_rate as f64 / to_rate as f64;
    (0..output_len)
        .map(|i| {
            let source = i as f64 * ratio;
            let left = source.floor() as usize;
            let right = (left + 1).min(samples.len() - 1);
            let fraction = (source - left as f64) as f32;
            samples[left] * (1.0 - fraction) + samples[right] * fraction
        })
        .collect()
}

fn run_beam(state: &mut whisper_rs::WhisperState, audio: &[f32]) -> String {
    let mut params = FullParams::new(SamplingStrategy::BeamSearch {
        beam_size: 5,
        patience: -1.0,
    });
    params.set_language(Some("en"));
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    state.full(params, audio).expect("full");
    state
        .as_iter()
        .map(|segment| segment.to_string())
        .collect::<Vec<_>>()
        .join(" ")
}
