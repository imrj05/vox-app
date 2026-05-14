# Vox Roadmap

Issues and improvements identified from codebase analysis.

---

## High Priority

### 1. Download cancellation
`reqwest::blocking::get` inside `spawn_blocking` has no cancellation path. If the user navigates away mid-download, the thread runs to completion — wasting bandwidth and writing a partial `.bin` file with no way to stop it.

**Fix:** Hold an `AbortHandle` or use a shared `AtomicBool` cancel flag. Check it in the read loop and early-exit, then delete the `.download` temp file.

---

### 2. Transcription blocks the UI
`transcribeRecording()` is called directly from a React event handler with `await`. Whisper on a large file can take 30+ seconds — the UI freezes with no cancel button and no progress feedback. The Rust command is also synchronous, tying up a Tauri command thread for the full duration.

**Fix:** Emit incremental `vox-transcription-progress` events from Rust (whisper.cpp exposes a progress callback). Show a cancel button that sets a shared flag the Rust side checks.

---

### 3. `reqwest::blocking` inside `spawn_blocking` is an anti-pattern
`reqwest` explicitly warns against using its blocking client inside `spawn_blocking` because it can deadlock under a small threadpool. The current `async` wrapper is a band-aid.

**Fix:** Switch `download_model` to use `reqwest`'s async client directly and make the Tauri command fully `async` without `spawn_blocking`.

---

## Medium Priority

### 4. Audio loaded fully into memory
`read_wav_as_16khz_mono` loads the entire WAV as a `Vec<f32>` before passing it to whisper. For long recordings this can be hundreds of MB.

**Fix:** Stream audio in chunks or memory-map the file. Whisper.cpp supports processing audio in segments.

---

### 5. Onboarding model list diverges from Rust
`ONBOARDING_MODELS` in `onboarding.tsx` is hardcoded in the frontend. If a model is added or removed from the `MODELS` array in `whisper.rs`, the onboarding picker silently goes out of sync.

**Fix:** Replace the hardcoded array with a call to `listWhisperModels()` on step mount, same as the Models page does.

---

### 6. No transcript pagination
`getTranscripts()` returns every row from SQLite with no limit. After heavy use the home page will query and render hundreds or thousands of transcript rows.

**Fix:** Add `LIMIT` + `OFFSET` to the SQL query and implement virtual scrolling or a "load more" button in the UI.

---

## Low Priority

### 7. Widget `localStorage` race on first launch
The widget reads `soundEnabled` from `localStorage`. On first launch, before onboarding completes, the main window hasn't written it yet — the widget gets `null` and may behave unexpectedly.

**Fix:** Default to `true` when `localStorage.getItem(SOUND_ENABLED_KEY)` returns `null`, or write the default during app init before the widget window opens.
