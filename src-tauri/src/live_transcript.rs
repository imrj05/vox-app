//! Live dictation preview — streams partial transcripts to the widget while
//! the user is still speaking.
//!
//! Drives the Apple Speech sidecar in its `--live` mode: the sidecar taps the
//! microphone itself (macOS allows simultaneous capture; Vox's cpal recording
//! is unaffected) and emits partial results as JSON lines on stdout, which are
//! relayed to the widget as `vox-live-transcript` events.
//!
//! This is strictly best-effort preview: the final transcript always comes
//! from the user's selected engine over the recorded file. Any failure here
//! (missing sidecar, permission not granted, engine error) is silently ignored
//! so recording is never affected.

#![cfg(target_os = "macos")]

use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Mutex, OnceLock},
};

use tauri::{AppHandle, Emitter};

use crate::engines::apple_speech::locale_code;

struct LiveSession {
    child: Child,
    stdin: ChildStdin,
}

fn live_session_cell() -> &'static Mutex<Option<LiveSession>> {
    static LIVE_SESSION: OnceLock<Mutex<Option<LiveSession>>> = OnceLock::new();
    LIVE_SESSION.get_or_init(|| Mutex::new(None))
}

fn permission_cache() -> &'static Mutex<Option<bool>> {
    static PERMISSION: OnceLock<Mutex<Option<bool>>> = OnceLock::new();
    PERMISSION.get_or_init(|| Mutex::new(None))
}

/// Whether Speech Recognition permission is already granted. Probed once per
/// app run with a flag that never triggers a TCC prompt — an ungranted state
/// simply disables the preview rather than interrupting dictation with a
/// dialog.
fn speech_permission_granted() -> bool {
    let mut cache = permission_cache().lock().unwrap_or_else(|p| p.into_inner());
    if let Some(granted) = *cache {
        return granted;
    }

    let granted = (|| -> Option<bool> {
        let sidecar = crate::engines::find_sidecar("apple-speech").ok()?;
        let output = Command::new(&sidecar)
            .arg("--check-permission")
            .output()
            .ok()?;
        Some(String::from_utf8_lossy(&output.stdout).contains("granted"))
    })()
    .unwrap_or(false);
    *cache = Some(granted);
    eprintln!("[VOX][live] speech permission granted: {granted}");
    granted
}

/// Start the live preview sidecar for a new recording. Failures are logged
/// and otherwise ignored — recording never depends on the preview.
pub fn start(app: &AppHandle, language: &str) {
    let _ = start_inner(app, language);
}

fn start_inner(app: &AppHandle, language: &str) -> Result<(), String> {
    if !speech_permission_granted() {
        return Err("Speech recognition permission not granted".to_string());
    }

    let mut session = live_session_cell()
        .lock()
        .map_err(|_| "Live transcript session state unavailable".to_string())?;
    if session.is_some() {
        // A previous session may have leaked (e.g. after an unclean stop);
        // drop it before starting fresh.
        if let Some(mut old) = session.take() {
            let _ = old.child.kill();
            let _ = old.child.wait();
        }
    }

    let sidecar = crate::engines::find_sidecar("apple-speech")?;
    let mut child = Command::new(&sidecar)
        .arg("--live")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Failed to start live preview sidecar: {error}"))?;

    // Take the pipes and send the start request. If anything fails here the
    // just-spawned sidecar must be reaped — otherwise it leaks and keeps
    // tapping the microphone.
    let pipes = (|| -> Result<(std::process::ChildStdin, std::process::ChildStdout), String> {
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Live preview sidecar stdin unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Live preview sidecar stdout unavailable".to_string())?;
        Ok((stdin, stdout))
    })();
    let (mut stdin, stdout) = match pipes {
        Ok(pipes) => pipes,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };

    let locale = locale_code(Some(language)).unwrap_or_else(|| "en-US".to_string());
    let start_request = serde_json::json!({ "type": "start", "locale": locale });
    if let Err(error) = stdin
        .write_all(start_request.to_string().as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
    {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!("Live preview sidecar refused start: {error}"));
    }

    // Reader thread: partials arrive continuously while the user speaks.
    let emitter = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let Ok(payload) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
                continue; // diagnostics or garbage — skip
            };
            match payload.get("type").and_then(serde_json::Value::as_str) {
                Some("partial") | Some("final") => {
                    let text = payload
                        .get("text")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    let is_final =
                        payload.get("type").and_then(serde_json::Value::as_str) == Some("final");
                    let _ = emitter.emit(
                        "vox-live-transcript",
                        serde_json::json!({ "text": text, "isFinal": is_final }),
                    );
                }
                Some("error") => {
                    let message = payload
                        .get("message")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("unknown");
                    eprintln!("[VOX][live] preview error: {message}");
                }
                _ => {}
            }
        }
        // Sidecar exited (stdin dropped or crash) — nothing to do; the
        // recording pipeline is independent.
    });

    *session = Some(LiveSession { child, stdin });
    Ok(())
}

/// Stop the live preview. Called when recording ends; the preview is preview
/// only, so the sidecar is told to stop and reaped without waiting long.
pub fn stop() {
    let session = live_session_cell()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();

    if let Some(session) = session {
        let LiveSession {
            mut stdin,
            mut child,
        } = session;

        // Tell the sidecar to stop gracefully; drop stdin afterwards so the
        // process exits even if it misses the message.
        let _ = writeln!(stdin, "{{\"type\":\"stop\"}}");
        let _ = stdin.flush();
        drop(stdin);

        // Reap on a background thread: the grace-period wait (up to 800 ms)
        // must never block recording teardown on the caller.
        std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + std::time::Duration::from_millis(800);
            while child
                .try_wait()
                .map(|status| status.is_none())
                .unwrap_or(false)
                && std::time::Instant::now() < deadline
            {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            if child
                .try_wait()
                .map(|status| status.is_none())
                .unwrap_or(false)
            {
                let _ = child.kill();
                let _ = child.wait();
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_without_session_is_safe() {
        stop();
        stop();
    }
}
