#![allow(unexpected_cfgs)]

use std::{
    fs::{self, File},
    io::BufWriter,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
#[cfg(target_os = "macos")]
use core_foundation::{
    base::{CFType, TCFType},
    dictionary::{CFDictionary, CFDictionaryRef},
    string::{CFString, CFStringRef},
};
#[cfg(target_os = "macos")]
use core_graphics::window::{
    copy_window_info, kCGNullWindowID, kCGWindowListExcludeDesktopElements,
    kCGWindowListOptionOnScreenOnly,
};
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use hound::{SampleFormat, WavSpec, WavWriter};
#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};
#[cfg(target_os = "macos")]
use std::ffi::c_void;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Position, State, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg(target_os = "macos")]
#[link(name = "AppKit", kind = "framework")]
extern "C" {}

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
struct DictionaryState {
    content: Mutex<String>,
}

struct TranscriptFormattingState {
    mode: Mutex<TranscriptFormattingMode>,
}

impl Default for TranscriptFormattingState {
    fn default() -> Self {
        Self {
            mode: Mutex::new(TranscriptFormattingMode::Auto),
        }
    }
}

#[derive(Default)]
struct FocusContextState {
    is_editable_focused: Mutex<bool>,
}

#[derive(Default)]
struct RecorderState {
    session: Mutex<Option<RecordingSession>>,
    audio_bars: Arc<Mutex<[f32; 7]>>,
}

struct RecordingSession {
    path: PathBuf,
    app_name: Option<String>,
    window_title: Option<String>,
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
    app_name: Option<String>,
    window_title: Option<String>,
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
    app_name: Option<String>,
    duration_seconds: Option<u64>,
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

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TranscriptFormattingMode {
    Auto,
    Plain,
    Developer,
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
fn resolve_app_icon(app_name: String) -> Option<String> {
    resolve_app_icon_data_url(&app_name)
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
            app_name: session.app_name.clone(),
            window_title: session.window_title.clone(),
            duration_seconds: Some(session.started_at.elapsed().as_secs()),
        },
        None => RecordingStatus {
            is_recording: false,
            path: None,
            app_name: None,
            window_title: None,
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
    let app_name = frontmost_app_name();
    let window_title = frontmost_window_title(app_name.as_deref());

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
        app_name: app_name.clone(),
        window_title: window_title.clone(),
        started_at,
        stream,
        writer,
    });

