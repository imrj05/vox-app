//! Live dictation preview — streams partial transcripts to the widget while
//! the user is still speaking.
//!
//! Drives the Apple Speech sidecar in its `--live` mode: the sidecar taps the
//! microphone itself (macOS allows simultaneous capture; Vox's cpal recording
//! is unaffected) and emits partial results as JSON lines on stdout, which are
//! relayed to the widget as `vox-live-transcript` events.
//!
//! This is best-effort preview/final support: when Apple Speech is selected,
//! a final live result may be reused instead of recognizing the recorded file
//! again. Any failure here (missing sidecar, permission not granted, engine
//! error) falls back to the normal file-based transcription path.

#![cfg(target_os = "macos")]

use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Condvar, Mutex, OnceLock},
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter};

use crate::engines::apple_speech::locale_code;

#[derive(Default)]
struct LiveResultState {
    final_text: Option<String>,
    final_confidence: Option<f32>,
    finished: bool,
}

struct LiveResult {
    state: Mutex<LiveResultState>,
    ready: Condvar,
}

struct LiveSession {
    child: Child,
    stdin: ChildStdin,
    result: Arc<LiveResult>,
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

    let result = Arc::new(LiveResult {
        state: Mutex::new(LiveResultState::default()),
        ready: Condvar::new(),
    });

    // Reader thread: partials arrive continuously while the user speaks. The
    // final result is retained so a selected Apple Speech transcription can
    // reuse it instead of recognizing the same recording a second time.
    let emitter = app.clone();
    let result_for_reader = Arc::clone(&result);
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
                    if is_final && !text.is_empty() {
                        if let Ok(mut state) = result_for_reader.state.lock() {
                            state.final_text = Some(text.clone());
                            state.final_confidence = payload
                                .get("confidence")
                                .and_then(serde_json::Value::as_f64)
                                .map(|value| (value as f32).clamp(0.0, 1.0))
                                .filter(|value| *value > 0.0);
                            result_for_reader.ready.notify_all();
                        }
                    }
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
        if let Ok(mut state) = result_for_reader.state.lock() {
            state.finished = true;
            result_for_reader.ready.notify_all();
        }
        // Sidecar exited (stdin dropped or crash) — the recording pipeline
        // will fall back to file recognition if no final result was received.
    });

    *session = Some(LiveSession {
        child,
        stdin,
        result,
    });
    Ok(())
}

/// Stop the live preview and return its final result when one arrived before
/// the short grace period. A missing result is normal and tells the caller to
/// use the recorded-file fallback.
pub fn stop() -> Option<(String, Option<f32>)> {
    let session = live_session_cell()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();

    let Some(LiveSession {
        mut stdin,
        mut child,
        result,
    }) = session
    else {
        return None;
    };

    // Tell the sidecar to stop gracefully. The Swift sidecar emits its final
    // result asynchronously after this request.
    let _ = writeln!(stdin, "{{\"type\":\"stop\"}}");
    let _ = stdin.flush();

    let deadline = Instant::now() + Duration::from_millis(600);
    let final_result = {
        let mut state = result
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while state.final_text.is_none() && !state.finished {
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                break;
            };
            let (next_state, timed_out) = result
                .ready
                .wait_timeout(state, remaining)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state = next_state;
            if timed_out.timed_out() {
                break;
            }
        }
        state
            .final_text
            .take()
            .map(|text| (text, state.final_confidence.take()))
    };
    drop(stdin);

    // Reap on a background thread. The sidecar deliberately has a longer
    // shutdown grace period so its final callback can arrive without keeping
    // the transcription command blocked after the result was captured.
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_millis(800);
        while child
            .try_wait()
            .map(|status| status.is_none())
            .unwrap_or(false)
            && Instant::now() < deadline
        {
            std::thread::sleep(Duration::from_millis(50));
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

    final_result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_without_session_is_safe() {
        assert!(stop().is_none());
        assert!(stop().is_none());
    }
}
