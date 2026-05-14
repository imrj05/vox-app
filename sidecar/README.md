# Vox Sidecar — Native Engine (Planned)

This directory will contain the native macOS sidecar that powers the Vox desktop
application's core capabilities:

- **Audio Capture** — System-level audio and microphone capture via CoreAudio
- **Whisper Inference** — Local speech-to-text using whisper.cpp, compiled for Apple Silicon
- **Metal Acceleration** — GPU-accelerated model inference via Core ML / Metal
- **System Tray** — macOS menu bar integration for quick recording controls
- **Global Hotkeys** — System-wide keyboard shortcuts via Carbon/CGEvent

## Planned Structure

```
sidecar/
├── Cargo.toml           # Rust crate for the sidecar binary
├── src/
│   ├── main.rs          # Entry point, CLI argument parsing
│   ├── audio/
│   │   ├── mod.rs
│   │   └── capture.rs   # CoreAudio input stream management
│   ├── whisper/
│   │   ├── mod.rs
│   │   └── engine.rs    # whisper.cpp bindings + Metal optimizations
│   ├── ipc/
│   │   ├── mod.rs
│   │   └── bridge.rs    # IPC protocol with Tauri frontend
│   └── sys/
│       ├── mod.rs
│       ├── hotkeys.rs   # Global hotkey registration
│       └── tray.rs      # Menu bar app integration
└── whisper.cpp/         # Git submodule: ggerganov/whisper.cpp
    └── ...              # Compiled for aarch64-apple-darwin
```

## Building (Future)

```bash
# Clone whisper.cpp as a submodule
git submodule add https://github.com/ggerganov/whisper.cpp.git sidecar/whisper.cpp

# Build whisper.cpp for Apple Silicon with Metal support
cd sidecar/whisper.cpp
WHISPER_METAL=1 make -j

# Build the Vox sidecar binary
cargo build --release --target aarch64-apple-darwin
```

## IPC Protocol (Proposed)

The sidecar communicates with the Tauri frontend via a local WebSocket or stdin/stdout JSON-RPC protocol:

```json
{
  "method": "transcribe",
  "params": { "audio_path": "/tmp/vox_recording.wav", "model": "small" }
}
```

```json
{
  "method": "transcription_result",
  "result": {
    "segments": [
      { "start": 0.0, "end": 2.3, "text": "Hello, this is a test." }
    ]
  }
}
```

## Status

**Not yet implemented.** The frontend UI shell is in the adjacent `src/` directory.
This sidecar will be built once the UI milestone is complete.
