#![allow(unexpected_cfgs)]

use std::{
    fs::{self, File},
    io::BufWriter,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "macos")]
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
};

#[cfg(target_os = "linux")]
use std::{env, io::Write, process::Stdio};

use arboard::Clipboard;
#[cfg(target_os = "macos")]
use core_foundation::{
    base::{CFRelease, CFType, CFTypeRef, TCFType},
    dictionary::{CFDictionary, CFDictionaryRef},
    string::{CFString, CFStringRef},
};
#[cfg(target_os = "macos")]
use core_graphics::window::{
    copy_window_info, kCGNullWindowID, kCGWindowListExcludeDesktopElements,
    kCGWindowListOptionOnScreenOnly,
};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use hound::{SampleFormat, WavSpec, WavWriter};
#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};
use sentry::ClientInitGuard;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::ffi::c_void;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Emitter, Manager, PhysicalPosition, Position, State, WebviewWindow,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg(target_os = "macos")]
#[link(name = "AppKit", kind = "framework")]
extern "C" {}

#[cfg(target_os = "macos")]
#[link(name = "AVFoundation", kind = "framework")]
extern "C" {}

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    // Input Monitoring permission (macOS 10.15+). Required for CGEventTap to
    // receive keyboard events from other apps, which the global hotkey relies on.
    fn CGPreflightListenEventAccess() -> bool;
    fn CGRequestListenEventAccess() -> bool;
}

mod custom_models;
#[cfg(target_os = "macos")]
mod dock_icon;
#[cfg(target_os = "macos")]
mod event_tap;
#[cfg(target_os = "macos")]
mod live_transcript;
#[cfg(target_os = "macos")]
mod login_item;
mod text_enhancement;
pub mod vocabulary;
mod writing;

#[cfg(not(target_os = "macos"))]
mod live_transcript {
    /// No live preview off macOS (no Apple Speech sidecar).
    pub fn start(_app: &tauri::AppHandle, _language: &str) {}
    pub fn stop() -> Option<(String, Option<f32>)> {
        None
    }
}

#[cfg(not(target_os = "macos"))]
mod dock_icon {
    /// The Dock icon is macOS-only; other platforms use the bundled icon.
    pub fn apply(_app: &tauri::AppHandle, _theme: &str) {}
}

#[cfg(not(target_os = "macos"))]
mod login_item {
    // "Start at login" off macOS is delegated to the autostart plugin
    // directly (no SMAppService or LaunchAgent-grouping concerns).
    use tauri::Manager;

    pub fn set_enabled(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
        let manager = app
            .try_state::<tauri_plugin_autostart::AutoLaunchManager>()
            .ok_or_else(|| "Autostart service is unavailable".to_string())?;
        if enabled {
            manager.enable().map_err(|error| error.to_string())
        } else {
            manager.disable().map_err(|error| error.to_string())
        }
    }

    pub fn is_enabled(app: &tauri::AppHandle) -> Result<bool, String> {
        app.try_state::<tauri_plugin_autostart::AutoLaunchManager>()
            .ok_or_else(|| "Autostart service is unavailable".to_string())?
            .is_enabled()
            .map_err(|error| error.to_string())
    }

    /// Nothing to migrate off macOS — there is no legacy LaunchAgent path.
    pub fn migrate_legacy_agent() {}
}

#[cfg(not(target_os = "macos"))]
mod event_tap {
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Debug, PartialEq)]
    pub struct HotKey {
        shortcut: String,
    }

    #[derive(Clone, Copy, Debug, PartialEq)]
    pub enum TriggerMode {
        Toggle,
        PushToTalk,
    }

    pub struct TapState {
        pub hotkey: Mutex<HotKey>,
        pub mode: Mutex<TriggerMode>,
        pub is_active: Mutex<bool>,
        pub last_error: Mutex<Option<String>>,
    }

    pub fn is_accessibility_trusted() -> bool {
        true
    }

    pub fn request_accessibility_permission() -> bool {
        true
    }

    pub fn parse_hotkey(shortcut: &str) -> Result<HotKey, String> {
        if shortcut.trim().is_empty() {
            return Err("Shortcut cannot be empty".to_string());
        }

        Ok(HotKey {
            shortcut: shortcut.to_string(),
        })
    }

    pub fn start(
        initial_hotkey: HotKey,
        initial_mode: TriggerMode,
        _on_press: impl Fn() + Send + Sync + 'static,
        _on_release: impl Fn() + Send + Sync + 'static,
    ) -> Arc<TapState> {
        Arc::new(TapState {
            hotkey: Mutex::new(initial_hotkey),
            mode: Mutex::new(initial_mode),
            is_active: Mutex::new(false),
            last_error: Mutex::new(Some(
                "Native event tap is only available on macOS; using Tauri global shortcuts."
                    .to_string(),
            )),
        })
    }
}

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

#[tauri::command]
fn open_external_link(href: String) -> Result<(), String> {
    let normalized = href.to_ascii_lowercase();
    if !(normalized.starts_with("https://")
        || normalized.starts_with("http://")
        || normalized.starts_with("mailto:"))
    {
        return Err("Unsupported link type".to_string());
    }

    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&href).spawn();

    #[cfg(target_os = "windows")]
    let result = Command::new("cmd")
        .args(["/C", "start", "", href.as_str()])
        .spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(&href).spawn();

    result
        .map(|_| ())
        .map_err(|error| format!("Could not open link: {error}"))
}

mod engines;
mod hardware;
mod whisper;

const DEFAULT_SHORTCUT: &str = "Meta+Shift+Space";
const TRAY_OPEN_APP_ID: &str = "open_app";
const TRAY_START_DICTATION_ID: &str = "start_dictation";
const TRAY_PRIVATE_DICTATION_ID: &str = "private_dictation";
const TRAY_CANCEL_DICTATION_ID: &str = "cancel_dictation";
const TRAY_UNDO_INSERTION_ID: &str = "undo_insertion";
const TRAY_RETRY_INSERTION_ID: &str = "retry_insertion";
const TRAY_SETTINGS_ID: &str = "settings";
const TRAY_QUIT_ID: &str = "quit";

/// How long after insertion the tray/undo command keeps offering an undo.
const UNDO_INSERTION_WINDOW: Duration = Duration::from_secs(60);
/// How long a failed insertion can be retried from the tray.
const RETRY_INSERTION_WINDOW: Duration = Duration::from_secs(5 * 60);
/// Cmd+Z is only a safe fallback immediately after insertion, before the user
/// is likely to have typed something else.
const UNDO_SHORTCUT_FALLBACK_WINDOW: Duration = Duration::from_secs(10);

type SharedWriter = Arc<Mutex<Option<WavWriter<BufWriter<File>>>>>;

struct ActiveShortcut {
    current: Mutex<String>,
}

/// Vocabulary Packs state (spec §23): the store is behind a Mutex and never
/// mutated from the audio thread — it is only touched by Tauri commands and
/// the transcription command, both of which already run off the audio path.
/// The cached trie/context is rebuilt lazily when the generation counter or
/// app context changes (spec §22: rebuild indexes only after changes).
struct VocabularyState {
    store: Mutex<vocabulary::store::VocabularyStore>,
    cache: Mutex<Option<VocabularyCache>>,
}

struct VocabularyCache {
    generation: u64,
    app_key: Option<String>,
    context: std::sync::Arc<vocabulary::model::ActiveVocabularyContext>,
    trie: std::sync::Arc<vocabulary::index::PhraseTrie>,
}

impl VocabularyState {
    fn with_store<T>(
        &self,
        mutate: impl FnOnce(&mut vocabulary::store::VocabularyStore) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut store = self
            .store
            .lock()
            .map_err(|_| "Vocabulary state unavailable".to_string())?;
        let result = mutate(&mut store)?;
        if let Err(error) = store.persist() {
            eprintln!("[VOX][vocabulary] persist failed: {error}");
        }
        *self
            .cache
            .lock()
            .map_err(|_| "Vocabulary cache unavailable".to_string())? = None; // invalidate
        Ok(result)
    }

    /// Cached active context + trie for the given app (spec §22).
    fn cached_context(&self, app_name: Option<&str>) -> std::sync::Arc<VocabularyCache> {
        let generation = self.store.lock().map(|store| store.generation).unwrap_or(0);
        let app_key = app_name.map(|name| name.trim().to_lowercase());

        let mut cache = self
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(cached) = cache.as_ref() {
            if cached.generation == generation && cached.app_key == app_key {
                return std::sync::Arc::new(VocabularyCache {
                    generation,
                    app_key: cached.app_key.clone(),
                    context: cached.context.clone(),
                    trie: cached.trie.clone(),
                });
            }
        }

        let now = vocabulary::store::now_secs();
        let (context, trie) = {
            let store = self
                .store
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let packs = store.all_packs();
            let app_context = app_key
                .clone()
                .map(|name| vocabulary::model::ApplicationContext {
                    app: vocabulary::model::ApplicationIdentifier {
                        id: name.clone(),
                        display_name: Some(name),
                    },
                    window_title: None,
                });
            let context = vocabulary::context::build_context(&packs, app_context.clone(), now);
            // The correction trie covers every enabled entry (local + fast);
            // the capped `context` is what engine adapters receive (spec §8).
            let correction_context =
                vocabulary::context::build_correction_context(&packs, app_context, now);
            let trie = vocabulary::index::PhraseTrie::build(&correction_context);
            (std::sync::Arc::new(context), std::sync::Arc::new(trie))
        };
        let built = VocabularyCache {
            generation,
            app_key: app_key.clone(),
            context: context.clone(),
            trie: trie.clone(),
        };
        *cache = Some(VocabularyCache {
            generation,
            app_key: app_key.clone(),
            context: context.clone(),
            trie: trie.clone(),
        });
        std::sync::Arc::new(built)
    }
}

struct TranscriptFormattingState {
    mode: Mutex<TranscriptFormattingMode>,
}

#[derive(Default)]
struct CleanupLevelState {
    level: Mutex<text_enhancement::CleanupLevel>,
}

struct WidgetPreferencesState {
    enabled: Mutex<bool>,
}

#[derive(Default)]
struct ErrorReportingState {
    guard: Mutex<Option<ClientInitGuard>>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum CliCommand {
    ToggleRecording,
    StartRecording,
    StopRecording,
    Cancel,
    Show,
    Hide,
    Diagnostics,
}

#[derive(Clone, Debug, Default)]
struct CliOptions {
    start_hidden: bool,
    commands: Vec<CliCommand>,
}

impl CliOptions {
    fn from_env() -> Self {
        Self::from_args(std::env::args().skip(1))
    }

    fn from_forwarded_args(args: Vec<String>) -> Self {
        Self::from_args(args.into_iter().skip(1))
    }

    fn from_args(args: impl IntoIterator<Item = String>) -> Self {
        let mut options = Self::default();

        for arg in args {
            match arg.as_str() {
                "--toggle-recording" => options.commands.push(CliCommand::ToggleRecording),
                "--start-recording" => options.commands.push(CliCommand::StartRecording),
                "--stop-recording" => options.commands.push(CliCommand::StopRecording),
                "--cancel" => options.commands.push(CliCommand::Cancel),
                "--show" => options.commands.push(CliCommand::Show),
                "--hide" => options.commands.push(CliCommand::Hide),
                "--start-hidden" => options.start_hidden = true,
                "--diagnostics" => options.commands.push(CliCommand::Diagnostics),
                "--help" | "-h" => options.commands.push(CliCommand::Diagnostics),
                _ => {}
            }
        }

        options
    }

    fn has_actions(&self) -> bool {
        self.start_hidden || !self.commands.is_empty()
    }
}

#[tauri::command]
fn set_error_reporting_enabled(
    state: State<'_, ErrorReportingState>,
    enabled: bool,
    dsn: Option<String>,
) -> Result<(), String> {
    let mut guard = state
        .guard
        .lock()
        .map_err(|_| "Error reporting state is unavailable".to_string())?;

    if !enabled {
        *guard = None;
        return Ok(());
    }

    let Some(dsn) = dsn.filter(|value| !value.trim().is_empty()) else {
        *guard = None;
        return Ok(());
    };
    let parsed_dsn = parse_error_reporting_dsn(&dsn)?;

    if guard.is_some() {
        return Ok(());
    }

    let release = format!("{}@{}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"));
    *guard = Some(sentry::init((
        parsed_dsn,
        sentry::ClientOptions {
            release: Some(release.into()),
            send_default_pii: false,
            before_send: Some(Arc::new(|event| Some(sanitize_sentry_event(event)))),
            ..Default::default()
        },
    )));
    Ok(())
}

fn parse_error_reporting_dsn(dsn: &str) -> Result<sentry::types::Dsn, String> {
    dsn.parse::<sentry::types::Dsn>()
        .map_err(|_| "Error reporting DSN is invalid".to_string())
}

fn sanitize_sentry_event(
    mut event: sentry::protocol::Event<'static>,
) -> sentry::protocol::Event<'static> {
    event.user = None;
    event.request = None;
    event.message = None;
    event.logentry = None;
    event.transaction = None;
    event.culprit = None;
    event.extra.clear();
    event.contexts.clear();
    event.tags.clear();
    event.breadcrumbs.values.clear();

    for exception in &mut event.exception {
        exception.value = Some("[redacted]".to_string());
        if let Some(stacktrace) = exception.stacktrace.as_mut() {
            sanitize_sentry_stacktrace(stacktrace);
        }
        if let Some(stacktrace) = exception.raw_stacktrace.as_mut() {
            sanitize_sentry_stacktrace(stacktrace);
        }
    }
    if let Some(stacktrace) = event.stacktrace.as_mut() {
        sanitize_sentry_stacktrace(stacktrace);
    }
    for thread in &mut event.threads {
        if let Some(stacktrace) = thread.stacktrace.as_mut() {
            sanitize_sentry_stacktrace(stacktrace);
        }
        if let Some(stacktrace) = thread.raw_stacktrace.as_mut() {
            sanitize_sentry_stacktrace(stacktrace);
        }
    }

    event
}

fn sanitize_sentry_stacktrace(stacktrace: &mut sentry::protocol::Stacktrace) {
    for frame in &mut stacktrace.frames {
        frame.abs_path = None;
        frame.pre_context.clear();
        frame.context_line = None;
        frame.post_context.clear();
        frame.vars.clear();
    }
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

struct EnhancePreferencesState {
    enabled: Mutex<bool>,
    model_name: Mutex<String>,
    model_available: Mutex<bool>,
}

impl Default for EnhancePreferencesState {
    fn default() -> Self {
        Self {
            enabled: Mutex::new(true),
            model_name: Mutex::new(text_enhancement::DEFAULT_TEXT_ENHANCEMENT_MODEL.to_string()),
            model_available: Mutex::new(false),
        }
    }
}

#[derive(Default)]
struct FocusedInputSnapshotState {
    latest: Mutex<Option<FocusedInputSnapshot>>,
    presented: Mutex<Option<PresentedEnhanceOverlay>>,
}

#[derive(Default)]
struct TransformState {
    /// Clipboard content saved before capturing the current selection.
    original_clipboard: Mutex<Option<String>>,
}

#[derive(Clone)]
struct FocusedInputSnapshot {
    id: String,
    app_name: Option<String>,
    text: String,
}

#[derive(Clone, Copy, PartialEq)]
struct InputFrame {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, PartialEq)]
struct PresentedEnhanceOverlay {
    snapshot_id: String,
    position: (i32, i32),
}

#[derive(Default)]
struct LanguageState {
    /// User's preferred dictation language: "auto", "en", "hi", "hinglish", …
    language: Mutex<String>,
}

/// Which transcription engine runs (spec §6/§7/§8). `engine` is "auto" or an
/// engine id; fallback settings govern what happens when the chosen engine
/// cannot produce a transcript.
struct EngineSelectionState {
    engine: Mutex<String>,
    /// The Whisper pin used by background hotkey transcriptions. The UI path
    /// already passes this explicitly; keeping it here keeps both paths fast
    /// and consistent.
    selected_model: Mutex<String>,
    fallback_enabled: AtomicBool,
    preferred_fallback: Mutex<String>,
    /// Engine used by the previous transcription — used to emit
    /// `transcription_engine_changed` when auto/dispatch picks a different one.
    last_engine: Mutex<String>,
}

impl Default for EngineSelectionState {
    fn default() -> Self {
        Self {
            // Apple Speech needs no download, so it is the out-of-the-box
            // engine. Any other model must be downloaded and chosen explicitly.
            engine: Mutex::new("apple".to_string()),
            selected_model: Mutex::new("large-v3-turbo".to_string()),
            fallback_enabled: AtomicBool::new(true),
            preferred_fallback: Mutex::new("whisper".to_string()),
            last_engine: Mutex::new(String::new()),
        }
    }
}

/// A voice-triggered text expansion: when the trigger phrase appears in a
/// transcript, it is replaced with the expansion.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snippet {
    trigger: String,
    expansion: String,
    /// Optional app/window-name filter. Empty or missing = anywhere.
    #[serde(default)]
    app_pattern: Option<String>,
}

#[derive(Default)]
struct SnippetsState {
    snippets: Mutex<Vec<Snippet>>,
}

/// The most recent transcript Vox inserted (or tried to insert). Powers the
/// "Undo last dictation" action and retrying an insertion that failed.
#[derive(Default)]
struct LastInsertionState {
    last: Mutex<Option<LastInsertion>>,
}

/// User preference for how dictated text is inserted: cursor typing (default)
/// or a clipboard paste that restores the previous clipboard afterwards.
#[derive(Default)]
struct InsertionMethodState {
    method: Mutex<String>,
}

#[derive(Clone)]
struct LastInsertion {
    /// Exact text handed to the typing layer, including any trailing space.
    text: String,
    app_name: Option<String>,
    inserted_at: Instant,
    /// False when typing failed, so the tray offers Retry instead of Undo.
    inserted: bool,
}

#[derive(Default)]
struct RecorderState {
    session: Mutex<Option<RecordingSession>>,
    audio_bars: Arc<Mutex<[f32; 7]>>,
    /// Voice-activity state updated by the audio callback; used by hands-free
    /// mode to detect utterance boundaries.
    vad: Arc<VadState>,
    /// Serializes hands-free segment transcription so concurrent Whisper
    /// invocations never compete for CPU/GPU or spike memory.
    segment_transcribe_lock: Mutex<()>,
    /// Whisper mode: boosts quiet/whispered speech in the recording path.
    whisper_mode: Arc<AtomicBool>,
    /// Rolling window of normalized samples used to compute the widget's audio
    /// bars. A window (~200 ms) gives the 7 bars real temporal variation from
    /// speech, instead of near-identical values from a single short buffer.
    bar_window: Arc<Mutex<Vec<f32>>>,
}

/// Voice-activity detection state shared between the audio callback (writer)
/// and the hands-free monitor thread (reader).
struct VadState {
    /// When sound was last heard above the speech threshold.
    last_sound_at: Mutex<Instant>,
    /// Whether any speech has been detected in the current segment.
    has_speech: AtomicBool,
}

impl Default for VadState {
    fn default() -> Self {
        Self {
            last_sound_at: Mutex::new(Instant::now()),
            has_speech: AtomicBool::new(false),
        }
    }
}

