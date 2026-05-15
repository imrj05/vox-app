# Vox

Vox is a private, local-first voice dictation app for macOS. Press a global hotkey anywhere, speak, and the transcription is inserted directly at the cursor. All audio processing runs entirely on-device using OpenAI Whisper — nothing is sent to external servers.

> Minimum macOS: 10.15 Catalina — Apple Silicon recommended for best performance.

---

## How it works

1. Press the global hotkey (`⌘ Shift Space` by default) anywhere on macOS.
2. Speak. A floating overlay shows a live waveform while recording.
3. Whisper runs locally using Metal GPU acceleration.
4. The transcript is injected at the cursor position — no clipboard involved.

---

## Features

### Local Whisper transcription

- Runs fully on-device with no network requests for transcription.
- GPU-accelerated inference via Metal; falls back to CPU automatically.
- Beam-search decoding (beam size 5) for accuracy over speed.
- Blank/filler detection — discards empty or nonsense results silently.
- Context-aware initial prompt built from the active app, window title, and custom dictionary terms.

### Whisper model management

Seven model tiers available directly from HuggingFace:

| Model | Size | Notes |
|---|---|---|
| Tiny | ~75 MB | Fastest, lowest accuracy |
| Base | ~150 MB | Default — recommended |
| Small | ~500 MB | Good balance |
| Medium | ~1.5 GB | High accuracy |
| Distil-Large v3 | ~1.5 GB | Fast large-equivalent |
| Large v3 Turbo | ~1.5 GB | Fast large-equivalent |
| Large v3 | ~3 GB | Highest accuracy |

- Live download progress with MB/total and percentage.
- Active model persisted to SQLite; falls back to `base.en` on deletion.
- Quick dictation test widget on the Models page to audition each model.

### Global hotkey

- Default: `⌘ Shift Space`. Fully customisable via a key-capture picker.
- Dual backend: `tauri-plugin-global-shortcut` for standard combos + a custom **CGEventTap** thread for keys the OS API cannot intercept (bare Option, Globe/Fn, etc.).
- **Toggle mode** — press to start, press again to stop and transcribe.
- **Push-to-talk mode** — hold to record, release to transcribe.
- Live hotkey diagnostics panel showing Accessibility permission, EventTap status, model presence, trigger mode, and recording state.
- Risky binding warning for modifier-free keys.

### Floating widget

- Transparent always-on-top overlay (220 × 64 px) that appears during recording and transcription.
- 7-bar live waveform driven by real-time audio level events from Rust.
- Transitions to a shimmer "Transcribing…" state while Whisper runs.
- Elapsed recording timer.
- Soft synthesised start/stop audio tones (Web Audio API oscillators — toggleable).
- Theme-aware (reads dark/light from `localStorage`).

### Context-aware transcript formatting

Three formatting modes selectable in settings:

- **Auto** — detects developer context from the active app/window title (VS Code, Cursor, Xcode, Terminal, Warp, Arc, Chrome, localhost, file extensions, etc.) and applies code formatting automatically.
- **Plain text** — always outputs plain prose.
- **Developer** — always applies code formatting.

Developer mode converts spoken phrases to code: camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, code symbols (brace, bracket, arrow, semicolon…), newline/indent/outdent commands, and template snippets. Context-specific Whisper prompt hints are also injected for Git, npm/pnpm, shell, Docker, Kubernetes, Jira/Linear, and chat apps.

### Custom dictionary

- Add words, names, and acronyms to improve Whisper recognition for your vocabulary.
- Optional pronunciation hints formatted for Whisper (e.g. `Tauri | tow-ree`).
- Categories: General, People, Product, Technical, Company.
- Comma-separated bulk add; case-insensitive deduplication.
- Persisted to SQLite.

### Insights dashboard

- **Summary stats**: total words dictated, transcription count, estimated time saved, total recording time.
- **Streaks**: current and all-time longest consecutive-day streak.
- **Activity heatmap**: GitHub-style 6-month daily contribution grid.
- **Hourly usage chart**: 24-bar chart of sessions and time per hour with morning/afternoon/evening breakdowns and peak hour label.
- **Weekly trend chart**: 8-week session count and recorded time bars.
- **Top apps panel**: ranked by words dictated with app icon, word count, session count, and share percentage.
- **Recent transcripts panel**: last 6 transcripts with text preview, source app, timestamp, and per-item delete.

