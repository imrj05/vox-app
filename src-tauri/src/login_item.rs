//! Login item registration — "Start at login" support.
//!
//! On macOS 13+ the app registers **itself** as a login item via
//! `SMAppService.mainAppService`, so System Settings → Login Items shows the
//! app's own name ("Vox") under "Open at Login". The previous mechanism — a
//! legacy LaunchAgent plist written by tauri-plugin-autostart — got grouped
//! under the code-signing team name in System Settings, which read as
//! "some other app is starting at login".
//!
//! Falls back to the autostart plugin's LaunchAgent below macOS 13, and
//! migrates existing legacy registrations to SMAppService on startup.

#![cfg(target_os = "macos")]

use std::{path::PathBuf, process::Command};

use objc2_foundation::NSProcessInfo;
use objc2_service_management::{SMAppService, SMAppServiceStatus};
use tauri::Manager;

/// Label of the legacy LaunchAgent plist written by tauri-plugin-autostart.
const LEGACY_AGENT_LABEL: &str = "Vox";

fn macos_major_version() -> isize {
    NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
}

/// SMAppService ships with macOS 13 (Ventura). Below that, the legacy
/// LaunchAgent path is used.
fn sm_app_service_available() -> bool {
    macos_major_version() >= 13
}

/// The app's own SMAppService login item ("Open at Login").
fn main_app_service() -> objc2::rc::Retained<SMAppService> {
    unsafe { SMAppService::mainAppService() }
}

/// Path of the legacy LaunchAgent plist, if present.
fn legacy_agent_plist() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let path = PathBuf::from(home)
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{LEGACY_AGENT_LABEL}.plist"));
    path.is_file().then_some(path)
}

/// Unload and delete the legacy LaunchAgent, if any. Errors are ignored on
/// purpose — the file's absence is the goal, and launchctl fails benignly
/// when the label was never loaded.
fn remove_legacy_agent() {
    let _ = Command::new("launchctl")
        .args(["remove", LEGACY_AGENT_LABEL])
        .output();
    if let Some(path) = legacy_agent_plist() {
        eprintln!("[vox] removed legacy LaunchAgent {}", path.display());
        let _ = std::fs::remove_file(path);
    }
}

/// Whether "Start at login" is currently active. Reports `true` while a
/// legacy registration still exists so the settings toggle never lies.
pub fn is_enabled(app: &tauri::AppHandle) -> Result<bool, String> {
    if sm_app_service_available() {
        let sm_enabled = unsafe { main_app_service().status() } == SMAppServiceStatus::Enabled;
        Ok(sm_enabled || legacy_agent_plist().is_some())
    } else {
        let manager = app
            .try_state::<tauri_plugin_autostart::AutoLaunchManager>()
            .ok_or_else(|| "Autostart service is unavailable".to_string())?;
        manager.is_enabled().map_err(|error| error.to_string())
    }
}

/// Enable or disable "Start at login".
pub fn set_enabled(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if sm_app_service_available() {
        let service = main_app_service();
        let result = unsafe {
            if enabled {
                service.registerAndReturnError()
            } else {
                service.unregisterAndReturnError()
            }
        };
        result.map_err(|error| format!("Login item registration failed: {error}"))?;
        if enabled {
            // Switched over successfully — retire the legacy LaunchAgent so
            // the app starts exactly once at login.
            remove_legacy_agent();
        }
        Ok(())
    } else {
        // Below macOS 13: delegate to the autostart plugin's LaunchAgent.
        let manager = app
            .try_state::<tauri_plugin_autostart::AutoLaunchManager>()
            .ok_or_else(|| "Autostart service is unavailable".to_string())?;
        if enabled {
            manager.enable().map_err(|error| error.to_string())
        } else {
            manager.disable().map_err(|error| error.to_string())
        }
    }
}

/// One-time migration at app startup: users who enabled the old LaunchAgent
/// keep autostart, switched to SMAppService. Runs before the settings UI
/// reads the state.
pub fn migrate_legacy_agent() {
    if !sm_app_service_available() {
        return;
    }
    if legacy_agent_plist().is_none() {
        return;
    }

    // Preserve the user's intent: register via SMAppService first; only
    // retire the legacy plist when that succeeds.
    let service = main_app_service();
    let result = unsafe { service.registerAndReturnError() };
    match result {
        Ok(()) => {
            remove_legacy_agent();
            eprintln!("[vox] migrated login item from legacy LaunchAgent to SMAppService");
        }
        Err(error) => {
            eprintln!(
                "[vox] login item migration deferred (SMAppService register failed: {error}); legacy LaunchAgent kept"
            );
        }
    }
}
