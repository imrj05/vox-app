# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Lead edge:** developers and technical workers who dictate code, commit messages, terminal commands, and documentation across their Mac apps.
- **Broader audience:** privacy-conscious professionals (writers, lawyers, clinicians, executives) replacing cloud voice-typing tools with an on-device alternative.
- Situation: mid-task on macOS, in any app; primary job is speaking instead of typing — fast, hands-free, without switching context.

## Product Purpose
Vox is a private, local-first voice dictation app for macOS. Press a global hotkey anywhere on the OS, speak, and the transcript inserts directly at the cursor. All speech processing runs on-device; nothing is sent to external servers. Success means dictation that is instant, accurate in technical vocabularies, and invisible between phrases.

## Positioning
The only Mac dictation app with **multi-engine local routing** — Apple Speech, Parakeet, and Whisper run locally, chosen and orchestrated automatically per language, context, model availability, and hardware, with transparent fallback (never a silent engine switch). Neighboring products (Superwhisper, MacWhisper, Wispr Flow, Handy) each bind to one engine or cloud; Vox treats engines as swappable parts owned by the user.

## Operating Context
- Used from the **global hotkey and floating widget** far more often than from the main window; the widget and transcript insertion are the primary loop.
- Main window roles: model/library management, transcript history and notes, analytics, settings, onboarding.
- Runs against macOS permission machinery: Accessibility (event tap / text insertion), microphone (TCC).
- Enhance overlay transforms raw transcripts (cleanup levels, custom dictionary, formatting modes: auto / plain / developer).
- Developer-context formatting converts spoken phrases into camelCase, symbols, newlines, shell/git/npm/docker/k8s snippets.

## Capabilities and Constraints
- Tauri v2 desktop shell, React/TypeScript frontend, Rust backend; UI is web-technology inside a native macOS window.
- **macOS-only going forward.** Windows/Linux release targets were removed by product decision (August 2026); cross-platform is not current product truth.
- Minimum macOS 10.15 (Catalina); Apple Silicon recommended (Metal GPU acceleration).
- Engines: Apple Speech (system, on-device), Parakeet, Whisper (7 model tiers via HuggingFace, local download with progress, SQLite-persisted selection). Engine selection + fallback order is user-controlled and never silently overridden.
- Global hotkey with dual backend (plugin + CGEventTap for bare-modifier keys), toggle and push-to-talk modes, custom hotkey picker.
- Custom dictionary (with pronunciation hints), voice-command snippets, hands-free mode.
- Local SQLite persistence for transcripts, models, settings; autostart; signed auto-updates.
- Floating widget: transparent always-on-top capsule with live waveform, timer, shimmer transcribing state.
- Text insertion is cursor-direct (no clipboard).
- Open decision (undecided): distribution/pricing model — not yet stated by owner.

## Brand Commitments
- Name is **Vox** and stays Vox (owner-confirmed). Identifier: `app.vox.desktop`.
- "Local-only / private by default" is a binding product promise: transcription must never require external servers.
- macOS 10.15 floor and Metal acceleration remain binding.

## Evidence on Hand
- Real working app with all capabilities above shipped (v0.0.8, released via signed updater).
- Engineering docs in-repo: README.md, features.md, DESIGN.md, architecture notes.
- No testimonials, press, benchmarks, or case studies exist. Future work must not fabricate them.

## Product Principles
1. **Local is the product.** Everything must work with the network unavailable; cloud is never a fallback.
2. **The hotkey is the app.** Optimize for the 2-second, eyes-elsewhere loop: press → speak → text appears.
3. **Engines serve the user, not the vendor.** Multi-engine choice is explicit, visible, and never silently overridden.
4. **Speak in the user's vocabulary.** Developer formatting and the dictionary make Vox fluent in technical speech.
5. **Trust through transparency.** Permissions, engine switches, downloads, and deletions are always visible and reversible where possible.

## Accessibility & Inclusion
- Dictation is itself an accessibility tool for users who cannot or prefer not to type; reliability and clear error recovery are accessibility features.
- Must honor macOS system appearance (light/dark), reduced motion, and keyboard-first operation; native VoiceOver-friendly markup expected on all window surfaces.