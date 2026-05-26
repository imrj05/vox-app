# Vox Cross-Platform Feature Plan

This checklist targets production-ready Vox builds for macOS, Windows, and Linux. Vox already has the right foundation: Tauri, React, TypeScript, Rust, local audio recording, Whisper model management, global shortcuts, autostart, SQLite, updater support, and a desktop widget.

The main work is making every native feature explicit per operating system instead of assuming macOS behavior.

## Goals

- [ ] Ship Vox for macOS, Windows, and Linux from one codebase.
- [ ] Keep speech-to-text local by default.
- [ ] Support reliable record, transcribe, and insert-text workflows on every OS.
- [ ] Package each OS with the installer format users expect.
- [ ] Add platform-specific fallback paths for permissions, hotkeys, overlays, and text insertion.
- [ ] Verify each release with real hardware or virtual machines before publishing.

## Current App Foundation

- [x] Tauri v2 desktop shell.
- [x] React, TypeScript, and Vite frontend.
- [x] Rust backend for native recording and transcription.
- [x] Local Whisper model downloads.
- [x] WAV recording through `cpal`.
- [x] Local transcription through `whisper-rs`.
- [x] Text insertion through `enigo`.
- [x] Global shortcut support.
- [x] Autostart support.
- [x] SQLite plugin support.
- [x] Updater configuration.
- [x] macOS-specific accessibility and microphone permission handling.
- [x] macOS-specific active app/window context.
- [ ] Windows-specific permission, hotkey, and text insertion paths.
- [ ] Linux-specific X11 and Wayland behavior.
- [x] Non-macOS compatibility stubs for macOS-only event tap behavior.
- [x] Platform-aware native status label.
- [ ] Platform-specific build validation.

## Cross-Platform Features

### Audio Recording

- [ ] Confirm `cpal` input recording works on macOS, Windows, and Linux.
- [ ] Add clear no-microphone and permission-denied states.
- [ ] Normalize sample rate and channel handling across devices.
- [ ] Add recording device selection if default input is unreliable.
- [ ] Add audio-level diagnostics for troubleshooting.
- [ ] Test Bluetooth, USB, and built-in microphones.

### Transcription Engine

- [ ] Keep local Whisper support for all OS targets.
- [ ] Split Whisper acceleration features per OS.
- [x] Use Metal on macOS.
- [ ] Use Vulkan or DirectML-capable backend on Windows.
- [ ] Use Vulkan or CPU fallback on Linux.
- [ ] Add CPU fallback when GPU initialization fails.
- [ ] Show model compatibility and hardware notes in the Models UI.
- [ ] Validate tiny, base, small, medium, large, and turbo models per OS.
- [ ] Consider adding a CPU-optimized model option later, similar to Handy's Parakeet support.

### Global Shortcuts

- [ ] Keep current macOS event tap support.
- [ ] Keep Tauri global shortcut support for normal key combinations.
- [ ] Add Windows shortcut validation.
- [ ] Add Linux X11 shortcut validation.
- [ ] Add Wayland fallback guidance because many Wayland desktops restrict app-owned global shortcuts.
- [x] Support CLI commands for toggle recording, cancel recording, and start hidden.
- [ ] Let Linux users bind desktop-environment shortcuts to Vox CLI commands.
- [ ] Add diagnostics when a shortcut cannot be registered.

### Text Insertion

- [x] Keep direct text insertion where `enigo` works.
- [ ] Add clipboard paste fallback.
- [ ] Add Windows-specific paste behavior.
- [x] Add Linux X11 support through `xdotool`.
- [x] Add Linux Wayland support through `wtype` or `dotool`.
- [x] Detect missing Linux helper tools and show install guidance.
- [ ] Preserve clipboard contents when using clipboard fallback.
- [ ] Add retry and focus-delay handling after transcription.

### Permissions

- [ ] macOS: microphone permission.
- [ ] macOS: accessibility permission.
- [ ] macOS: input monitoring permission if needed.
- [x] Windows: microphone privacy permission guidance.
- [x] Windows: startup/autostart permission behavior.
- [x] Linux: microphone access diagnostics.
- [x] Linux: input simulation guidance for X11 and Wayland.
- [x] Add a platform-aware permissions page in Settings.

