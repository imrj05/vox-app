//! CGEventTap-based global hotkey listener for macOS.
//!
//! This replaces `tauri-plugin-global-shortcut` for key codes that the OS
//! hotkey API cannot register (bare Option, Globe/Fn, etc.).
//!
//! The tap runs on a dedicated thread with its own CFRunLoop.
//! When the configured hotkey fires the callback is invoked and the event is
//! suppressed so it doesn't reach other apps.

use std::{
    ffi::c_void,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use core_foundation::{
    base::TCFType,
    runloop::{kCFRunLoopCommonModes, CFRunLoop},
};
use core_graphics::event::{
    CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
    CGEventType, CGKeyCode, EventField, KeyCode,
};

// ── Accessibility ─────────────────────────────────────────────────────────────

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    static kAXTrustedCheckOptionPrompt: *const c_void;
}

/// Returns true if the app already has Accessibility / Input Monitoring permission.
pub fn is_accessibility_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

/// Opens the System Settings Accessibility pane with a prompt.
/// Returns the current trusted state (may still be false until user grants it).
pub fn request_accessibility_permission() -> bool {
    use core_foundation::{boolean::CFBoolean, dictionary::CFDictionary, string::CFString};

    let key = unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt as *const _) };
    let val = CFBoolean::true_value();
    let dict = CFDictionary::<CFString, CFBoolean>::from_CFType_pairs(&[(key, val)]);
    unsafe { AXIsProcessTrustedWithOptions(dict.as_concrete_TypeRef() as *const c_void) }
}

// ── Hotkey descriptor ─────────────────────────────────────────────────────────

/// A hotkey expressed as a virtual key code + required modifier flags.
#[derive(Clone, Debug, PartialEq)]
pub struct HotKey {
    /// macOS virtual key code (kVK_*).
    pub key_code: CGKeyCode,
    /// Modifier flags that must ALL be present (others are ignored).
    pub modifiers: CGEventFlags,
}

impl HotKey {
    pub fn new(key_code: CGKeyCode, modifiers: CGEventFlags) -> Self {
        Self {
            key_code,
            modifiers,
        }
    }
}

fn standalone_modifier_flag(key_code: CGKeyCode) -> Option<CGEventFlags> {
    match key_code {
        KeyCode::OPTION | KeyCode::RIGHT_OPTION => Some(CGEventFlags::CGEventFlagAlternate),
        KeyCode::FUNCTION => Some(CGEventFlags::CGEventFlagSecondaryFn),
        _ => None,
    }
}

