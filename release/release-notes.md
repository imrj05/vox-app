## v0.0.1 - 2026-05-15

Initial release changelog generated from repository history.

### Added

- show changelog in update flow (546078a)
- prepare app release workflow (c3cbda4)
- add quick dictation feature with recording and transcription capabilities (55c48fc)
- add Textarea component for flexible text input (9026f1c)
- add main application and widget structure with recording and transcription features (eeb03c9)

### Changed

- enable updater artifact generation (6625943)
- avoid unsupported ARM whisper path (ad62848)
- fix macOS release build for whisper (4caa2dc)
- skip validation on release branches (28d408b)

### Fixed

- remove landing page input from Vite configuration (8de5169)
- update class name for month grid in Calendar component (7a55497)


### macOS — Gatekeeper warning

If macOS blocks the app, run once in Terminal after installing:

```bash
xattr -cr /Applications/Vox.app
```