### Active App Context

- [ ] Keep macOS active app and window title detection.
- [ ] Add Windows active app and window title detection.
- [ ] Add Linux active window detection for X11.
- [ ] Add graceful "unknown app" fallback on Wayland.
- [ ] Avoid blocking transcription when context cannot be detected.
- [ ] Keep context optional and privacy-friendly.

### Widget And Overlay

- [ ] Keep the floating widget on macOS.
- [ ] Test transparent always-on-top windows on Windows.
- [ ] Test transparent always-on-top windows on Linux X11.
- [ ] Disable or simplify overlay behavior on Linux Wayland if it steals focus.
- [x] Add a setting to turn the widget off.
- [ ] Ensure widget focus never interrupts the target text field.

### System Tray

- [ ] Add tray icon support for all desktop OS targets.
- [ ] Add tray menu actions: show Vox, start recording, cancel recording, settings, quit.
- [ ] Support start-hidden behavior.
- [ ] Support minimize-to-tray behavior.
- [ ] Verify tray behavior on GNOME, KDE, Windows, and macOS.

### Autostart

- [ ] Keep Tauri autostart plugin integration.
- [x] Add start-hidden option for login startup.
- [ ] Verify Windows startup registration.
- [ ] Verify Linux desktop autostart entry behavior.
- [ ] Verify macOS login item behavior.

### Storage And Data

- [x] Store models in the platform app data directory.
- [x] Store recordings in the platform app data directory.
- [x] Store transcripts in SQLite.
- [x] Add cleanup controls for temporary recordings.
- [x] Add a reset-local-data action.
- [x] Keep paths visible in About or Diagnostics.

### Updates

- [ ] Keep Tauri updater support.
- [ ] Generate updater artifacts for each platform.
- [ ] Sign updater artifacts.
- [ ] Publish `latest.json` for each release.
- [ ] Test update flow from the previous version on every OS.
- [ ] Add user-facing update failure messages.

## macOS Target

- [x] Build `.dmg` or `.app` bundle through Tauri.
- [x] Use Metal acceleration for Whisper.
- [x] Use Accessibility permission for hotkeys and text insertion.
- [x] Use native active app/window APIs.
- [ ] Add signing and notarization for public distribution.
- [ ] Verify Intel and Apple Silicon builds.
- [ ] Verify first-launch permission flow.
- [ ] Verify updater with signed artifacts.

## Windows Target

- [ ] Build Windows installer through Tauri.
- [x] Configure NSIS or MSI output.
- [ ] Add code signing for installer and executable.
- [ ] Validate microphone recording with `cpal`.
- [ ] Validate text insertion into common apps.
- [ ] Validate global shortcuts.
- [ ] Add Windows active window/app detection.
- [ ] Add DirectML, Vulkan, or CPU transcription fallback.
- [ ] Test on Windows 10 and Windows 11.
- [ ] Test with Intel, AMD, and NVIDIA hardware where possible.
- [ ] Add Windows release notes for privacy, microphone access, and startup behavior.

## Linux Target

- [ ] Build `.deb`.
- [ ] Build `.rpm`.
- [ ] Build `.AppImage` if dependency bundling is stable.
- [x] Include WebKitGTK and GTK requirements in docs.
- [x] Include `libasound2-dev`, `pkg-config`, `libssl-dev`, `libwebkit2gtk`, and related build dependencies in docs.
- [x] Add runtime guidance for `xdotool` on X11.
- [x] Add runtime guidance for `wtype` or `dotool` on Wayland.
- [x] Add detection for missing helper tools.
- [ ] Add Wayland global shortcut fallback through CLI commands.
- [ ] Add startup troubleshooting for WebKit/GPU issues.
- [ ] Test Ubuntu LTS.
- [ ] Test Fedora.
- [ ] Test an Arch-based distro if AppImage is supported.
- [ ] Test GNOME, KDE Plasma, and at least one tiling window manager.

