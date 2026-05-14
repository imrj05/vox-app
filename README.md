# Vox

Vox is a macOS-first desktop app concept for fast, private voice transcription. It is designed around a persistent sidebar workspace, local Whisper speech-to-text, Apple Silicon acceleration, and a clean dark interface inspired by Linear-style productivity tools.

This repository currently contains the first frontend milestone plus a minimal Tauri desktop shell. The Tauri command bridge is wired and callable from the React UI; native audio capture and Whisper transcription are planned next.

> [!NOTE]
> The current implementation is a frontend scaffold with a minimal Tauri command bridge. Swift sidecar audio capture and Core ML transcription are planned but not wired yet.

## Features

- Persistent desktop-style layout with a fixed left sidebar
- macOS traffic-light window controls in the shell
- Command/search trigger with `Cmd + K` affordance
- Home page with mock transcription history grouped by day
- Models page with local Whisper model download placeholders
- Focused dictation page for recording and transcription
- Centered settings modal with its own internal sidebar
- shadcn-style UI components built from Radix primitives
- Dark, Linear-inspired theme with subtle borders and blue accent states

## Planned Product Direction

Vox is intended to become a native macOS transcription app with this workflow:

1. Press a global hotkey anywhere on macOS.
2. Vox records microphone audio using a native Apple audio pipeline.
3. Audio is transcribed locally using Whisper accelerated by Apple Silicon.
4. The transcript is inserted at the current cursor position.
5. Optional AI cleanup can polish dictation for notes, emails, prompts, or chat.

## Planned Native Architecture

```text
React UI (Vite/shadcn)
        │
        ▼
Tauri v2 Rust backend
  - global hotkeys
  - tray/menu bar
  - text insertion
  - model management
  - sidecar process control
        │
        ▼
Swift sidecar
  - AVAudioEngine audio capture
  - whisper.cpp + Core ML transcription
  - JSON events over stdin/stdout
```

The intended macOS transcription path is:

- `AVAudioEngine` for microphone capture
- `AVAudioConverter` for 16kHz mono Float32 audio conversion
- `whisper.cpp` with Core ML model bundles for Apple Silicon acceleration
- Tauri/Rust for system integration and text injection

## Tech Stack

| Area | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite |
| Styling | Tailwind CSS v4 |
| UI components | shadcn-style components, Radix UI primitives |
| Icons | Lucide React |
| Routing | React Router |
| Utilities | clsx, tailwind-merge, class-variance-authority |
| Planned desktop shell | Tauri v2 |
| Planned native engine | Swift sidecar, AVAudioEngine, whisper.cpp, Core ML |

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

Vox uses embedded `whisper-rs` with models downloaded inside the app. Start the desktop app, complete onboarding, download the Base English model, then record and transcribe from Home. No external `whisper-cli` is required.

Preview a production build:

```bash
pnpm preview
```

## Project Structure

```text
vox-app/
├── components.json          # shadcn-style component configuration
├── sidecar/
│   └── README.md            # planned native engine notes
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
- Basic Whisper model status and downloads
- Focused dictation shell
- Settings modal shell
- shadcn-style UI primitives
- Tailwind v4 theme tokens

Not implemented yet:

- Swift sidecar binary
- Production model management and Core ML tuning
- Global hotkey capture
- Text insertion at cursor
- Real model downloads
- Persistent transcript storage

## Next Steps

1. Add progress/cancellation for model downloads and transcription.
2. Add Rust-side process management, global hotkeys, and text insertion.
3. Replace mock pages with real transcript history, model state, and settings persistence.
