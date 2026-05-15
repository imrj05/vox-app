# Vox

Vox is a macOS-first desktop app concept for fast, private voice transcription. It is designed around a persistent sidebar workspace, local Whisper speech-to-text, Apple Silicon acceleration, and a clean dark interface inspired by Linear-style productivity tools.

This repository contains a working Tauri desktop app with a React frontend, in-process Rust audio capture, and local Whisper transcription.

> [!NOTE]
> Vox currently records audio and runs Whisper directly inside the Tauri Rust process. Older sidecar-based notes in this repository are historical and are not the current implementation.

## Features

- Persistent desktop-style layout with a fixed left sidebar
- macOS traffic-light window controls in the shell
- Command/search trigger with `Cmd + K` affordance
- Home page with mock transcription history grouped by day
- Models page with local Whisper model downloads and quick dictation
- Focused dictation page for recording and transcription
- Centered settings modal with its own internal sidebar
- shadcn-style UI components built from Radix primitives
- Light, dark, and system theme support
- Context-aware vocabulary injection based on the active app and window title
- Custom dictionary terms synced into Whisper prompts

## Planned Product Direction

Vox is intended to become a native macOS transcription app with this workflow:

1. Press a global hotkey anywhere on macOS.
2. Vox records microphone audio using the local Rust audio pipeline.
3. Audio is transcribed locally using Whisper accelerated by Apple Silicon.
4. The transcript is inserted at the current cursor position.
5. Optional AI cleanup can polish dictation for notes, emails, prompts, or chat.

## Current Architecture

```text
React UI (Vite/shadcn)
        │
        ▼
Tauri v2 Rust backend
  - microphone recording via cpal
  - local Whisper inference via whisper-rs
  - global hotkeys
  - tray/menu bar
  - text insertion
  - model management
  - context-aware prompt and dictionary injection
```

The current macOS transcription path is:

- `cpal` for microphone capture
- WAV recording written locally by Rust
- `whisper-rs` with Metal acceleration for local transcription
- Tauri/Rust for app integration, model management, and text insertion hooks

## Tech Stack

| Area | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite |
| Styling | Tailwind CSS v4 |
| UI components | shadcn-style components, Radix UI primitives |
| Icons | Lucide React |
| Routing | React Router |
| Utilities | clsx, tailwind-merge, class-variance-authority |
| Desktop shell | Tauri v2 |
| Native engine | Rust, cpal, whisper-rs, Metal |

## Getting Started

Install dependencies:

```bash
pnpm install
```

Start the development server:

```bash
pnpm dev
```

Start the Tauri desktop app:

```bash
pnpm desktop:dev
```

Build for production:

```bash
pnpm build
```

Run TypeScript checks:

```bash
pnpm typecheck
```

Run linting:

```bash
pnpm lint
```

Check the Rust desktop shell:

```bash
cd src-tauri
cargo check
```

## Local Whisper Setup

Vox uses embedded `whisper-rs` with models downloaded inside the app. Start the desktop app, complete onboarding, download a model, then record and transcribe from Home or Models. No external `whisper-cli` or sidecar process is required.

Preview a production build:

```bash
pnpm preview
```

## Project Structure

```text
vox-app/
├── components.json          # shadcn-style component configuration
├── sidecar/
│   └── README.md            # historical architecture notes
├── src/
│   ├── components/
│   │   ├── ui/              # reusable shadcn-style primitives
│   │   ├── settings-modal.tsx
│   │   └── sidebar.tsx
│   ├── hooks/               # shared React hooks
│   ├── lib/
│   │   └── utils.ts         # cn() class merge helper
│   ├── pages/
│   │   ├── home.tsx
│   │   ├── models.tsx
│   │   └── models.tsx
│   ├── App.tsx              # app shell and routes
│   ├── index.css            # Tailwind setup and design tokens
│   └── main.tsx             # React entry point
├── package.json
└── vite.config.ts
```

## UI Layout

The app uses a desktop productivity layout rather than a traditional web dashboard:

- Fixed left sidebar for primary navigation
- Dictation and model management routes only
- Settings action pinned near the bottom
- Main content pane focused on recording and transcription
- Settings rendered as a centered modal with a secondary settings sidebar

The visual direction is intentionally dark, minimal, and dense enough for a desktop utility while keeping the interface spacious and readable.

## Current Status

Implemented:

- Frontend app scaffold
- Minimal Tauri v2 desktop shell
- Rust command bridge exposed to React
- Native microphone recording to local WAV files
- Model-managed local Whisper transcription bridge
- Whisper model status, downloads, and quick dictation
- Focused dictation shell
- Settings modal shell
- shadcn-style UI primitives
- Tailwind v4 theme tokens
- Theme switching
- Context-aware prompt and dictionary injection

Not implemented yet:

- Global hotkey capture
- Text insertion at cursor
- Persistent transcript storage

## Next Steps

1. Add progress/cancellation for model downloads and transcription.
2. Add Rust-side global hotkeys and text insertion.
3. Replace mock pages with real transcript history, model state, and settings persistence.