struct RecordingSession {
    path: PathBuf,
    app_name: Option<String>,
    window_title: Option<String>,
    started_at: Instant,
    stream: cpal::Stream,
    writer: SharedWriter,
    /// WAV format captured at session start; reused when hands-free mode
    /// rotates segment files.
    channels: u16,
    sample_rate: u32,
    /// Incognito dictation: transcribe and insert, but never save the
    /// transcript, audio, or vocabulary learning.
    private: bool,
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
    /// Final Apple Speech live result, when available. The selected Apple
    /// engine can reuse it instead of recognizing the recorded WAV again.
    preview_text: Option<String>,
    /// Average confidence of the live final, when Apple reports it.
    preview_confidence: Option<f32>,
    /// True for an incognito dictation (nothing is persisted).
    private: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptPreview {
    title: &'static str,
    text: &'static str,
    duration_seconds: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionInfo {
    /// Raw ASR form that was replaced.
    pub source: String,
    /// Canonical form it was replaced with.
    pub canonical: String,
    /// Lexical confidence of the correction (1.0 for exact matches).
    pub confidence: f32,
    /// Engine confidence for the transcript this correction came from.
    pub asr_confidence: Option<f32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptionTimings {
    audio_preflight_ms: u64,
    transcribe_ms: u64,
    postprocess_ms: u64,
    total_ms: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptionResult {
    audio_path: String,
    text: String,
    app_name: Option<String>,
    duration_seconds: Option<u64>,
    /// Raw text exactly as the ASR engine produced it, before formatting,
    /// cleanup, corrections, or snippet expansion.
    asr_text: String,
    /// Text before AI cleanup/corrections, when a later stage changed it.
    /// Used by the transcript library's "Undo AI edit" action.
    raw_text: Option<String>,
    /// Language actually used for transcription (auto-detected or pinned).
    language: Option<String>,
    /// Engine confidence for the raw transcript (0.0–1.0), when available.
    confidence: Option<f32>,
    /// Engine that produced the raw transcript ("whisper", "parakeet", …).
    engine: &'static str,
    /// Per-stage timings for latency dashboards and regression checks.
    timings: TranscriptionTimings,
    /// Vocabulary corrections applied to the final text.
    corrections: Vec<CorrectionInfo>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WidgetEvent {
    mode: &'static str,
    message: String,
    elapsed_seconds: Option<u64>,
    /// When true, the widget shows an Enhance action + close button (done state).
    show_enhance: bool,
    /// When true, the widget shows an Undo action for the last insertion.
    show_undo: bool,
    /// Active app + window title captured at recording start, so the widget can
    /// show the user what context Vox detected ("In Visual Studio Code · file.ts").
    app_name: Option<String>,
    window_title: Option<String>,
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnhanceOverlayEvent {
    visible: bool,
    snapshot_id: Option<String>,
    x: i32,
    y: i32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnhanceOverlayStateEvent {
    mode: &'static str,
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnhanceResult {
    original_length: usize,
    enhanced_length: usize,
    app_name: Option<String>,
    replacement_method: &'static str,
}

type WhisperModelInfo = whisper::WhisperModelInfo;
type TextEnhancementModelInfo = text_enhancement::TextEnhancementModelInfo;

struct EventTapHandle {
    state: Arc<event_tap::TapState>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HotkeyDiagnostics {
    platform: &'static str,
    current_shortcut: String,
    trigger_mode: TriggerMode,
    accessibility_trusted: bool,
    event_tap_active: bool,
    event_tap_error: Option<String>,
    has_downloaded_model: bool,
    is_recording: bool,
    app_data_dir: Option<String>,
    models_dir: Option<String>,
    recordings_dir: Option<String>,
    text_insertion: TextInsertionDiagnostics,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TextInsertionDiagnostics {
    direct_typing_supported: bool,
    x11_available: bool,
    wayland_available: bool,
    xdotool_available: bool,
    wtype_available: bool,
    dotool_available: bool,
    guidance: Option<&'static str>,
}

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TriggerMode {
    Toggle,
    PushToTalk,
    HandsFree,
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
            TriggerMode::HandsFree => event_tap::TriggerMode::HandsFree,
        }
    }
}

impl From<event_tap::TriggerMode> for TriggerMode {
    fn from(m: event_tap::TriggerMode) -> Self {
        match m {
            event_tap::TriggerMode::Toggle => TriggerMode::Toggle,
            event_tap::TriggerMode::PushToTalk => TriggerMode::PushToTalk,
            event_tap::TriggerMode::HandsFree => TriggerMode::HandsFree,
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

#[cfg(target_os = "macos")]
#[tauri::command]
fn check_microphone_permission() -> bool {
    unsafe {
        let media_type = nsstring_from_str("soun");
        let status: i64 =
            msg_send![class!(AVCaptureDevice), authorizationStatusForMediaType: media_type];
        status == 3
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn check_microphone_permission() -> bool {
    true
}

/// Speech Recognition access — the one extra permission the built-in Apple
/// engine needs. Only the process that owns an SFSpeechRecognizer can read or
/// ask for this state, so both commands delegate to the Apple Speech sidecar:
/// `--check-permission` never prompts, `--request-permission` shows the macOS
/// prompt when the user has not answered yet.
#[cfg(target_os = "macos")]
fn run_apple_speech_permission(argument: &str) -> Result<bool, String> {
    let sidecar = engines::find_sidecar("apple-speech")?;
    let status = std::process::Command::new(sidecar)
        .arg(argument)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|error| format!("Could not run the Apple Speech runtime: {error}"))?;
    // The sidecar exits 0 only when the state is `authorized`.
    Ok(matches!(status.code(), Some(0)))
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn check_speech_permission() -> bool {
    run_apple_speech_permission("--check-permission").unwrap_or(false)
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn request_speech_permission() -> Result<bool, String> {
    run_apple_speech_permission("--request-permission")
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn check_speech_permission() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn request_speech_permission() -> Result<bool, String> {
    Err("Apple Speech is only available on macOS".to_string())
}

/// Raw macOS microphone authorization state so the UI can react to WHY the
/// permission is missing:
///   0 = not determined (offer the native prompt),
///   1 = restricted, 2 = denied (System Settings is the only path — macOS
///   never re-prompts after a refusal),
///   3 = authorized.
#[cfg(target_os = "macos")]
#[tauri::command]
fn microphone_authorization_status() -> i64 {
    unsafe {
        let media_type = nsstring_from_str("soun");
        msg_send![class!(AVCaptureDevice), authorizationStatusForMediaType: media_type]
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn microphone_authorization_status() -> i64 {
    3
}

/// Deep-link straight into the matching Privacy pane. Essential for mic
/// recovery: after one refusal, macOS suppresses the native prompt forever and
/// System Settings is the only path back.
#[tauri::command]
fn open_system_settings(pane: String) -> Result<(), String> {
    let url = match pane.as_str() {
        "microphone" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        }
        "accessibility" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        }
        "input_monitoring" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"
        }
        other => return Err(format!("Unknown System Settings pane: {other}")),
    };

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn check_input_monitoring_permission() -> bool {
    unsafe { CGPreflightListenEventAccess() }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn check_input_monitoring_permission() -> bool {
    true
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn request_input_monitoring_permission() -> bool {
    unsafe { CGRequestListenEventAccess() }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn request_input_monitoring_permission() -> bool {
    true
}

#[tauri::command]
fn resolve_app_icon(app_name: String) -> Option<String> {
    resolve_app_icon_data_url(&app_name)
}

#[tauri::command]
fn native_status() -> NativeStatus {
    NativeStatus {
        platform: platform_label(),
        engine: "Tauri bridge + native recorder + whisper.cpp / transcribe.cpp (Parakeet)",
        recording_supported: true,
        transcription_supported: true,
    }
}

fn platform_label() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "macOS desktop shell"
    }

    #[cfg(target_os = "windows")]
    {
        "Windows desktop shell"
    }

    #[cfg(target_os = "linux")]
    {
        "Linux desktop shell"
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        "Unsupported desktop shell"
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
            preview_text: None,
            preview_confidence: None,
            private: session.private,
        },
        None => RecordingStatus {
            is_recording: false,
            path: None,
            app_name: None,
            window_title: None,
            duration_seconds: None,
            preview_text: None,
            preview_confidence: None,
            private: false,
        },
    })
}

#[tauri::command]
fn start_recording(
    app: AppHandle,
    state: State<'_, RecorderState>,
    hands_free: Option<bool>,
) -> Result<RecordingStatus, String> {
    clear_last_insertion(&app);
    let result = start_recording_inner(&app, &state, hands_free.unwrap_or(false), false);
    refresh_tray_menu(&app);
    result
}

fn start_recording_inner(
    app: &AppHandle,
    state: &RecorderState,
    hands_free: bool,
    private: bool,
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
    if let Ok(mut window) = state.bar_window.lock() {
        window.clear();
    }

    let stream = build_input_stream(
        &device,
        &config,
        Arc::clone(&writer),
        Arc::clone(&state.audio_bars),
        Arc::clone(&state.vad),
        Arc::clone(&state.whisper_mode),
        Arc::clone(&state.bar_window),
    )?;
    stream.play().map_err(|error| error.to_string())?;

    // Capture app context AFTER the stream is running so the hotkey feels
    // instant — enumerating windows (copy_window_info) can take a while.
    let app_name = frontmost_app_name();
    let window_title = frontmost_window_title(app_name.as_deref());

    let started_at = Instant::now();
    *session = Some(RecordingSession {
        path: path.clone(),
        app_name: app_name.clone(),
        window_title: window_title.clone(),
        started_at,
        stream,
        writer,
        channels: spec.channels,
        sample_rate: spec.sample_rate,
        private,
    });

    if hands_free {
        // Reset VAD so the first segment starts clean.
        state.vad.has_speech.store(false, Ordering::Relaxed);
        *state.vad.last_sound_at.lock().unwrap() = Instant::now();
        spawn_hands_free_monitor(app.clone());
    }

    // Apple Speech is also the live-preview implementation. For an explicit
    // Apple selection, its final live result can be reused by the final
    // pipeline, avoiding a second recognition pass. Hands-free segments keep
    // the file path because one live result cannot represent each segment.
    let preview_engine = app
        .try_state::<EngineSelectionState>()
        .and_then(|state| state.engine.lock().ok().map(|engine| engine.clone()))
        .unwrap_or_else(|| "auto".to_string());
    if !hands_free && preview_engine == "apple" {
        let language = app
            .try_state::<LanguageState>()
            .and_then(|state| state.language.lock().ok().map(|language| language.clone()))
            .unwrap_or_else(|| "auto".to_string());
        live_transcript::start(app, &language);
    } else {
        let _ = live_transcript::stop();
    }

    Ok(RecordingStatus {
        is_recording: true,
        path: Some(path.to_string_lossy().to_string()),
        app_name,
        window_title,
        duration_seconds: Some(0),
        preview_text: None,
        preview_confidence: None,
        private,
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

    // Capture the live final before disposing of the session. Apple can reuse
    // it; all other engines continue through their normal file path.
    let live_result = match live_transcript::stop() {
        Some((text, confidence)) => (Some(text), confidence),
        None => (None, None),
    };

    Ok(RecordingStatus {
        is_recording: false,
        path: Some(session.path.to_string_lossy().to_string()),
        app_name,
        window_title,
        duration_seconds: Some(duration_seconds),
        preview_text: live_result.0,
        preview_confidence: live_result.1,
        private: session.private,
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

/// Hardware awareness (spec §25): what this machine can run comfortably.
#[tauri::command]
fn get_hardware_info() -> hardware::HardwareInfo {
    hardware::detect()
}

/// Expose the registered transcription engines and their availability to the
/// frontend (spec §3/§31). React only ever sees `id`/`displayName`/`available`
/// — never engine internals.
#[tauri::command]
fn get_transcription_engines(app: AppHandle) -> Result<Vec<engines::EngineStatus>, String> {
    let models_dir = whisper_models_dir(&app)?;
    Ok(engines::describe_engines(&models_dir))
}

#[tauri::command]
fn delete_whisper_model(app: AppHandle, model_name: String) -> Result<(), String> {
    let models_dir = whisper_models_dir(&app)?;
    let path = whisper::model_path_for(&models_dir, &model_name);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn delete_recording_file(audio_path: String) -> Result<(), String> {
    let audio_path = PathBuf::from(audio_path);
    if audio_path.exists() {
        std::fs::remove_file(&audio_path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn cleanup_recordings(app: AppHandle) -> Result<u64, String> {
    let recordings_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("recordings");

    if !recordings_dir.exists() {
        return Ok(0);
    }

    let mut removed = 0;
    for entry in fs::read_dir(&recordings_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.is_file() {
            fs::remove_file(&path).map_err(|error| error.to_string())?;
            removed += 1;
        }
    }

    Ok(removed)
}

#[tauri::command]
fn wipe_local_app_files(app: AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let recordings_dir = app_data_dir.join("recordings");
    let writing_path = writing::config_path(&app_data_dir);
    let models_dir = whisper::models_dir(app_data_dir);

    if recordings_dir.exists() {
        fs::remove_dir_all(&recordings_dir).map_err(|error| error.to_string())?;
    }

    if models_dir.exists() {
        fs::remove_dir_all(&models_dir).map_err(|error| error.to_string())?;
    }

    if writing_path.exists() {
        fs::remove_file(&writing_path).map_err(|error| error.to_string())?;
    }
    if let Some(state) = app.try_state::<writing::WritingProfilesState>() {
        if let Ok(mut config) = state.config.lock() {
            *config = writing::WritingProfileConfig::default();
        }
    }

    Ok(())
}

#[tauri::command]
async fn download_whisper_model(
    app: AppHandle,
    registry: State<'_, whisper::DownloadRegistry>,
    model_name: String,
) -> Result<WhisperModelInfo, String> {
    let models_dir = whisper_models_dir(&app)?;
    let control = std::sync::Arc::new(whisper::DownloadControl::default());
    {
        let mut registry = registry.lock().map_err(|error| error.to_string())?;
        registry.insert(model_name.clone(), control.clone());
    }
    let app_progress = app.clone();
    let progress_name = model_name.clone();
    let result = whisper::download_model(
        &models_dir,
        &model_name,
        &control,
        move |downloaded, total| {
            let _ = app_progress.emit(
                "vox-download-progress",
                DownloadProgress {
                    model_name: progress_name.clone(),
                    downloaded,
                    total,
                },
            );
        },
    )
    .await;
    {
        let mut registry = registry.lock().map_err(|error| error.to_string())?;
        registry.remove(&model_name);
    }
    result
}

#[tauri::command]
fn pause_whisper_download(
    registry: State<'_, whisper::DownloadRegistry>,
    model_name: String,
) -> Result<(), String> {
    let registry = registry.lock().map_err(|error| error.to_string())?;
    if let Some(control) = registry.get(&model_name) {
        control
            .pause
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
fn resume_whisper_download(
    registry: State<'_, whisper::DownloadRegistry>,
    model_name: String,
) -> Result<(), String> {
    let registry = registry.lock().map_err(|error| error.to_string())?;
    if let Some(control) = registry.get(&model_name) {
        control
            .pause
            .store(false, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
fn cancel_whisper_download(
    registry: State<'_, whisper::DownloadRegistry>,
    model_name: String,
) -> Result<(), String> {
    let registry = registry.lock().map_err(|error| error.to_string())?;
    if let Some(control) = registry.get(&model_name) {
        control
            .cancel
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
fn text_enhancement_models(app: AppHandle) -> Result<Vec<TextEnhancementModelInfo>, String> {
    let models_dir = text_enhancement_models_dir(&app)?;
    Ok(text_enhancement::list_models(&models_dir))
}

/// The enhancement model a fresh install should use (spec §25): the hardware
/// recommendation, or the best already-downloaded model. Used only until the
/// user pins a model.
#[tauri::command]
fn recommended_enhancement_model(app: AppHandle) -> Result<String, String> {
    let models_dir = text_enhancement_models_dir(&app)?;
    Ok(text_enhancement::resolve_recommended_model(&models_dir))
}

#[tauri::command]
async fn download_text_enhancement_model(
    app: AppHandle,
    model_name: String,
) -> Result<TextEnhancementModelInfo, String> {
    let models_dir = text_enhancement_models_dir(&app)?;
    let app_progress = app.clone();
    let progress_name = model_name.clone();
    let model =
        text_enhancement::download_model(&models_dir, &model_name, move |downloaded, total| {
            let _ = app_progress.emit(
                "vox-text-model-download-progress",
                DownloadProgress {
                    model_name: progress_name.clone(),
                    downloaded,
                    total,
                },
            );
        })
        .await?;
    refresh_selected_enhancement_model_availability(&app);
    Ok(model)
}

#[tauri::command]
fn delete_text_enhancement_model(app: AppHandle, model_name: String) -> Result<(), String> {
    let models_dir = text_enhancement_models_dir(&app)?;
    text_enhancement::delete_model(&models_dir, &model_name)?;
    refresh_selected_enhancement_model_availability(&app);
    Ok(())
}

#[tauri::command]
fn set_enhance_icon_enabled(
    app: AppHandle,
    state: State<'_, EnhancePreferencesState>,
    enabled: bool,
) -> Result<(), String> {
    *state
        .enabled
        .lock()
        .map_err(|_| "Enhance preferences unavailable".to_string())? = enabled;
    if !enabled {
        clear_focused_input_snapshot(&app);
        hide_enhance_overlay(&app);
    }
    Ok(())
}

#[tauri::command]
fn set_enhancement_model(
    app: AppHandle,
    state: State<'_, EnhancePreferencesState>,
    model_name: String,
) -> Result<(), String> {
    let model_name = model_name.trim().to_string();
    if model_name.is_empty() {
        return Err("Enhancement model cannot be empty".to_string());
    }
    *state
        .model_name
        .lock()
        .map_err(|_| "Enhance preferences unavailable".to_string())? = model_name.clone();
    refresh_selected_enhancement_model_availability(&app);

    // Load the selected GGUF and initialize the backend in the background so
    // the first visible Enhance/AI-cleanup action does not pay cold-start cost.
    if let Ok(models_dir) = text_enhancement_models_dir(&app) {
        std::thread::spawn(move || {
            if let Err(error) = text_enhancement::warm_model(&models_dir, &model_name) {
                eprintln!("[VOX][AI] text-enhance prewarm skipped: {error}");
            }
        });
    }
    Ok(())
}

#[tauri::command]
fn list_custom_models(app: AppHandle) -> Vec<custom_models::CustomModel> {
    let mut models = custom_models::load_registry(&app);
    for model in &mut models {
        let path = custom_models::model_file_path(&app, &model.name, model.kind);
        model.downloaded = path.map(|path| path.exists()).unwrap_or(false);
    }
    models
}

#[tauri::command]
async fn add_custom_model(
    app: AppHandle,
    url: String,
    kind: Option<custom_models::CustomModelKind>,
) -> Result<custom_models::CustomModel, String> {
    custom_models::add_custom_model(&app, &url, kind).await
}

#[tauri::command]
fn delete_custom_model(app: AppHandle, name: String) -> Result<(), String> {
    custom_models::delete_custom_model(&app, &name)
}

#[tauri::command]
async fn enhance_focused_input(
    app: AppHandle,
    snapshot_id: String,
) -> Result<EnhanceResult, String> {
    let snapshot = app
        .state::<FocusedInputSnapshotState>()
        .latest
        .lock()
        .map_err(|_| "Focused input snapshot unavailable".to_string())?
        .clone()
        .filter(|snapshot| snapshot.id == snapshot_id)
        .ok_or_else(|| "Focused input changed. Try again.".to_string())?;
    enhance_snapshot(&app, &snapshot).await
}

/// Enhance the currently focused text field, capturing it fresh. Used by the
/// widget's Enhance action so it works even when the focus watcher is idle.
#[tauri::command]
async fn enhance_focused_input_now(app: AppHandle) -> Result<EnhanceResult, String> {
    let snapshot = focused_input_snapshot().ok_or_else(|| {
        "No text field focused. Focus the text you want to enhance and try again.".to_string()
    })?;
    enhance_snapshot(&app, &snapshot).await
}

/// Core enhance flow shared by the focused-input overlay and the widget action.
async fn enhance_snapshot(
    app: &AppHandle,
    snapshot: &FocusedInputSnapshot,
) -> Result<EnhanceResult, String> {
    let original = snapshot.text.trim().to_string();
    if original.is_empty() {
        return Err("Focused input is empty".to_string());
    }

    show_enhance_overlay_state(app, "enhancing", "Enhancing...");
    let model_name = app
        .state::<EnhancePreferencesState>()
        .model_name
        .lock()
        .map_err(|_| "Enhance preferences unavailable".to_string())?
        .clone();
    let models_dir = text_enhancement_models_dir(app)?;
    let inference_original = original.clone();
    let enhanced = tauri::async_runtime::spawn_blocking(move || {
        text_enhancement::enhance_text(&models_dir, Some(&model_name), &inference_original)
    })
    .await
    .map_err(|error| format!("Enhancement task failed: {error}"))?
    .inspect_err(|error| show_enhance_overlay_state(app, "error", error))?;

    // Only fail if the user moved to a DIFFERENT editable field with text.
    // If no editable field is focused now (e.g. the enhance overlay took focus
    // while the model ran), proceed with the captured snapshot.
    let focus_is_unchanged = match focused_input_snapshot() {
        Some(current) => current.id == snapshot.id,
        None => true,
    };
    if !focus_is_unchanged {
        let error = "Focused input changed before enhancement finished. Try again.";
        show_enhance_overlay_state(app, "error", error);
        return Err(error.to_string());
    }

    // Hide the enhance overlay so focus returns to the target app before the
    // replacement reads the focused element (the overlay window can steal
    // focus while the model runs).
    hide_enhance_overlay(app);
    thread::sleep(Duration::from_millis(80));

    let replacement_method = replace_focused_input_text(&enhanced)
        .inspect_err(|error| show_enhance_overlay_state(app, "error", error))?;
    show_enhance_overlay_state(app, "success", "Enhanced");

    Ok(EnhanceResult {
        original_length: original.chars().count(),
        enhanced_length: enhanced.chars().count(),
        app_name: snapshot.app_name.clone(),
        replacement_method,
    })
}

/// Dismiss the floating widget (close button on the Enhance action).
#[tauri::command]
fn hide_widget(app: AppHandle) -> Result<(), String> {
    hide_widget_after_delay(app, 0);
    Ok(())
}

/// Resize the floating widget window to hug the glass capsule (the window
/// *is* the capsule, so macOS vibrancy shows through exactly its pill
/// shape) and re-anchor it to the bottom-right corner. The vibrancy corner
/// radius is kept at half the capsule height so the blur mask matches the
/// pill at any content size.
#[tauri::command]
fn widget_set_size(window: tauri::WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    if !width.is_finite() || !height.is_finite() || width < 1.0 || height < 1.0 {
        return Ok(());
    }
    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize::new(width, height)))
        .map_err(|e| e.to_string())?;

    // Position from the requested size: the native resize is dispatched
    // asynchronously, so outer_size() may still report the old bounds.
    let scale = window.scale_factor().unwrap_or(1.0);
    let win_w = (width * scale).round() as i32;
    let win_h = (height * scale).round() as i32;
    position_widget_with_size(&window, win_w, win_h);

    #[cfg(target_os = "macos")]
    {
        use tauri::window::{Effect, EffectState, EffectsBuilder};
        let _ = window.set_effects(Some(
            EffectsBuilder::new()
                .effect(Effect::Sidebar)
                .state(EffectState::Active)
                .radius(height / 2.0)
                .build(),
        ));
    }

    Ok(())
}

#[tauri::command]
async fn capture_selected_text(app: AppHandle) -> Result<String, String> {
    let original = Clipboard::new()
        .and_then(|mut clipboard| clipboard.get_text())
        .ok();

    simulate_copy_shortcut()?;
    thread::sleep(Duration::from_millis(150));

    let selected = Clipboard::new()
        .and_then(|mut clipboard| clipboard.get_text())
        .map_err(|error| format!("Could not read clipboard: {error}"))?;

    if selected.trim().is_empty() {
        return Err("No text selected. Select text in another app and try again.".to_string());
    }

    *app.state::<TransformState>()
        .original_clipboard
        .lock()
        .map_err(|_| "Transform state unavailable".to_string())? = original;

    Ok(selected)
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum NoteTask {
    SummarizeMeeting,
    ExtractActionItems,
}

impl NoteTask {
    fn instruction(self) -> &'static str {
        match self {
            NoteTask::SummarizeMeeting => {
                "Summarize this meeting transcript in Markdown. Return exactly three sections: `## Summary` with 3-6 concise bullets, `## Decisions` with bullets (or `None noted`), and `## Action items` as a Markdown checklist. For each action item use `- [ ] Task — owner (due date)` when the transcript states an owner or date. Preserve names, technical terms, and the original language. Return only the Markdown."
            }
            NoteTask::ExtractActionItems => {
                "Extract every action item from this meeting transcript. Return only a Markdown checklist using `- [ ] Task — owner (due date)` when the transcript states an owner or date. Preserve names, technical terms, and the original language. If there are no action items, return `- [ ] None noted`."
            }
        }
    }
}

/// Run a local meeting task (summary or action items) and return the generated
/// Markdown without pasting it. Notes are user content, so this never touches
/// the clipboard or the focused app.
#[tauri::command]
async fn note_transform(app: AppHandle, task: NoteTask, text: String) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("This note is empty.".to_string());
    }
    if !is_selected_enhancement_model_available(&app) {
        return Err(
            "Download a cleanup model in Models to use meeting tools. Everything runs locally."
                .to_string(),
        );
    }

    let model_name = app
        .try_state::<EnhancePreferencesState>()
        .and_then(|state| state.model_name.lock().ok().map(|name| name.clone()))
        .unwrap_or_default();
    let models_dir = text_enhancement_models_dir(&app)?;
    let instruction = task.instruction().to_string();
    let input = text;

    tauri::async_runtime::spawn_blocking(move || {
        text_enhancement::transform_text(
            &models_dir,
            Some(&model_name),
            &input,
            None,
            Some(&instruction),
        )
    })
    .await
    .map_err(|error| format!("Meeting task failed: {error}"))?
}

#[tauri::command]
async fn apply_transform(
    app: AppHandle,
    text: String,
    preset: Option<text_enhancement::TransformPreset>,
    custom_instruction: Option<String>,
) -> Result<(), String> {
    run_transform_and_paste(&app, text, preset, custom_instruction).await
}

/// Run the local enhancement model on `text` and paste the result at the cursor,
/// restoring the original clipboard afterwards. Shared by the AI Transform
/// overlay and voice commands.
async fn run_transform_and_paste(
    app: &AppHandle,
    text: String,
    preset: Option<text_enhancement::TransformPreset>,
    custom_instruction: Option<String>,
) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("No text to transform".to_string());
    }

    let model_name = app
        .state::<EnhancePreferencesState>()
        .model_name
        .lock()
        .map_err(|_| "Enhance preferences unavailable".to_string())?
        .clone();
    let models_dir = text_enhancement_models_dir(app)?;
    let inference_text = text.clone();
    let inference_custom = custom_instruction.clone();

    let transformed = tauri::async_runtime::spawn_blocking(move || {
        text_enhancement::transform_text(
            &models_dir,
            Some(&model_name),
            &inference_text,
            preset,
            inference_custom.as_deref(),
        )
    })
    .await
    .map_err(|error| format!("Transform task failed: {error}"))??;

    let mut clipboard =
        Clipboard::new().map_err(|error| format!("Could not access clipboard: {error}"))?;
    clipboard
        .set_text(&transformed)
        .map_err(|error| format!("Could not write transformed text to clipboard: {error}"))?;

    hide_main_window(app);
    thread::sleep(Duration::from_millis(150));
    simulate_paste_shortcut()?;
    thread::sleep(Duration::from_millis(150));

    if let Ok(Some(original)) = app
        .state::<TransformState>()
        .original_clipboard
        .lock()
        .map(|value| value.clone())
    {
        let _ = clipboard.set_text(&original);
    }

    Ok(())
}

// ── Voice commands ────────────────────────────────────────────────────────────

#[derive(Default)]
struct VoiceCommandsState {
    enabled: Mutex<bool>,
}

#[tauri::command]
fn set_whisper_mode(enabled: bool, state: State<'_, RecorderState>) -> Result<(), String> {
    state.whisper_mode.store(enabled, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn set_voice_commands_enabled(
    enabled: bool,
    state: State<'_, VoiceCommandsState>,
) -> Result<(), String> {
    *state
        .enabled
        .lock()
        .map_err(|_| "Voice commands state unavailable".to_string())? = enabled;
    Ok(())
}

/// A dictated instruction that should act on the selected text instead of being
/// pasted as a transcript.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum VoiceCommand {
    Transform(text_enhancement::TransformPreset),
    Custom(&'static str),
}

/// Detect whether a dictated utterance is a voice command. Commands are short
/// (≤ 10 words) and match a known instruction pattern; anything longer is
/// treated as normal dictation.
fn detect_voice_command(text: &str) -> Option<VoiceCommand> {
    let lower = text
        .trim()
        .trim_end_matches(['.', '!', '?', ',', ';', ':'])
        .to_ascii_lowercase();
    let words: Vec<&str> = lower.split_whitespace().collect();
    if words.is_empty() || words.len() > 10 {
        return None;
    }
    let joined = words.join(" ");

    if contains_any(
        &joined,
        &[
            "make this professional",
            "make it professional",
            "make this more professional",
            "make it more professional",
            "more professional",
            "professional tone",
            "professional",
        ],
    ) {
        return Some(VoiceCommand::Transform(
            text_enhancement::TransformPreset::Professional,
        ));
    }
    if contains_any(
        &joined,
        &[
            "make this casual",
            "make it casual",
            "make this friendly",
            "make it friendly",
            "more casual",
            "casual tone",
            "friendly tone",
            "casual",
        ],
    ) {
        return Some(VoiceCommand::Transform(
            text_enhancement::TransformPreset::Casual,
        ));
    }
    if contains_any(
        &joined,
        &[
            "make this shorter",
            "make it shorter",
            "make this concise",
            "make it concise",
            "make this more concise",
            "make it more concise",
            "shorten this",
            "shorten it",
            "shorter",
            "concise",
        ],
    ) {
        return Some(VoiceCommand::Transform(
            text_enhancement::TransformPreset::Concise,
        ));
    }
    if contains_any(
        &joined,
        &[
            "summarize this",
            "summarize it",
            "summarize",
            "give me a summary",
        ],
    ) {
        return Some(VoiceCommand::Transform(
            text_enhancement::TransformPreset::Summarize,
        ));
    }
    if contains_any(
        &joined,
        &[
            "fix the grammar",
            "fix grammar",
            "fix this grammar",
            "fix the grammar of this",
            "correct the grammar",
            "fix grammar of this",
        ],
    ) {
        return Some(VoiceCommand::Transform(
            text_enhancement::TransformPreset::FixGrammar,
        ));
    }
    if contains_any(
        &joined,
        &[
            "polish this",
            "polish it",
            "make this better",
            "make it better",
            "improve this",
            "improve it",
            "clean this up",
            "clean up this text",
            "polish",
        ],
    ) {
        return Some(VoiceCommand::Transform(
            text_enhancement::TransformPreset::Polish,
        ));
    }
    if contains_any(
        &joined,
        &[
            "translate to hindi",
            "translate this to hindi",
            "translate it to hindi",
            "hindi translation",
        ],
    ) {
        return Some(VoiceCommand::Custom(
            "Translate the text to Hindi. Preserve the original meaning and language. Return only the translated text.",
        ));
    }
    if contains_any(
        &joined,
        &[
            "translate to english",
            "translate this to english",
            "translate it to english",
        ],
    ) {
        return Some(VoiceCommand::Custom(
            "Translate the text to English. Preserve the original meaning and language. Return only the translated text.",
        ));
    }
    if contains_any(
        &joined,
        &[
            "turn this into bullet points",
            "make this bullet points",
            "as bullet points",
            "bullet points",
        ],
    ) {
        return Some(VoiceCommand::Custom(
            "Rewrite the text as a bullet list of key points. Preserve the original language. Return only the bullet list.",
        ));
    }
    if contains_any(
        &joined,
        &[
            "make this an ai prompt",
            "make this a prompt",
            "prompt engineer",
            "turn this into a prompt",
            "as an ai prompt",
        ],
    ) {
        return Some(VoiceCommand::Transform(
            text_enhancement::TransformPreset::PromptEngine,
        ));
    }
    None
}

/// Execute a voice command: capture the selected text, run the matching
/// transform, and paste the result. The command utterance itself is never
/// inserted.
async fn execute_voice_command(app: AppHandle, command: VoiceCommand) -> Result<(), String> {
    let selected = capture_selected_text(app.clone()).await?;
    let (preset, custom) = match command {
        VoiceCommand::Transform(preset) => (Some(preset), None),
        VoiceCommand::Custom(instruction) => (None, Some(instruction.to_string())),
    };
    run_transform_and_paste(&app, selected, preset, custom).await
}

fn simulate_copy_shortcut() -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    let modifier = if cfg!(target_os = "macos") {
        Key::Meta
    } else {
        Key::Control
    };

    enigo
        .key(modifier, Direction::Press)
        .map_err(|e| e.to_string())?;
    enigo
        .key(Key::Unicode('c'), Direction::Click)
        .map_err(|e| e.to_string())?;
    enigo
        .key(modifier, Direction::Release)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn simulate_paste_shortcut() -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    let modifier = if cfg!(target_os = "macos") {
        Key::Meta
    } else {
        Key::Control
    };

    enigo
        .key(modifier, Direction::Press)
        .map_err(|e| e.to_string())?;
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| e.to_string())?;
    enigo
        .key(modifier, Direction::Release)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn transcribe_recording(
    app: AppHandle,
    audio_path: String,
    model_name: Option<String>,
    context_app_name: Option<String>,
    context_window_title: Option<String>,
    preview_text: Option<String>,
    preview_confidence: Option<f32>,
    learn_corrections: bool,
) -> Result<TranscriptionResult, String> {
    transcribe_recording_inner(
        &app,
        audio_path,
        model_name,
        context_app_name,
        context_window_title,
        preview_text,
        preview_confidence,
        learn_corrections,
    )
}

fn transcribe_recording_inner(
    app: &AppHandle,
    audio_path: String,
    model_name: Option<String>,
    context_app_name: Option<String>,
    context_window_title: Option<String>,
    preview_text: Option<String>,
    preview_confidence: Option<f32>,
    learn_corrections: bool,
) -> Result<TranscriptionResult, String> {
    let pipeline_started = Instant::now();
    let audio_path = PathBuf::from(audio_path);
    if !audio_path.exists() {
        return Err(format!(
            "Recording file does not exist: {}",
            audio_path.display()
        ));
    }

    // A WAV header is exactly 44 bytes. If the file is header-only, the
    // microphone produced zero samples — almost always a missing mic
    // permission (TCC) or a missing audio-input entitlement under the
    // hardened runtime, not a transcription problem.
    if audio_path.metadata().map(|m| m.len()).unwrap_or(0) <= 44 {
        return Err(
            "No audio was captured — the microphone produced no samples. Check that Vox has microphone permission in System Settings → Privacy & Security → Microphone, then try again."
                .to_string(),
        );
    }

    // A full-length file can still be all zeros when macOS routes the stream
    // to the wrong (or muted) input device. Fail before spending seconds on a
    // hopeless transcription pass. The check scans raw PCM only; engines do
    // their own normalization later when it is actually required.
    let audio_check_started = Instant::now();
    if let Some(reason) = engines::audio::detect_silent_recording(&audio_path) {
        eprintln!(
            "[VOX][ASR] audio preflight: {}ms (silent)",
            audio_check_started.elapsed().as_millis()
        );
        return Err(reason);
    }
    let audio_preflight_ms = audio_check_started.elapsed().as_millis() as u64;
    eprintln!("[VOX][ASR] audio preflight: {}ms", audio_preflight_ms);

    let models_dir = whisper_models_dir(&app)?;
    let context_dictionary =
        build_context_dictionary(context_app_name.as_deref(), context_window_title.as_deref());
    let context_prompt =
        build_context_prompt(context_app_name.as_deref(), context_window_title.as_deref());

    // Vocabulary Packs (spec §8, §10–§12): build the active context for this
    // app, then adapt it per engine. Fast (cached trie, ≤64 entries, spec §22);
    // never blocks audio capture — this command runs after recording ends.
    let vocab_cache = app
        .try_state::<VocabularyState>()
        .map(|state| state.cached_context(context_app_name.as_deref()));
    let (vocab_prompt, contextual_strings) = match &vocab_cache {
        Some(cache) => {
            let started = std::time::Instant::now();
            let whisper_payload = vocabulary::adapters::adapt("whisper", &cache.context);
            let apple_payload = vocabulary::adapters::adapt("apple", &cache.context);
            eprintln!(
                "[VOX][vocabulary] active terms: {} | context+adapt: {}ms",
                cache.context.entries.len(),
                started.elapsed().as_millis()
            );
            (whisper_payload.prompt, apple_payload.contextual_strings)
        }
        None => (None, Vec::new()),
    };
    let context_prompt = match (&context_prompt, &vocab_prompt) {
        (Some(prompt), Some(vocab)) => Some(format!("{prompt} {vocab}")),
        (Some(prompt), None) => Some(prompt.clone()),
        (None, Some(vocab)) => Some(vocab.clone()),
        (None, None) => None,
    };
    let language = app
        .try_state::<LanguageState>()
        .and_then(|state| state.language.lock().ok().map(|language| language.clone()))
        .unwrap_or_else(|| "auto".to_string());
    let transcribe_started = std::time::Instant::now();

    // Engine selection + fallback come from user settings (spec §6–§8).
    let (engine_pref, selected_model, fallback_enabled, fallback_target, last_engine) = app
        .try_state::<EngineSelectionState>()
        .and_then(|state| {
            let engine = state.engine.lock().ok().map(|e| e.clone())?;
            let selected_model = state.selected_model.lock().ok().map(|m| m.clone())?;
            let fallback = state.preferred_fallback.lock().ok().map(|f| f.clone())?;
            let last_engine = state.last_engine.lock().ok().map(|e| e.clone())?;
            Some((
                engine,
                selected_model,
                state.fallback_enabled.load(Ordering::Relaxed),
                fallback,
                last_engine,
            ))
        })
        .unwrap_or_else(|| {
            (
                "auto".to_string(),
                "large-v3-turbo".to_string(),
                true,
                "whisper".to_string(),
                String::new(),
            )
        });
    // The pinned model belongs to one engine family. Pass it only to the
    // engine that owns it, so switching engines never makes a pin from the
    // other family look like a wrong-engine error. A pin that is no longer in
    // the catalog or is not on disk is dropped too, so a stale pin from an
    // older release never turns into a hard failure. Apple Speech has no model
    // file, so it never receives a pin.
    let pin_downloaded = crate::whisper::list_models(&models_dir)
        .iter()
        .any(|model| model.name == selected_model && model.downloaded);
    let requested_model = model_name.or_else(|| {
        let pin_is_parakeet = selected_model.starts_with("parakeet");
        match engine_pref.as_str() {
            "whisper" if !pin_is_parakeet && pin_downloaded => Some(selected_model),
            "parakeet" if pin_is_parakeet && pin_downloaded => Some(selected_model),
            _ => None,
        }
    });
    let fallback_report: Mutex<Option<engines::EngineFallback>> = Mutex::new(None);
    let live_preview = preview_text
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty());
    let (text, detected_language, engine, asr_confidence) = if engine_pref == "apple" {
        if let Some(text) = live_preview {
            eprintln!("[VOX][ASR] apple-speech: reused live final transcript");
            let detected_language = match language.as_str() {
                "auto" | "hinglish" => None,
                code => Some(code.to_string()),
            };
            (text, detected_language, "apple", preview_confidence)
        } else {
            engines::route_transcribe_with_vocabulary(
                &models_dir,
                &audio_path,
                requested_model.as_deref(),
                context_dictionary.as_deref(),
                context_prompt.as_deref(),
                Some(&language),
                engines::EngineSelection {
                    preferred: &engine_pref,
                    fallback_enabled,
                    preferred_fallback: Some(&fallback_target),
                },
                |from, to, reason| {
                    *fallback_report.lock().unwrap() =
                        Some(engines::EngineFallback { from, to, reason });
                },
                &contextual_strings,
            )?
        }
    } else {
        engines::route_transcribe_with_vocabulary(
            &models_dir,
            &audio_path,
            requested_model.as_deref(),
            context_dictionary.as_deref(),
            context_prompt.as_deref(),
            Some(&language),
            engines::EngineSelection {
                preferred: &engine_pref,
                fallback_enabled,
                preferred_fallback: Some(&fallback_target),
            },
            |from, to, reason| {
                *fallback_report.lock().unwrap() =
                    Some(engines::EngineFallback { from, to, reason });
            },
            &contextual_strings,
        )?
    };
    if let Some(fallback) = fallback_report.into_inner().unwrap_or(None) {
        // Engine switches must never be silent (spec §8/§26).
        eprintln!(
            "[VOX][ASR] fallback: {} -> {} ({})",
            fallback.from, fallback.to, fallback.reason
        );
        let _ = app.emit(
            "transcription_engine_fallback",
            serde_json::json!({
                "event": "transcription_engine_fallback",
                "from": fallback.from,
                "to": fallback.to,
                "reason": fallback.reason,
            }),
        );
    }
    // `transcription_engine_changed` (spec §11): emitted whenever the engine
    // that just ran differs from the previous transcription's engine.
    if let Some(state) = app.try_state::<EngineSelectionState>() {
        let previous = last_engine.clone();
        if !previous.is_empty() && previous != engine {
            let _ = app.emit(
                "transcription_engine_changed",
                serde_json::json!({
                    "event": "transcription_engine_changed",
                    "from": previous,
                    "to": engine,
                }),
            );
        }
        if let Ok(mut last) = state.last_engine.lock() {
            *last = engine.to_string();
        }
    }
    // Performance logging (spec §26). Never logs transcript content.
    let transcribe_ms = transcribe_started.elapsed().as_millis() as u64;
    eprintln!(
        "[VOX][ASR] Engine: {engine} | confidence: {asr_confidence:?} | audio: {:.1}s | transcribe: {}ms",
        wav_duration_seconds(&audio_path).unwrap_or(0.0),
        transcribe_ms
    );
    let postprocess_started = Instant::now();
    // Capture the engine output before any formatting or cleanup so the
    // transcript library can always show what was actually heard.
    let asr_text = text.clone();
    let formatting_mode = app
        .try_state::<TranscriptFormattingState>()
        .and_then(|state| state.mode.lock().ok().map(|mode| *mode))
        .unwrap_or(TranscriptFormattingMode::Auto);
    let is_editable_focused = app
        .try_state::<FocusContextState>()
        .and_then(|state| state.is_editable_focused.lock().ok().map(|value| *value))
        .unwrap_or(false);
    let (formatted_text, dev_applied) = format_transcript_for_context(
        &text,
        formatting_mode,
        context_app_name.as_deref(),
        context_window_title.as_deref(),
        is_editable_focused,
    );
    // Conservative punctuation restoration for engines that return unpunctuated
    // prose. Developer transcripts are never touched.
    let formatted_text = if dev_applied {
        formatted_text
    } else {
        restore_punctuation(&formatted_text)
    };

    // Auto AI cleanup only runs on plain (non-developer) transcripts so it
    // never rephrases or mangles dictated code, commands, paths, or symbols.
    let mut final_text = formatted_text;
    let mut raw_text: Option<String> = None;
    // Vocabulary corrections applied during post-processing, surfaced to the
    // UI for review/teaching (spec §13, §17).
    let mut applied_corrections: Vec<CorrectionInfo> = Vec::new();
    if !dev_applied {
        let cleanup_started = std::time::Instant::now();
        let cleanup_level = app
            .try_state::<CleanupLevelState>()
            .and_then(|state| state.level.lock().ok().map(|level| *level))
            .unwrap_or(text_enhancement::CleanupLevel::None);
        if cleanup_level.is_enabled() {
            // Rule-based fast path: filler removal, self-correction collapse,
            // repeated-word fixes, and capitalization — instant, no LLM.
            let fast_cleaned = fast_cleanup(&final_text);
            if fast_cleaned != final_text {
                raw_text = Some(final_text);
                final_text = fast_cleaned;
            }

            // Drop meta-commentary asides ("there is lots of noise and some
            // other text that should not be there") so they never reach the
            // output, regardless of model size.
            let without_meta = remove_meta_commentary(&final_text);
            if without_meta != final_text {
                if raw_text.is_none() {
                    raw_text = Some(final_text);
                }
                final_text = without_meta;
            }

            // LLM pass only for Medium/High. Light is fully rule-based so it
            // feels instant; the model stays for grammar/concision/rewrites.
            if cleanup_level != text_enhancement::CleanupLevel::Light
                && is_selected_enhancement_model_available(&app)
            {
                let enhance_model = app
                    .try_state::<EnhancePreferencesState>()
                    .and_then(|state| state.model_name.lock().ok().map(|name| name.clone()))
                    .unwrap_or_default();
                let enhance_models_dir = text_enhancement_models_dir(&app).ok();
                if let Some(models_dir) = enhance_models_dir {
                    // App-context writing style (Gmail → professional email, Slack →
                    // casual, Notion → structured document) steers the cleanup model.
                    let mut style: Option<String> = writing::resolve_style(
                        &app.try_state::<writing::WritingProfilesState>()
                            .and_then(|state| state.config.lock().ok().map(|config| config.clone()))
                            .unwrap_or_default(),
                        context_app_name.as_deref(),
                        context_window_title.as_deref(),
                        is_developer_app_context(
                            context_app_name.as_deref(),
                            context_window_title.as_deref(),
                            true,
                        ),
                        app_style_instruction(
                            context_app_name.as_deref(),
                            context_window_title.as_deref(),
                        ),
                    );
                    // File Awareness: tell the model which file the user is
                    // working on so prompts can reference it.
                    if let Some(file) = current_file_from_title(context_window_title.as_deref()) {
                        style = Some(
                            style.unwrap_or_default()
                                + &format!(" The user is working on the file {file}."),
                        );
                    }
                    // Whisper mode: tell the model the source was whispered so it
                    // transcribes faithfully instead of "fixing" quiet fragments.
                    if app
                        .try_state::<RecorderState>()
                        .map(|state| state.whisper_mode.load(Ordering::Relaxed))
                        .unwrap_or(false)
                    {
                        style = Some(
                            style.unwrap_or_default()
                                + " The speaker is whispering; transcribe faithfully without adding or rephrasing words.",
                        );
                    }
                    show_widget(&app, "transcribing", "Cleaning up…");
                    match text_enhancement::enhance_text_with_level(
                        &models_dir,
                        Some(&enhance_model),
                        &final_text,
                        cleanup_level,
                        style.as_deref(),
                    ) {
                        Ok(cleaned) if cleaned != final_text => {
                            raw_text = Some(final_text);
                            final_text = cleaned;
                        }
                        _ => {}
                    }
                }
            }

            eprintln!(
                "[VOX][AI] Cleanup level: {cleanup_level:?} | cleanup: {}ms",
                cleanup_started.elapsed().as_millis()
            );
        }
    }

    // Vocabulary Packs correction pass (spec §13–§16): token-aware,
    // longest-match-first canonicalization across every engine. This runs
    // regardless of the AI cleanup level and also in developer contexts:
    // cleanup is optional, but configured technical vocabulary is a core
    // dictation guarantee. Developer contexts receive a restricted policy so
    // identifiers, paths, and package names are never rewritten.
    if let Some(cache) = &vocab_cache {
        if !cache.context.entries.is_empty() {
            let correction_started = std::time::Instant::now();
            let settings = app
                .try_state::<VocabularyState>()
                .map(|state| {
                    state
                        .store
                        .lock()
                        .map(|store| store.document.settings.clone())
                        .unwrap_or_default()
                })
                .unwrap_or_default();
            let result = vocabulary::correct::correct_transcript_with_options(
                &final_text,
                &cache.trie,
                &settings,
                vocabulary::correct::CorrectionOptions {
                    developer_context: dev_applied,
                    asr_confidence,
                },
            );
            if !result.corrections.is_empty() {
                // Learning (spec §17): record accepted corrections and
                // promote unknown terms into the Personal pack. Incognito
                // dictation skips this so nothing derived from the text is
                // persisted.
                if learn_corrections {
                    if let Some(state) = app.try_state::<VocabularyState>() {
                        let now = vocabulary::store::now_secs();
                        let mut store = state
                            .store
                            .lock()
                            .map_err(|_| "Vocabulary state unavailable")?;
                        for correction in &result.corrections {
                            store.record_correction(
                                &correction.source,
                                &correction.entry_id,
                                correction.confidence,
                                now,
                            );
                        }
                        let _ = store.persist();
                        drop(store);
                        *state.cache.lock().unwrap_or_else(|p| p.into_inner()) = None;
                    }
                }
                eprintln!(
                    "[VOX][vocabulary] applied {} correction(s) in {}ms",
                    result.corrections.len(),
                    correction_started.elapsed().as_millis()
                );
            }
            if result.text != final_text {
                if raw_text.is_none() {
                    raw_text = Some(final_text);
                }
                final_text = result.text;
            }
            applied_corrections.extend(result.corrections.iter().map(|correction| {
                CorrectionInfo {
                    source: correction.source.clone(),
                    canonical: correction.canonical.clone(),
                    confidence: correction.confidence,
                    asr_confidence,
                }
            }));
        }
    }

    // Voice-triggered snippets: replace trigger phrases ("my email") with
    // their expansions ("rajeshwar@example.com") in the final text.
    let snippets = app
        .try_state::<SnippetsState>()
        .and_then(|state| state.snippets.lock().ok().map(|snippets| snippets.clone()))
        .unwrap_or_default();
    if !snippets.is_empty() {
        let expanded = expand_snippets(&final_text, &snippets, context_app_name.as_deref());
        if expanded != final_text {
            if raw_text.is_none() {
                raw_text = Some(final_text);
            }
            final_text = expanded;
        }
    }

    eprintln!(
        "[VOX][ASR] postprocess: {}ms | total: {}ms",
        postprocess_started.elapsed().as_millis(),
        pipeline_started.elapsed().as_millis()
    );

    Ok(TranscriptionResult {
        audio_path: audio_path.to_string_lossy().to_string(),
        text: final_text,
        app_name: context_app_name,
        duration_seconds: None,
        asr_text,
        confidence: asr_confidence,
        raw_text,
        language: detected_language,
        engine,
        timings: TranscriptionTimings {
            audio_preflight_ms,
            transcribe_ms,
            postprocess_ms: postprocess_started.elapsed().as_millis() as u64,
            total_ms: pipeline_started.elapsed().as_millis() as u64,
        },
        corrections: applied_corrections,
    })
}

/// Replace snippet trigger phrases in `text` with their expansions.
/// Case-insensitive, word-boundary-aware ("my email" in "send it to my email"
/// matches, but "my email" inside "my emailaddress" does not).
fn expand_snippets(text: &str, snippets: &[Snippet], app_name: Option<&str>) -> String {
    let mut result = text.to_string();
    for snippet in snippets {
        let trigger = snippet.trigger.trim();
        if trigger.is_empty()
            || is_macro_expansion(&snippet.expansion)
            || !snippet_matches_app(snippet.app_pattern.as_deref(), app_name)
            || !result.to_lowercase().contains(&trigger.to_lowercase())
        {
            continue;
        }
        let expansion = expand_snippet_variables(&snippet.expansion, app_name);
        result = replace_phrase(&result, trigger, &expansion);
    }
    result
}

/// Snippets with an app pattern only apply when the active app name contains
/// that pattern (case-insensitive). Empty patterns apply everywhere.
fn snippet_matches_app(pattern: Option<&str>, app_name: Option<&str>) -> bool {
    let pattern = pattern.unwrap_or_default().trim();
    if pattern.is_empty() {
        return true;
    }
    let app = app_name.unwrap_or_default().trim().to_lowercase();
    !app.is_empty() && app.contains(&pattern.to_lowercase())
}

/// Expand macro variables in a snippet at insertion time. Supported:
/// `{date}`, `{time}`, `{datetime}`, `{day}`, `{app}`, `{clipboard}`.
/// Unknown tokens are left untouched.
fn expand_snippet_variables(expansion: &str, app_name: Option<&str>) -> String {
    if !expansion.contains('{') {
        return expansion.to_string();
    }

    let now = chrono::Local::now();
    let mut result = expansion.to_string();
    result = result.replace("{date}", &now.format("%Y-%m-%d").to_string());
    result = result.replace("{time}", &now.format("%H:%M").to_string());
    result = result.replace("{datetime}", &now.format("%Y-%m-%d %H:%M").to_string());
    result = result.replace("{day}", &now.format("%A").to_string());
    result = result.replace("{app}", app_name.unwrap_or_default());
    if result.contains("{clipboard}") {
        let clipboard = Clipboard::new()
            .ok()
            .and_then(|mut clipboard| clipboard.get_text().ok())
            .unwrap_or_default();
        result = result.replace("{clipboard}", &clipboard);
    }
    result
}

// ── Multi-step macros ────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MacroKey {
    Return,
    Tab,
    Escape,
    Backspace,
    Delete,
    Space,
    Up,
    Down,
    Left,
    Right,
    Home,
    End,
    PageUp,
    PageDown,
    Char(char),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MacroModifier {
    Cmd,
    Ctrl,
    Alt,
    Shift,
}

#[derive(Debug, PartialEq, Eq)]
enum MacroStep {
    Text(String),
    Key(MacroKey),
    Combo(Vec<MacroModifier>, MacroKey),
    Wait(u64),
}

fn parse_macro_key(token: &str) -> Option<MacroKey> {
    match token {
        "enter" | "return" => Some(MacroKey::Return),
        "tab" => Some(MacroKey::Tab),
        "escape" | "esc" => Some(MacroKey::Escape),
        "backspace" => Some(MacroKey::Backspace),
        "delete" | "del" => Some(MacroKey::Delete),
        "space" => Some(MacroKey::Space),
        "up" => Some(MacroKey::Up),
        "down" => Some(MacroKey::Down),
        "left" => Some(MacroKey::Left),
        "right" => Some(MacroKey::Right),
        "home" => Some(MacroKey::Home),
        "end" => Some(MacroKey::End),
        "pageup" => Some(MacroKey::PageUp),
        "pagedown" => Some(MacroKey::PageDown),
        _ => {
            let mut chars = token.chars();
            match (chars.next(), chars.next()) {
                (Some(ch), None) => Some(MacroKey::Char(ch)),
                _ => None,
            }
        }
    }
}

fn parse_macro_modifier(token: &str) -> Option<MacroModifier> {
    match token {
        "cmd" | "command" | "meta" => Some(MacroModifier::Cmd),
        "ctrl" | "control" => Some(MacroModifier::Ctrl),
        "alt" | "option" | "opt" => Some(MacroModifier::Alt),
        "shift" => Some(MacroModifier::Shift),
        _ => None,
    }
}

fn parse_macro_action(token: &str) -> Option<MacroStep> {
    if let Some(millis) = token.strip_prefix("wait:") {
        let millis = millis.parse::<u64>().ok()?.min(5_000);
        return Some(MacroStep::Wait(millis));
    }

    let mut parts: Vec<&str> = token.split('+').collect();
    let key = parse_macro_key(parts.pop()?)?;
    if parts.is_empty() {
        return Some(MacroStep::Key(key));
    }

    let mut modifiers = Vec::new();
    for part in parts {
        modifiers.push(parse_macro_modifier(part)?);
    }
    // Never let a dictated macro quit or lock the current app.
    if modifiers.contains(&MacroModifier::Cmd)
        && matches!(key, MacroKey::Char('q') | MacroKey::Char('Q'))
    {
        return None;
    }
    Some(MacroStep::Combo(modifiers, key))
}

fn is_macro_expansion(expansion: &str) -> bool {
    let mut rest = expansion;
    while let Some(open) = rest.find('{') {
        let after = &rest[open + 1..];
        let Some(close) = after.find('}') else {
            break;
        };
        let token = after[..close].trim().to_ascii_lowercase();
        if matches!(
            parse_macro_action(&token),
            Some(MacroStep::Key(_) | MacroStep::Combo(_, _) | MacroStep::Wait(_))
        ) {
            return true;
        }
        rest = &after[close + 1..];
    }
    false
}

/// Parse an expansion into ordered text/key/wait steps. Variables are
/// interpolated inside text segments only, so clipboard contents can never be
/// mistaken for macro actions.
fn parse_macro_steps(expansion: &str, app_name: Option<&str>) -> Vec<MacroStep> {
    let mut steps = Vec::new();
    let mut text = String::new();
    let mut cursor = 0usize;

    while let Some(open_rel) = expansion[cursor..].find('{') {
        let open = cursor + open_rel;
        let Some(close_rel) = expansion[open + 1..].find('}') else {
            break;
        };
        let close = open + 1 + close_rel;
        text.push_str(&expansion[cursor..open]);

        let token = expansion[open + 1..close].trim().to_ascii_lowercase();
        if let Some(step) = parse_macro_action(&token) {
            if !text.is_empty() {
                steps.push(MacroStep::Text(expand_snippet_variables(&text, app_name)));
                text.clear();
            }
            steps.push(step);
        } else {
            // Variables and unknown tokens stay in the text segment.
            text.push_str(&expansion[open..=close]);
        }
        cursor = close + 1;
    }
    text.push_str(&expansion[cursor..]);
    if !text.is_empty() {
        steps.push(MacroStep::Text(expand_snippet_variables(&text, app_name)));
    }

    steps.truncate(64);
    steps
}

fn normalize_macro_trigger(text: &str) -> String {
    text.trim()
        .trim_end_matches(['.', '!', '?', ',', ';', ':'])
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Macros run only when the entire utterance is the trigger, so a trigger
/// spoken inside a sentence can never fire keystrokes.
fn find_macro_for_utterance<'a>(
    snippets: &'a [Snippet],
    text: &str,
    app_name: Option<&str>,
) -> Option<&'a Snippet> {
    let normalized = normalize_macro_trigger(text);
    if normalized.is_empty() {
        return None;
    }
    snippets.iter().find(|snippet| {
        snippet_matches_app(snippet.app_pattern.as_deref(), app_name)
            && is_macro_expansion(&snippet.expansion)
            && normalize_macro_trigger(&snippet.trigger) == normalized
    })
}

fn to_enigo_key(key: MacroKey) -> Key {
    match key {
        MacroKey::Return => Key::Return,
        MacroKey::Tab => Key::Tab,
        MacroKey::Escape => Key::Escape,
        MacroKey::Backspace => Key::Backspace,
        MacroKey::Delete => Key::Delete,
        MacroKey::Space => Key::Space,
        MacroKey::Up => Key::UpArrow,
        MacroKey::Down => Key::DownArrow,
        MacroKey::Left => Key::LeftArrow,
        MacroKey::Right => Key::RightArrow,
        MacroKey::Home => Key::Home,
        MacroKey::End => Key::End,
        MacroKey::PageUp => Key::PageUp,
        MacroKey::PageDown => Key::PageDown,
        MacroKey::Char(ch) => Key::Unicode(ch),
    }
}

fn to_enigo_modifier(modifier: MacroModifier) -> Key {
    match modifier {
        MacroModifier::Cmd => Key::Meta,
        MacroModifier::Ctrl => Key::Control,
        MacroModifier::Alt => Key::Alt,
        MacroModifier::Shift => Key::Shift,
    }
}

/// Execute a macro. Text steps go through the normal insertion path; key steps
/// use enigo. Waits are capped so a bad macro cannot hang dictation.
fn execute_macro_steps(steps: &[MacroStep]) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|error| error.to_string())?;
    let mut total_wait = 0u64;

    for step in steps {
        match step {
            MacroStep::Text(text) => {
                if !text.is_empty() {
                    paste_text(text)?;
                }
            }
            MacroStep::Key(key) => {
                enigo
                    .key(to_enigo_key(*key), Direction::Click)
                    .map_err(|error| error.to_string())?;
            }
            MacroStep::Combo(modifiers, key) => {
                for modifier in modifiers {
                    enigo
                        .key(to_enigo_modifier(*modifier), Direction::Press)
                        .map_err(|error| error.to_string())?;
                }
                let result = enigo.key(to_enigo_key(*key), Direction::Click);
                for modifier in modifiers.iter().rev() {
                    let _ = enigo.key(to_enigo_modifier(*modifier), Direction::Release);
                }
                result.map_err(|error| error.to_string())?;
            }
            MacroStep::Wait(millis) => {
                total_wait = total_wait.saturating_add(*millis);
                if total_wait > 10_000 {
                    return Err("Macro wait limit exceeded (10s).".to_string());
                }
                thread::sleep(Duration::from_millis(*millis));
            }
        }
    }
    Ok(())
}

fn replace_phrase(text: &str, trigger: &str, expansion: &str) -> String {
    let lower_text = text.to_lowercase();
    let lower_trigger = trigger.to_lowercase();
    let mut result = String::with_capacity(text.len() + expansion.len());
    let mut search_from = 0;

    while let Some(relative) = lower_text[search_from..].find(&lower_trigger) {
        let abs = search_from + relative;
        let before_ok = abs == 0
            || !text[..abs]
                .chars()
                .next_back()
                .map(|ch| ch.is_alphanumeric())
                .unwrap_or(false);
        let after = abs + trigger.len();
        let after_ok = after >= text.len()
            || !text[after..]
                .chars()
                .next()
                .map(|ch| ch.is_alphanumeric())
                .unwrap_or(false);

        if before_ok && after_ok {
            result.push_str(&text[search_from..abs]);
            result.push_str(expansion);
            search_from = after;
        } else {
            // Not a word-boundary match: copy the char at the match start and
            // advance one char so no text is dropped.
            let next = text[abs..]
                .chars()
                .next()
                .map(|ch| ch.len_utf8())
                .unwrap_or(1);
            result.push_str(&text[search_from..abs + next]);
            search_from = abs + next;
        }
    }
    result.push_str(&text[search_from..]);
    result
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

// ── Vocabulary Packs commands (spec §6, §7, §9, §17, §19) ────────────────────

#[tauri::command]
fn vocabulary_packs(
    state: State<'_, VocabularyState>,
) -> Result<Vec<vocabulary::model::VocabularyPack>, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "Vocabulary state unavailable".to_string())?;
    Ok(store.all_packs())
}

#[tauri::command]
fn vocabulary_create_pack(
    name: String,
    description: String,
    category: String,
    state: State<'_, VocabularyState>,
) -> Result<vocabulary::model::VocabularyPack, String> {
    let category = serde_json::from_value::<vocabulary::model::PackCategory>(
        serde_json::Value::String(category),
    )
    .unwrap_or(vocabulary::model::PackCategory::Custom);
    state.with_store(|store| store.create_pack(name, description, category))
}

#[tauri::command]
fn vocabulary_update_pack(
    pack_id: String,
    name: String,
    description: String,
    state: State<'_, VocabularyState>,
) -> Result<(), String> {
    state.with_store(|store| store.update_pack(&pack_id, name, description))
}

#[tauri::command]
fn vocabulary_duplicate_pack(
    pack_id: String,
    state: State<'_, VocabularyState>,
) -> Result<vocabulary::model::VocabularyPack, String> {
    state.with_store(|store| store.duplicate_pack(&pack_id))
}

#[tauri::command]
fn vocabulary_delete_pack(
    pack_id: String,
    state: State<'_, VocabularyState>,
) -> Result<(), String> {
    state.with_store(|store| store.delete_pack(&pack_id))
}

#[tauri::command]
fn vocabulary_set_pack_enabled(
    pack_id: String,
    enabled: bool,
    state: State<'_, VocabularyState>,
) -> Result<(), String> {
    state.with_store(|store| store.set_pack_enabled(&pack_id, enabled))
}

#[tauri::command]
fn vocabulary_upsert_entry(
    pack_id: String,
    entry: vocabulary::model::VocabularyEntry,
    state: State<'_, VocabularyState>,
) -> Result<vocabulary::model::VocabularyEntry, String> {
    state.with_store(|store| store.upsert_entry(&pack_id, entry))
}

#[tauri::command]
fn vocabulary_delete_entry(
    pack_id: String,
    entry_id: String,
    state: State<'_, VocabularyState>,
) -> Result<(), String> {
    state.with_store(|store| store.delete_entry(&pack_id, &entry_id))
}

#[tauri::command]
fn vocabulary_set_entry_enabled(
    pack_id: String,
    entry_id: String,
    enabled: bool,
    state: State<'_, VocabularyState>,
) -> Result<(), String> {
    state.with_store(|store| store.set_entry_enabled(&pack_id, &entry_id, enabled))
}

#[tauri::command]
fn vocabulary_set_app_mapping(
    app: vocabulary::model::ApplicationIdentifier,
    pack_ids: Vec<String>,
    state: State<'_, VocabularyState>,
) -> Result<(), String> {
    state.with_store(|store| {
        store.set_app_mapping(app, pack_ids);
        Ok(())
    })
}

#[tauri::command]
fn vocabulary_import(
    json: String,
    state: State<'_, VocabularyState>,
) -> Result<vocabulary::model::VocabularyPack, String> {
    state.with_store(|store| store.import_pack(&json))
}

#[tauri::command]
fn vocabulary_export(pack_id: String, state: State<'_, VocabularyState>) -> Result<String, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "Vocabulary state unavailable".to_string())?;
    serde_json::to_string_pretty(&store.export_pack(&pack_id)?)
        .map_err(|error| format!("Export serialization failed: {error}"))
}

/// Run the deterministic vocabulary evaluation dataset against the current
/// packs and settings (spec §26). Local-only; used by the Corrections page's
/// quality check and available for CI through the same test harness.
#[tauri::command]
fn vocabulary_eval(
    state: State<'_, VocabularyState>,
) -> Result<vocabulary::eval::EvalReport, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "Vocabulary state unavailable".to_string())?;
    let packs = store.all_packs();
    let settings = store.document.settings.clone();
    let context =
        vocabulary::context::build_correction_context(&packs, None, vocabulary::store::now_secs());
    let trie = vocabulary::index::PhraseTrie::build(&context);
    Ok(vocabulary::eval::evaluate(&trie, &settings))
}

#[tauri::command]
fn vocabulary_set_settings(
    settings: vocabulary::model::VocabularySettings,
    state: State<'_, VocabularyState>,
) -> Result<(), String> {
    state.with_store(|store| {
        store.document.settings = settings;
        Ok(())
    })
}

/// One-time migration: converts the legacy free-text personal dictionary
/// ("word | hint | category" lines) into Personal-pack vocabulary entries.
/// Idempotent — safe to call repeatedly.
#[tauri::command]
fn vocabulary_migrate_dictionary(
    dictionary: String,
    state: State<'_, VocabularyState>,
) -> Result<usize, String> {
    state.with_store(|store| store.migrate_dictionary(&dictionary))
}

/// Teach a correction from the UI (spec §17): the Corrections page's
/// "Teach a correction" form and transcript edits both land here. Repeated
/// corrections raise the entry's ranking; unknown terms become Personal-pack
/// entries with the heard form as an alias.
#[tauri::command]
fn vocabulary_record_correction(
    source: String,
    canonical: String,
    state: State<'_, VocabularyState>,
) -> Result<(), String> {
    let now = vocabulary::store::now_secs();
    state.with_store(|store| {
        store.teach_correction(&source, &canonical, now)?;
        Ok(())
    })
}

#[tauri::command]
fn set_login_item(app: AppHandle, enabled: bool) -> Result<(), String> {
    login_item::set_enabled(&app, enabled)
}

/// Switch the Dock icon with the active theme: dark theme → the dark logo,
/// light theme → the light logo. Applied on the main thread (AppKit).
#[tauri::command]
fn set_dock_icon(app: AppHandle, theme: String) {
    dock_icon::apply(&app, &theme);
}

#[tauri::command]
fn is_login_item_enabled(app: AppHandle) -> Result<bool, String> {
    login_item::is_enabled(&app)
}

#[tauri::command]
fn set_language(language: String, state: State<'_, LanguageState>) -> Result<(), String> {
    let language = language.trim().to_ascii_lowercase();
    if language.is_empty() {
        return Err("Language cannot be empty".to_string());
    }
    *state
        .language
        .lock()
        .map_err(|_| "Language state unavailable".to_string())? = language;
    Ok(())
}

const VALID_ENGINES: [&str; 4] = ["auto", "apple", "whisper", "parakeet"];

#[tauri::command]
fn set_transcription_engine(
    engine: String,
    state: State<'_, EngineSelectionState>,
) -> Result<(), String> {
    let engine = engine.trim().to_ascii_lowercase();
    if !VALID_ENGINES.contains(&engine.as_str()) {
        return Err(format!("Unknown transcription engine: {engine}"));
    }
    #[cfg(target_os = "macos")]
    let should_warm_apple = engine == "apple";
    *state
        .engine
        .lock()
        .map_err(|_| "Engine selection state unavailable".to_string())? = engine;

    #[cfg(target_os = "macos")]
    if should_warm_apple {
        // Sidecar startup must never delay settings hydration or the UI.
        std::thread::spawn(|| {
            // Apple on-device is the default engine, so the recognizer needs
            // Speech Recognition access. Ask here, in the app's own context,
            // instead of letting the first dictation fail on a permission the
            // user was never shown. Asking again after a refusal does nothing:
            // macOS never re-prompts, so this cannot nag.
            // A bare development binary has no Info.plist, and macOS aborts the
            // sidecar that asks for Speech Recognition (TCC privacy violation),
            // so only ask from a packaged app.
            if engines::apple_speech::is_bundled_app() && !check_speech_permission() {
                match request_speech_permission() {
                    Ok(true) => eprintln!("[VOX][ASR] Speech Recognition granted"),
                    Ok(false) => {
                        eprintln!("[VOX][ASR] Speech Recognition still not granted; enable Vox in System Settings → Privacy & Security → Speech Recognition")
                    }
                    Err(error) => eprintln!("[VOX][ASR] Speech Recognition request failed: {error}"),
                }
            }
            // A development build cannot use Apple Speech at all (see
            // `availability`), so do not keep a sidecar alive for it.
            if engines::apple_speech::is_bundled_app() {
                if let Err(error) = engines::apple_speech::warm_serve_session() {
                    eprintln!("[VOX][ASR] apple-speech prewarm skipped: {error}");
                }
            }
        });
    }

    Ok(())
}

#[tauri::command]
fn set_selected_model(
    model_name: String,
    state: State<'_, EngineSelectionState>,
) -> Result<(), String> {
    let model_name = model_name.trim();
    if model_name.is_empty() {
        return Err("Selected model cannot be empty".to_string());
    }
    *state
        .selected_model
        .lock()
        .map_err(|_| "Engine selection state unavailable".to_string())? = model_name.to_string();
    Ok(())
}

#[tauri::command]
fn set_engine_fallback(
    enabled: bool,
    state: State<'_, EngineSelectionState>,
) -> Result<(), String> {
    state.fallback_enabled.store(enabled, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn set_engine_fallback_target(
    engine: String,
    state: State<'_, EngineSelectionState>,
) -> Result<(), String> {
    let engine = engine.trim().to_ascii_lowercase();
    if !VALID_ENGINES.contains(&engine.as_str()) {
        return Err(format!("Unknown transcription engine: {engine}"));
    }
    *state
        .preferred_fallback
        .lock()
        .map_err(|_| "Engine selection state unavailable".to_string())? = engine;
    Ok(())
}

#[tauri::command]
fn set_snippets(snippets: Vec<Snippet>, state: State<'_, SnippetsState>) -> Result<(), String> {
    *state
        .snippets
        .lock()
        .map_err(|_| "Snippets state unavailable".to_string())? = snippets;
    Ok(())
}

#[tauri::command]
fn set_insertion_method(
    method: String,
    state: State<'_, InsertionMethodState>,
) -> Result<(), String> {
    if method != "typing" && method != "clipboard" {
        return Err(format!("Unknown insertion method: {method}"));
    }
    *state
        .method
        .lock()
        .map_err(|_| "Insertion method state unavailable".to_string())? = method;
    Ok(())
}

#[tauri::command]
fn get_writing_profiles(
    state: State<'_, writing::WritingProfilesState>,
) -> Result<writing::WritingProfilesView, String> {
    let config = state
        .config
        .lock()
        .map_err(|_| "Writing profiles unavailable".to_string())?;
    Ok(writing::view(&config))
}

#[tauri::command]
fn set_writing_profiles(
    app: AppHandle,
    state: State<'_, writing::WritingProfilesState>,
    custom_styles: Vec<writing::WritingStyle>,
    profiles: Vec<writing::AppWritingProfile>,
    default_style_id: Option<String>,
) -> Result<writing::WritingProfilesView, String> {
    let config = writing::sanitize(writing::WritingProfileConfig {
        custom_styles,
        profiles,
        default_style_id,
    });
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    writing::save(&app_data_dir, &config)?;
    *state
        .config
        .lock()
        .map_err(|_| "Writing profiles unavailable".to_string())? = config.clone();
    Ok(writing::view(&config))
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
fn get_cleanup_level(state: State<'_, CleanupLevelState>) -> text_enhancement::CleanupLevel {
    *state.level.lock().unwrap()
}

#[tauri::command]
fn set_cleanup_level(
    level: text_enhancement::CleanupLevel,
    state: State<'_, CleanupLevelState>,
) -> Result<(), String> {
    *state
        .level
        .lock()
        .map_err(|_| "Cleanup level state unavailable".to_string())? = level;
    Ok(())
}

#[tauri::command]
fn set_widget_enabled(
    enabled: bool,
    state: State<'_, WidgetPreferencesState>,
) -> Result<(), String> {
    *state
        .enabled
        .lock()
        .map_err(|_| "Widget preference state unavailable".to_string())? = enabled;
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
    let app_data_dir = app.path().app_data_dir().ok();
    let models_dir = app_data_dir.clone().map(whisper::models_dir);
    let recordings_dir = app_data_dir.clone().map(|path| path.join("recordings"));

    Ok(HotkeyDiagnostics {
        platform: platform_label(),
        current_shortcut,
        trigger_mode,
        accessibility_trusted: event_tap::is_accessibility_trusted(),
        event_tap_active,
        event_tap_error,
        has_downloaded_model,
        is_recording,
        app_data_dir: path_to_string(app_data_dir),
        models_dir: path_to_string(models_dir),
        recordings_dir: path_to_string(recordings_dir),
        text_insertion: text_insertion_diagnostics(),
    })
}

fn path_to_string(path: Option<PathBuf>) -> Option<String> {
    path.map(|path| path.to_string_lossy().to_string())
}

#[cfg(target_os = "linux")]
fn text_insertion_diagnostics() -> TextInsertionDiagnostics {
    let x11_available = env::var_os("DISPLAY").is_some();
    let wayland_available = env::var_os("WAYLAND_DISPLAY").is_some();
    let xdotool_available = command_exists("xdotool");
    let wtype_available = command_exists("wtype");
    let dotool_available = command_exists("dotool");
    let has_linux_helper = xdotool_available || wtype_available || dotool_available;

    TextInsertionDiagnostics {
        direct_typing_supported: true,
        x11_available,
        wayland_available,
        xdotool_available,
        wtype_available,
        dotool_available,
        guidance: if has_linux_helper {
            None
        } else {
            Some("Install xdotool for X11, or wtype/dotool for Wayland.")
        },
    }
}

#[cfg(not(target_os = "linux"))]
fn text_insertion_diagnostics() -> TextInsertionDiagnostics {
    TextInsertionDiagnostics {
        direct_typing_supported: true,
        x11_available: false,
        wayland_available: false,
        xdotool_available: false,
        wtype_available: false,
        dotool_available: false,
        guidance: None,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cli_options = CliOptions::from_env();
    let default_shortcut = Shortcut::new(Some(Modifiers::META | Modifiers::SHIFT), Code::Space);
    let default_hotkey =
        event_tap::parse_hotkey(DEFAULT_SHORTCUT).expect("DEFAULT_SHORTCUT must be valid");
    let transform_shortcut = Shortcut::new(Some(Modifiers::META | Modifiers::SHIFT), Code::KeyV);

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(
            |app, args, _working_directory| {
                let options = CliOptions::from_forwarded_args(args);
                if options.has_actions() {
                    apply_startup_visibility(app, &options);
                    run_cli_commands(app, &options);
                } else {
                    show_main_window(app);
                }
            },
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, pressed_shortcut, event| {
                    if pressed_shortcut == &transform_shortcut {
                        if event.state == ShortcutState::Pressed {
                            handle_transform_shortcut(app.clone());
                        }
                        return;
                    }

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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build());

    // NSPanel support so the floating overlays can be drawn over other apps'
    // full-screen Spaces (plain NSWindows cannot). macOS only.
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .manage(RecorderState::default())
        .manage(ActiveShortcut {
            current: Mutex::new(DEFAULT_SHORTCUT.to_string()),
        })
        .manage(LanguageState::default())
        .manage(SnippetsState::default())
        .manage(LastInsertionState::default())
        .manage(InsertionMethodState::default())
        .manage(VoiceCommandsState::default())
        .manage(TranscriptFormattingState::default())
        .manage(CleanupLevelState::default())
        .manage(WidgetPreferencesState {
            enabled: Mutex::new(true),
        })
        .manage(EnhancePreferencesState::default())
        .manage(FocusedInputSnapshotState::default())
        .manage(FocusContextState::default())
        .manage(ErrorReportingState::default())
        .manage(whisper::DownloadRegistry::default())
        .manage(EngineSelectionState::default())
        .manage(TransformState::default())
        .setup(move |app| {
            // Vocabulary Packs (spec §6): persisted under <app data>/vocabulary/.
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir());
            app.manage(VocabularyState {
                store: Mutex::new(vocabulary::store::VocabularyStore::load(&app_data_dir)),
                cache: Mutex::new(None),
            });
            app.manage(writing::WritingProfilesState {
                config: Mutex::new(writing::load(&app_data_dir)),
            });

            create_tray_menu(app)?;

            // One-time migration: legacy LaunchAgent login item → SMAppService
            // (shows "Vox" instead of the signing team in System Settings).
            login_item::migrate_legacy_agent();

            // Register default shortcut via OS hotkey API (works for Cmd+Shift+Space)
            app.global_shortcut().register(default_shortcut)?;
            app.global_shortcut().register(transform_shortcut)?;

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

            apply_startup_visibility(app.handle(), &cli_options);
            run_cli_commands(app.handle(), &cli_options);
            refresh_selected_enhancement_model_availability(app.handle());

            // Keep the floating overlays above normal windows and visible over
            // full-screen apps and on every Space (macOS).
            if let Some(widget) = app.get_webview_window("widget") {
                configure_floating_window(&widget);
            }
            if let Some(enhance) = app.get_webview_window("enhance") {
                configure_floating_window(&enhance);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            native_status,
            request_microphone_permission,
            microphone_authorization_status,
            open_system_settings,
            recording_status,
            start_recording,
            stop_recording,
            whisper_models,
            get_transcription_engines,
            get_hardware_info,
            download_whisper_model,
            pause_whisper_download,
            resume_whisper_download,
            cancel_whisper_download,
            delete_whisper_model,
            text_enhancement_models,
            recommended_enhancement_model,
            download_text_enhancement_model,
            delete_text_enhancement_model,
            set_enhance_icon_enabled,
            set_enhancement_model,
            enhance_focused_input,
            delete_recording_file,
            cleanup_recordings,
            wipe_local_app_files,
            transcribe_recording,
            transcribe_sample,
            get_current_shortcut,
            set_global_shortcut,
            get_trigger_mode,
            set_trigger_mode,
            set_language,
            set_login_item,
            is_login_item_enabled,
            set_dock_icon,
            set_transcription_engine,
            set_selected_model,
            set_engine_fallback,
            set_engine_fallback_target,
            set_snippets,
            set_insertion_method,
            get_writing_profiles,
            set_writing_profiles,
            set_whisper_mode,
            set_voice_commands_enabled,
            list_custom_models,
            add_custom_model,
            delete_custom_model,
            enhance_focused_input_now,
            hide_widget,
            undo_last_insertion,
            retry_last_insertion,
            widget_set_size,
            set_transcript_formatting_mode,
            get_cleanup_level,
            set_cleanup_level,
            set_widget_enabled,
            set_error_reporting_enabled,
            set_editable_focus_context,
            hotkey_diagnostics,
            check_accessibility_permission,
            request_accessibility_permission,
            check_microphone_permission,
            check_speech_permission,
            request_speech_permission,
            check_input_monitoring_permission,
            request_input_monitoring_permission,
            resolve_app_icon,
            open_external_link,
            capture_selected_text,
            apply_transform,
            note_transform,
            vocabulary_packs,
            vocabulary_migrate_dictionary,
            vocabulary_create_pack,
            vocabulary_update_pack,
            vocabulary_duplicate_pack,
            vocabulary_delete_pack,
            vocabulary_set_pack_enabled,
            vocabulary_upsert_entry,
            vocabulary_delete_entry,
            vocabulary_set_entry_enabled,
            vocabulary_set_app_mapping,
            vocabulary_import,
            vocabulary_export,
            vocabulary_eval,
            vocabulary_set_settings,
            vocabulary_record_correction,
        ])
        .build(tauri::generate_context!())
        .expect("error while running Vox")
        .run(|_app_handle, event| {
            // Kill the persistent engine sidecars so app exit never orphans
            // them (they hold loaded models in memory otherwise).
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                engines::apple_speech::shutdown_serve_session();
                engines::parakeet_engine::shutdown_serve_session();
                crate::text_enhancement::shutdown_serve_session();
            }
        });
}

fn create_tray_menu(app: &App) -> tauri::Result<()> {
    let menu = build_tray_menu(app.handle(), false)?;

    // Monochrome mic glyph (2x of the tray's fixed 18pt height) rendered as
    // an NSImage template: AppKit masks it from the alpha channel and tints
    // it automatically, so it reads correctly on both light and dark menu
    // bars.
    let tray = TrayIconBuilder::with_id("main")
        .tooltip("Vox")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(handle_tray_menu_event)
        .icon(tauri::include_image!("icons/menubar-icon.png"))
        .icon_as_template(true);

    tray.build(app)?;
    Ok(())
}

fn build_tray_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    is_recording: bool,
) -> tauri::Result<Menu<R>> {
    let open_app = MenuItem::with_id(app, TRAY_OPEN_APP_ID, "Show Vox", true, None::<&str>)?;
    let dictation = if is_recording {
        MenuItem::with_id(
            app,
            TRAY_CANCEL_DICTATION_ID,
            "Cancel Dictation",
            true,
            None::<&str>,
        )?
    } else {
        MenuItem::with_id(
            app,
            TRAY_START_DICTATION_ID,
            "Start Dictation",
            true,
            None::<&str>,
        )?
    };
    let private = MenuItem::with_id(
        app,
        TRAY_PRIVATE_DICTATION_ID,
        "Dictate Without Saving",
        !is_recording,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let (can_undo, can_retry) = last_insertion_actions(app);
    let undo = MenuItem::with_id(
        app,
        TRAY_UNDO_INSERTION_ID,
        "Undo Last Dictation",
        can_undo,
        None::<&str>,
    )?;
    let retry = MenuItem::with_id(
        app,
        TRAY_RETRY_INSERTION_ID,
        "Retry Insertion",
        can_retry,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, TRAY_SETTINGS_ID, "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT_ID, "Quit", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &open_app, &dictation, &private, &undo, &retry, &settings, &separator, &quit,
        ],
    )
}

fn handle_tray_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        TRAY_OPEN_APP_ID => show_main_window(app),
        TRAY_START_DICTATION_ID => start_recording_flow(app.clone()),
        TRAY_PRIVATE_DICTATION_ID => start_private_dictation_flow(app.clone()),
        TRAY_CANCEL_DICTATION_ID => cancel_recording(app.clone()),
        TRAY_UNDO_INSERTION_ID => match undo_last_insertion(app.clone()) {
            Ok(_) => {
                show_widget(app, "done", "Dictation undone");
                hide_widget_after_delay(app.clone(), 1400);
            }
            Err(error) => {
                show_widget(app, "error", &error);
                hide_widget_after_delay(app.clone(), 4000);
            }
        },
        TRAY_RETRY_INSERTION_ID => {
            if let Err(error) = retry_last_insertion(app.clone()) {
                show_widget(app, "error", &error);
                hide_widget_after_delay(app.clone(), 4000);
            }
        }
        TRAY_SETTINGS_ID => {
            show_main_window(app);
            let _ = app.emit("vox-open-settings", ());
        }
        TRAY_QUIT_ID => app.exit(0),
        _ => {}
    }
}

fn refresh_tray_menu(app: &AppHandle) {
    let is_recording = app
        .try_state::<RecorderState>()
        .and_then(|state| state.session.lock().ok().map(|session| session.is_some()))
        .unwrap_or(false);

    if let (Some(tray), Ok(menu)) = (app.tray_by_id("main"), build_tray_menu(app, is_recording)) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn apply_startup_visibility(app: &AppHandle, options: &CliOptions) {
    if options.start_hidden {
        hide_main_window(app);
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.maximize();
    }
}

fn run_cli_commands(app: &AppHandle, options: &CliOptions) {
    for command in &options.commands {
        match command {
            CliCommand::ToggleRecording => handle_hotkey_press(app.clone()),
            CliCommand::StartRecording => start_recording_flow(app.clone()),
            CliCommand::StopRecording => stop_and_transcribe(app.clone()),
            CliCommand::Cancel => cancel_recording(app.clone()),
            CliCommand::Show => show_main_window(app),
            CliCommand::Hide => hide_main_window(app),
            CliCommand::Diagnostics => print_cli_diagnostics(app, options),
        }
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn print_cli_diagnostics(app: &AppHandle, options: &CliOptions) {
    let status = native_status();
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|error| format!("Unavailable: {error}"));
    let current_shortcut = app
        .try_state::<ActiveShortcut>()
        .map(|state| {
            state
                .current
                .lock()
                .map(|shortcut| shortcut.clone())
                .unwrap_or_else(|_| DEFAULT_SHORTCUT.to_string())
        })
        .unwrap_or_else(|| DEFAULT_SHORTCUT.to_string());
    let is_recording = app
        .try_state::<RecorderState>()
        .and_then(|state| state.session.lock().ok().map(|session| session.is_some()))
        .unwrap_or(false);

    eprintln!("Vox CLI");
    eprintln!("  platform: {}", status.platform);
    eprintln!("  engine: {}", status.engine);
    eprintln!("  app data: {app_data_dir}");
    eprintln!("  shortcut: {current_shortcut}");
    eprintln!("  recording: {is_recording}");
    eprintln!("  start hidden: {}", options.start_hidden);
    eprintln!("  commands:");
    eprintln!("    vox --toggle-recording");
    eprintln!("    vox --start-recording");
    eprintln!("    vox --stop-recording");
    eprintln!("    vox --cancel");
    eprintln!("    vox --show");
    eprintln!("    vox --hide");
    eprintln!("    vox --start-hidden");
    eprintln!("    vox --diagnostics");
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
            TriggerMode::Toggle | TriggerMode::HandsFree => {
                // Toggle / Hands-free: press once to start, press again to stop + transcribe
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

fn handle_transform_shortcut(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        match capture_selected_text(app.clone()).await {
            Ok(text) => {
                show_main_window(&app);
                let _ = app.emit("vox-show-transform", serde_json::json!({ "text": text }));
            }
            Err(error) => {
                show_main_window(&app);
                let _ = app.emit("vox-show-transform", serde_json::json!({ "error": error }));
            }
        }
    });
}

fn transcription_preflight_error(
    models_dir: &Path,
    preferred: &str,
    fallback_enabled: bool,
) -> Option<String> {
    let statuses = engines::describe_engines(models_dir);

    if preferred == "auto" {
        if statuses.iter().any(|status| status.available) {
            return None;
        }
        return Some(
            "No transcription engine is ready. Download a model or check the engine permissions in Settings."
                .to_string(),
        );
    }

    let selected = statuses.iter().find(|status| status.id == preferred);
    if selected.is_some_and(|status| status.available) {
        return None;
    }

    // The router can try any registered fallback, so do not block recording
    // when at least one other engine is usable.
    if fallback_enabled
        && statuses
            .iter()
            .any(|status| status.id != preferred && status.available)
    {
        return None;
    }

    let display_name = selected
        .map(|status| status.display_name)
        .unwrap_or(preferred);
    let reason = selected
        .and_then(|status| status.reason.as_deref())
        .unwrap_or("the engine is unavailable");
    Some(format!("{display_name} is unavailable — {reason}"))
}

fn start_recording_flow(app: AppHandle) {
    start_recording_flow_inner(app, false);
}

/// Incognito dictation: same pipeline as a normal hotkey dictation, but the
/// transcript, audio, and vocabulary learning are never persisted.
fn start_private_dictation_flow(app: AppHandle) {
    start_recording_flow_inner(app, true);
}

fn start_recording_flow_inner(app: AppHandle, private: bool) {
    let recorder_state = app.state::<RecorderState>();

    // Fast pre-checks first (model availability) so we never flash a widget
    // that immediately turns into an error.
    let models_dir = match whisper_models_dir(&app) {
        Ok(d) => d,
        Err(e) => {
            show_widget(&app, "error", &e);
            hide_widget_after_delay(app.clone(), 4000);
            return;
        }
    };

    let (preferred_engine, fallback_enabled) = app
        .try_state::<EngineSelectionState>()
        .and_then(|state| {
            Some((
                state.engine.lock().ok()?.clone(),
                state.fallback_enabled.load(Ordering::Relaxed),
            ))
        })
        .unwrap_or_else(|| ("auto".to_string(), true));
    if let Some(error) =
        transcription_preflight_error(&models_dir, &preferred_engine, fallback_enabled)
    {
        show_widget(&app, "error", &error);
        hide_widget_after_delay(app.clone(), 4000);
        return;
    }

    // Show the widget immediately so the hotkey feels instant, while the audio
    // device warms up in the background.
    clear_last_insertion(&app);
    let listening_message = if private {
        "Private · Listening…"
    } else {
        "Listening…"
    };
    show_widget(&app, "recording", listening_message);

    // Private dictation always uses toggle mode: hands-free segments emit
    // incremental events and would bypass the no-save guarantee.
    let hands_free = !private
        && app
            .try_state::<EventTapHandle>()
            .map(|handle| {
                let mode: TriggerMode = (*handle.state.mode.lock().unwrap()).into();
                mode == TriggerMode::HandsFree
            })
            .unwrap_or(false);

    match start_recording_inner(&app, &recorder_state, hands_free, private) {
        Ok(_) => {
            // Re-emit the widget state now that the session carries the active
            // app context, so the "In <app> · <file>" line appears instantly
            // instead of waiting for the first timer tick.
            show_widget_with_elapsed(&app, "recording", listening_message, Some(0));
            start_recording_timer(app.clone());
            refresh_tray_menu(&app);
        }
        Err(error) => {
            show_widget(&app, "error", &error);
            hide_widget_after_delay(app.clone(), 4000);
            refresh_tray_menu(&app);
        }
    }
}

fn stop_and_transcribe(app: AppHandle) {
    eprintln!("[vox] stop_and_transcribe: stopping recording");
    let recorder_state = app.state::<RecorderState>();
    match stop_recording_inner(&recorder_state) {
        Ok(status) => {
            let private = status.private;
            eprintln!(
                "[vox] stop_and_transcribe: stopped path={:?} duration={:?}",
                status.path, status.duration_seconds
            );
            show_widget(&app, "transcribing", "Transcribing…");

            let audio_path = status.path.clone();
            if let Some(path) = status.path {
                eprintln!("[vox] stop_and_transcribe: transcribing {path}");
                match transcribe_recording_inner(
                    &app,
                    path,
                    None,
                    status.app_name.clone(),
                    status.window_title.clone(),
                    status.preview_text.clone(),
                    status.preview_confidence,
                    !status.private,
                ) {
                    Ok(mut result) => {
                        result.app_name = status.app_name;
                        eprintln!(
                            "[vox] stop_and_transcribe: transcript chars={}",
                            result.text.chars().count()
                        );

                        if is_blank_transcription(&result.text) {
                            eprintln!("[vox] stop_and_transcribe: blank transcription");
                            if private {
                                if let Some(path) = &audio_path {
                                    let _ = fs::remove_file(path);
                                }
                            }
                            show_widget(&app, "done", "No speech detected");
                            hide_widget_after_delay(app.clone(), 1200);
                            refresh_tray_menu(&app);
                            return;
                        }

                        // Multi-step macros run only when the whole utterance
                        // is the trigger. They never enter transcript history.
                        let snippets = app
                            .try_state::<SnippetsState>()
                            .and_then(|state| {
                                state.snippets.lock().ok().map(|snippets| snippets.clone())
                            })
                            .unwrap_or_default();
                        if let Some(macro_snippet) = find_macro_for_utterance(
                            &snippets,
                            &result.asr_text,
                            result.app_name.as_deref(),
                        ) {
                            let steps = parse_macro_steps(
                                &macro_snippet.expansion,
                                result.app_name.as_deref(),
                            );
                            if !steps.is_empty() {
                                show_widget(&app, "transcribing", "Running macro…");
                                if let Some(path) = &audio_path {
                                    let _ = fs::remove_file(path);
                                }
                                match execute_macro_steps(&steps) {
                                    Ok(()) => {
                                        show_widget(&app, "done", "Macro executed");
                                        hide_widget_after_delay(app.clone(), 1400);
                                    }
                                    Err(error) => {
                                        eprintln!("[vox] macro error: {error}");
                                        show_widget(&app, "error", &error);
                                        hide_widget_after_delay(app.clone(), 4000);
                                    }
                                }
                                refresh_tray_menu(&app);
                                return;
                            }
                        }

                        // Voice commands: a short instruction ("make this
                        // professional", "summarize this", …) acts on the
                        // selected text instead of being pasted as a transcript.
                        let voice_commands_enabled = app
                            .try_state::<VoiceCommandsState>()
                            .and_then(|state| state.enabled.lock().ok().map(|enabled| *enabled))
                            .unwrap_or(true);
                        if voice_commands_enabled {
                            if let Some(command) = detect_voice_command(&result.text) {
                                eprintln!("[vox] stop_and_transcribe: voice command detected");
                                show_widget(&app, "transcribing", "Applying command…");
                                if private {
                                    if let Some(path) = &audio_path {
                                        let _ = fs::remove_file(path);
                                    }
                                }
                                let app_clone = app.clone();
                                tauri::async_runtime::spawn(async move {
                                    match execute_voice_command(app_clone.clone(), command).await {
                                        Ok(()) => {
                                            show_widget(
                                                &app_clone,
                                                "done",
                                                if private {
                                                    "Command applied · not saved"
                                                } else {
                                                    "Command applied"
                                                },
                                            );
                                            hide_widget_after_delay(app_clone.clone(), 1200);
                                            refresh_tray_menu(&app_clone);
                                        }
                                        Err(error) => {
                                            eprintln!("[vox] voice command error: {error}");
                                            show_widget(&app_clone, "error", &error);
                                            hide_widget_after_delay(app_clone.clone(), 4000);
                                            refresh_tray_menu(&app_clone);
                                        }
                                    }
                                });
                                return;
                            }
                        }

                        let app_name = result.app_name.clone();
                        let text = ensure_trailing_space(&result.text);
                        show_widget(&app, "done", "Pasting transcript…");
                        if private {
                            eprintln!(
                                "[vox] stop_and_transcribe: private dictation — history event skipped"
                            );
                        } else {
                            let _ = app.emit("vox-transcription-complete", result);
                            eprintln!("[vox] stop_and_transcribe: emitted completion event");
                        }

                        let paste_started = std::time::Instant::now();
                        let inserted = match insert_text(&app, &text) {
                            Ok(method) => {
                                // Performance logging (spec §26).
                                eprintln!(
                                    "[VOX][OUTPUT] Inserted via {method} in {}ms",
                                    paste_started.elapsed().as_millis()
                                );
                                true
                            }
                            Err(error) => {
                                eprintln!("[vox] paste_text error: {error}");
                                // Never send incognito text to the main window.
                                if !private {
                                    let _ = app.emit(
                                        "vox-insertion-failed",
                                        serde_json::json!({
                                            "text": &text,
                                            "error": error,
                                            "appName": &app_name,
                                        }),
                                    );
                                }
                                false
                            }
                        };
                        remember_last_insertion(&app, text, app_name, inserted);

                        if private {
                            if let Some(path) = &audio_path {
                                let _ = fs::remove_file(path);
                            }
                        }

                        if inserted {
                            // Offer Undo (and Enhance when the model is
                            // available). The widget dismisses on typing or
                            // after 10 seconds.
                            if is_enhance_icon_enabled(&app)
                                && is_selected_enhancement_model_available(&app)
                            {
                                show_widget_done_with_actions(
                                    &app,
                                    if private {
                                        "Enhanced? · not saved"
                                    } else {
                                        "Enhanced?"
                                    },
                                    true,
                                );
                            } else if private {
                                show_widget_done_with_actions(&app, "Inserted · not saved", false);
                            } else {
                                show_widget_done_with_actions(&app, "Inserted", false);
                            }
                        } else {
                            show_widget(
                                &app,
                                "error",
                                if private {
                                    "Couldn't insert — text was not saved"
                                } else {
                                    "Couldn't insert — retry from the menu bar"
                                },
                            );
                            hide_widget_after_delay(app.clone(), 6000);
                        }
                        refresh_tray_menu(&app);
                    }
                    Err(error) => {
                        eprintln!("[vox] stop_and_transcribe: transcription error: {error}");
                        if private {
                            // Incognito recordings are discarded on failure; the
                            // main window must not receive the path or text.
                            if let Some(path) = &audio_path {
                                let _ = fs::remove_file(path);
                            }
                            show_widget(
                                &app,
                                "error",
                                "Transcription failed — recording discarded",
                            );
                        } else {
                            // Keep the recording file and surface the error with its
                            // path so the main window can offer a Retry action.
                            let _ = app.emit(
                                "vox-transcription-error",
                                serde_json::json!({
                                    "path": audio_path,
                                    "error": error,
                                    "appName": status.app_name,
                                    "windowTitle": status.window_title,
                                }),
                            );
                            show_widget(&app, "error", &error);
                        }
                        hide_widget_after_delay(app.clone(), 4000);
                        refresh_tray_menu(&app);
                    }
                }
            } else {
                eprintln!("[vox] stop_and_transcribe: stopped without audio path");
                show_widget(&app, "error", "Recording did not produce an audio file");
                hide_widget_after_delay(app.clone(), 4000);
                refresh_tray_menu(&app);
            }
        }
        Err(error) => {
            eprintln!("[vox] stop_and_transcribe: stop error: {error}");
            show_widget(&app, "error", &error);
            hide_widget_after_delay(app.clone(), 4000);
            refresh_tray_menu(&app);
        }
    }
}

fn cancel_recording(app: AppHandle) {
    let recorder_state = app.state::<RecorderState>();
    match stop_recording_inner(&recorder_state) {
        Ok(status) => {
            if let Some(path) = status.path {
                let _ = fs::remove_file(path);
            }
            show_widget(&app, "done", "Recording cancelled");
            hide_widget_after_delay(app.clone(), 900);
            refresh_tray_menu(&app);
        }
        Err(error) if error == "Recording is not running" => {
            hide_widget_after_delay(app.clone(), 0);
        }
        Err(error) => {
            show_widget(&app, "error", &error);
            hide_widget_after_delay(app.clone(), 4000);
        }
    }
}

// ── Hands-free mode ───────────────────────────────────────────────────────────

/// How long the user must stay silent before the current utterance is
/// considered complete and transcribed.
const HANDS_FREE_SILENCE_TIMEOUT: Duration = Duration::from_millis(1400);

/// Spawns a monitor that watches voice activity and rotates recording segments
/// on silence. Each finalized segment is transcribed on its own thread and
/// inserted progressively. The loop exits when the recording session ends.
fn spawn_hands_free_monitor(app: AppHandle) {
    thread::spawn(move || {
        let recorder_state = app.state::<RecorderState>();
        loop {
            let session_active = recorder_state
                .session
                .lock()
                .map(|session| session.is_some())
                .unwrap_or(false);
            if !session_active {
                break;
            }

            let (silence_elapsed, has_speech) = {
                let silence = recorder_state.vad.last_sound_at.lock().unwrap().elapsed();
                let has_speech = recorder_state.vad.has_speech.load(Ordering::Relaxed);
                (silence, has_speech)
            };

            if has_speech && silence_elapsed >= HANDS_FREE_SILENCE_TIMEOUT {
                if let Some(segment_path) = finalize_hands_free_segment(&recorder_state) {
                    recorder_state
                        .vad
                        .has_speech
                        .store(false, Ordering::Relaxed);
                    *recorder_state.vad.last_sound_at.lock().unwrap() = Instant::now();
                    let app_clone = app.clone();
                    thread::spawn(move || {
                        transcribe_hands_free_segment(app_clone, segment_path);
                    });
                }
            }

            thread::sleep(Duration::from_millis(100));
        }
    });
}

/// Finalize the current hands-free segment WAV and start a fresh one. Returns
/// the path of the finalized segment.
fn finalize_hands_free_segment(state: &RecorderState) -> Option<PathBuf> {
    let mut session_guard = state.session.lock().ok()?;
    let session = session_guard.as_mut()?;

    let writer = session.writer.lock().ok()?.take();
    if let Some(writer) = writer {
        writer.finalize().ok()?;
    }
    let finalized_path = session.path.clone();

    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
    let new_path = session
        .path
        .with_file_name(format!("vox-recording-{timestamp}.wav"));
    let spec = WavSpec {
        channels: session.channels,
        sample_rate: session.sample_rate,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };
    let new_writer = WavWriter::create(&new_path, spec).ok()?;
    *session.writer.lock().ok()? = Some(new_writer);
    session.path = new_path;

    Some(finalized_path)
}

/// Transcribe a hands-free segment, insert it into the active app, and emit an
/// event so the main window can save it to history. Runs on its own thread and
/// serializes against other segment transcriptions.
fn transcribe_hands_free_segment(app: AppHandle, path: PathBuf) {
    let recorder_state = app.state::<RecorderState>();
    let _guard = recorder_state
        .segment_transcribe_lock
        .lock()
        .unwrap_or_else(|error| error.into_inner());

    let (app_name, window_title) = {
        let session = recorder_state.session.lock().ok();
        match session.as_ref().and_then(|session| session.as_ref()) {
            Some(session) => (session.app_name.clone(), session.window_title.clone()),
            None => (None, None),
        }
    };

    let path_str = path.to_string_lossy().to_string();
    match transcribe_recording_inner(
        &app,
        path_str,
        None,
        app_name,
        window_title,
        None,
        None,
        true,
    ) {
        Ok(result) => {
            if !is_blank_transcription(&result.text) {
                let snippets = app
                    .try_state::<SnippetsState>()
                    .and_then(|state| state.snippets.lock().ok().map(|snippets| snippets.clone()))
                    .unwrap_or_default();
                if let Some(macro_snippet) = find_macro_for_utterance(
                    &snippets,
                    &result.asr_text,
                    result.app_name.as_deref(),
                ) {
                    let steps =
                        parse_macro_steps(&macro_snippet.expansion, result.app_name.as_deref());
                    if !steps.is_empty() {
                        let _ = fs::remove_file(&path);
                        if let Err(error) = execute_macro_steps(&steps) {
                            eprintln!("[vox] hands-free macro error: {error}");
                        }
                        return;
                    }
                }

                let text = ensure_trailing_space(&result.text);
                let _ = app.emit(
                    "vox-hands-free-segment",
                    serde_json::json!({
                        "text": result.text,
                        "asrText": result.asr_text,
                        "rawText": result.raw_text,
                        "timings": result.timings,
                        "appName": result.app_name,
                        "language": result.language,
                        "engine": result.engine,
                        "corrections": result.corrections,
                    }),
                );
                let paste_started = std::time::Instant::now();
                if let Err(error) = insert_text(&app, &text) {
                    eprintln!("[vox] hands-free paste error: {error}");
                } else {
                    eprintln!(
                        "[VOX][OUTPUT] Inserted in {}ms",
                        paste_started.elapsed().as_millis()
                    );
                }
            }
            let _ = fs::remove_file(&path);
        }
        Err(error) => {
            eprintln!("[vox] hands-free segment transcription error: {error}");
            let _ = fs::remove_file(&path);
        }
    }
}

/// Append a space when the transcript ends with sentence punctuation, so the
/// cursor in the target app never sits flush against a full stop and the next
/// typed or dictated word starts cleanly (matches system dictation behavior).
fn ensure_trailing_space(text: &str) -> String {
    let trimmed = text.trim_end();
    if trimmed.is_empty() || text.ends_with(' ') {
        return text.to_string();
    }
    // A closing quote after the punctuation still ends the sentence.
    let core = trimmed.trim_end_matches(['"', '\'', '”', '’']);
    if core.ends_with(['.', '!', '?', ',', ';', ':']) {
        return format!("{text} ");
    }
    text.to_string()
}

/// Type `text` at the current cursor position.
fn paste_text(text: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        paste_text_linux(text)
    }

    #[cfg(not(target_os = "linux"))]
    {
        paste_text_with_enigo(text)
    }
}

/// Type `text` through enigo's direct text injection.
fn paste_text_with_enigo(text: &str) -> Result<(), String> {
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

/// Insert dictated text using the user's preferred method. Returns the method
/// actually used for diagnostics.
fn insert_text(app: &AppHandle, text: &str) -> Result<&'static str, String> {
    let method = app
        .try_state::<InsertionMethodState>()
        .and_then(|state| state.method.lock().ok().map(|method| method.clone()))
        .unwrap_or_default();
    if method == "clipboard" {
        match paste_text_with_clipboard(text) {
            Ok(()) => Ok("clipboard"),
            Err(error) => {
                // Clipboard access can fail (locked clipboard, missing
                // Wayland helper). Fall back to direct typing rather than
                // dropping the transcript.
                eprintln!("[vox] clipboard insertion failed ({error}); typing instead");
                paste_text(text)?;
                Ok("typing")
            }
        }
    } else {
        // Long transcripts are the ones most likely to lose characters during
        // direct typing. Snapshot the focused field first so a retry only
        // happens when the field demonstrably did not change.
        let verify = text.chars().count() >= 120;
        let before = if verify { focused_text_value() } else { None };
        paste_text(text)?;
        if let Some(before) = before {
            thread::sleep(Duration::from_millis(150));
            if focused_text_value().as_deref() == Some(before.as_str()) {
                eprintln!(
                    "[vox] insertion post-check: focused field unchanged; retrying via clipboard"
                );
                paste_text_with_clipboard(text)?;
                thread::sleep(Duration::from_millis(200));
                if focused_text_value().as_deref() == Some(before.as_str()) {
                    return Err("The focused app did not accept the inserted text.".to_string());
                }
                return Ok("typing+clipboardRetry");
            }
        }
        Ok("typing")
    }
}

enum ClipboardBackup {
    Text(String),
    Image(arboard::ImageData<'static>),
    Empty,
}

/// Paste through the clipboard for long transcripts, then restore whatever the
/// clipboard held before (text or image). This is opt-in; the default path is
/// direct typing.
fn paste_text_with_clipboard(text: &str) -> Result<(), String> {
    let mut clipboard =
        Clipboard::new().map_err(|error| format!("Could not access clipboard: {error}"))?;
    let backup = if let Ok(previous) = clipboard.get_text() {
        ClipboardBackup::Text(previous)
    } else if let Ok(image) = clipboard.get_image() {
        ClipboardBackup::Image(image)
    } else {
        ClipboardBackup::Empty
    };

    clipboard
        .set_text(text)
        .map_err(|error| format!("Could not write transcript to clipboard: {error}"))?;
    thread::sleep(Duration::from_millis(30));
    simulate_paste_shortcut()?;
    // Give the target app time to read the clipboard before restoring it.
    thread::sleep(Duration::from_millis(250));

    match backup {
        ClipboardBackup::Text(previous) => {
            let _ = clipboard.set_text(previous);
        }
        ClipboardBackup::Image(image) => {
            let _ = clipboard.set_image(image);
        }
        ClipboardBackup::Empty => {
            let _ = clipboard.clear();
        }
    }
    Ok(())
}

// ── Last insertion (undo / retry) ───────────────────────────────────────────

fn remember_last_insertion(
    app: &AppHandle,
    text: String,
    app_name: Option<String>,
    inserted: bool,
) {
    if let Some(state) = app.try_state::<LastInsertionState>() {
        if let Ok(mut last) = state.last.lock() {
            *last = Some(LastInsertion {
                text,
                app_name,
                inserted_at: Instant::now(),
                inserted,
            });
        }
    }
}

fn clear_last_insertion(app: &AppHandle) {
    if let Some(state) = app.try_state::<LastInsertionState>() {
        if let Ok(mut last) = state.last.lock() {
            *last = None;
        }
    }
}

fn last_insertion_snapshot<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<LastInsertion> {
    app.try_state::<LastInsertionState>()
        .and_then(|state| state.last.lock().ok().and_then(|last| last.clone()))
}

/// `(can_undo, can_retry)` for the tray menu.
fn last_insertion_actions<R: tauri::Runtime>(app: &AppHandle<R>) -> (bool, bool) {
    match last_insertion_snapshot(app) {
        Some(entry) if entry.inserted => {
            (entry.inserted_at.elapsed() <= UNDO_INSERTION_WINDOW, false)
        }
        Some(entry) => (false, entry.inserted_at.elapsed() <= RETRY_INSERTION_WINDOW),
        None => (false, false),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UndoInsertionResult {
    method: &'static str,
}

/// Remove the exact text Vox typed from the focused field when it is still
/// present. This keeps the app's own undo stack untouched and works for
/// insertions at the end of a field.
#[cfg(target_os = "macos")]
fn remove_inserted_suffix(inserted: &str) -> Result<(), String> {
    if inserted.trim().is_empty() {
        return Err("There is no inserted text to remove.".to_string());
    }

    let system = OwnedAxElement::new(unsafe { AXUIElementCreateSystemWide() })
        .ok_or_else(|| "Could not access the focused app.".to_string())?;
    let focused = ax_copy_attribute(system.as_ref(), "AXFocusedUIElement")
        .and_then(|value| OwnedAxElement::new(value as AXUIElementRef))
        .ok_or_else(|| "Could not find the focused field.".to_string())?;
    let role = ax_string_attribute(focused.as_ref(), "AXRole");
    if !is_editable_ax_role(role.as_deref()) {
        return Err("No editable field is focused.".to_string());
    }

    let value = ax_string_attribute(focused.as_ref(), "AXValue")
        .ok_or_else(|| "The focused field does not expose its text.".to_string())?;
    let trimmed = inserted.trim_end();
    let stripped = value.strip_suffix(inserted).or_else(|| {
        (trimmed != inserted && !trimmed.is_empty())
            .then(|| value.strip_suffix(trimmed))
            .flatten()
    });
    let Some(stripped) = stripped else {
        return Err("The inserted text is no longer at the end of the field.".to_string());
    };

    let new_value = CFString::new(stripped);
    let status = unsafe {
        AXUIElementSetAttributeValue(
            focused.as_ref(),
            CFString::new("AXValue").as_concrete_TypeRef(),
            new_value.as_CFTypeRef(),
        )
    };
    if status == 0 {
        Ok(())
    } else {
        Err(format!("The app refused the edit (AX error {status})."))
    }
}

fn simulate_undo_shortcut() -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    let modifier = if cfg!(target_os = "macos") {
        Key::Meta
    } else {
        Key::Control
    };
    enigo
        .key(modifier, Direction::Press)
        .map_err(|e| e.to_string())?;
    enigo
        .key(Key::Unicode('z'), Direction::Click)
        .map_err(|e| e.to_string())?;
    enigo
        .key(modifier, Direction::Release)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn undo_last_insertion(app: AppHandle) -> Result<UndoInsertionResult, String> {
    let entry = last_insertion_snapshot(&app).ok_or_else(|| "Nothing to undo.".to_string())?;
    if !entry.inserted {
        return Err(
            "The last transcript was not inserted. Use Retry insertion instead.".to_string(),
        );
    }
    if entry.inserted_at.elapsed() > UNDO_INSERTION_WINDOW {
        clear_last_insertion(&app);
        refresh_tray_menu(&app);
        return Err("The undo window has passed. Press Cmd+Z in the app instead.".to_string());
    }
    if let (Some(expected), Some(current)) =
        (entry.app_name.as_deref(), frontmost_app_name().as_deref())
    {
        if expected != current {
            return Err(format!("Switch back to {expected} to undo this dictation."));
        }
    }

    // Prefer the precise AX edit: it removes exactly the text Vox typed.
    #[cfg(target_os = "macos")]
    if remove_inserted_suffix(&entry.text).is_ok() {
        clear_last_insertion(&app);
        refresh_tray_menu(&app);
        return Ok(UndoInsertionResult {
            method: "accessibilityValue",
        });
    }

    // Mid-field insertions cannot be matched by suffix. Cmd+Z is only safe
    // while the user is unlikely to have typed since insertion.
    if entry.inserted_at.elapsed() <= UNDO_SHORTCUT_FALLBACK_WINDOW {
        simulate_undo_shortcut()?;
        clear_last_insertion(&app);
        refresh_tray_menu(&app);
        return Ok(UndoInsertionResult {
            method: "undoShortcut",
        });
    }

    Err(
        "The cursor moved after insertion. Select the text and delete it, or press Cmd+Z."
            .to_string(),
    )
}

#[tauri::command]
fn retry_last_insertion(app: AppHandle) -> Result<(), String> {
    let entry = last_insertion_snapshot(&app).ok_or_else(|| "Nothing to insert.".to_string())?;
    if entry.inserted {
        return Err("That transcript was already inserted.".to_string());
    }
    if entry.inserted_at.elapsed() > RETRY_INSERTION_WINDOW {
        clear_last_insertion(&app);
        refresh_tray_menu(&app);
        return Err(
            "The retry window has passed. Copy the transcript from History instead.".to_string(),
        );
    }

    let text = ensure_trailing_space(&entry.text);
    insert_text(&app, &text)?;
    remember_last_insertion(&app, text, entry.app_name, true);
    refresh_tray_menu(&app);
    show_widget_done_with_actions(&app, "Inserted", false);
    Ok(())
}

#[cfg(target_os = "linux")]
fn paste_text_linux(text: &str) -> Result<(), String> {
    if paste_text_with_enigo(text).is_ok() {
        return Ok(());
    }

    let is_wayland = env::var_os("WAYLAND_DISPLAY").is_some();
    let is_x11 = env::var_os("DISPLAY").is_some();

    if is_wayland {
        if command_exists("wtype") {
            return paste_text_with_wtype(text);
        }

        if command_exists("dotool") {
            return paste_text_with_dotool(text);
        }
    }

    if is_x11 && command_exists("xdotool") {
        return paste_text_with_xdotool(text);
    }

    if command_exists("wtype") {
        return paste_text_with_wtype(text);
    }

    if command_exists("dotool") {
        return paste_text_with_dotool(text);
    }

    if command_exists("xdotool") {
        return paste_text_with_xdotool(text);
    }

    Err("Could not insert text. Install xdotool for X11, or wtype/dotool for Wayland.".to_string())
}

#[cfg(target_os = "linux")]
fn paste_text_with_xdotool(text: &str) -> Result<(), String> {
    let mut lines = text.split('\n').peekable();
    while let Some(line) = lines.next() {
        if !line.is_empty() {
            run_command(
                "xdotool",
                &["type", "--clearmodifiers", "--delay", "0", line],
            )?;
        }

        if lines.peek().is_some() {
            run_command("xdotool", &["key", "Return"])?;
        }
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn paste_text_with_wtype(text: &str) -> Result<(), String> {
    let mut lines = text.split('\n').peekable();
    while let Some(line) = lines.next() {
        if !line.is_empty() {
            run_command("wtype", &[line])?;
        }

        if lines.peek().is_some() {
            run_command("wtype", &["-k", "Return"])?;
        }
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn paste_text_with_dotool(text: &str) -> Result<(), String> {
    let mut script = String::new();
    let mut lines = text.split('\n').peekable();
    while let Some(line) = lines.next() {
        if !line.is_empty() {
            script.push_str("type ");
            script.push_str(line);
            script.push('\n');
        }

        if lines.peek().is_some() {
            script.push_str("key enter\n");
        }
    }

    let mut child = Command::new("dotool")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not run dotool: {error}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(script.as_bytes())
            .map_err(|error| format!("Could not write to dotool: {error}"))?;
    }

    child
        .wait()
        .map_err(|error| format!("dotool failed: {error}"))
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err(format!("dotool exited with {status}"))
            }
        })
}

#[cfg(target_os = "linux")]
fn run_command(program: &str, args: &[&str]) -> Result<(), String> {
    Command::new(program)
        .args(args)
        .status()
        .map_err(|error| format!("Could not run {program}: {error}"))
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err(format!("{program} exited with {status}"))
            }
        })
}

#[cfg(target_os = "linux")]
fn command_exists(name: &str) -> bool {
    let Some(paths) = env::var_os("PATH") else {
        return false;
    };

    env::split_paths(&paths).any(|path| path.join(name).is_file())
}

fn build_context_prompt(app_name: Option<&str>, window_title: Option<&str>) -> Option<String> {
    let app_name = app_name.map(str::trim).filter(|value| !value.is_empty());
    let window_title = window_title
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let current_file = current_file_from_title(window_title);

    let file_suffix = current_file
        .map(|file| format!(" The user is working on the file {file}."))
        .unwrap_or_default();

    match (app_name, window_title) {
        (Some(app), Some(title)) => Some(format!(
            "The user is dictating in {app}, window title \"{title}\".{file_suffix}"
        )),
        (Some(app), None) => Some(format!("The user is dictating in {app}.{file_suffix}")),
        (None, Some(title)) => Some(format!(
            "The active window title is \"{title}\".{file_suffix}"
        )),
        (None, None) => None,
    }
}

/// Extract the current file name from an editor window title like
/// "user.service.ts — my-project — Visual Studio Code" (File Awareness).
/// Returns `None` when the leading segment doesn't look like a file.
fn current_file_from_title(window_title: Option<&str>) -> Option<String> {
    let title = window_title?.trim();
    if title.is_empty() {
        return None;
    }
    let first = title
        .split(" — ")
        .next()
        .and_then(|part| part.split(" - ").next())
        .map(str::trim)
        .filter(|part| !part.is_empty())?;
    let looks_like_file = first.contains('.') || first.contains('/') || first.contains('\\');
    looks_like_file.then(|| first.to_string())
}

fn build_context_dictionary(app_name: Option<&str>, window_title: Option<&str>) -> Option<String> {
    let mut lines: Vec<String> = Vec::new();

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

    // File Awareness: bias the ASR model toward the file currently open in the
    // editor ("user.service.ts — my-project — Visual Studio Code").
    if let Some(file) = current_file_from_title(window_title) {
        entries.push(format!("{file} | | File"));
    }

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
        entries.extend(
            [
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
            .map(str::to_string),
        );
    }

    // npm / pnpm / yarn commands
    if contains_any(
        &context,
        &["terminal", "iterm", "warp", "node", "npm", "pnpm", "yarn"],
    ) {
        entries.extend(
            [
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
            .map(str::to_string),
        );
    }

    // Terminal / shell context
    if contains_any(&context, &["terminal", "iterm", "warp", "zsh", "bash"]) {
        entries.extend(
            [
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
            .map(str::to_string),
        );
    }

    // Docker context
    if contains_any(&context, &["docker", "container", "dockerfile", "compose"]) {
        entries.extend(
            [
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
            .map(str::to_string),
        );
    }

    // Kubernetes context
    if contains_any(
        &context,
        &["kubernetes", "kubectl", "k8s", "helm", "pod", "namespace"],
    ) {
        entries.extend(
            [
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
            .map(str::to_string),
        );
    }

    // Jira / Linear / project management
    if contains_any(&context, &["jira", "linear", "ticket", "issue", "sprint"]) {
        entries.extend(
            [
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
            .map(str::to_string),
        );
    }

    // Chat / messaging context
    if contains_any(
        &context,
        &["chatgpt", "claude", "chat", "slack", "messages"],
    ) {
        entries.extend(
            [
                "ChatGPT | chat-gee-pee-tee | Product",
                "Claude | clawd | Product",
                "Slack | slack | Product",
                "Rajeshwar | rah-jaysh-war | People",
                "PRD | pee-arr-dee | Product",
                "API | ay-pee-eye | Technical",
            ]
            .into_iter()
            .map(str::to_string),
        );
    }

    dedupe_lines(entries)
}

fn format_transcript_for_context(
    text: &str,
    mode: TranscriptFormattingMode,
    app_name: Option<&str>,
    window_title: Option<&str>,
    is_editable_focused: bool,
) -> (String, bool) {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return (String::new(), false);
    }

    let should_format_for_developer = match mode {
        TranscriptFormattingMode::Plain => false,
        TranscriptFormattingMode::Developer => true,
        TranscriptFormattingMode::Auto => {
            is_developer_app_context(app_name, window_title, is_editable_focused)
        }
    };

    if !should_format_for_developer {
        return (format_general_transcript(trimmed), false);
    }

    (format_developer_transcript(trimmed), true)
}

// ── General (non-developer) smart formatting ─────────────────────────────────

/// Add a terminal period and initial capital to unpunctuated single-line prose.
/// Deliberately conservative: any existing `.`/`!`/`?`, multi-line structure,
/// or list/heading marker leaves the text untouched.
fn restore_punctuation(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty()
        || trimmed.contains('\n')
        || trimmed.starts_with('#')
        || trimmed.starts_with("- ")
        || trimmed.starts_with("* ")
    {
        return text.to_string();
    }
    if trimmed.chars().any(|ch| matches!(ch, '.' | '!' | '?')) {
        return text.to_string();
    }

    let capitalized = capitalize_first(trimmed);
    if capitalized
        .chars()
        .last()
        .is_some_and(|ch| ch.is_alphanumeric())
    {
        format!("{capitalized}.")
    } else {
        capitalized
    }
}

/// Rule-based smart formatting for non-developer dictation: numbered lists,
/// bullet lists, and headings. Runs before AI cleanup so the model sees a
/// pre-structured transcript, and also when cleanup is disabled. Falls back to
/// the normalized input when no pattern is detected.
fn format_general_transcript(text: &str) -> String {
    let normalized = text
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    if let Some(formatted) = format_numbered_list(&normalized) {
        return formatted;
    }
    if let Some(formatted) = format_bullet_list(&normalized) {
        return formatted;
    }
    if let Some(formatted) = format_heading(&normalized) {
        return formatted;
    }
    normalized
}

/// Ordinal markers that reliably signal a dictated numbered list.
const NUMBERED_LIST_MARKERS: &[&str] = &[
    "first", "firstly", "second", "secondly", "third", "thirdly", "fourth", "fourthly", "fifth",
    "fifthly", "sixth", "seventh", "eighth", "ninth", "tenth", "lastly", "finally", "one", "two",
    "three", "four", "five", "six", "seven", "eight", "nine", "ten",
];

/// "first install dependencies second run migration third start the server" →
/// "1. Install dependencies\n2. Run migration\n3. Start the server".
fn format_numbered_list(text: &str) -> Option<String> {
    let words: Vec<&str> = text.split(' ').collect();
    let mut markers: Vec<usize> = Vec::new();
    for (index, word) in words.iter().enumerate() {
        let lower = word
            .trim_end_matches(['.', ',', ':', ';'])
            .to_ascii_lowercase();
        if NUMBERED_LIST_MARKERS.contains(&lower.as_str()) {
            markers.push(index);
        }
    }
    if markers.len() < 2 {
        return None;
    }

    let mut lines = Vec::new();
    for (index, &marker_pos) in markers.iter().enumerate() {
        let start = marker_pos + 1;
        let end = markers.get(index + 1).copied().unwrap_or(words.len());
        let item = words[start..end].join(" ").trim().to_string();
        if item.is_empty() {
            continue;
        }
        lines.push(format!("• {}", capitalize_first(&item)));
    }
    if lines.len() < 2 {
        return None;
    }
    Some(lines.join("\n"))
}

/// Phrases that introduce a dictated bullet list.
const BULLET_LIST_INTENTS: &[&str] = &[
    "things i need",
    "things to do",
    "my list",
    "to do list",
    "to do",
    "todo",
    "shopping list",
    "remember",
    "reminders",
    "key points",
    "bullet points",
    "my goals",
    "my plan",
    "my priorities",
    "my tasks",
    "what i need",
    "here's what",
    "here is what",
    "agenda items",
    "items",
    "ideas",
    "topics",
    "notes",
];

/// "things I need milk eggs bread" → "• Milk\n• Eggs\n• Bread".
fn format_bullet_list(text: &str) -> Option<String> {
    let lower = text.to_ascii_lowercase();
    let intent = BULLET_LIST_INTENTS
        .iter()
        .find(|phrase| lower.starts_with(*phrase))?;
    let rest = text[intent.len()..].trim();
    if rest.is_empty() {
        return None;
    }

    // Prefer comma/semicolon separation; fall back to " and " for spoken lists.
    let mut items: Vec<String> = rest
        .split(|ch| ch == ',' || ch == ';')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect();
    if items.len() < 2 {
        items = rest
            .split(" and ")
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .map(str::to_string)
            .collect();
    }
    if items.len() < 2 {
        return None;
    }

    let lines = items
        .iter()
        .map(|item| format!("• {}", capitalize_first(item)))
        .collect::<Vec<_>>();
    Some(lines.join("\n"))
}

/// Explicit heading commands and well-known short heading phrases.
const HEADING_COMMANDS: &[&str] = &["title", "heading"];
const HEADING_PHRASES: &[&str] = &[
    "project requirements",
    "meeting notes",
    "meeting summary",
    "agenda",
    "action items",
    "next steps",
    "key takeaways",
    "release notes",
    "weekly report",
    "daily standup",
    "readme",
    "changelog",
    "summary",
    "overview",
    "introduction",
    "conclusion",
    "decisions",
    "follow-ups",
    "todo",
    "to do list",
    "my notes",
    "project plan",
    "roadmap",
    "goals",
    "objectives",
    "requirements",
    "proposal",
];

/// "title project requirements" → "## Project Requirements".
fn format_heading(text: &str) -> Option<String> {
    let lower = text.to_ascii_lowercase();

    // Explicit command: "title X" / "heading X" → "## Title Case X".
    for command in HEADING_COMMANDS {
        if let Some(rest) = lower.strip_prefix(command) {
            let rest = rest.trim();
            if !rest.is_empty() && rest.split_whitespace().count() <= 8 {
                return Some(format!("## {}", title_case(rest)));
            }
        }
    }

    // Known heading phrase when the utterance is short (a heading, not prose).
    if text.split_whitespace().count() <= 6 {
        for phrase in HEADING_PHRASES {
            if lower == *phrase {
                return Some(format!("## {}", title_case(text)));
            }
        }
    }
    None
}

fn capitalize_first(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

fn title_case(value: &str) -> String {
    value
        .split_whitespace()
        .map(capitalize_first)
        .collect::<Vec<_>>()
        .join(" ")
}

// ── Rule-based fast cleanup ───────────────────────────────────────────────────

/// Deterministic, instant cleanup that runs without the LLM: removes filler
/// words, collapses self-corrections, fixes stutters, and normalizes
/// capitalization. Operates line-by-line so list/paragraph structure survives.
fn fast_cleanup(text: &str) -> String {
    text.lines()
        .map(|line| {
            let line = collapse_self_corrections(line);
            let line = remove_fillers(&line);
            let line = fix_repeated_words(&line);
            normalize_capitalization(&line)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Sentences that describe the dictation/writing process itself rather than
/// actual content. These are spoken as asides while dictating ("there is lots
/// of noise and some other text that should not be there", "I want to write an
/// essay about my life") and should not appear in the final output.
const META_COMMENTARY_PATTERNS: &[&str] = &[
    "should not be there",
    "that should not be there",
    "lots of noise",
    "lots of ease",
    "some other text",
    "i want to write an essay",
    "i want to write the essay",
    "i want to write a essay",
    "i am dictating",
    "i'm dictating",
    "ignore that",
    "ignore this",
    "remove that",
    "remove this",
    "delete that",
    "delete this",
    "scratch that",
    "forget that",
    "forget it",
    "never mind",
    "that was wrong",
    "i said that wrong",
    "let me start over",
    "let me redo",
    "let me try again",
];

/// Drop sentences that are meta-commentary about the dictation itself, so
/// asides like "there is lots of noise and some other text that should not be
/// there" never end up in the transcript. Conservative: only removes whole
/// sentences that clearly match a known meta pattern.
fn remove_meta_commentary(text: &str) -> String {
    let mut kept: Vec<&str> = Vec::new();
    for sentence in split_sentences(text) {
        let lower = sentence.to_lowercase();
        let is_meta = META_COMMENTARY_PATTERNS
            .iter()
            .any(|pattern| lower.contains(pattern));
        if !is_meta {
            kept.push(sentence);
        }
    }
    kept.join(" ")
}

/// Split text into sentences on `.`, `!`, or `?` followed by whitespace or
/// end-of-input. Keeps the punctuation attached to each sentence.
fn split_sentences(text: &str) -> Vec<&str> {
    let mut sentences = Vec::new();
    let mut start = 0;
    let bytes = text.as_bytes();
    for (index, ch) in text.char_indices() {
        if !matches!(ch, '.' | '!' | '?') {
            continue;
        }
        let after = index + ch.len_utf8();
        let ends_sentence = after >= bytes.len()
            || text[after..]
                .chars()
                .next()
                .map(|next| next.is_whitespace())
                .unwrap_or(true);
        if ends_sentence {
            let sentence = text[start..after].trim();
            if !sentence.is_empty() {
                sentences.push(sentence);
            }
            start = after;
        }
    }
    let tail = text[start..].trim();
    if !tail.is_empty() {
        sentences.push(tail);
    }
    sentences
}

/// Filler words that are never meaningful and can be removed anywhere.
const SAFE_FILLERS: &[&str] = &["um", "uh", "er", "erm", "hmm", "ah", "uhh", "uhm", "mm"];

/// Filler phrases removed only when they sit between commas ("I was, like,
/// going") so legitimate uses ("I like this") survive.
const COMMA_FILLERS: &[&str] = &[
    "like",
    "you know",
    "i mean",
    "sort of",
    "kind of",
    "basically",
    "literally",
];

fn remove_fillers(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    let mut out: Vec<String> = Vec::new();
    let mut index = 0;
    while index < words.len() {
        let word = words[index];
        let lower = word
            .trim_matches(|ch: char| !ch.is_alphanumeric())
            .to_ascii_lowercase();

        let mut is_filler = false;
        // Multi-word comma fillers: "you know", "i mean", "sort of", …
        if index + 1 < words.len() {
            let next = words[index + 1]
                .trim_matches(|ch: char| !ch.is_alphanumeric())
                .to_ascii_lowercase();
            let pair = format!("{lower} {next}");
            if COMMA_FILLERS.contains(&pair.as_str()) && is_between_commas(&words, index) {
                is_filler = true;
                index += 2;
            }
        }
        if !is_filler && SAFE_FILLERS.contains(&lower.as_str()) {
            is_filler = true;
            index += 1;
        }
        if !is_filler && COMMA_FILLERS.contains(&lower.as_str()) && is_between_commas(&words, index)
        {
            is_filler = true;
            index += 1;
        }

        if is_filler {
            // Drop a dangling comma left on the previous word ("was, like," → "was").
            if let Some(prev) = out.last_mut() {
                if prev.ends_with(',') {
                    prev.pop();
                }
            }
            continue;
        }

        out.push(word.to_string());
        index += 1;
    }
    out.join(" ")
}

/// True when the word at `index` is flanked by commas (or a comma before and
/// sentence end after), e.g. "I was, like, going".
fn is_between_commas(words: &[&str], index: usize) -> bool {
    let before = words
        .get(index.wrapping_sub(1))
        .map(|word| word.ends_with(','))
        .unwrap_or(false);
    let after = words
        .get(index + 1)
        .map(|word| word.starts_with(','))
        .unwrap_or(false);
    before || after
}

/// Markers that signal a spoken self-correction. Only honored when preceded by
/// an ellipsis ("...") so ordinary uses ("I actually think…") survive.
const CORRECTION_MARKERS: &[&str] = &[
    "actually",
    "wait",
    "sorry",
    "no wait",
    "i mean",
    "correction",
    "scratch that",
    "no, actually",
    "no actually",
    "never mind",
    "forget it",
];

/// "Let's meet at 2 PM... actually 3 PM." → "Let's meet at 3 PM."
/// Keeps the text before the last ellipsis-preceded correction marker, drops
/// the phrase the correction replaces (matched by word count), and appends the
/// correction.
fn collapse_self_corrections(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let mut best: Option<(usize, usize)> = None; // (prefix_end, marker_end)

    for marker in CORRECTION_MARKERS {
        let mut search_from = 0;
        while let Some(relative) = lower[search_from..].find(marker) {
            let abs = search_from + relative;
            let before = text[..abs].trim_end();
            let ellipsis_len = if before.ends_with("...") {
                Some(3)
            } else if before.ends_with('…') {
                Some(1)
            } else {
                None
            };
            if let Some(len) = ellipsis_len {
                best = Some((before.len() - len, abs + marker.len()));
            }
            search_from = abs + marker.len();
        }
    }

    match best {
        Some((prefix_end, marker_end)) => {
            let prefix = text[..prefix_end].trim_end();
            let correction = text[marker_end..]
                .trim()
                .trim_start_matches(|ch: char| ch == ',' || ch == ' ' || ch == '.')
                .trim();
            if correction.is_empty() {
                return text.to_string();
            }

            // The correction replaces the last N words of the prefix, where N is
            // the correction's own word count ("2 PM" → "3 PM").
            let correction_words = correction.split_whitespace().count();
            let prefix_words: Vec<&str> = prefix.split_whitespace().collect();
            let keep_count = prefix_words.len().saturating_sub(correction_words);
            let mut result = prefix_words[..keep_count].join(" ");
            if !result.is_empty() {
                result.push(' ');
            }
            result.push_str(correction);
            capitalize_first(&result)
        }
        None => text.to_string(),
    }
}

/// Approximate recording duration from its WAV header/length.
fn wav_duration_seconds(path: &std::path::Path) -> Option<f64> {
    let reader = hound::WavReader::open(path).ok()?;
    let spec = reader.spec();
    let frames = reader.duration() as f64 / f64::from(spec.channels);
    Some(frames / f64::from(spec.sample_rate))
}

/// Remove adjacent repeated words (stutters): "I I want" → "I want".
fn fix_repeated_words(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    let mut out: Vec<&str> = Vec::with_capacity(words.len());
    for word in words {
        if let Some(last) = out.last() {
            if last.eq_ignore_ascii_case(word) {
                continue;
            }
        }
        out.push(word);
    }
    out.join(" ")
}

/// Capitalize the first letter of the text and after sentence-ending
/// punctuation (". ", "! ", "? ").
fn normalize_capitalization(text: &str) -> String {
    let mut chars = text.chars().peekable();
    let mut result = String::with_capacity(text.len());
    let mut capitalize_next = true;

    while let Some(ch) = chars.next() {
        if capitalize_next && ch.is_alphabetic() {
            result.extend(ch.to_uppercase());
            capitalize_next = false;
        } else {
            result.push(ch);
        }

        if matches!(ch, '.' | '!' | '?') {
            // Only treat as sentence end when followed by whitespace/end.
            if let Some(&next) = chars.peek() {
                if next.is_whitespace() {
                    capitalize_next = true;
                }
            } else {
                capitalize_next = false;
            }
        }
    }
    result
}

// ── App-context writing styles ────────────────────────────────────────────────

/// Map the active application to a writing-style instruction used by AI cleanup
/// (Context Awareness). Returns `None` for developer contexts and unknown apps.
fn app_style_instruction(
    app_name: Option<&str>,
    window_title: Option<&str>,
) -> Option<&'static str> {
    let context = format!(
        "{} {}",
        app_name.unwrap_or_default(),
        window_title.unwrap_or_default()
    )
    .to_lowercase();

    // Developer apps are handled by developer mode; don't apply prose styles.
    if is_developer_app_context(app_name, window_title, true) {
        return None;
    }

    if contains_any(
        &context,
        &[
            "gmail",
            "apple mail",
            "mail",
            "outlook",
            "spark",
            "superhuman",
            "thunderbird",
            "yahoo mail",
            "proton mail",
            "fastmail",
        ],
    ) {
        return Some(
            "Write in a professional email style: polite, clear, well-structured, with complete sentences and standard email conventions.",
        );
    }
    if contains_any(
        &context,
        &[
            "slack",
            "discord",
            "teams",
            "messages",
            "whatsapp",
            "telegram",
            "signal",
            "imessage",
            "messenger",
        ],
    ) {
        return Some(
            "Write in a casual conversational style: friendly, concise, natural, with short sentences and a relaxed tone.",
        );
    }
    if contains_any(
        &context,
        &[
            "notion",
            "obsidian",
            "google docs",
            "docs",
            "word",
            "pages",
            "bear",
            "craft",
            "evernote",
            "apple notes",
            "notes",
        ],
    ) {
        return Some(
            "Write in a structured document style: clear organization, well-structured paragraphs, and content suitable for a document.",
        );
    }
    None
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

    // Browsers are only treated as developer contexts when the window title
    // carries a developer signal (localhost, GitHub, StackBlitz, file paths,
    // etc.). Dictating into Gmail/Slack/Notion in a browser should get prose
    // formatting and app-aware styles instead of developer formatting.
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
            let (identifier, consumed_words) =
                collect_styled_identifier(&remaining[phrase_len..], style);
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
        (Some("function"), Some("declaration"), _) => Some((2, "function name() {\n    \n}")),
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
            words
                .first()
                .map(|word| word.to_ascii_lowercase())
                .as_deref(),
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
    match words
        .first()
        .map(|word| word.to_ascii_lowercase())
        .as_deref()
    {
        Some("indent") | Some("tab") => Some(1),
        _ => None,
    }
}

fn developer_outdent_phrase(words: &[&str]) -> Option<usize> {
    match words
        .first()
        .map(|word| word.to_ascii_lowercase())
        .as_deref()
    {
        Some("outdent") | Some("dedent") => Some(1),
        _ => None,
    }
}

fn developer_symbol_phrase(words: &[&str]) -> Option<(usize, &'static str)> {
    let lower = |index: usize| words.get(index).map(|word| word.to_ascii_lowercase());

    match (
        lower(0).as_deref(),
        lower(1).as_deref(),
        lower(2).as_deref(),
    ) {
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
            (Some("open"), Some("paren")) | (Some("open"), Some("parenthesis")) => Some((2, "(")),
            (Some("close"), Some("paren")) | (Some("close"), Some("parenthesis")) => Some((2, ")")),
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

        let bitmap: *mut objc::runtime::Object =
            msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff_data];
        if bitmap.is_null() {
            return None;
        }

        let png_type: usize = 4;
        let png_data: *mut objc::runtime::Object = msg_send![bitmap, representationUsingType: png_type properties: std::ptr::null::<c_void>()];
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
    let url: *mut objc::runtime::Object =
        msg_send![workspace, URLForApplicationWithBundleIdentifier: ns_name];
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

    std::ffi::CStr::from_ptr(utf8)
        .to_str()
        .ok()
        .map(str::to_string)
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
    Some(format!("data:{mime};base64,{}", base64_encode(slice)))
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

        std::ffi::CStr::from_ptr(utf8)
            .to_str()
            .ok()
            .map(str::to_string)
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

#[cfg(target_os = "macos")]
type AXUIElementRef = *const c_void;

#[cfg(target_os = "macos")]
type AXValueRef = *const c_void;

#[cfg(target_os = "macos")]
struct OwnedCfType(CFTypeRef);

#[cfg(target_os = "macos")]
impl OwnedCfType {
    fn new(value: CFTypeRef) -> Option<Self> {
        (!value.is_null()).then_some(Self(value))
    }

    fn as_ref(&self) -> CFTypeRef {
        self.0
    }
}

#[cfg(target_os = "macos")]
impl Drop for OwnedCfType {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) };
    }
}

#[cfg(target_os = "macos")]
struct OwnedAxElement(AXUIElementRef);

#[cfg(target_os = "macos")]
impl OwnedAxElement {
    fn new(value: AXUIElementRef) -> Option<Self> {
        (!value.is_null()).then_some(Self(value))
    }

    fn as_ref(&self) -> AXUIElementRef {
        self.0
    }
}

#[cfg(target_os = "macos")]
impl Drop for OwnedAxElement {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0 as CFTypeRef) };
    }
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct AxPoint {
    x: f64,
    y: f64,
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct AxSize {
    width: f64,
    height: f64,
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct AxRect {
    origin: AxPoint,
    size: AxSize,
}

#[cfg(target_os = "macos")]
extern "C" {
    fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> i32;
    fn AXUIElementSetAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: CFTypeRef,
    ) -> i32;
    fn AXValueGetType(value: AXValueRef) -> i32;
    fn AXValueGetValue(value: AXValueRef, type_: i32, value_ptr: *mut c_void) -> bool;
}

#[cfg(target_os = "macos")]
fn focused_input_snapshot() -> Option<FocusedInputSnapshot> {
    let system = OwnedAxElement::new(unsafe { AXUIElementCreateSystemWide() })?;
    let focused = OwnedAxElement::new(
        ax_copy_attribute(system.as_ref(), "AXFocusedUIElement")? as AXUIElementRef
    )?;
    let role = ax_string_attribute(focused.as_ref(), "AXRole");
    let text = ax_string_attribute(focused.as_ref(), "AXValue")?;
    let frame = ax_frame_attribute(focused.as_ref())?;

    if !is_editable_ax_role(role.as_deref()) || text.trim().is_empty() {
        return None;
    }

    let app_name = frontmost_app_name();
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    role.hash(&mut hasher);
    app_name.hash(&mut hasher);
    let content_hash = hasher.finish();
    let id = format!(
        "{}:{}:{}:{}:{content_hash:016x}",
        frame.x.round() as i64,
        frame.y.round() as i64,
        frame.width.round() as i64,
        frame.height.round() as i64,
    );
    Some(FocusedInputSnapshot { id, app_name, text })
}

#[cfg(not(target_os = "macos"))]
fn focused_input_snapshot() -> Option<FocusedInputSnapshot> {
    None
}

#[cfg(target_os = "macos")]
fn replace_focused_input_text(text: &str) -> Result<&'static str, String> {
    let Some(system) = OwnedAxElement::new(unsafe { AXUIElementCreateSystemWide() }) else {
        return replace_focused_input_text_fallback(text);
    };

    let Some(focused) = ax_copy_attribute(system.as_ref(), "AXFocusedUIElement")
        .and_then(|value| OwnedAxElement::new(value as AXUIElementRef))
    else {
        return replace_focused_input_text_fallback(text);
    };
    let value = CFString::new(text);
    let value_result = unsafe {
        AXUIElementSetAttributeValue(
            focused.as_ref(),
            CFString::new("AXValue").as_concrete_TypeRef(),
            value.as_CFTypeRef(),
        )
    };

    if value_result == 0 {
        Ok("accessibilityValue")
    } else {
        replace_focused_input_text_fallback(text)
    }
}

/// Fallback replacement: select all in the focused field, then type the new
/// text. Typing over a selection replaces it, so the original text is not
/// duplicated (unlike a bare paste at the cursor).
fn replace_focused_input_text_fallback(text: &str) -> Result<&'static str, String> {
    simulate_select_all_shortcut()?;
    // Give the app a moment to register the selection before typing.
    thread::sleep(Duration::from_millis(60));
    paste_text(text).map(|_| "typingFallback")
}

fn simulate_select_all_shortcut() -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    let modifier = if cfg!(target_os = "macos") {
        Key::Meta
    } else {
        Key::Control
    };
    enigo
        .key(modifier, Direction::Press)
        .map_err(|e| e.to_string())?;
    enigo
        .key(Key::Unicode('a'), Direction::Click)
        .map_err(|e| e.to_string())?;
    enigo
        .key(modifier, Direction::Release)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn replace_focused_input_text(text: &str) -> Result<&'static str, String> {
    replace_focused_input_text_fallback(text)
}

#[cfg(target_os = "macos")]
fn ax_copy_attribute(element: AXUIElementRef, attribute: &str) -> Option<CFTypeRef> {
    let mut value: CFTypeRef = std::ptr::null();
    let status = unsafe {
        AXUIElementCopyAttributeValue(
            element,
            CFString::new(attribute).as_concrete_TypeRef(),
            &mut value,
        )
    };
    if status == 0 && !value.is_null() {
        Some(value)
    } else {
        None
    }
}

#[cfg(target_os = "macos")]
fn ax_string_attribute(element: AXUIElementRef, attribute: &str) -> Option<String> {
    let value = ax_copy_attribute(element, attribute)?;
    let type_id = unsafe { core_foundation::base::CFGetTypeID(value) };
    if type_id != unsafe { core_foundation::string::CFStringGetTypeID() } {
        unsafe { CFRelease(value) };
        return None;
    }

    let string = unsafe { CFString::wrap_under_create_rule(value as CFStringRef) };
    Some(string.to_string())
}

#[cfg(target_os = "macos")]
fn ax_frame_attribute(element: AXUIElementRef) -> Option<InputFrame> {
    if let Some(value) = ax_copy_attribute(element, "AXFrame").and_then(OwnedCfType::new) {
        let frame = ax_value_rect(value.as_ref() as AXValueRef);
        if frame.is_some() {
            return frame;
        }
    }

    let position_value = ax_copy_attribute(element, "AXPosition").and_then(OwnedCfType::new)?;
    let size_value = ax_copy_attribute(element, "AXSize").and_then(OwnedCfType::new)?;
    let position = ax_value_point(position_value.as_ref() as AXValueRef);
    let size = ax_value_size(size_value.as_ref() as AXValueRef);

    match (position, size) {
        (Some(position), Some(size)) => Some(InputFrame {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        }),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn ax_value_rect(value: AXValueRef) -> Option<InputFrame> {
    if unsafe { AXValueGetType(value) } != 3 {
        return None;
    }
    let mut rect = AxRect::default();
    let ok = unsafe { AXValueGetValue(value, 3, &mut rect as *mut AxRect as *mut c_void) };
    ok.then_some(InputFrame {
        x: rect.origin.x,
        y: rect.origin.y,
        width: rect.size.width,
        height: rect.size.height,
    })
}

#[cfg(target_os = "macos")]
fn ax_value_point(value: AXValueRef) -> Option<AxPoint> {
    if unsafe { AXValueGetType(value) } != 1 {
        return None;
    }
    let mut point = AxPoint::default();
    let ok = unsafe { AXValueGetValue(value, 1, &mut point as *mut AxPoint as *mut c_void) };
    ok.then_some(point)
}

#[cfg(target_os = "macos")]
fn ax_value_size(value: AXValueRef) -> Option<AxSize> {
    if unsafe { AXValueGetType(value) } != 2 {
        return None;
    }
    let mut size = AxSize::default();
    let ok = unsafe { AXValueGetValue(value, 2, &mut size as *mut AxSize as *mut c_void) };
    ok.then_some(size)
}

#[cfg(target_os = "macos")]
fn is_editable_ax_role(role: Option<&str>) -> bool {
    matches!(
        role,
        Some("AXTextField" | "AXTextArea" | "AXComboBox" | "AXSearchField")
    )
}

/// Read the focused editable field's text for insertion verification. Returns
/// `None` when the app exposes no editable AX value; callers must treat that
/// as "unverified", never as failure.
#[cfg(target_os = "macos")]
fn focused_text_value() -> Option<String> {
    let system = OwnedAxElement::new(unsafe { AXUIElementCreateSystemWide() })?;
    let focused = ax_copy_attribute(system.as_ref(), "AXFocusedUIElement")
        .and_then(|value| OwnedAxElement::new(value as AXUIElementRef))?;
    let role = ax_string_attribute(focused.as_ref(), "AXRole");
    if !is_editable_ax_role(role.as_deref()) {
        return None;
    }
    ax_string_attribute(focused.as_ref(), "AXValue")
}

#[cfg(not(target_os = "macos"))]
fn focused_text_value() -> Option<String> {
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
    if !is_widget_enabled(app) {
        return;
    }

    // Attach the active app context (frontmost app + window title) captured at
    // recording start so the widget can show what the user is doing right now.
    let (app_name, window_title) = match app.try_state::<RecorderState>() {
        Some(state) => {
            let session = state.session.lock().ok();
            match session.as_ref().and_then(|session| session.as_ref()) {
                Some(session) => (session.app_name.clone(), session.window_title.clone()),
                None => (None, None),
            }
        }
        None => (None, None),
    };

    if let Some(window) = app.get_webview_window("widget") {
        position_widget_bottom_right(&window);
        // Ensure the window is visible even if macOS hid it (e.g. after a focus change).
        // show_without_focusing keeps the previously-focused app in the foreground.
        let _ = window.show();
        // Order the panel front even over full-screen apps (orderFrontRegardless,
        // dispatched to the main thread).
        order_overlay_front(app, "widget");
        let _ = window.emit(
            "vox-widget-state",
            WidgetEvent {
                mode,
                message: message.to_string(),
                elapsed_seconds,
                show_enhance: false,
                show_undo: false,
                app_name,
                window_title,
            },
        );
        // Do NOT steal focus — we need the previous app to keep focus for paste
    }
}

/// Show the widget in a "done" state with Undo (and optionally Enhance)
/// actions. Unlike the transient done state, this stays visible until dismissed
/// or a new recording starts.
fn show_widget_done_with_actions(app: &AppHandle, message: &str, show_enhance: bool) {
    if !is_widget_enabled(app) {
        return;
    }
    if let Some(window) = app.get_webview_window("widget") {
        position_widget_bottom_right(&window);
        let _ = window.show();
        order_overlay_front(app, "widget");
        let _ = window.emit(
            "vox-widget-state",
            WidgetEvent {
                mode: "done",
                message: message.to_string(),
                elapsed_seconds: None,
                show_enhance,
                show_undo: true,
                app_name: None,
                window_title: None,
            },
        );
    }

    // Dismissal monitor: hide the widget when the user types, presses Enter,
    // moves focus, or after 10 seconds of inactivity.
    let baseline = focused_input_snapshot();
    let app_clone = app.clone();
    thread::spawn(move || {
        let start = Instant::now();
        loop {
            // A new recording replaces the widget; stop monitoring.
            let is_recording = app_clone
                .state::<RecorderState>()
                .session
                .lock()
                .map(|session| session.is_some())
                .unwrap_or(false);
            if is_recording {
                return;
            }

            // Auto-hide after 10 seconds if nothing was clicked.
            if start.elapsed() >= Duration::from_secs(10) {
                hide_widget_after_delay(app_clone.clone(), 0);
                return;
            }

            // Dismiss when the user interacts with the target app: the focused
            // input's text changed (typed / Enter) or focus moved elsewhere.
            let current = focused_input_snapshot();
            let changed = match (&baseline, &current) {
                (Some(before), Some(after)) => before.id != after.id || before.text != after.text,
                (Some(_), None) => true, // focus moved to a non-editable element
                (None, Some(_)) => true, // a field became focused
                (None, None) => false,   // still no editable field
            };
            if changed {
                hide_widget_after_delay(app_clone.clone(), 0);
                return;
            }

            thread::sleep(Duration::from_millis(300));
        }
    });
}

fn is_widget_enabled(app: &AppHandle) -> bool {
    app.try_state::<WidgetPreferencesState>()
        .and_then(|state| state.enabled.lock().ok().map(|enabled| *enabled))
        .unwrap_or(true)
}

/// NSPanel subclass used for the floating overlays (recording widget / enhance
/// icon). `can_become_key_window: false` keeps the panel from stealing focus
/// from the app being dictated into.
///
/// Wrapped in a module so the `tauri_panel!` macro's internal imports don't
/// clash with the crate-level `objc` imports.
#[cfg(target_os = "macos")]
mod overlay_panel {
    use tauri::Manager;

    tauri_nspanel::tauri_panel!(VoxOverlayPanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    });
}

/// Convert a floating overlay window (recording widget / enhance icon) to a
/// non-activating NSPanel so it stays above normal windows and remains visible
/// over full-screen apps and on every Space (macOS).
///
/// A plain NSWindow cannot be drawn over another app's full-screen Space —
/// the window must be an NSPanel (see tauri#9556 / #11488).
#[cfg(target_os = "macos")]
fn configure_floating_window(window: &WebviewWindow) {
    use tauri_nspanel::{CollectionBehavior, ManagerExt, StyleMask, WebviewWindowExt};

    let label = window.label().to_string();
    let app = window.app_handle();

    // Convert the window to an NSPanel once; later calls reuse the panel.
    let panel = match app.get_webview_panel(&label) {
        Ok(panel) => panel,
        Err(_) => match window.to_panel::<overlay_panel::VoxOverlayPanel>() {
            Ok(panel) => panel,
            Err(error) => {
                eprintln!("[vox] to_panel failed: {error:?}");
                return;
            }
        },
    };

    // Non-activating panel: never steals focus from the app being dictated into.
    panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());
    // Above normal windows (and the menu bar).
    panel.set_level(25);
    // Visible on every Space and over full-screen apps.
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .full_screen_auxiliary()
            .can_join_all_spaces()
            .into(),
    );
}

#[cfg(not(target_os = "macos"))]
fn configure_floating_window(_window: &WebviewWindow) {}

/// Order a floating overlay panel to the front even when the app is not active
/// and the frontmost app is in full screen (macOS).
///
/// `orderFrontRegardless` is an AppKit call, so it is dispatched to the main
/// thread (this function may be called from background threads).
#[cfg(target_os = "macos")]
fn order_overlay_front(app: &AppHandle, label: &str) {
    let app = app.clone();
    let label = label.to_string();
    let _ = app.clone().run_on_main_thread(move || {
        use tauri_nspanel::ManagerExt;
        if let Ok(panel) = app.get_webview_panel(&label) {
            panel.order_front_regardless();
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn order_overlay_front(_app: &AppHandle, _label: &str) {}

fn is_enhance_icon_enabled(app: &AppHandle) -> bool {
    app.try_state::<EnhancePreferencesState>()
        .and_then(|state| state.enabled.lock().ok().map(|enabled| *enabled))
        .unwrap_or(true)
}

fn is_selected_enhancement_model_available(app: &AppHandle) -> bool {
    app.try_state::<EnhancePreferencesState>()
        .and_then(|state| {
            state
                .model_available
                .lock()
                .ok()
                .map(|available| *available)
        })
        .unwrap_or(false)
}

fn refresh_selected_enhancement_model_availability(app: &AppHandle) {
    let Some(state) = app.try_state::<EnhancePreferencesState>() else {
        return;
    };
    let Ok(model_name) = state.model_name.lock().map(|name| name.clone()) else {
        return;
    };
    let available = text_enhancement_models_dir(app)
        .ok()
        .map(|models_dir| {
            text_enhancement::list_models(&models_dir)
                .iter()
                .any(|model| model.name == model_name && model.downloaded)
        })
        .unwrap_or(false);
    if let Ok(mut cached) = state.model_available.lock() {
        *cached = available;
    };
}

fn clear_focused_input_snapshot(app: &AppHandle) {
    if let Some(state) = app.try_state::<FocusedInputSnapshotState>() {
        if let Ok(mut latest) = state.latest.lock() {
            *latest = None;
        }
    }
}

fn hide_enhance_overlay(app: &AppHandle) {
    let was_presented = app
        .try_state::<FocusedInputSnapshotState>()
        .and_then(|state| {
            state.presented.lock().ok().map(|mut presented| {
                let was_presented = presented.is_some();
                *presented = None;
                was_presented
            })
        })
        .unwrap_or(true);
    if !was_presented {
        return;
    }

    if let Some(window) = app.get_webview_window("enhance") {
        let _ = window.emit(
            "vox-enhance-overlay",
            EnhanceOverlayEvent {
                visible: false,
                snapshot_id: None,
                x: -9999,
                y: -9999,
            },
        );
        let _ = window.set_position(Position::Physical(PhysicalPosition::new(-9999, -9999)));
        let _ = window.hide();
    }
}

fn show_enhance_overlay_state(app: &AppHandle, mode: &'static str, message: &str) {
    if let Some(window) = app.get_webview_window("enhance") {
        let _ = window.show();
        let _ = window.emit(
            "vox-enhance-state",
            EnhanceOverlayStateEvent {
                mode,
                message: message.to_string(),
            },
        );
    }
}

fn position_widget_bottom_right(window: &WebviewWindow) {
    let Ok(window_size) = window.outer_size() else {
        return;
    };
    position_widget_with_size(window, window_size.width as i32, window_size.height as i32);
}

fn position_widget_with_size(window: &WebviewWindow, window_width: i32, window_height: i32) {
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

    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let x = monitor_position.x + monitor_size.width as i32 - window_width - MARGIN;
    let y = monitor_position.y + monitor_size.height as i32 - window_height - MARGIN;

    let _ = window.set_position(Position::Physical(PhysicalPosition::new(x, y)));
}

/// Warn the user once a recording passes this length (seconds).
const LONG_RECORDING_WARN_SECS: u64 = 600; // 10 minutes
/// Hard cap: auto-stop and transcribe recordings longer than this (seconds) so
/// a forgotten session can't run forever or balloon transcription memory.
const MAX_RECORDING_SECS: u64 = 1800; // 30 minutes

/// Spawn a background thread that emits audio levels (50 ms) and ticks the
/// widget timer (once per second) while recording.
fn start_recording_timer(app: AppHandle) {
    thread::spawn(move || {
        let mut ticks: u64 = 0;
        let mut long_warned = false;
        let hands_free = app
            .try_state::<EventTapHandle>()
            .map(|handle| {
                let mode: TriggerMode = (*handle.state.mode.lock().unwrap()).into();
                mode == TriggerMode::HandsFree
            })
            .unwrap_or(false);
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
            if is_widget_enabled(&app) {
                if let Some(window) = app.get_webview_window("widget") {
                    let level = bars.iter().copied().fold(0.0, f32::max);
                    #[cfg(debug_assertions)]
                    if ticks % 20 == 0 {
                        eprintln!("[vox] audio bars max={level:.3} bars={bars:?}");
                    }
                    let _ = window.emit("vox-audio-level", AudioLevel { level });
                    let _ = window.emit("vox-audio-bars", AudioBars { bars });
                }
            }

            // Elapsed counter (every ~1 s)
            if ticks % 20 == 0 {
                let elapsed = ticks / 20;
                let private = recorder_state
                    .session
                    .lock()
                    .ok()
                    .and_then(|session| session.as_ref().map(|session| session.private))
                    .unwrap_or(false);
                let message = if elapsed >= LONG_RECORDING_WARN_SECS && !long_warned {
                    long_warned = true;
                    "Long recording — transcription may take a while"
                } else if private {
                    "Private · Listening…"
                } else if hands_free {
                    "Hands-free…"
                } else {
                    "Listening…"
                };
                show_widget_with_elapsed(&app, "recording", message, Some(elapsed));

                // Hard cap: auto-stop very long sessions so a forgotten
                // recording can't run forever.
                if elapsed >= MAX_RECORDING_SECS {
                    stop_and_transcribe(app.clone());
                    break;
                }
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
                    show_enhance: false,
                    show_undo: false,
                    app_name: None,
                    window_title: None,
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
                let _ =
                    window.set_position(Position::Physical(PhysicalPosition::new(-9999, -9999)));
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

fn text_enhancement_models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(text_enhancement::models_dir)
        .map_err(|error| error.to_string())
}

fn build_input_stream(
    device: &cpal::Device,
    config: &cpal::SupportedStreamConfig,
    writer: SharedWriter,
    audio_bars: Arc<Mutex<[f32; 7]>>,
    vad: Arc<VadState>,
    whisper_mode: Arc<AtomicBool>,
    bar_window: Arc<Mutex<Vec<f32>>>,
) -> Result<cpal::Stream, String> {
    let stream_config = config.clone().into();
    let on_error = |error| eprintln!("audio input stream error: {error}");

    match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let bars = Arc::clone(&audio_bars);
            let vad = Arc::clone(&vad);
            let whisper_mode = Arc::clone(&whisper_mode);
            let bar_window = Arc::clone(&bar_window);
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[f32], _| {
                        write_f32_samples(data, &writer, &whisper_mode);
                        update_audio_bars(
                            &bars,
                            compute_bar_levels_f32_windowed(&bar_window, data),
                        );
                        update_vad_f32(&vad, data);
                    },
                    on_error,
                    None,
                )
                .map_err(|error| error.to_string())
        }
        cpal::SampleFormat::I16 => {
            let bars = Arc::clone(&audio_bars);
            let vad = Arc::clone(&vad);
            let whisper_mode = Arc::clone(&whisper_mode);
            let bar_window = Arc::clone(&bar_window);
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[i16], _| {
                        write_i16_samples(data, &writer, &whisper_mode);
                        update_audio_bars(
                            &bars,
                            compute_bar_levels_i16_windowed(&bar_window, data),
                        );
                        update_vad_i16(&vad, data);
                    },
                    on_error,
                    None,
                )
                .map_err(|error| error.to_string())
        }
        cpal::SampleFormat::U16 => {
            let bars = Arc::clone(&audio_bars);
            let vad = Arc::clone(&vad);
            let whisper_mode = Arc::clone(&whisper_mode);
            let bar_window = Arc::clone(&bar_window);
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[u16], _| {
                        write_u16_samples(data, &writer, &whisper_mode);
                        update_audio_bars(
                            &bars,
                            compute_bar_levels_u16_windowed(&bar_window, data),
                        );
                        update_vad_u16(&vad, data);
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

/// Speech threshold for VAD, expressed as RMS of normalized samples.
/// Typical speech RMS is 0.02–0.1; quiet room noise is usually below 0.005.
const VAD_SPEECH_RMS: f32 = 0.008;

fn update_vad_f32(vad: &Arc<VadState>, samples: &[f32]) {
    update_vad(vad, rms_f32(samples));
}

fn update_vad_i16(vad: &Arc<VadState>, samples: &[i16]) {
    if samples.is_empty() {
        return;
    }
    let sum = samples
        .iter()
        .map(|sample| {
            let normalized = *sample as f32 / i16::MAX as f32;
            normalized * normalized
        })
        .sum::<f32>();
    update_vad(vad, (sum / samples.len() as f32).sqrt());
}

fn update_vad_u16(vad: &Arc<VadState>, samples: &[u16]) {
    if samples.is_empty() {
        return;
    }
    let sum = samples
        .iter()
        .map(|sample| {
            let normalized = (*sample as i32 - i16::MAX as i32 - 1) as f32 / i16::MAX as f32;
            normalized * normalized
        })
        .sum::<f32>();
    update_vad(vad, (sum / samples.len() as f32).sqrt());
}

fn rms_f32(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum = samples
        .iter()
        .map(|sample| {
            let normalized = sample.clamp(-1.0, 1.0);
            normalized * normalized
        })
        .sum::<f32>();
    (sum / samples.len() as f32).sqrt()
}

fn update_vad(vad: &Arc<VadState>, rms: f32) {
    if rms >= VAD_SPEECH_RMS {
        if let Ok(mut last_sound_at) = vad.last_sound_at.lock() {
            *last_sound_at = Instant::now();
        }
        vad.has_speech.store(true, Ordering::Relaxed);
    }
}

/// Whisper mode gain multiplier applied to recorded samples so quiet speech is
/// captured above the ASR noise floor.
const WHISPER_MODE_GAIN: f32 = 2.5;

fn write_f32_samples(samples: &[f32], writer: &SharedWriter, whisper_mode: &AtomicBool) {
    let boost = if whisper_mode.load(Ordering::Relaxed) {
        WHISPER_MODE_GAIN
    } else {
        1.0
    };
    if let Ok(mut writer) = writer.lock() {
        if let Some(writer) = writer.as_mut() {
            for sample in samples {
                let sample = (sample.clamp(-1.0, 1.0) * boost).clamp(-1.0, 1.0) * i16::MAX as f32;
                let _ = writer.write_sample(sample as i16);
            }
        }
    }
}

fn write_i16_samples(samples: &[i16], writer: &SharedWriter, whisper_mode: &AtomicBool) {
    let boost = if whisper_mode.load(Ordering::Relaxed) {
        WHISPER_MODE_GAIN
    } else {
        1.0
    };
    if let Ok(mut writer) = writer.lock() {
        if let Some(writer) = writer.as_mut() {
            for sample in samples {
                let sample = (*sample as f32 * boost).clamp(-32768.0, 32767.0) as i16;
                let _ = writer.write_sample(sample);
            }
        }
    }
}

fn write_u16_samples(samples: &[u16], writer: &SharedWriter, whisper_mode: &AtomicBool) {
    let boost = if whisper_mode.load(Ordering::Relaxed) {
        WHISPER_MODE_GAIN
    } else {
        1.0
    };
    if let Ok(mut writer) = writer.lock() {
        if let Some(writer) = writer.as_mut() {
            for sample in samples {
                let sample = ((*sample as i32 - i16::MAX as i32 - 1) as f32 * boost)
                    .clamp(-32768.0, 32767.0) as i16;
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

/// Rolling window length in samples (~200 ms at 48 kHz; longer at lower rates).
const BAR_WINDOW_SAMPLES: usize = 9600;

fn push_bar_window_f32(window: &Arc<Mutex<Vec<f32>>>, samples: &[f32]) {
    if let Ok(mut window) = window.lock() {
        window.extend_from_slice(samples);
        if window.len() > BAR_WINDOW_SAMPLES {
            let excess = window.len() - BAR_WINDOW_SAMPLES;
            window.drain(0..excess);
        }
    }
}

fn push_bar_window_i16(window: &Arc<Mutex<Vec<f32>>>, samples: &[i16]) {
    if let Ok(mut window) = window.lock() {
        window.extend(
            samples
                .iter()
                .map(|sample| *sample as f32 / i16::MAX as f32),
        );
        if window.len() > BAR_WINDOW_SAMPLES {
            let excess = window.len() - BAR_WINDOW_SAMPLES;
            window.drain(0..excess);
        }
    }
}

fn push_bar_window_u16(window: &Arc<Mutex<Vec<f32>>>, samples: &[u16]) {
    if let Ok(mut window) = window.lock() {
        window.extend(
            samples
                .iter()
                .map(|sample| (*sample as i32 - i16::MAX as i32 - 1) as f32 / i16::MAX as f32),
        );
        if window.len() > BAR_WINDOW_SAMPLES {
            let excess = window.len() - BAR_WINDOW_SAMPLES;
            window.drain(0..excess);
        }
    }
}

/// Compute the 7 bars from a rolling window of recent audio so the bars carry
/// real temporal variation from speech (syllables, consonants, pauses) instead
/// of near-identical values from a single short buffer.
fn compute_bar_levels_f32_windowed(window: &Arc<Mutex<Vec<f32>>>, samples: &[f32]) -> [f32; 7] {
    push_bar_window_f32(window, samples);
    let guard = window.lock().unwrap();
    compute_bar_levels(&guard, |sample| sample.clamp(-1.0, 1.0))
}

fn compute_bar_levels_i16_windowed(window: &Arc<Mutex<Vec<f32>>>, samples: &[i16]) -> [f32; 7] {
    push_bar_window_i16(window, samples);
    let guard = window.lock().unwrap();
    compute_bar_levels(&guard, |sample| sample.clamp(-1.0, 1.0))
}

fn compute_bar_levels_u16_windowed(window: &Arc<Mutex<Vec<f32>>>, samples: &[u16]) -> [f32; 7] {
    push_bar_window_u16(window, samples);
    let guard = window.lock().unwrap();
    compute_bar_levels(&guard, |sample| sample.clamp(-1.0, 1.0))
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
    fn wav_duration_matches_sample_count() {
        let dir = std::env::temp_dir();
        let path = dir.join("vox-duration-test.wav");
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&path, spec).unwrap();
        for _ in 0..32_000 {
            writer.write_sample(0i16).unwrap();
        }
        drop(writer);

        let duration = wav_duration_seconds(&path).unwrap();
        assert!((duration - 2.0).abs() < 0.01, "got {duration}");
        let _ = std::fs::remove_file(&path);
    }

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

    #[test]
    fn rejects_invalid_error_reporting_dsn() {
        assert!(parse_error_reporting_dsn("not-a-dsn").is_err());
        assert!(parse_error_reporting_dsn("ftp://key@example.com/1").is_err());
        assert!(parse_error_reporting_dsn("https://key@example.com/1").is_ok());
    }

    #[test]
    fn strips_sensitive_data_from_sentry_events() {
        let mut event = sentry::protocol::Event::default();
        event.message = Some("dictated private text".to_string());
        event.transaction = Some("/Users/person/private.wav".to_string());
        event.extra.insert(
            "transcript".to_string(),
            serde_json::Value::String("private".to_string()),
        );
        event.breadcrumbs.values.push(sentry::Breadcrumb {
            message: Some("private breadcrumb".to_string()),
            ..Default::default()
        });
        event.exception.values.push(sentry::protocol::Exception {
            ty: "TestError".to_string(),
            value: Some("private exception value".to_string()),
            stacktrace: Some(sentry::protocol::Stacktrace {
                frames: vec![sentry::protocol::Frame {
                    abs_path: Some("/Users/person/project/src/lib.rs".to_string()),
                    context_line: Some("private source context".to_string()),
                    vars: [(
                        "transcript".to_string(),
                        serde_json::Value::String("private".to_string()),
                    )]
                    .into_iter()
                    .collect(),
                    ..Default::default()
                }],
                ..Default::default()
            }),
            ..Default::default()
        });

        let sanitized = sanitize_sentry_event(event);
        let exception = &sanitized.exception[0];
        let frame = &exception.stacktrace.as_ref().unwrap().frames[0];

        assert!(sanitized.message.is_none());
        assert!(sanitized.transaction.is_none());
        assert!(sanitized.extra.is_empty());
        assert!(sanitized.breadcrumbs.is_empty());
        assert_eq!(exception.ty, "TestError");
        assert_eq!(exception.value.as_deref(), Some("[redacted]"));
        assert!(frame.abs_path.is_none());
        assert!(frame.context_line.is_none());
        assert!(frame.vars.is_empty());
    }

    #[test]
    fn formats_numbered_lists_from_ordinals() {
        let text = "first install dependencies second run the database migration third start the development server";
        assert_eq!(
            format_general_transcript(text),
            "• Install dependencies\n• Run the database migration\n• Start the development server"
        );
    }

    #[test]
    fn leaves_plain_prose_unchanged() {
        let text = "I wanted to ask if we can move the meeting to tomorrow";
        assert_eq!(format_general_transcript(text), text);
    }

    #[test]
    fn formats_bullet_lists_from_intent() {
        let text = "things I need milk and eggs and bread";
        assert_eq!(format_general_transcript(text), "• Milk\n• Eggs\n• Bread");
        let comma_text = "my list apples, bananas, oranges";
        assert_eq!(
            format_general_transcript(comma_text),
            "• Apples\n• Bananas\n• Oranges"
        );
    }

    #[test]
    fn formats_explicit_heading_command() {
        assert_eq!(
            format_general_transcript("title project requirements"),
            "## Project Requirements"
        );
    }

    #[test]
    fn formats_known_heading_phrase() {
        assert_eq!(
            format_general_transcript("meeting notes"),
            "## Meeting Notes"
        );
    }

    #[test]
    fn does_not_trigger_heading_on_prose() {
        let text = "I took meeting notes during the call";
        assert_eq!(format_general_transcript(text), text);
    }

    #[test]
    fn maps_email_apps_to_professional_style() {
        assert!(app_style_instruction(Some("Gmail"), None)
            .unwrap()
            .contains("professional email"));
        assert!(app_style_instruction(Some("Slack"), None)
            .unwrap()
            .contains("casual"));
        assert!(app_style_instruction(Some("Notion"), None)
            .unwrap()
            .contains("structured document"));
    }

    #[test]
    fn browser_gmail_is_not_developer_context() {
        assert!(!is_developer_app_context(
            Some("Google Chrome"),
            Some("Inbox - Gmail"),
            true
        ));
        assert!(is_developer_app_context(
            Some("Google Chrome"),
            Some("localhost:3000"),
            true
        ));
    }

    #[test]
    fn detects_english_only_models() {
        assert!(whisper::is_english_only_model("/models/ggml-base.en.bin"));
        assert!(whisper::is_english_only_model("ggml-small.en.bin"));
        assert!(!whisper::is_english_only_model("ggml-large-v3.bin"));
        assert!(!whisper::is_english_only_model(
            "parakeet-tdt-0.6b-v3-Q8_0.gguf"
        ));
    }

    #[test]
    fn fast_cleanup_removes_fillers() {
        assert_eq!(
            fast_cleanup("um so I wanted to uh ask you something"),
            "So I wanted to ask you something"
        );
    }

    #[test]
    fn fast_cleanup_collapses_self_corrections() {
        assert_eq!(
            fast_cleanup("Let's meet at 2 PM... actually 3 PM."),
            "Let's meet at 3 PM."
        );
        assert_eq!(
            fast_cleanup("Deploy it to production... wait, staging."),
            "Deploy it to staging."
        );
        assert_eq!(fast_cleanup("Monday... sorry, Tuesday."), "Tuesday.");
    }

    #[test]
    fn fast_cleanup_keeps_ordinary_actually() {
        assert_eq!(
            fast_cleanup("I actually think we should go"),
            "I actually think we should go"
        );
    }

    #[test]
    fn fast_cleanup_fixes_stutters() {
        assert_eq!(fast_cleanup("I I want to go now"), "I want to go now");
    }

    #[test]
    fn fast_cleanup_preserves_newlines() {
        assert_eq!(
            fast_cleanup("1. Um install dependencies\n2. Uh run migration"),
            "1. Install dependencies\n2. Run migration"
        );
    }

    #[test]
    fn fast_cleanup_removes_comma_fillers_only_between_commas() {
        assert_eq!(fast_cleanup("I was, like, going home"), "I was going home");
        assert_eq!(fast_cleanup("I like this idea"), "I like this idea");
    }

    #[test]
    fn removes_meta_commentary_sentences() {
        assert_eq!(
            remove_meta_commentary(
                "I am a software developer. There is lots of noise and some other text that should not be there. I work at hyphen.com."
            ),
            "I am a software developer. I work at hyphen.com."
        );
        assert_eq!(
            remove_meta_commentary(
                "I am a PSP developer. I want to write an essay about my life. I am currently working in the workshop."
            ),
            "I am a PSP developer. I am currently working in the workshop."
        );
    }

    #[test]
    fn keeps_ordinary_sentences() {
        assert_eq!(
            remove_meta_commentary("I am a software developer at hyphen.com."),
            "I am a software developer at hyphen.com."
        );
        assert_eq!(
            remove_meta_commentary("I am currently working in the workshop."),
            "I am currently working in the workshop."
        );
    }

    #[test]
    fn split_sentences_handles_punctuation() {
        assert_eq!(
            split_sentences("One. Two! Three? Four"),
            vec!["One.", "Two!", "Three?", "Four"]
        );
        assert_eq!(
            split_sentences("No punctuation here"),
            vec!["No punctuation here"]
        );
    }

    #[test]
    fn restores_punctuation_only_for_unpunctuated_single_lines() {
        assert_eq!(restore_punctuation("hello world"), "Hello world.");
        assert_eq!(restore_punctuation("42 is the answer"), "42 is the answer.");
        assert_eq!(restore_punctuation("Hello world."), "Hello world.");
        assert_eq!(restore_punctuation("what now?"), "what now?");
        assert_eq!(restore_punctuation("# heading"), "# heading");
        assert_eq!(restore_punctuation("- item"), "- item");
        assert_eq!(
            restore_punctuation("line one\nline two"),
            "line one\nline two"
        );
        assert_eq!(restore_punctuation(""), "");
    }

    #[test]
    fn ensure_trailing_space_after_final_punctuation() {
        assert_eq!(ensure_trailing_space("20.09.2026."), "20.09.2026. ");
        assert_eq!(ensure_trailing_space("Great!"), "Great! ");
        assert_eq!(
            ensure_trailing_space("He said \"stop.\""),
            "He said \"stop.\" "
        );
        assert_eq!(ensure_trailing_space("plain words"), "plain words");
        assert_eq!(
            ensure_trailing_space("already spaced. "),
            "already spaced. "
        );
        assert_eq!(ensure_trailing_space("1. one\n2. two"), "1. one\n2. two");
        assert_eq!(ensure_trailing_space(""), "");
    }

    #[test]
    fn detects_voice_commands() {
        assert!(matches!(
            detect_voice_command("make this professional"),
            Some(VoiceCommand::Transform(
                text_enhancement::TransformPreset::Professional
            ))
        ));
        assert!(matches!(
            detect_voice_command("summarize this"),
            Some(VoiceCommand::Transform(
                text_enhancement::TransformPreset::Summarize
            ))
        ));
        assert!(matches!(
            detect_voice_command("translate this to Hindi"),
            Some(VoiceCommand::Custom(_))
        ));
        assert!(matches!(
            detect_voice_command("turn this into bullet points"),
            Some(VoiceCommand::Custom(_))
        ));
    }

    #[test]
    fn does_not_detect_commands_in_long_dictation() {
        assert_eq!(
            detect_voice_command("I want to make this professional report look better for the client meeting tomorrow"),
            None
        );
        assert_eq!(
            detect_voice_command("The summary of this quarter is strong"),
            None
        );
    }

    #[test]
    fn expands_snippet_triggers() {
        let snippets = vec![
            Snippet {
                trigger: "my email".to_string(),
                expansion: "rajeshwar@example.com".to_string(),
                app_pattern: None,
            },
            Snippet {
                trigger: "my github".to_string(),
                expansion: "github.com/imrj05".to_string(),
                app_pattern: None,
            },
        ];
        assert_eq!(
            expand_snippets("Please send it to my email", &snippets, None),
            "Please send it to rajeshwar@example.com"
        );
        assert_eq!(
            expand_snippets("Check my github and my email", &snippets, None),
            "Check github.com/imrj05 and rajeshwar@example.com"
        );
    }

    #[test]
    fn snippet_app_scope_and_variables() {
        let snippets = vec![
            Snippet {
                trigger: "my signature".to_string(),
                expansion: "— {app} on {date}".to_string(),
                app_pattern: Some("Slack".to_string()),
            },
            Snippet {
                trigger: "meeting link".to_string(),
                expansion: "https://meet.example/{date}".to_string(),
                app_pattern: None,
            },
        ];
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();

        assert_eq!(
            expand_snippets("my signature", &snippets, Some("Slack")),
            format!("— Slack on {today}")
        );
        // App-scoped snippet stays inert in another app.
        assert_eq!(
            expand_snippets("my signature", &snippets, Some("Mail")),
            "my signature"
        );
        // Unscoped snippet applies everywhere and expands variables.
        assert_eq!(
            expand_snippets("send meeting link", &snippets, Some("Mail")),
            format!("send https://meet.example/{today}")
        );
        assert_eq!(
            expand_snippet_variables("keep {unknown} intact", None),
            "keep {unknown} intact"
        );
    }

    #[test]
    fn snippet_expansion_respects_word_boundaries() {
        let snippets = vec![Snippet {
            trigger: "my email".to_string(),
            expansion: "x@y.com".to_string(),
            app_pattern: None,
        }];
        // "my emailaddress" must not match "my email".
        assert_eq!(
            expand_snippets("my emailaddress is long", &snippets, None),
            "my emailaddress is long"
        );
        // Case-insensitive match.
        assert_eq!(
            expand_snippets("Send to MY EMAIL now", &snippets, None),
            "Send to x@y.com now"
        );
    }

    #[test]
    fn parses_macro_steps_and_blocks_quit_shortcuts() {
        let steps = parse_macro_steps("Hello{enter}{cmd+a}{wait:120}{tab}", None);
        assert_eq!(
            steps,
            vec![
                MacroStep::Text("Hello".to_string()),
                MacroStep::Key(MacroKey::Return),
                MacroStep::Combo(vec![MacroModifier::Cmd], MacroKey::Char('a')),
                MacroStep::Wait(120),
                MacroStep::Key(MacroKey::Tab),
            ]
        );
        assert!(is_macro_expansion("x{enter}"));
        assert!(!is_macro_expansion("{date} and {clipboard}"));
        assert_eq!(parse_macro_action("cmd+q"), None);
        // Variables inside text segments still expand.
        let steps = parse_macro_steps("sent to {app}{enter}", Some("Slack"));
        assert_eq!(
            steps,
            vec![
                MacroStep::Text("sent to Slack".to_string()),
                MacroStep::Key(MacroKey::Return),
            ]
        );
    }

    #[test]
    fn macro_requires_whole_utterance_and_app_scope() {
        let snippets = vec![Snippet {
            trigger: "deploy the app".to_string(),
            expansion: "{cmd+shift+p}{enter}".to_string(),
            app_pattern: Some("Visual Studio Code".to_string()),
        }];

        assert!(
            find_macro_for_utterance(&snippets, "Deploy the app.", Some("Visual Studio Code"))
                .is_some()
        );
        assert!(find_macro_for_utterance(
            &snippets,
            "please deploy the app",
            Some("Visual Studio Code")
        )
        .is_none());
        assert!(find_macro_for_utterance(&snippets, "deploy the app", Some("Mail")).is_none());
        // Macro triggers are not expanded as inline text.
        assert_eq!(
            expand_snippets(
                "please deploy the app now",
                &snippets,
                Some("Visual Studio Code")
            ),
            "please deploy the app now"
        );
    }

    #[test]
    fn extracts_current_file_from_editor_title() {
        assert_eq!(
            current_file_from_title(Some("user.service.ts — my-project — Visual Studio Code")),
            Some("user.service.ts".to_string())
        );
        assert_eq!(
            current_file_from_title(Some("README.md - docs - Cursor")),
            Some("README.md".to_string())
        );
        // Non-file titles (browser pages, plain windows) are ignored.
        assert_eq!(current_file_from_title(Some("Inbox - Gmail")), None);
        assert_eq!(current_file_from_title(None), None);
    }

    #[test]
    fn context_prompt_includes_current_file() {
        let prompt = build_context_prompt(
            Some("Cursor"),
            Some("user.service.ts — my-project — Cursor"),
        )
        .unwrap();
        assert!(prompt.contains("user.service.ts"));
        assert!(prompt.contains("working on the file"));
    }

    #[test]
    fn detects_custom_model_capability() {
        use custom_models::{detect_model_kind, CustomModelKind};
        // whisper.cpp GGML → STT
        assert_eq!(
            detect_model_kind(
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
            )
            .unwrap(),
            CustomModelKind::Stt
        );
        // Parakeet GGUF → STT
        assert_eq!(
            detect_model_kind("https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v3-gguf/resolve/main/parakeet-tdt-0.6b-v3-Q8_0.gguf").unwrap(),
            CustomModelKind::Stt
        );
        // LLM GGUF → Enhance
        assert_eq!(
            detect_model_kind("https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf").unwrap(),
            CustomModelKind::Enhance
        );
        // Ambiguous GGUF → error
        assert!(
            detect_model_kind("https://huggingface.co/foo/bar/resolve/main/mystery.gguf").is_err()
        );
        // Unsupported extension → error
        assert!(
            detect_model_kind("https://huggingface.co/foo/bar/resolve/main/model.safetensors")
                .is_err()
        );
    }
}