/// Parse a shortcut string (same format as the rest of the app) into a `HotKey`.
///
/// Modifier tokens: Meta/Cmd/Super, Ctrl/Control, Alt/Option, Shift.
/// Key tokens: Space, Enter, Tab, Escape, Backspace/Delete,
///   KeyA-Z, Digit0-9, F1-F19,
///   AltLeft, AltRight, Globe/Fn/Lang1.
pub fn parse_hotkey(s: &str) -> Result<HotKey, String> {
    let parts: Vec<&str> = s.split('+').collect();
    let mut flags = CGEventFlags::empty();
    let mut key_code: Option<CGKeyCode> = None;
    let has_primary_key = parts.iter().any(|part| {
        !matches!(
            *part,
            "Meta"
                | "Super"
                | "Cmd"
                | "Ctrl"
                | "Control"
                | "Alt"
                | "Option"
                | "AltLeft"
                | "AltRight"
                | "Shift"
                | "Globe"
                | "Fn"
                | "Lang1"
        )
    });

    for part in &parts {
        match *part {
            "Meta" | "Super" | "Cmd" => flags |= CGEventFlags::CGEventFlagCommand,
            "Ctrl" | "Control" => flags |= CGEventFlags::CGEventFlagControl,
            "Alt" | "Option" => flags |= CGEventFlags::CGEventFlagAlternate,
            "AltLeft" | "AltRight" if has_primary_key => {
                flags |= CGEventFlags::CGEventFlagAlternate
            }
            "Globe" | "Fn" | "Lang1" if has_primary_key => {
                flags |= CGEventFlags::CGEventFlagSecondaryFn
            }
            "Shift" => flags |= CGEventFlags::CGEventFlagShift,
            key => {
                key_code = Some(match key {
                    // Standalone Option keys and Globe/Fn
                    "AltLeft" => KeyCode::OPTION,
                    "AltRight" => KeyCode::RIGHT_OPTION,
                    "Globe" | "Fn" | "Lang1" => KeyCode::FUNCTION,
                    // Common keys
                    "Space" => KeyCode::SPACE,
                    "Enter" => KeyCode::RETURN,
                    "Tab" => KeyCode::TAB,
                    "Escape" => KeyCode::ESCAPE,
                    "Backspace" | "Delete" => KeyCode::DELETE,
                    // Letters — macOS virtual key codes (ANSI layout)
                    "KeyA" | "A" => 0x00,
                    "KeyS" | "S" => 0x01,
                    "KeyD" | "D" => 0x02,
                    "KeyF" | "F" => 0x03,
                    "KeyH" | "H" => 0x04,
                    "KeyG" | "G" => 0x05,
                    "KeyZ" | "Z" => 0x06,
                    "KeyX" | "X" => 0x07,
                    "KeyC" | "C" => 0x08,
                    "KeyV" | "V" => 0x09,
                    "KeyB" | "B" => 0x0B,
                    "KeyQ" | "Q" => 0x0C,
                    "KeyW" | "W" => 0x0D,
                    "KeyE" | "E" => 0x0E,
                    "KeyR" | "R" => 0x0F,
                    "KeyY" | "Y" => 0x10,
                    "KeyT" | "T" => 0x11,
                    "KeyO" | "O" => 0x1F,
                    "KeyU" | "U" => 0x20,
                    "KeyI" | "I" => 0x22,
                    "KeyP" | "P" => 0x23,
                    "KeyL" | "L" => 0x25,
                    "KeyJ" | "J" => 0x26,
                    "KeyK" | "K" => 0x28,
                    "KeyN" | "N" => 0x2D,
                    "KeyM" | "M" => 0x2E,
                    // Digits
                    "Digit0" | "0" => 0x1D,
                    "Digit1" | "1" => 0x12,
                    "Digit2" | "2" => 0x13,
                    "Digit3" | "3" => 0x14,
                    "Digit4" | "4" => 0x15,
                    "Digit5" | "5" => 0x17,
                    "Digit6" | "6" => 0x16,
                    "Digit7" | "7" => 0x1A,
                    "Digit8" | "8" => 0x1C,
                    "Digit9" | "9" => 0x19,
                    // Function keys
                    "F1" => KeyCode::F1,
                    "F2" => KeyCode::F2,
                    "F3" => KeyCode::F3,
                    "F4" => KeyCode::F4,
                    "F5" => KeyCode::F5,
                    "F6" => KeyCode::F6,
                    "F7" => KeyCode::F7,
                    "F8" => KeyCode::F8,
                    "F9" => KeyCode::F9,
                    "F10" => KeyCode::F10,
                    "F11" => KeyCode::F11,
                    "F12" => KeyCode::F12,
                    "F13" => KeyCode::F13,
                    "F14" => KeyCode::F14,
                    "F15" => KeyCode::F15,
                    "F16" => KeyCode::F16,
                    "F17" => KeyCode::F17,
                    "F18" => KeyCode::F18,
                    "F19" => KeyCode::F19,
                    other => return Err(format!("Unknown key: '{other}'")),
                });
            }
        }
    }

    let key_code = key_code.ok_or_else(|| format!("No key found in shortcut '{s}'"))?;
    Ok(HotKey::new(key_code, flags))
}

// ── Tap lifecycle ─────────────────────────────────────────────────────────────

/// How the hotkey triggers recording.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TriggerMode {
    /// Press once to start, press again to stop.
    Toggle,
    /// Hold to record, release to stop and transcribe.
    PushToTalk,
}

/// Shared mutable hotkey — updated atomically when the user changes the binding.
pub struct TapState {
    pub hotkey: Mutex<HotKey>,
    pub mode: Mutex<TriggerMode>,
    pub pressed: Mutex<bool>,
    pub run_loop: Mutex<Option<CFRunLoop>>,
    pub is_active: Mutex<bool>,
    pub last_error: Mutex<Option<String>>,
}

// CFRunLoop is not Send by default; we only touch it from the tap thread.
unsafe impl Send for TapState {}
unsafe impl Sync for TapState {}

/// Start the CGEventTap on a background thread.
///
/// Returns an `Arc<TapState>` you can use to update the hotkey at runtime via
/// `state.hotkey.lock().unwrap() = new_hotkey`.
pub fn start(
    initial_hotkey: HotKey,
    initial_mode: TriggerMode,
    on_press: impl Fn() + Send + Sync + 'static,
    on_release: impl Fn() + Send + Sync + 'static,
) -> Arc<TapState> {
    let state = Arc::new(TapState {
        hotkey: Mutex::new(initial_hotkey),
        mode: Mutex::new(initial_mode),
        pressed: Mutex::new(false),
        run_loop: Mutex::new(None),
        is_active: Mutex::new(false),
        last_error: Mutex::new(None),
    });

    let state_clone = Arc::clone(&state);
    let press_cb = Arc::new(on_press);
    let release_cb = Arc::new(on_release);
    thread::spawn(move || run_tap_thread(state_clone, press_cb, release_cb));

    state
}