### Transcript history

- All transcripts stored in local SQLite (`vox.db`) with text, source app, duration, and timestamp.
- Per-transcript deletion from the dashboard.
- Bulk "Clear history" action (with confirmation).
- "Reset app data" resets all transcripts and settings — downloaded models are preserved.

### Permissions

- Live status polling for Accessibility and Microphone permissions.
- Auto-opens System Settings with a prompt when permission is needed.
- Status updates automatically when the user grants permission (no app restart required).

### Onboarding

- 4-step guided first-launch wizard: Accessibility → Microphone → Model download → Hotkey test.
- Steps auto-advance on permission grant.
- Full model picker with download progress inline.
- Hotkey test step detects the keypress via both `keydown` and a Tauri event.

### App updates

- `tauri-plugin-updater` checks GitHub Releases for a signed `latest.json` manifest.
- Auto-check on every app launch.
- Manual "Check for updates" button on the About page.
- Update dialog shows release notes (Markdown headings and bullet lists rendered).
- Live download progress bar during update streaming.
- Auto-relaunches into the new version after install.
- Update artifacts verified against an embedded minisign public key.

### Settings

| Setting | Options |
|---|---|
| Theme | System / Light / Dark |
| Sound cues | On / Off |
| Start at login | On / Off (macOS LaunchAgent) |
| Transcript formatting | Auto / Plain text / Developer |
| Global hotkey | Any combo via key picker |
| Trigger mode | Toggle / Push-to-talk |

All settings persisted to SQLite and hydrated on startup.

---

## Tech stack

| Area | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite |
| Styling | Tailwind CSS v4, OKLCH design tokens |
| UI components | shadcn-style components, Radix UI primitives |
| Icons | Lucide React |
| State | Zustand |
| Desktop shell | Tauri v2 |
| Audio capture | cpal (Rust) |
| Transcription | whisper-rs / whisper.cpp (Metal GPU) |
| Database | SQLite via tauri-plugin-sql |
| Text injection | enigo (Rust) |
| Global shortcuts | tauri-plugin-global-shortcut + CGEventTap (Rust) |

---

## Getting started

```bash
pnpm install
```

Start the Tauri desktop app in development mode:

```bash
pnpm desktop:dev
```

Other commands:

```bash
pnpm dev          # Vite dev server only (no Tauri shell)
pnpm build        # production build
pnpm typecheck    # TypeScript check
pnpm lint         # ESLint
cd src-tauri && cargo check   # Rust check
```

---

## Project structure

```
vox-app/
├── src/
│   ├── components/
│   │   ├── ui/               # shadcn-style primitives
│   │   ├── onboarding.tsx
│   │   ├── settings-modal.tsx
│   │   └── sidebar.tsx
│   ├── hooks/
│   ├── lib/                  # db.ts, native.ts, about.ts, async.ts
│   ├── pages/
│   │   ├── home.tsx          # dashboard / insights
│   │   ├── models.tsx        # model management
│   │   ├── settings.tsx      # full-page settings
│   │   └── about.tsx         # about + updater
│   ├── store/
│   │   └── app-store.ts      # Zustand store (settings + update state)
│   ├── App.tsx               # app shell, routing, update dialog
│   ├── index.css             # Tailwind setup, OKLCH design tokens
│   └── main.tsx
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs            # Tauri commands + plugin registration
│   │   ├── whisper.rs        # Whisper inference + model management
│   │   ├── event_tap.rs      # CGEventTap global shortcut backend
│   │   └── widget/           # floating overlay window
│   └── tauri.conf.json
├── release/
│   └── latest.json           # updater manifest
└── scripts/
    └── generate-updater-manifest.mjs
```

---

## Privacy

Vox is designed to be private by default:

- No analytics, telemetry, or tracking.
- No account or sign-in required.
- All audio is processed locally and never transmitted.
- Downloaded model files stay on your machine.
- SQLite database is stored in the macOS app data directory.
