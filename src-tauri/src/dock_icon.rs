//! Theme-adaptive Dock icon.
//!
//! The static bundle icon (`.icns`) cannot switch with the system
//! appearance, so the running app swaps the Dock icon itself:
//! dark theme → the dark logo tile, light theme → the light logo tile.
//! Both variants are embedded at compile time and applied through
//! `NSApplication.setApplicationIconImage` on the main thread.

#![cfg(target_os = "macos")]

use objc2::AnyThread;
use objc2_app_kit::{NSApplication, NSImage};
use objc2_foundation::{MainThreadMarker, NSData};

const LOGO_DARK: &[u8] = include_bytes!("../icons/logo-dark.png");
const LOGO_LIGHT: &[u8] = include_bytes!("../icons/logo-light.png");

pub fn apply(app: &tauri::AppHandle, theme: &str) {
    let dark = theme.trim().eq_ignore_ascii_case("dark");
    let bytes = if dark { LOGO_DARK } else { LOGO_LIGHT };

    let handle = app.clone();
    // AppKit calls must run on the main thread.
    if let Err(error) = handle.run_on_main_thread(move || {
        if let Err(error) = apply_on_main_thread(bytes) {
            eprintln!("[vox] dock icon update failed: {error}");
        }
    }) {
        eprintln!("[vox] dock icon dispatch failed: {error}");
    }
}

/// Must run on the main thread.
fn apply_on_main_thread(png: &[u8]) -> Result<(), String> {
    let Some(mtm) = MainThreadMarker::new() else {
        return Err("not on the main thread".to_string());
    };

    unsafe {
        let data =
            NSData::dataWithBytes_length(png.as_ptr() as *const core::ffi::c_void, png.len());
        let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) else {
            return Err("embedded logo data could not be decoded".to_string());
        };
        NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&image));
    }

    Ok(())
}
