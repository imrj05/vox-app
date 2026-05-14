use std::{
    fs::{self, File},
    io::BufWriter,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use enigo::{Enigo, Keyboard, Settings};
use hound::{SampleFormat, WavSpec, WavWriter};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Position, State, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

mod event_tap;

/// Parse a shortcut string like "Meta+Shift+Space" or a bare "F9" into a `Shortcut`.
/// Supported modifiers: Meta, Ctrl, Alt/AltLeft/AltRight, Shift.
/// Key names follow the `Code` enum (e.g. Space, KeyD, F9, AltLeft, Globe, Fn).
/// A single key with no modifiers is allowed (e.g. "F9", "AltLeft", "Globe").
fn parse_shortcut(s: &str) -> Result<Shortcut, String> {
    let parts: Vec<&str> = s.split('+').collect();

    let mut modifiers = Modifiers::empty();
    let mut code: Option<Code> = None;

    for part in &parts {
        match *part {
            "Meta" | "Super" => modifiers |= Modifiers::META,
            "Ctrl" | "Control" => modifiers |= Modifiers::CONTROL,
            // Generic Alt (used when Alt appears as a modifier in a combo)
            "Alt" | "Option" | "AltLeft" | "AltRight" => modifiers |= Modifiers::ALT,
            "Shift" => modifiers |= Modifiers::SHIFT,
            key => {
                code = Some(match key {
                    "Space" => Code::Space,
                    "Enter" => Code::Enter,
                    "Tab" => Code::Tab,
                    "Backspace" => Code::Backspace,
                    "Escape" => Code::Escape,
                    "KeyA" | "A" => Code::KeyA,
                    "KeyB" | "B" => Code::KeyB,
                    "KeyC" | "C" => Code::KeyC,
                    "KeyD" | "D" => Code::KeyD,
                    "KeyE" | "E" => Code::KeyE,
                    "KeyF" | "F" => Code::KeyF,
                    "KeyG" | "G" => Code::KeyG,
                    "KeyH" | "H" => Code::KeyH,
                    "KeyI" | "I" => Code::KeyI,
                    "KeyJ" | "J" => Code::KeyJ,
                    "KeyK" | "K" => Code::KeyK,
                    "KeyL" | "L" => Code::KeyL,
                    "KeyM" | "M" => Code::KeyM,
                    "KeyN" | "N" => Code::KeyN,
                    "KeyO" | "O" => Code::KeyO,
                    "KeyP" | "P" => Code::KeyP,
                    "KeyQ" | "Q" => Code::KeyQ,
                    "KeyR" | "R" => Code::KeyR,
                    "KeyS" | "S" => Code::KeyS,
                    "KeyT" | "T" => Code::KeyT,
                    "KeyU" | "U" => Code::KeyU,
                    "KeyV" | "V" => Code::KeyV,
                    "KeyW" | "W" => Code::KeyW,
                    "KeyX" | "X" => Code::KeyX,
                    "KeyY" | "Y" => Code::KeyY,
                    "KeyZ" | "Z" => Code::KeyZ,
                    "Digit0" | "0" => Code::Digit0,
                    "Digit1" | "1" => Code::Digit1,
                    "Digit2" | "2" => Code::Digit2,
                    "Digit3" | "3" => Code::Digit3,
                    "Digit4" | "4" => Code::Digit4,
                    "Digit5" | "5" => Code::Digit5,
                    "Digit6" | "6" => Code::Digit6,
                    "Digit7" | "7" => Code::Digit7,
                    "Digit8" | "8" => Code::Digit8,
                    "Digit9" | "9" => Code::Digit9,
                    "F1" => Code::F1,
                    "F2" => Code::F2,
                    "F3" => Code::F3,
                    "F4" => Code::F4,
                    "F5" => Code::F5,
                    "F6" => Code::F6,
                    "F7" => Code::F7,
                    "F8" => Code::F8,
                    "F9" => Code::F9,
                    "F10" => Code::F10,
                    "F11" => Code::F11,
                    "F12" => Code::F12,
                    "F13" => Code::F13,
                    "F14" => Code::F14,
                    "F15" => Code::F15,
                    "F16" => Code::F16,
                    "F17" => Code::F17,
                    "F18" => Code::F18,
                    "F19" => Code::F19,
                    "F20" => Code::F20,
                    other => return Err(format!("Unknown key code: '{other}'")),
                });
            }
        }
    }

    let code = code.ok_or_else(|| format!("No key code found in shortcut '{s}'"))?;
    // Pass None for modifiers when empty so tauri registers a bare key shortcut
    let mods = if modifiers.is_empty() {
        None
    } else {
        Some(modifiers)
    };
    Ok(Shortcut::new(mods, code))
}

mod whisper;

const DEFAULT_SHORTCUT: &str = "Meta+Shift+Space";

type SharedWriter = Arc<Mutex<Option<WavWriter<BufWriter<File>>>>>;

struct ActiveShortcut {
    current: Mutex<String>,
}

#[derive(Default)]
struct RecorderState {
    session: Mutex<Option<RecordingSession>>,
    audio_bars: Arc<Mutex<[f32; 7]>>,
}

struct RecordingSession {
    path: PathBuf,
    started_at: Instant,
    stream: cpal::Stream,
    writer: SharedWriter,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeStatus {
    platform: &'static str,
    engine: &'static str,
    recording_supported: bool,
    transcription_supported: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingStatus {
    is_recording: bool,
    path: Option<String>,
    duration_seconds: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptPreview {
    title: &'static str,
    text: &'static str,
    duration_seconds: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptionResult {
    audio_path: String,
    text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WidgetEvent {
    mode: &'static str,
    message: String,
    elapsed_seconds: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioLevel {
    level: f32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioBars {
    bars: [f32; 7],
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    model_name: String,
    downloaded: u64,
    total: u64,
}

type WhisperModelInfo = whisper::WhisperModelInfo;

struct EventTapHandle {
    state: Arc<event_tap::TapState>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HotkeyDiagnostics {
    current_shortcut: String,
    trigger_mode: TriggerMode,
    accessibility_trusted: bool,
    event_tap_active: bool,
    event_tap_error: Option<String>,
    has_downloaded_model: bool,
    is_recording: bool,
}

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TriggerMode {
    Toggle,
    PushToTalk,
}

impl From<TriggerMode> for event_tap::TriggerMode {
    fn from(m: TriggerMode) -> Self {
        match m {
            TriggerMode::Toggle => event_tap::TriggerMode::Toggle,
            TriggerMode::PushToTalk => event_tap::TriggerMode::PushToTalk,
        }
    }
}

impl From<event_tap::TriggerMode> for TriggerMode {
    fn from(m: event_tap::TriggerMode) -> Self {
        match m {
            event_tap::TriggerMode::Toggle => TriggerMode::Toggle,
            event_tap::TriggerMode::PushToTalk => TriggerMode::PushToTalk,
        }
    }
}

#[tauri::command]
fn check_accessibility_permission() -> bool {
    event_tap::is_accessibility_trusted()
}

#[tauri::command]
fn request_accessibility_permission() -> bool {
    event_tap::request_accessibility_permission()
}

#[tauri::command]
fn native_status() -> NativeStatus {
    NativeStatus {
        platform: "macOS desktop shell",
        engine: "Tauri command bridge + native WAV recorder + model-managed Whisper",
        recording_supported: true,
        transcription_supported: true,
    }
}

#[tauri::command]
fn request_microphone_permission() -> Result<(), String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "No input microphone found".to_string())?;
    let config = device
        .default_input_config()
        .map_err(|error| error.to_string())?;
    let stream_config = config.clone().into();
    let on_error = |error| eprintln!("microphone permission stream error: {error}");

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            device.build_input_stream(&stream_config, move |_data: &[f32], _| {}, on_error, None)
        }
        cpal::SampleFormat::I16 => {
            device.build_input_stream(&stream_config, move |_data: &[i16], _| {}, on_error, None)
        }
        cpal::SampleFormat::U16 => {
            device.build_input_stream(&stream_config, move |_data: &[u16], _| {}, on_error, None)
        }
        sample_format => {
            return Err(format!(
                "Unsupported microphone sample format: {sample_format:?}"
            ))
        }
    }
    .map_err(|error| error.to_string())?;

    stream.play().map_err(|error| error.to_string())?;
    thread::sleep(Duration::from_millis(250));
    drop(stream);

    Ok(())
}

#[tauri::command]
fn recording_status(state: State<'_, RecorderState>) -> Result<RecordingStatus, String> {
    let session = state
        .session
        .lock()
        .map_err(|_| "Recording state is unavailable".to_string())?;

    Ok(match session.as_ref() {
        Some(session) => RecordingStatus {
            is_recording: true,
            path: Some(session.path.to_string_lossy().to_string()),
            duration_seconds: Some(session.started_at.elapsed().as_secs()),
        },
        None => RecordingStatus {
            is_recording: false,
            path: None,
            duration_seconds: None,
        },
    })
}

#[tauri::command]
fn start_recording(
    app: AppHandle,
    state: State<'_, RecorderState>,
) -> Result<RecordingStatus, String> {
    start_recording_inner(&app, &state)
}

fn start_recording_inner(
    app: &AppHandle,
    state: &RecorderState,
) -> Result<RecordingStatus, String> {
    let mut session = state
        .session
        .lock()
        .map_err(|_| "Recording state is unavailable".to_string())?;

    if session.is_some() {
        return Err("Recording is already running".to_string());
    }

    let recordings_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("recordings");
    fs::create_dir_all(&recordings_dir).map_err(|error| error.to_string())?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let path = recordings_dir.join(format!("vox-recording-{timestamp}.wav"));

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "No input microphone found".to_string())?;
    let config = device
        .default_input_config()
        .map_err(|error| error.to_string())?;

    let spec = WavSpec {
        channels: config.channels(),
        sample_rate: config.sample_rate(),
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };
    let writer = Arc::new(Mutex::new(Some(
        WavWriter::create(&path, spec).map_err(|error| error.to_string())?,
    )));

    if let Ok(mut bars) = state.audio_bars.lock() {
        *bars = [0.0; 7];
    }

    let stream = build_input_stream(
        &device,
        &config,
        Arc::clone(&writer),
        Arc::clone(&state.audio_bars),
    )?;
    stream.play().map_err(|error| error.to_string())?;

    let started_at = Instant::now();
    *session = Some(RecordingSession {
        path: path.clone(),
        started_at,
        stream,
        writer,
    });

    Ok(RecordingStatus {
        is_recording: true,
        path: Some(path.to_string_lossy().to_string()),
        duration_seconds: Some(0),
    })
}

#[tauri::command]
fn stop_recording(state: State<'_, RecorderState>) -> Result<RecordingStatus, String> {
    stop_recording_inner(&state)
}

fn stop_recording_inner(state: &RecorderState) -> Result<RecordingStatus, String> {
    let mut session = state
        .session
        .lock()
        .map_err(|_| "Recording state is unavailable".to_string())?;
    let session = session
        .take()
        .ok_or_else(|| "Recording is not running".to_string())?;

    let duration_seconds = session.started_at.elapsed().as_secs();
    drop(session.stream);

    let writer = session
        .writer
        .lock()
        .map_err(|_| "Recording writer is unavailable".to_string())?
        .take();

    if let Some(writer) = writer {
        writer.finalize().map_err(|error| error.to_string())?;
    }

    if let Ok(mut bars) = state.audio_bars.lock() {
        *bars = [0.0; 7];
    }

    Ok(RecordingStatus {
        is_recording: false,
        path: Some(session.path.to_string_lossy().to_string()),
        duration_seconds: Some(duration_seconds),
    })
}

#[tauri::command]
fn transcribe_sample() -> TranscriptPreview {
    TranscriptPreview {
        title: "Native bridge sample",
        text: "The Tauri command bridge is connected. Real audio capture and Whisper transcription are the next slice.",
        duration_seconds: 0,
    }
}

#[tauri::command]
fn whisper_models(app: AppHandle) -> Result<Vec<WhisperModelInfo>, String> {
    let models_dir = whisper_models_dir(&app)?;
    Ok(whisper::list_models(&models_dir))
}

#[tauri::command]
fn download_whisper_model(app: AppHandle, model_name: String) -> Result<WhisperModelInfo, String> {
    let models_dir = whisper_models_dir(&app)?;
    let name = model_name.clone();
    whisper::download_model(&models_dir, &model_name, move |downloaded, total| {
        let _ = app.emit(
            "vox-download-progress",
            DownloadProgress {
                model_name: name.clone(),
                downloaded,
                total,
            },
        );
    })
}

#[tauri::command]
fn transcribe_recording(
    app: AppHandle,
    audio_path: String,
    model_name: Option<String>,
) -> Result<TranscriptionResult, String> {
    transcribe_recording_inner(&app, audio_path, model_name)
}

fn transcribe_recording_inner(
    app: &AppHandle,
    audio_path: String,
    model_name: Option<String>,
) -> Result<TranscriptionResult, String> {
    let audio_path = PathBuf::from(audio_path);
    if !audio_path.exists() {
        return Err(format!(
            "Recording file does not exist: {}",
            audio_path.display()
        ));
    }

    let models_dir = whisper_models_dir(&app)?;
    let text = whisper::transcribe(&models_dir, &audio_path, model_name.as_deref())?;

    Ok(TranscriptionResult {
        audio_path: audio_path.to_string_lossy().to_string(),
        text,
    })
}

#[tauri::command]
fn get_current_shortcut(state: State<'_, ActiveShortcut>) -> String {
    state
        .current
        .lock()
        .map(|s| s.clone())
        .unwrap_or_else(|_| DEFAULT_SHORTCUT.to_string())
}

#[tauri::command]
fn set_global_shortcut(
    app: AppHandle,
    shortcut_str: String,
    active: State<'_, ActiveShortcut>,
    tap_handle: State<'_, EventTapHandle>,
) -> Result<(), String> {
    // Validate the shortcut string via the CGEventTap parser
    let new_hotkey = event_tap::parse_hotkey(&shortcut_str)?;

    let old_str = active
        .current
        .lock()
        .map_err(|_| "Shortcut state unavailable".to_string())?
        .clone();

    // Keep tauri-plugin-global-shortcut in sync for keys it supports.
    // Always unregister the old OS hotkey first so it can't keep firing when
    // the new binding is handled only by CGEventTap (for example AltLeft).
    if let Ok(old_shortcut) = parse_shortcut(&old_str) {
        let _ = app.global_shortcut().unregister(old_shortcut);
    }
    if let Ok(new_shortcut) = parse_shortcut(&shortcut_str) {
        let _ = app.global_shortcut().register(new_shortcut);
    }

    // Always update the CGEventTap hotkey — this handles ALL keys
    *tap_handle.state.hotkey.lock().unwrap() = new_hotkey;

    // Persist
    *active
        .current
        .lock()
        .map_err(|_| "Shortcut state unavailable".to_string())? = shortcut_str;

    Ok(())
}

#[tauri::command]
fn get_trigger_mode(tap_handle: State<'_, EventTapHandle>) -> TriggerMode {
    (*tap_handle.state.mode.lock().unwrap()).into()
}

#[tauri::command]
fn set_trigger_mode(
    mode: TriggerMode,
    tap_handle: State<'_, EventTapHandle>,
) -> Result<(), String> {
    *tap_handle.state.mode.lock().unwrap() = mode.into();
    Ok(())
}

#[tauri::command]
fn hotkey_diagnostics(
    app: AppHandle,
    active: State<'_, ActiveShortcut>,
    tap_handle: State<'_, EventTapHandle>,
    recorder_state: State<'_, RecorderState>,
) -> Result<HotkeyDiagnostics, String> {
    let current_shortcut = active
        .current
        .lock()
        .map_err(|_| "Shortcut state unavailable".to_string())?
        .clone();
    let trigger_mode = (*tap_handle.state.mode.lock().unwrap()).into();
    let event_tap_active = *tap_handle.state.is_active.lock().unwrap();
    let event_tap_error = tap_handle.state.last_error.lock().unwrap().clone();
    let is_recording = recorder_state
        .session
        .lock()
        .map_err(|_| "Recording state is unavailable".to_string())?
        .is_some();

    let has_downloaded_model = whisper_models_dir(&app)
        .ok()
        .map(|models_dir| {
            whisper::list_models(&models_dir)
                .iter()
                .any(|m| m.downloaded)
        })
        .unwrap_or(false);

    Ok(HotkeyDiagnostics {
        current_shortcut,
        trigger_mode,
        accessibility_trusted: event_tap::is_accessibility_trusted(),
        event_tap_active,
        event_tap_error,
        has_downloaded_model,
        is_recording,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let default_shortcut = Shortcut::new(Some(Modifiers::META | Modifiers::SHIFT), Code::Space);
    let default_hotkey =
        event_tap::parse_hotkey(DEFAULT_SHORTCUT).expect("DEFAULT_SHORTCUT must be valid");

    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, _pressed_shortcut, event| {
                    let mode = app
                        .try_state::<EventTapHandle>()
                        .map(|tap_handle| (*tap_handle.state.mode.lock().unwrap()).into())
                        .unwrap_or(TriggerMode::Toggle);

                    match event.state {
                        ShortcutState::Pressed => handle_hotkey_press(app.clone()),
                        ShortcutState::Released if mode == TriggerMode::PushToTalk => {
                            handle_hotkey_release(app.clone())
                        }
                        _ => {}
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(RecorderState::default())
        .manage(ActiveShortcut {
            current: Mutex::new(DEFAULT_SHORTCUT.to_string()),
        })
        .setup(move |app| {
            // Register default shortcut via OS hotkey API (works for Cmd+Shift+Space)
            app.global_shortcut().register(default_shortcut)?;

            // Start CGEventTap for full key support (Globe, bare Option, Fn, etc.)
            let app_press = app.handle().clone();
            let app_release = app.handle().clone();
            let tap_state = event_tap::start(
                default_hotkey,
                event_tap::TriggerMode::Toggle,
                move || handle_hotkey_press(app_press.clone()),
                move || handle_hotkey_release(app_release.clone()),
            );
            app.manage(EventTapHandle { state: tap_state });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            native_status,
            request_microphone_permission,
            recording_status,
            start_recording,
            stop_recording,
            whisper_models,
            download_whisper_model,
            transcribe_recording,
            transcribe_sample,
            get_current_shortcut,
            set_global_shortcut,
            get_trigger_mode,
            set_trigger_mode,
            hotkey_diagnostics,
            check_accessibility_permission,
            request_accessibility_permission,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vox");
}

fn handle_hotkey_press(app: AppHandle) {
    thread::spawn(move || {
        let tap_handle = app.state::<EventTapHandle>();
        let mode: TriggerMode = (*tap_handle.state.mode.lock().unwrap()).into();

        let recorder_state = app.state::<RecorderState>();
        let is_recording = recorder_state
            .session
            .lock()
            .map(|session| session.is_some())
            .unwrap_or(false);

        match mode {
            TriggerMode::Toggle => {
                // Toggle: press once to start, press again to stop + transcribe
                if is_recording {
                    stop_and_transcribe(app.clone());
                } else {
                    start_recording_flow(app.clone());
                }
            }
            TriggerMode::PushToTalk => {
                // Push-to-talk: press starts recording (release handled separately)
                if !is_recording {
                    start_recording_flow(app.clone());
                }
            }
        }
    });
}

fn handle_hotkey_release(app: AppHandle) {
    thread::spawn(move || {
        let recorder_state = app.state::<RecorderState>();
        let is_recording = recorder_state
            .session
            .lock()
            .map(|session| session.is_some())
            .unwrap_or(false);

        if is_recording {
            stop_and_transcribe(app.clone());
        }
    });
}

fn start_recording_flow(app: AppHandle) {
    let recorder_state = app.state::<RecorderState>();
    let models_dir = match whisper_models_dir(&app) {
        Ok(d) => d,
        Err(e) => {
            show_widget(&app, "error", &e);
            hide_widget_after_delay(app.clone(), 4000);
            return;
        }
    };

    let has_model = whisper::list_models(&models_dir)
        .iter()
        .any(|m| m.downloaded);

    if !has_model {
        show_widget(
            &app,
            "error",
            "No model downloaded — open Vox and download one first",
        );
        hide_widget_after_delay(app.clone(), 4000);
        return;
    }

    match start_recording_inner(&app, &recorder_state) {
        Ok(_) => {
            show_widget(&app, "recording", "Listening…");
            start_recording_timer(app.clone());
        }
        Err(error) => {
            show_widget(&app, "error", &error);
            hide_widget_after_delay(app.clone(), 4000);
        }
    }
}

fn stop_and_transcribe(app: AppHandle) {
    eprintln!("[vox] stop_and_transcribe: stopping recording");
    let recorder_state = app.state::<RecorderState>();
    match stop_recording_inner(&recorder_state) {
        Ok(status) => {
            eprintln!(
                "[vox] stop_and_transcribe: stopped path={:?} duration={:?}",
                status.path, status.duration_seconds
            );
            show_widget(&app, "transcribing", "Transcribing…");

            if let Some(path) = status.path {
                // Yield briefly so the webview can render "transcribing" before
                // the heavy Whisper work blocks the event loop.
                thread::sleep(Duration::from_millis(80));

                eprintln!("[vox] stop_and_transcribe: transcribing {path}");
                match transcribe_recording_inner(&app, path, None) {
                    Ok(mut result) => {
                        result.text = result.text.trim().to_string();
                        eprintln!(
                            "[vox] stop_and_transcribe: transcript chars={}",
                            result.text.chars().count()
                        );

                        if is_blank_transcription(&result.text) {
                            eprintln!("[vox] stop_and_transcribe: blank transcription");
                            show_widget(&app, "done", "No speech detected");
                            hide_widget_after_delay(app.clone(), 1200);
                            return;
                        }

                        let text = result.text.clone();
                        show_widget(&app, "done", "Pasting transcript…");
                        let _ = app.emit("vox-transcription-complete", result);
                        eprintln!("[vox] stop_and_transcribe: emitted completion event");

                        thread::sleep(Duration::from_millis(150));
                        if let Err(e) = paste_text(&text) {
                            eprintln!("paste_text error: {e}");
                        } else {
                            eprintln!("[vox] stop_and_transcribe: pasted transcript");
                        }

                        hide_widget_after_delay(app.clone(), 1200);
                    }
                    Err(error) => {
                        eprintln!("[vox] stop_and_transcribe: transcription error: {error}");
                        show_widget(&app, "error", &error);
                        hide_widget_after_delay(app.clone(), 4000);
                    }
                }
            } else {
                eprintln!("[vox] stop_and_transcribe: stopped without audio path");
                show_widget(&app, "error", "Recording did not produce an audio file");
                hide_widget_after_delay(app.clone(), 4000);
            }
        }
        Err(error) => {
            eprintln!("[vox] stop_and_transcribe: stop error: {error}");
            show_widget(&app, "error", &error);
            hide_widget_after_delay(app.clone(), 4000);
        }
    }
}

/// Type `text` at the current cursor position using enigo's text injection.
/// This works in any focused text field without touching the clipboard.
fn paste_text(text: &str) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo.text(text).map_err(|e| e.to_string())?;
    Ok(())
}

fn is_blank_transcription(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return true;
    }

    let normalized = trimmed
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect::<String>();

    matches!(normalized.as_str(), "blankaudio" | "nospeech" | "silence")
}

fn show_widget(app: &AppHandle, mode: &'static str, message: &str) {
    show_widget_with_elapsed(app, mode, message, None);
}

fn show_widget_with_elapsed(
    app: &AppHandle,
    mode: &'static str,
    message: &str,
    elapsed_seconds: Option<u64>,
) {
    if let Some(window) = app.get_webview_window("widget") {
        position_widget_bottom_right(&window);
        // Ensure the window is visible even if macOS hid it (e.g. after a focus change).
        // show_without_focusing keeps the previously-focused app in the foreground.
        let _ = window.show();
        let _ = window.emit(
            "vox-widget-state",
            WidgetEvent {
                mode,
                message: message.to_string(),
                elapsed_seconds,
            },
        );
        // Do NOT steal focus — we need the previous app to keep focus for paste
    }
}

fn position_widget_bottom_right(window: &WebviewWindow) {
    const MARGIN: i32 = 24;

    // current_monitor() returns None when called from a background thread on macOS.
    // Fall back to primary_monitor() which works from any thread.
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        eprintln!("[vox] position_widget: no monitor found, window may stay off-screen");
        return;
    };

    let Ok(window_size) = window.outer_size() else {
        return;
    };

    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let x = monitor_position.x + monitor_size.width as i32 - window_size.width as i32 - MARGIN;
    let y = monitor_position.y + monitor_size.height as i32 - window_size.height as i32 - MARGIN;

    let _ = window.set_position(Position::Physical(PhysicalPosition::new(x, y)));
}

/// Spawn a background thread that emits audio levels (50 ms) and ticks the
/// widget timer (once per second) while recording.
fn start_recording_timer(app: AppHandle) {
    thread::spawn(move || {
        let mut ticks: u64 = 0;
        loop {
            thread::sleep(Duration::from_millis(50));
            ticks += 1;

            let recorder_state = app.state::<RecorderState>();
            let still_recording = recorder_state
                .session
                .lock()
                .map(|s| s.is_some())
                .unwrap_or(false);
            if !still_recording {
                break;
            }

            // Emit per-bar audio levels to the widget
            let bars = recorder_state
                .audio_bars
                .lock()
                .map(|b| *b)
                .unwrap_or([0.0; 7]);
            if let Some(window) = app.get_webview_window("widget") {
                let level = bars.iter().copied().fold(0.0, f32::max);
                #[cfg(debug_assertions)]
                if ticks % 20 == 0 {
                    eprintln!("[vox] audio bars max={level:.3} bars={bars:?}");
                }
                let _ = window.emit("vox-audio-level", AudioLevel { level });
                let _ = window.emit("vox-audio-bars", AudioBars { bars });
            }

            // Elapsed counter (every ~1 s)
            if ticks % 20 == 0 {
                let elapsed = ticks / 20;
                show_widget_with_elapsed(&app, "recording", "Listening…", Some(elapsed));
            }
        }
    });
}

fn hide_widget_after_delay(app: AppHandle, delay_ms: u64) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(delay_ms));

        // Abort if a new recording session started while we were waiting.
        let recorder_state = app.state::<RecorderState>();
        let is_recording = recorder_state
            .session
            .lock()
            .map(|s| s.is_some())
            .unwrap_or(false);
        if is_recording {
            return;
        }

        if let Some(window) = app.get_webview_window("widget") {
            // Emit idle so CSS fades out, then move off-screen
            let _ = window.emit(
                "vox-widget-state",
                WidgetEvent {
                    mode: "idle",
                    message: String::new(),
                    elapsed_seconds: None,
                },
            );
            thread::sleep(Duration::from_millis(450)); // wait for CSS fade (400ms)

            // Re-check: a new recording may have started during the CSS fade.
            let is_recording = recorder_state
                .session
                .lock()
                .map(|s| s.is_some())
                .unwrap_or(false);
            if !is_recording {
                let _ = window.set_position(Position::Physical(PhysicalPosition::new(-9999, -9999)));
            }
        }
    });
}

fn whisper_models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(whisper::models_dir)
        .map_err(|error| error.to_string())
}

fn build_input_stream(
    device: &cpal::Device,
    config: &cpal::SupportedStreamConfig,
    writer: SharedWriter,
    audio_bars: Arc<Mutex<[f32; 7]>>,
) -> Result<cpal::Stream, String> {
    let stream_config = config.clone().into();
    let on_error = |error| eprintln!("audio input stream error: {error}");

    match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let bars = Arc::clone(&audio_bars);
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[f32], _| {
                        write_f32_samples(data, &writer);
                        update_audio_bars(&bars, compute_bar_levels_f32(data));
                    },
                    on_error,
                    None,
                )
                .map_err(|error| error.to_string())
        }
        cpal::SampleFormat::I16 => {
            let bars = Arc::clone(&audio_bars);
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[i16], _| {
                        write_i16_samples(data, &writer);
                        update_audio_bars(&bars, compute_bar_levels_i16(data));
                    },
                    on_error,
                    None,
                )
                .map_err(|error| error.to_string())
        }
        cpal::SampleFormat::U16 => {
            let bars = Arc::clone(&audio_bars);
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[u16], _| {
                        write_u16_samples(data, &writer);
                        update_audio_bars(&bars, compute_bar_levels_u16(data));
                    },
                    on_error,
                    None,
                )
                .map_err(|error| error.to_string())
        }
        sample_format => Err(format!(
            "Unsupported microphone sample format: {sample_format:?}"
        )),
    }
}