## CLI Commands

Add CLI commands so external shortcut managers and Linux Wayland users can control Vox even when app-owned global shortcuts are restricted.

- [x] `vox --toggle-recording`
- [x] `vox --start-recording`
- [x] `vox --stop-recording`
- [x] `vox --cancel`
- [x] `vox --show`
- [x] `vox --hide`
- [x] `vox --start-hidden`
- [x] `vox --diagnostics`
- [x] Single-instance forwarding so commands control an already-running Vox process.

## Build System

- [ ] Add platform-specific Cargo features for macOS, Windows, and Linux.
- [x] Avoid compiling macOS-only dependencies on Windows and Linux.
- [ ] Avoid compiling Windows-only dependencies on macOS and Linux.
- [x] Add platform-specific Tauri bundle settings.
- [x] Add reproducible local build commands.
- [x] Add CI builds for macOS, Windows, and Linux.
- [x] Cache Rust, frontend, and model-independent build dependencies in CI.
- [x] Generate release artifacts from clean builds.

## Testing Checklist

- [ ] App launches.
- [ ] Settings opens.
- [ ] Microphone permission flow works.
- [ ] Recording starts and stops.
- [ ] Audio file is valid.
- [ ] Model downloads.
- [ ] Transcription succeeds.
- [ ] Transcribed text inserts into another app.
- [ ] Shortcut starts recording.
- [ ] Shortcut stops recording.
- [ ] Push-to-talk works where supported.
- [ ] Widget shows correct state.
- [ ] Widget does not steal focus.
- [ ] App starts at login if enabled.
- [ ] App can start hidden.
- [ ] Update check works.
- [ ] App exits cleanly.
- [ ] No crash when model, microphone, or helper tools are missing.

## Release Checklist

- [ ] Version is updated in `package.json`, `Cargo.toml`, and `tauri.conf.json`.
- [ ] Changelog is updated.
- [ ] Icons are present for all OS targets.
- [ ] macOS bundle is signed and notarized.
- [ ] Windows installer is signed.
- [ ] Linux packages include required metadata.
- [ ] Updater artifacts are generated.
- [ ] Release checksums are generated.
- [ ] Release notes mention known platform limitations.
- [ ] Install, run, update, and uninstall are tested per OS.

## Priority Roadmap

### MVP Cross-Platform Build

- [ ] Compile on Windows.
- [ ] Compile on Linux.
- [ ] Launch the app on Windows and Linux.
- [ ] Record audio on Windows and Linux.
- [ ] Transcribe locally on Windows and Linux with CPU fallback.
- [ ] Insert text through the most reliable available method.
- [ ] Produce installable artifacts.

### Beta Quality

- [x] Add platform-aware permissions UI.
- [ ] Add CLI control commands.
- [x] Add Linux helper-tool detection.
- [ ] Add Windows active window context.
- [ ] Add Linux active window fallback.
- [ ] Add tray and start-hidden behavior.
- [x] Add cross-platform diagnostics.

### Production Quality

- [ ] Add signing and notarization.
- [ ] Add CI release pipeline.
- [ ] Add updater validation.
- [ ] Add full OS test matrix.
- [ ] Add clear troubleshooting docs.
- [ ] Add crash/error reporting controls per platform.
- [ ] Publish stable installers for all target OSes.

## Handy Reference Points

Handy is a useful reference because it solves many of the same platform problems with Tauri, React, TypeScript, and Rust.

Useful ideas to adapt carefully:

- [ ] Platform-specific transcription acceleration.
- [x] Linux text insertion through `xdotool`, `wtype`, or `dotool`.
- [ ] CLI commands for external shortcut managers.
- [ ] Single-instance command forwarding.
- [ ] Linux overlay fallback behavior.
- [ ] Clear Linux dependency and troubleshooting notes.
- [ ] Per-platform bundle configuration.

Do not copy Handy directly. Use it as a reference for cross-platform patterns while keeping Vox's product design, UI, model choices, and privacy behavior consistent.