fn run_tap_thread(
    state: Arc<TapState>,
    on_press: Arc<dyn Fn() + Send + Sync + 'static>,
    on_release: Arc<dyn Fn() + Send + Sync + 'static>,
) {
    // Store the run loop so callers can stop/restart it
    let current_rl = CFRunLoop::get_current();
    *state.run_loop.lock().unwrap() = Some(current_rl.clone());

    loop {
        if !is_accessibility_trusted() {
            *state.is_active.lock().unwrap() = false;
            *state.last_error.lock().unwrap() =
                Some("Accessibility permission is required for Event tap shortcuts.".to_string());
            thread::sleep(Duration::from_secs(2));
            continue;
        }

        let state_ref = Arc::clone(&state);
        let press_ref = Arc::clone(&on_press);
        let release_ref = Arc::clone(&on_release);

        let tap = CGEventTap::new(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::Default,
            vec![
                CGEventType::KeyDown,
                CGEventType::KeyUp,
                CGEventType::FlagsChanged,
            ],
            move |_proxy, event_type, event| {
                let key =
                    event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE) as CGKeyCode;

                let hotkey = state_ref.hotkey.lock().unwrap().clone();
                let mode = *state_ref.mode.lock().unwrap();
                let flags = event.get_flags();
                let standalone_modifier = hotkey.modifiers.is_empty()
                    && standalone_modifier_flag(hotkey.key_code).is_some();
                let standalone_modifier_down = standalone_modifier_flag(hotkey.key_code)
                    .map(|flag| flags.contains(flag))
                    .unwrap_or(false);

                // Mask to the modifier bits we support in shortcut strings.
                let required = hotkey.modifiers;
                let actual = flags
                    & (CGEventFlags::CGEventFlagCommand
                        | CGEventFlags::CGEventFlagControl
                        | CGEventFlags::CGEventFlagAlternate
                        | CGEventFlags::CGEventFlagShift
                        | CGEventFlags::CGEventFlagSecondaryFn);

                match event_type {
                    CGEventType::KeyDown if key == hotkey.key_code && actual == required => {
                        let mut pressed = state_ref.pressed.lock().unwrap();
                        if !*pressed {
                            *pressed = true;
                            press_ref();
                        }
                        return None; // suppress
                    }
                    CGEventType::FlagsChanged
                        if standalone_modifier
                            && key == hotkey.key_code
                            && standalone_modifier_down =>
                    {
                        let mut pressed = state_ref.pressed.lock().unwrap();
                        if !*pressed {
                            *pressed = true;
                            press_ref();
                        }
                        return None; // suppress
                    }
                    CGEventType::KeyUp if key == hotkey.key_code => {
                        let mut pressed = state_ref.pressed.lock().unwrap();
                        if *pressed {
                            *pressed = false;
                            if mode == TriggerMode::PushToTalk {
                                release_ref();
                            }
                            return None; // suppress
                        }
                    }
                    CGEventType::FlagsChanged
                        if standalone_modifier
                            && key == hotkey.key_code
                            && !standalone_modifier_down =>
                    {
                        let mut pressed = state_ref.pressed.lock().unwrap();
                        if *pressed {
                            *pressed = false;
                            if mode == TriggerMode::PushToTalk {
                                release_ref();
                            }
                            return None; // suppress
                        }
                    }
                    _ => {}
                }

                Some(event.clone())
            },
        );

        match tap {
            Ok(tap) => {
                *state.last_error.lock().unwrap() = None;
                *state.is_active.lock().unwrap() = true;
                tap.enable();
                match tap.mach_port.create_runloop_source(0) {
                    Ok(source) => {
                        current_rl.add_source(&source, unsafe { kCFRunLoopCommonModes });
                        CFRunLoop::run_current();
                    }
                    Err(()) => {
                        *state.last_error.lock().unwrap() =
                            Some("Failed to create the CGEventTap run loop source".to_string());
                        eprintln!("[vox] Failed to create CGEventTap run loop source");
                    }
                }
            }
            Err(()) => {
                *state.last_error.lock().unwrap() = Some(
                    "CGEventTap could not start. Accessibility permission may be missing."
                        .to_string(),
                );
                eprintln!("[vox] CGEventTap::new failed — Accessibility permission not granted?");
            }
        }

        *state.is_active.lock().unwrap() = false;
        thread::sleep(Duration::from_secs(2));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_option_combo_as_modifier_plus_key() {
        let hotkey = parse_hotkey("AltLeft+KeyC").unwrap();

        assert_eq!(hotkey.key_code, 0x08);
        assert!(hotkey
            .modifiers
            .contains(CGEventFlags::CGEventFlagAlternate));
    }

    #[test]
    fn parses_standalone_option_as_key() {
        let hotkey = parse_hotkey("AltLeft").unwrap();

        assert_eq!(hotkey.key_code, KeyCode::OPTION);
        assert!(hotkey.modifiers.is_empty());
    }
}