fn write_f32_samples(samples: &[f32], writer: &SharedWriter) {
    if let Ok(mut writer) = writer.lock() {
        if let Some(writer) = writer.as_mut() {
            for sample in samples {
                let sample = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                let _ = writer.write_sample(sample);
            }
        }
    }
}

fn write_i16_samples(samples: &[i16], writer: &SharedWriter) {
    if let Ok(mut writer) = writer.lock() {
        if let Some(writer) = writer.as_mut() {
            for sample in samples {
                let _ = writer.write_sample(*sample);
            }
        }
    }
}

fn write_u16_samples(samples: &[u16], writer: &SharedWriter) {
    if let Ok(mut writer) = writer.lock() {
        if let Some(writer) = writer.as_mut() {
            for sample in samples {
                let sample = (*sample as i32 - i16::MAX as i32 - 1) as i16;
                let _ = writer.write_sample(sample);
            }
        }
    }
}

fn update_audio_bars(audio_bars: &Arc<Mutex<[f32; 7]>>, measured: [f32; 7]) {
    if let Ok(mut bars) = audio_bars.lock() {
        for (current, measured) in bars.iter_mut().zip(measured.iter()) {
            let factor = if *measured > *current { 0.55 } else { 0.2 };
            *current += (*measured - *current) * factor;
        }
    }
}