    Ok(RecordingStatus {
        is_recording: true,
        path: Some(path.to_string_lossy().to_string()),
        app_name,
        window_title,
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
    let app_name = session.app_name.clone();
    let window_title = session.window_title.clone();
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
        app_name,
        window_title,
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
fn delete_whisper_model(app: AppHandle, model_name: String) -> Result<(), String> {
    let models_dir = whisper_models_dir(&app)?;
    let path = models_dir.join(format!("{model_name}.bin"));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn download_whisper_model(app: AppHandle, model_name: String) -> Result<WhisperModelInfo, String> {
    let models_dir = whisper_models_dir(&app)?;
    let app_progress = app.clone();
    let progress_name = model_name.clone();
    tokio::task::spawn_blocking(move || -> Result<WhisperModelInfo, String> {
        whisper::download_model(&models_dir, &model_name, move |downloaded, total| {
            let _ = app_progress.emit(
                "vox-download-progress",
                DownloadProgress {
                    model_name: progress_name.clone(),
                    downloaded,
                    total,
                },
            );
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn transcribe_recording(
    app: AppHandle,
    audio_path: String,
    model_name: Option<String>,
    dictionary: Option<String>,
    context_app_name: Option<String>,
    context_window_title: Option<String>,
) -> Result<TranscriptionResult, String> {
    transcribe_recording_inner(
        &app,
        audio_path,
        model_name,
        dictionary,
        context_app_name,
        context_window_title,
    )
}

fn transcribe_recording_inner(
    app: &AppHandle,
    audio_path: String,
    model_name: Option<String>,
    dictionary: Option<String>,
    context_app_name: Option<String>,
    context_window_title: Option<String>,
) -> Result<TranscriptionResult, String> {
    let audio_path = PathBuf::from(audio_path);
    if !audio_path.exists() {
        return Err(format!(
            "Recording file does not exist: {}",
            audio_path.display()
        ));
    }

    let models_dir = whisper_models_dir(&app)?;
    let context_dictionary = build_context_dictionary(
        dictionary.as_deref(),
        context_app_name.as_deref(),
        context_window_title.as_deref(),
    );
    let context_prompt = build_context_prompt(
        context_app_name.as_deref(),
        context_window_title.as_deref(),
    );
    let text = whisper::transcribe(
        &models_dir,
        &audio_path,
        model_name.as_deref(),
        context_dictionary.as_deref(),
        context_prompt.as_deref(),
    )?;
    let formatting_mode = app
        .try_state::<TranscriptFormattingState>()
        .and_then(|state| state.mode.lock().ok().map(|mode| *mode))
        .unwrap_or(TranscriptFormattingMode::Auto);
    let is_editable_focused = app
        .try_state::<FocusContextState>()
        .and_then(|state| state.is_editable_focused.lock().ok().map(|value| *value))
        .unwrap_or(false);
    let text = format_transcript_for_context(
        &text,
        formatting_mode,
        context_app_name.as_deref(),
        context_window_title.as_deref(),
        is_editable_focused,
    );

    Ok(TranscriptionResult {
        audio_path: audio_path.to_string_lossy().to_string(),
        text,
        app_name: context_app_name,
        duration_seconds: None,
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
fn set_dictionary(dictionary: String, state: State<'_, DictionaryState>) -> Result<(), String> {
    *state
        .content
        .lock()
        .map_err(|_| "Dictionary state unavailable".to_string())? = dictionary;
    Ok(())
}

#[tauri::command]
fn set_transcript_formatting_mode(
    mode: TranscriptFormattingMode,
    state: State<'_, TranscriptFormattingState>,
) -> Result<(), String> {
    *state
        .mode
        .lock()
        .map_err(|_| "Transcript formatting state unavailable".to_string())? = mode;
    Ok(())
}

#[tauri::command]
fn set_editable_focus_context(
    is_editable_focused: bool,
    state: State<'_, FocusContextState>,
) -> Result<(), String> {
    *state
        .is_editable_focused
        .lock()
        .map_err(|_| "Focus context state unavailable".to_string())? = is_editable_focused;
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
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(RecorderState::default())
        .manage(ActiveShortcut {
            current: Mutex::new(DEFAULT_SHORTCUT.to_string()),
        })
        .manage(DictionaryState::default())
        .manage(TranscriptFormattingState::default())
        .manage(FocusContextState::default())
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
            delete_whisper_model,
            transcribe_recording,
            transcribe_sample,
            get_current_shortcut,
            set_global_shortcut,
            get_trigger_mode,
            set_trigger_mode,
            set_dictionary,
            set_transcript_formatting_mode,
            set_editable_focus_context,
            hotkey_diagnostics,
            check_accessibility_permission,
            request_accessibility_permission,
            resolve_app_icon,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vox");
}

fn handle_hotkey_press(app: AppHandle) {
    let _ = app.emit("vox-hotkey-pressed", ());

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
    let dictionary = app
        .try_state::<DictionaryState>()
        .and_then(|state| state.content.lock().ok().map(|content| content.clone()))
        .filter(|content| !content.trim().is_empty());
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
                match transcribe_recording_inner(
                    &app,
                    path,
                    None,
                    dictionary.clone(),
                    status.app_name.clone(),
                    status.window_title.clone(),
                ) {
                    Ok(mut result) => {
                        result.app_name = status.app_name;
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

    let mut lines = text.split('\n').peekable();
    while let Some(line) = lines.next() {
        if !line.is_empty() {
            enigo.text(line).map_err(|e| e.to_string())?;
        }

        if lines.peek().is_some() {
            enigo
                .key(Key::Return, Direction::Click)
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

fn build_context_prompt(app_name: Option<&str>, window_title: Option<&str>) -> Option<String> {
    let app_name = app_name.map(str::trim).filter(|value| !value.is_empty());
    let window_title = window_title.map(str::trim).filter(|value| !value.is_empty());

    match (app_name, window_title) {
        (Some(app), Some(title)) => Some(format!(
            "The user is dictating in {app}, window title \"{title}\"."
        )),
        (Some(app), None) => Some(format!("The user is dictating in {app}.")),
        (None, Some(title)) => Some(format!("The active window title is \"{title}\".")),
        (None, None) => None,
    }
}

fn build_context_dictionary(
    user_dictionary: Option<&str>,
    app_name: Option<&str>,
    window_title: Option<&str>,
) -> Option<String> {
    let mut lines: Vec<String> = Vec::new();
    if let Some(user_dictionary) = user_dictionary.map(str::trim).filter(|value| !value.is_empty()) {
        lines.push(user_dictionary.to_string());
    }

    lines.extend(developer_context_entries(app_name, window_title));

    (!lines.is_empty()).then(|| lines.join("\n"))
}

fn developer_context_entries(app_name: Option<&str>, window_title: Option<&str>) -> Vec<String> {
    let context = format!(
        "{} {}",
        app_name.unwrap_or_default(),
        window_title.unwrap_or_default()
    )
    .to_lowercase();

    let mut entries = Vec::new();

    // Git / source-control context (editors, terminals, GitHub, etc.)
    if contains_any(
        &context,
        &[
            "cursor",
            "visual studio code",
            " vs code",
            "code",
            "terminal",
            "iterm",
            "warp",
            "github",
            "source control",
            "git",
            "pull request",
            "merge",
        ],
    ) {
        entries.extend([
            // Git commands
            "git add | | Git",
            "git add . | | Git",
            "git add --all | | Git",
            "git commit | | Git",
            "git commit -m | | Git",
            "git commit --amend | | Git",
            "git push | | Git",
            "git push origin | | Git",
            "git push --force | | Git",
            "git pull | | Git",
            "git pull --rebase | | Git",
            "git fetch | | Git",
            "git fetch --all | | Git",
            "git checkout | | Git",
            "git checkout -b | | Git",
            "git switch | | Git",
            "git switch -c | | Git",
            "git branch | | Git",
            "git branch -d | | Git",
            "git branch -D | | Git",
            "git merge | | Git",
            "git merge --no-ff | | Git",
            "git rebase | ree-base | Git",
            "git rebase -i | | Git",
            "git rebase --continue | | Git",
            "git rebase --abort | | Git",
            "git stash | | Git",
            "git stash pop | | Git",
            "git stash apply | | Git",
            "git stash list | | Git",
            "git status | | Git",
            "git log | | Git",
            "git log --oneline | | Git",
            "git diff | | Git",
            "git diff --staged | | Git",
            "git reset | | Git",
            "git reset --hard | | Git",
            "git reset --soft | | Git",
            "git cherry-pick | | Git",
            "git tag | | Git",
            "git clone | | Git",
            "git init | | Git",
            "git remote | | Git",
            "git remote add origin | | Git",
            "git remote -v | | Git",
            "git submodule | | Git",
            "git bisect | | Git",
            "git blame | | Git",
            "git shortlog | | Git",
            // Git concepts
            "pull request | | Git",
            "merge conflict | | Git",
            "rebase | ree-base | Git",
            "diff | | Git",
            "HEAD | | Git",
            "origin | | Git",
            "upstream | | Git",
            "main | | Git",
            "master | | Git",
            "feature branch | | Git",
            "hotfix | | Git",
            "squash | | Git",
            "cherry-pick | | Git",
            "detached HEAD | | Git",
            // Tooling
            "pnpm | pee-en-pee-em | Technical",
            "npm | en-pee-em | Technical",
            "TypeScript | type-script | Technical",
            "Tauri | tow-ree | Product",
            "Rust | rust | Technical",
            "Cargo | car-go | Technical",
            "GitHub | git-hub | Product",
        ]
        .into_iter()
        .map(str::to_string));
    }

    // npm / pnpm / yarn commands
    if contains_any(&context, &["terminal", "iterm", "warp", "node", "npm", "pnpm", "yarn"]) {
        entries.extend([
            "npm install | | Technical",
            "npm install --save-dev | | Technical",
            "npm run | | Technical",
            "npm run build | | Technical",
            "npm run dev | | Technical",
            "npm run test | | Technical",
            "npm run lint | | Technical",
            "npm run typecheck | | Technical",
            "npm ci | | Technical",
            "npm publish | | Technical",
            "npm update | | Technical",
            "npm outdated | | Technical",
            "npm audit | | Technical",
            "npm audit fix | | Technical",
            "pnpm install | | Technical",
            "pnpm add | | Technical",
            "pnpm run | | Technical",
            "pnpm build | | Technical",
            "pnpm dev | | Technical",
            "yarn install | | Technical",
            "yarn add | | Technical",
            "yarn run | | Technical",
            "yarn build | | Technical",
            "npx | en-pee-ex | Technical",
        ]
        .into_iter()
        .map(str::to_string));
    }

    // Terminal / shell context
    if contains_any(&context, &["terminal", "iterm", "warp", "zsh", "bash"]) {
        entries.extend([
            "zsh | zee-shell | Technical",
            "Homebrew | home-brew | Technical",
            "Node.js | node jay ess | Technical",
            "localhost | local-host | Technical",
            "chmod | | Shell",
            "chown | | Shell",
            "sudo | | Shell",
            "mkdir | | Shell",
            "rm -rf | | Shell",
            "ls -la | | Shell",
            "cat | | Shell",
            "grep | | Shell",
            "grep -r | | Shell",
            "find . | | Shell",
            "curl | | Shell",
            "curl -X | | Shell",
            "wget | | Shell",
            "ssh | | Shell",
            "scp | | Shell",
            "rsync | | Shell",
            "export | | Shell",
            "source | | Shell",
            "echo | | Shell",
            "tail -f | | Shell",
            "head | | Shell",
            "wc -l | | Shell",
            "ps aux | | Shell",
            "kill | | Shell",
            "killall | | Shell",
            "lsof | | Shell",
            "which | | Shell",
            "env | | Shell",
            "printenv | | Shell",
            "alias | | Shell",
            "history | | Shell",
            "pipe | | Shell",
            "stdin | | Shell",
            "stdout | | Shell",
            "stderr | | Shell",
            "redirect | | Shell",
        ]
        .into_iter()
        .map(str::to_string));
    }

    // Docker context
    if contains_any(&context, &["docker", "container", "dockerfile", "compose"]) {
        entries.extend([
            "Docker | docker | Technical",
            "docker build | | Docker",
            "docker build -t | | Docker",
            "docker run | | Docker",
            "docker run -d | | Docker",
            "docker run -it | | Docker",
            "docker run --rm | | Docker",
            "docker ps | | Docker",
            "docker ps -a | | Docker",
            "docker stop | | Docker",
            "docker rm | | Docker",
            "docker rmi | | Docker",
            "docker pull | | Docker",
            "docker push | | Docker",
            "docker exec | | Docker",
            "docker exec -it | | Docker",
            "docker logs | | Docker",
            "docker logs -f | | Docker",
            "docker inspect | | Docker",
            "docker images | | Docker",
            "docker volume | | Docker",
            "docker network | | Docker",
            "docker compose up | | Docker",
            "docker compose up -d | | Docker",
            "docker compose down | | Docker",
            "docker compose build | | Docker",
            "docker compose logs | | Docker",
            "docker compose ps | | Docker",
            "Dockerfile | | Docker",
            "docker-compose.yml | | Docker",
            "container | | Docker",
            "image | | Docker",
            "registry | | Docker",
            "Docker Hub | | Docker",
        ]
        .into_iter()
        .map(str::to_string));
    }

    // Kubernetes context
    if contains_any(&context, &["kubernetes", "kubectl", "k8s", "helm", "pod", "namespace"]) {
        entries.extend([
            "Kubernetes | koo-ber-net-eez | Technical",
            "kubectl | koob-control | Technical",
            "kubectl get | | Kubernetes",
            "kubectl get pods | | Kubernetes",
            "kubectl get nodes | | Kubernetes",
            "kubectl get services | | Kubernetes",
            "kubectl get deployments | | Kubernetes",
            "kubectl describe | | Kubernetes",
            "kubectl apply | | Kubernetes",
            "kubectl apply -f | | Kubernetes",
            "kubectl delete | | Kubernetes",
            "kubectl logs | | Kubernetes",
            "kubectl logs -f | | Kubernetes",
            "kubectl exec | | Kubernetes",
            "kubectl exec -it | | Kubernetes",
            "kubectl port-forward | | Kubernetes",
            "kubectl rollout | | Kubernetes",
            "kubectl rollout restart | | Kubernetes",
            "kubectl scale | | Kubernetes",
            "kubectl set image | | Kubernetes",
            "kubectl config | | Kubernetes",
            "kubectl config use-context | | Kubernetes",
            "kubectl namespace | | Kubernetes",
            "helm install | | Kubernetes",
            "helm upgrade | | Kubernetes",
            "helm uninstall | | Kubernetes",
            "helm list | | Kubernetes",
            "pod | | Kubernetes",
            "deployment | | Kubernetes",
            "service | | Kubernetes",
            "ingress | | Kubernetes",
            "namespace | | Kubernetes",
            "ConfigMap | | Kubernetes",
            "Secret | | Kubernetes",
            "PersistentVolume | | Kubernetes",
            "StatefulSet | | Kubernetes",
            "DaemonSet | | Kubernetes",
        ]
        .into_iter()
        .map(str::to_string));
    }

    // Jira / Linear / project management
    if contains_any(&context, &["jira", "linear", "ticket", "issue", "sprint"]) {
        entries.extend([
            "Jira | jee-ruh | Product",
            "Linear | linear | Product",
            "ticket | | Product",
            "sprint | | Product",
            "backlog | | Product",
            "acceptance criteria | | Product",
            "PRD | pee-arr-dee | Product",
            "epic | | Product",
            "story points | | Product",
            "velocity | | Product",
            "retrospective | | Product",
            "standup | | Product",
            "roadmap | | Product",
        ]
        .into_iter()
        .map(str::to_string));
    }

    // Chat / messaging context
    if contains_any(&context, &["chatgpt", "claude", "chat", "slack", "messages"]) {
        entries.extend([
            "ChatGPT | chat-gee-pee-tee | Product",
            "Claude | clawd | Product",
            "Slack | slack | Product",
            "Rajeshwar | rah-jaysh-war | People",
            "PRD | pee-arr-dee | Product",
            "API | ay-pee-eye | Technical",
        ]
        .into_iter()
        .map(str::to_string));
    }

    dedupe_lines(entries)
}

fn format_transcript_for_context(
    text: &str,
    mode: TranscriptFormattingMode,
    app_name: Option<&str>,
    window_title: Option<&str>,
    is_editable_focused: bool,
) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let should_format_for_developer = match mode {
        TranscriptFormattingMode::Plain => false,
        TranscriptFormattingMode::Developer => true,
        TranscriptFormattingMode::Auto => {
            is_developer_app_context(app_name, window_title, is_editable_focused)
        }
    };

    if !should_format_for_developer {
        return trimmed.to_string();
    }

    format_developer_transcript(trimmed)
}

fn is_developer_app_context(
    app_name: Option<&str>,
    window_title: Option<&str>,
    is_editable_focused: bool,
) -> bool {
    let context = format!(
        "{} {}",
        app_name.unwrap_or_default(),
        window_title.unwrap_or_default()
    )
    .to_lowercase();

    if context.contains("vox") {
        return is_editable_focused;
    }

    contains_any(
        &context,
        &[
            "cursor",
            "visual studio code",
            "vscode",
            "xcode",
            "terminal",
            "iterm",
            "warp",
            "google chrome",
            "chrome",
            "chromium",
            "arc",
            "safari",
            "firefox",
            "brave",
            "github",
            "gitlab",
            "codesandbox",
            "stackblitz",
            "replit",
            "codepen",
            "playground",
            "monaco",
            "editor",
            "localhost",
            "127.0.0.1",
            "devtools",
            "pull request",
            "source control",
            "repo",
            "code",
            ".rs",
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".py",
            ".go",
            ".java",
            ".swift",
            ".json",
            ".yml",
            ".yaml",
            "package.json",
            "cargo.toml",
        ],
    )
}

fn format_developer_transcript(text: &str) -> String {
    let normalized = text
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let words: Vec<&str> = normalized.split(' ').collect();
    let mut formatted = String::new();
    let mut index = 0;
    let mut brace_depth = 0usize;
    let mut manual_indent = 0usize;

    while index < words.len() {
        let remaining = &words[index..];
        let lower = remaining[0].to_ascii_lowercase();

        if lower == "literal" || lower == "word" {
            if let Some(next) = remaining.get(1) {
                append_plain_token(&mut formatted, next);
                index += 2;
                continue;
            }
        }

        if let Some((phrase_len, style)) = developer_identifier_style(remaining) {
            let (identifier, consumed_words) = collect_styled_identifier(&remaining[phrase_len..], style);
            if !identifier.is_empty() {
                append_plain_token(&mut formatted, &identifier);
                index += phrase_len + consumed_words;
                continue;
            }
        }

        if let Some((phrase_len, template)) = developer_template_phrase(remaining) {
            append_template_token(&mut formatted, template, brace_depth + manual_indent);
            index += phrase_len;
            continue;
        }

        if let Some(phrase_len) = developer_newline_phrase(remaining) {
            append_newline(&mut formatted, brace_depth + manual_indent);
            index += phrase_len;
            continue;
        }

        if let Some(phrase_len) = developer_indent_phrase(remaining) {
            manual_indent += 1;
            apply_current_line_indent(&mut formatted, brace_depth + manual_indent);
            index += phrase_len;
            continue;
        }

        if let Some(phrase_len) = developer_outdent_phrase(remaining) {
            manual_indent = manual_indent.saturating_sub(1);
            apply_current_line_indent(&mut formatted, brace_depth + manual_indent);
            index += phrase_len;
            continue;
        }

        if let Some((phrase_len, symbol)) = developer_symbol_phrase(remaining) {
            append_symbol_token(&mut formatted, symbol, &mut brace_depth, manual_indent);
            index += phrase_len;
            continue;
        }

        append_plain_token(&mut formatted, remaining[0]);
        index += 1;
    }

    formatted.trim().to_string()
}

#[derive(Clone, Copy)]
enum IdentifierStyle {
    Camel,
    Pascal,
    Snake,
    Kebab,
    Constant,
}

fn developer_identifier_style(words: &[&str]) -> Option<(usize, IdentifierStyle)> {
    let lower = |index: usize| words.get(index).map(|word| word.to_ascii_lowercase());

    match (
        lower(0).as_deref(),
        lower(1).as_deref(),
        lower(2).as_deref(),
    ) {
        (Some("camel"), Some("case"), _) => Some((2, IdentifierStyle::Camel)),
        (Some("pascal"), Some("case"), _) => Some((2, IdentifierStyle::Pascal)),
        (Some("snake"), Some("case"), _) => Some((2, IdentifierStyle::Snake)),
        (Some("kebab"), Some("case"), _) => Some((2, IdentifierStyle::Kebab)),
        (Some("dash"), Some("case"), _) => Some((2, IdentifierStyle::Kebab)),
        (Some("constant"), Some("case"), _) => Some((2, IdentifierStyle::Constant)),
        (Some("upper"), Some("snake"), Some("case")) => Some((3, IdentifierStyle::Constant)),
        _ => None,
    }
}

fn collect_styled_identifier(words: &[&str], style: IdentifierStyle) -> (String, usize) {
    let mut parts = Vec::new();
    let mut consumed = 0;

    while consumed < words.len() {
        if is_identifier_boundary(&words[consumed..]) {
            break;
        }

        let normalized = normalize_identifier_word(words[consumed]);
        if !normalized.is_empty() {
            parts.push(normalized);
        }
        consumed += 1;
    }

    (apply_identifier_style(&parts, style), consumed)
}

fn developer_template_phrase(words: &[&str]) -> Option<(usize, &'static str)> {
    let lower = |index: usize| words.get(index).map(|word| word.to_ascii_lowercase());

    match (
        lower(0).as_deref(),
        lower(1).as_deref(),
        lower(2).as_deref(),
    ) {
        (Some("arrow"), Some("function"), _) => Some((2, "() => {}")),
        (Some("import"), Some("statement"), _) => Some((2, "import {} from \"\";")),
        (Some("object"), Some("literal"), _) => Some((2, "{}")),
        (Some("array"), Some("literal"), _) => Some((2, "[]")),
        (Some("try"), Some("catch"), _) => Some((2, "try {\n    \n} catch (error) {\n    \n}")),
        (Some("if"), Some("else"), _) => Some((2, "if () {\n    \n} else {\n    \n}")),
        (Some("function"), Some("declaration"), _) => {
            Some((2, "function name() {\n    \n}"))
        }
        _ => None,
    }
}

fn normalize_identifier_word(word: &str) -> String {
    word.chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn apply_identifier_style(parts: &[String], style: IdentifierStyle) -> String {
    if parts.is_empty() {
        return String::new();
    }

    match style {
        IdentifierStyle::Camel => {
            let mut result = parts[0].clone();
            for part in &parts[1..] {
                result.push_str(&capitalize_identifier_part(part));
            }
            result
        }
        IdentifierStyle::Pascal => parts
            .iter()
            .map(|part| capitalize_identifier_part(part))
            .collect::<String>(),
        IdentifierStyle::Snake => parts.join("_"),
        IdentifierStyle::Kebab => parts.join("-"),
        IdentifierStyle::Constant => parts
            .iter()
            .map(|part| part.to_ascii_uppercase())
            .collect::<Vec<_>>()
            .join("_"),
    }
}

fn capitalize_identifier_part(part: &str) -> String {
    let mut chars = part.chars();
    let Some(first) = chars.next() else {
        return String::new();
    };

    let mut result = String::new();
    result.extend(first.to_uppercase());
    result.push_str(chars.as_str());
    result
}

fn is_identifier_boundary(words: &[&str]) -> bool {
    developer_identifier_style(words).is_some()
        || developer_template_phrase(words).is_some()
        || developer_newline_phrase(words).is_some()
        || developer_indent_phrase(words).is_some()
        || developer_outdent_phrase(words).is_some()
        || developer_symbol_phrase(words).is_some()
        || matches!(
            words.first().map(|word| word.to_ascii_lowercase()).as_deref(),
            Some("literal") | Some("word")
        )
}

fn developer_newline_phrase(words: &[&str]) -> Option<usize> {
    let lower = |index: usize| words.get(index).map(|word| word.to_ascii_lowercase());

    match (lower(0).as_deref(), lower(1).as_deref()) {
        (Some("newline"), _) => Some(1),
        (Some("new"), Some("line")) => Some(2),
        (Some("next"), Some("line")) => Some(2),
        _ => None,
    }
}

fn developer_indent_phrase(words: &[&str]) -> Option<usize> {
    match words.first().map(|word| word.to_ascii_lowercase()).as_deref() {
        Some("indent") | Some("tab") => Some(1),
        _ => None,
    }
}

fn developer_outdent_phrase(words: &[&str]) -> Option<usize> {
    match words.first().map(|word| word.to_ascii_lowercase()).as_deref() {
        Some("outdent") | Some("dedent") => Some(1),
        _ => None,
    }
}

fn developer_symbol_phrase(words: &[&str]) -> Option<(usize, &'static str)> {
    let lower = |index: usize| words.get(index).map(|word| word.to_ascii_lowercase());

    match (lower(0).as_deref(), lower(1).as_deref(), lower(2).as_deref()) {
        (Some("open"), Some("curly"), Some("brace")) => Some((3, "{")),
        (Some("close"), Some("curly"), Some("brace")) => Some((3, "}")),
        (Some("open"), Some("square"), Some("bracket")) => Some((3, "[")),
        (Some("close"), Some("square"), Some("bracket")) => Some((3, "]")),
        (Some("open"), Some("angle"), Some("bracket")) => Some((3, "<")),
        (Some("close"), Some("angle"), Some("bracket")) => Some((3, ">")),
        _ => match (lower(0).as_deref(), lower(1).as_deref()) {
            (Some("open"), Some("brace")) => Some((2, "{")),
            (Some("close"), Some("brace")) => Some((2, "}")),
            (Some("open"), Some("bracket")) => Some((2, "[")),
            (Some("close"), Some("bracket")) => Some((2, "]")),
            (Some("open"), Some("paren")) | (Some("open"), Some("parenthesis")) => {
                Some((2, "("))
            }
            (Some("close"), Some("paren")) | (Some("close"), Some("parenthesis")) => {
                Some((2, ")"))
            }
            (Some("left"), Some("paren")) => Some((2, "(")),
            (Some("right"), Some("paren")) => Some((2, ")")),
            (Some("double"), Some("quote")) => Some((2, "\"")),
            (Some("single"), Some("quote")) => Some((2, "'")),
            (Some("back"), Some("tick")) => Some((2, "`")),
            _ => match lower(0).as_deref() {
                Some("comma") => Some((1, ",")),
                Some("dot") | Some("period") => Some((1, ".")),
                Some("colon") => Some((1, ":")),
                Some("semicolon") => Some((1, ";")),
                Some("dash") | Some("hyphen") | Some("minus") => Some((1, "-")),
                Some("underscore") => Some((1, "_")),
                Some("slash") => Some((1, "/")),
                Some("backslash") => Some((1, "\\")),
                Some("pipe") => Some((1, "|")),
                Some("equals") => Some((1, "=")),
                Some("plus") => Some((1, "+")),
                Some("asterisk") | Some("star") => Some((1, "*")),
                Some("ampersand") => Some((1, "&")),
                Some("question") => Some((1, "?")),
                Some("bang") => Some((1, "!")),
                Some("hash") => Some((1, "#")),
                Some("dollar") => Some((1, "$")),
                Some("percent") => Some((1, "%")),
                Some("at") => Some((1, "@")),
                Some("tilde") => Some((1, "~")),
                _ => None,
            },
        },
    }
}

fn append_plain_token(output: &mut String, token: &str) {
    if output.is_empty() {
        output.push_str(token);
        return;
    }

    if needs_space_before_word(output) {
        output.push(' ');
    }
    output.push_str(token);
}

fn append_symbol_token(
    output: &mut String,
    symbol: &str,
    brace_depth: &mut usize,
    manual_indent: usize,
) {
    match symbol {
        "}" => {
            *brace_depth = brace_depth.saturating_sub(1);
            apply_current_line_indent(output, *brace_depth + manual_indent);
            trim_trailing_space(output);
            output.push('}');
        }
        "," | "." | ":" | ";" | ")" | "]" | ">" => {
            trim_trailing_space(output);
            output.push_str(symbol);
            if matches!(symbol, "," | ":" | ";") {
                output.push(' ');
            }
        }
        "{" => {
            trim_trailing_space(output);
            output.push('{');
            *brace_depth += 1;
        }
        "(" | "[" | "<" => {
            trim_trailing_space(output);
            output.push_str(symbol);
        }
        "_" => {
            trim_trailing_space(output);
            output.push('_');
        }
        _ => {
            trim_trailing_space(output);
            output.push_str(symbol);
            output.push(' ');
        }
    }
}

fn append_template_token(output: &mut String, template: &str, indent_level: usize) {
    if output.is_empty() {
        output.push_str(&indent_template(template, indent_level));
        return;
    }

    if needs_space_before_word(output) {
        output.push(' ');
    }

    output.push_str(&indent_template(template, indent_level));
}

fn append_newline(output: &mut String, indent_level: usize) {
    trim_trailing_space(output);
    if output.is_empty() {
        return;
    }

    output.push('\n');
    output.push_str(&indent_string(indent_level));
}

fn apply_current_line_indent(output: &mut String, indent_level: usize) {
    if output.is_empty() {
        return;
    }

    if let Some(line_start) = output.rfind('\n') {
        let current = &output[line_start + 1..];
        if current.chars().all(|ch| ch == ' ') {
            output.truncate(line_start + 1);
            output.push_str(&indent_string(indent_level));
        }
        return;
    }

    if output.chars().all(|ch| ch == ' ') {
        output.clear();
        output.push_str(&indent_string(indent_level));
    }
}

fn indent_string(indent_level: usize) -> String {
    "    ".repeat(indent_level)
}

fn indent_template(template: &str, indent_level: usize) -> String {
    let mut lines = template.lines();
    let Some(first_line) = lines.next() else {
        return String::new();
    };

    let mut result = first_line.to_string();
    let line_indent = indent_string(indent_level);
    for line in lines {
        result.push('\n');
        result.push_str(&line_indent);
        result.push_str(line);
    }

    result
}

fn trim_trailing_space(output: &mut String) {
    while output.ends_with(' ') {
        output.pop();
    }
}

fn needs_space_before_word(output: &str) -> bool {
    !output.is_empty()
        && !output.ends_with(' ')
        && !output.ends_with('(')
        && !output.ends_with('[')
        && !output.ends_with('{')
        && !output.ends_with('<')
        && !output.ends_with('_')
        && !output.ends_with('/')
        && !output.ends_with('\\')
        && !output.ends_with('-')
        && !output.ends_with('.')
}

fn contains_any(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}

fn dedupe_lines(lines: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    lines
        .into_iter()
        .filter(|line| seen.insert(line.to_lowercase()))
        .collect()
}

#[cfg(target_os = "macos")]
fn resolve_app_icon_data_url(app_name: &str) -> Option<String> {
    let app_name = app_name.trim();
    if app_name.is_empty() {
        return None;
    }

    unsafe {
        let workspace: *mut objc::runtime::Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        if workspace.is_null() {
            return None;
        }

        let url = application_url_for_name(workspace, app_name)?;
        let path: *mut objc::runtime::Object = msg_send![url, path];
        if path.is_null() {
            return None;
        }

        let icon: *mut objc::runtime::Object = msg_send![workspace, iconForFile: path];
        if icon.is_null() {
            return None;
        }

        let tiff_data: *mut objc::runtime::Object = msg_send![icon, TIFFRepresentation];
        if tiff_data.is_null() {
            return None;
        }

        let bitmap: *mut objc::runtime::Object = msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff_data];
        if bitmap.is_null() {
            return None;
        }

        let png_type: usize = 4;
        let png_data: *mut objc::runtime::Object =
            msg_send![bitmap, representationUsingType: png_type properties: std::ptr::null::<c_void>()];
        nsdata_to_data_url(png_data, "image/png")
    }
}

#[cfg(target_os = "macos")]
unsafe fn application_url_for_name(
    workspace: *mut objc::runtime::Object,
    app_name: &str,
) -> Option<*mut objc::runtime::Object> {
    let running_apps: *mut objc::runtime::Object = msg_send![workspace, runningApplications];
    if !running_apps.is_null() {
        let count: usize = msg_send![running_apps, count];
        for index in 0..count {
            let app: *mut objc::runtime::Object = msg_send![running_apps, objectAtIndex: index];
            if app.is_null() {
                continue;
            }

            let name: *mut objc::runtime::Object = msg_send![app, localizedName];
            if nsstring_to_string(name).as_deref() == Some(app_name) {
                let url: *mut objc::runtime::Object = msg_send![app, bundleURL];
                if !url.is_null() {
                    return Some(url);
                }
            }
        }
    }

    let ns_name = nsstring_from_str(app_name);
    let url: *mut objc::runtime::Object = msg_send![workspace, URLForApplicationWithBundleIdentifier: ns_name];
    if !url.is_null() {
        return Some(url);
    }

    let full_name = if app_name.ends_with(".app") {
        app_name.to_string()
    } else {
        format!("{app_name}.app")
    };
    let full_name = nsstring_from_str(&full_name);
    let path: *mut objc::runtime::Object = msg_send![workspace, fullPathForApplication: full_name];
    if path.is_null() {
        return None;
    }

    let file_url: *mut objc::runtime::Object = msg_send![class!(NSURL), fileURLWithPath: path];
    if file_url.is_null() {
        None
    } else {
        Some(file_url)
    }
}

#[cfg(target_os = "macos")]
unsafe fn nsstring_from_str(value: &str) -> *mut objc::runtime::Object {
    let string: *mut objc::runtime::Object = msg_send![class!(NSString), alloc];
    let string: *mut objc::runtime::Object =
        msg_send![string, initWithBytes: value.as_ptr() length: value.len() encoding: 4usize];
    string
}

#[cfg(target_os = "macos")]
unsafe fn nsstring_to_string(value: *mut objc::runtime::Object) -> Option<String> {
    if value.is_null() {
        return None;
    }

    let utf8: *const std::os::raw::c_char = msg_send![value, UTF8String];
    if utf8.is_null() {
        return None;
    }

    std::ffi::CStr::from_ptr(utf8).to_str().ok().map(str::to_string)
}

#[cfg(target_os = "macos")]
unsafe fn nsdata_to_data_url(data: *mut objc::runtime::Object, mime: &str) -> Option<String> {
    if data.is_null() {
        return None;
    }

    let length: usize = msg_send![data, length];
    let bytes: *const u8 = msg_send![data, bytes];
    if bytes.is_null() || length == 0 {
        return None;
    }

    let slice = std::slice::from_raw_parts(bytes, length);
    Some(format!(
        "data:{mime};base64,{}",
        base64_encode(slice)
    ))
}

#[cfg(target_os = "macos")]
fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);

        output.push(TABLE[(b0 >> 2) as usize] as char);
        output.push(TABLE[(((b0 & 0b11) << 4) | (b1 >> 4)) as usize] as char);
        output.push(if chunk.len() > 1 {
            TABLE[(((b1 & 0b1111) << 2) | (b2 >> 6)) as usize] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            TABLE[(b2 & 0b0011_1111) as usize] as char
        } else {
            '='
        });
    }

    output
}

#[cfg(not(target_os = "macos"))]
fn resolve_app_icon_data_url(_app_name: &str) -> Option<String> {
    None
}

#[cfg(target_os = "macos")]
fn frontmost_app_name() -> Option<String> {
    unsafe {
        let workspace: *mut objc::runtime::Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        if workspace.is_null() {
            return None;
        }

        let app: *mut objc::runtime::Object = msg_send![workspace, frontmostApplication];
        if app.is_null() {
            return None;
        }

        let name: *mut objc::runtime::Object = msg_send![app, localizedName];
        if name.is_null() {
            return None;
        }

        let utf8: *const std::os::raw::c_char = msg_send![name, UTF8String];
        if utf8.is_null() {
            return None;
        }

        std::ffi::CStr::from_ptr(utf8).to_str().ok().map(str::to_string)
    }
}

#[cfg(target_os = "macos")]
fn frontmost_window_title(app_name: Option<&str>) -> Option<String> {
    let app_name = app_name?.trim();
    if app_name.is_empty() {
        return None;
    }

    let owner_key = CFString::new("kCGWindowOwnerName");
    let title_key = CFString::new("kCGWindowName");
    let options = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
    let windows = copy_window_info(options, kCGNullWindowID)?;

    for window in windows.get_all_values() {
        let dictionary = unsafe {
            CFDictionary::<CFString, CFType>::wrap_under_get_rule(window as CFDictionaryRef)
        };
        let owner = cf_dictionary_string(&dictionary, &owner_key);
        if owner.as_deref() != Some(app_name) {
            continue;
        }

        if let Some(title) = cf_dictionary_string(&dictionary, &title_key) {
            let title = title.trim().to_string();
            if !title.is_empty() {
                return Some(title);
            }
        }
    }

    None
}

#[cfg(target_os = "macos")]
fn cf_dictionary_string(
    dictionary: &CFDictionary<CFString, CFType>,
    key: &CFString,
) -> Option<String> {
    let value = dictionary.find(key)?;
    if !value.instance_of::<CFString>() {
        return None;
    }

    let value = unsafe { CFString::wrap_under_get_rule(value.as_CFTypeRef() as CFStringRef) };
    Some(value.to_string())
}

#[cfg(not(target_os = "macos"))]
fn frontmost_app_name() -> Option<String> {
    None
}

#[cfg(not(target_os = "macos"))]
fn frontmost_window_title(_app_name: Option<&str>) -> Option<String> {
    None
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
            // Emit idle so CSS fades out, then hide the native window.
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
                let _ = window.hide();
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