fn normalize_bar_level(measured: f32) -> f32 {
    if measured < 0.0025 {
        0.0
    } else {
        let normalized = ((measured - 0.0025) / 0.03).clamp(0.0, 1.0);
        normalized.sqrt()
    }
}

fn compute_bar_levels_f32(samples: &[f32]) -> [f32; 7] {
    compute_bar_levels(samples, |sample| sample.clamp(-1.0, 1.0))
}

fn compute_bar_levels_i16(samples: &[i16]) -> [f32; 7] {
    compute_bar_levels(samples, |sample| *sample as f32 / i16::MAX as f32)
}

fn compute_bar_levels_u16(samples: &[u16]) -> [f32; 7] {
    compute_bar_levels(samples, |sample| {
        (*sample as i32 - i16::MAX as i32 - 1) as f32 / i16::MAX as f32
    })
}

fn compute_bar_levels<T>(samples: &[T], normalize: impl Fn(&T) -> f32) -> [f32; 7] {
    let mut bars = [0.0; 7];
    if samples.is_empty() {
        return bars;
    }

    let bar_count = bars.len();
    let chunk_size = (samples.len() / bar_count).max(1);
    for (index, bar) in bars.iter_mut().enumerate() {
        let start = index * chunk_size;
        let end = if index == bar_count - 1 {
            samples.len()
        } else {
            ((index + 1) * chunk_size).min(samples.len())
        };

        let slice = &samples[start..end];
        if slice.is_empty() {
            continue;
        }

        let energy = slice
            .iter()
            .map(|sample| {
                let normalized = normalize(sample);
                normalized * normalized
            })
            .sum::<f32>();
        let rms = (energy / slice.len() as f32).sqrt();
        *bar = normalize_bar_level(rms);
    }

    bars
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn treats_blank_audio_marker_as_blank_transcription() {
        assert!(is_blank_transcription("[BLANK_AUDIO]"));
        assert!(is_blank_transcription(" blank audio "));
        assert!(is_blank_transcription(""));
    }

    #[test]
    fn keeps_real_transcription_text() {
        assert!(!is_blank_transcription("hello world"));
    }
}
