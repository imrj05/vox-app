# Multi-Engine Local Transcription — Implementation Deliverables

Implementation of `Multi-Engine Local Transcription Architecture for VOX.md`
across the existing Vox codebase. All work was done incrementally over six
non-breaking steps; every step was verified with `cargo test`, `cargo check
--release`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.

---

## 1. Files changed (modified)

| File | Change |
|---|---|
| `src-tauri/src/whisper.rs` | Reduced to model management only (catalog, downloads, path resolution). Transcription moved to the engine layer. |
| `src-tauri/src/lib.rs` | Engine registry wiring, `EngineSelectionState` + commands, router call in `transcribe_recording_inner`, fallback event, engine metadata in results/events, `[VOX][ASR/AI/OUTPUT]` timing logs, personal-dictionary pass, hardware command. |
| `src-tauri/src/custom_models.rs` | Shared `resolve_model_file` support, whisper-format availability helper. |
| `src-tauri/src/custom_models.rs` / `whisper.rs` | Parakeet routing removed from whisper.rs into its engine. |
| `src-tauri/tauri.conf.json` | `apple-speech` added to `externalBin`. |
| `src-tauri/Info.plist` | `NSSpeechRecognitionUsageDescription`. |
| `package.json` | `build:apple-speech` scripts + build-chain wiring. |
| `src/store/app-store.ts` | `engine`, `engineFallbackEnabled`, `preferredEngineFallback` state/hydration/persistence. |
| `src/App.tsx` | Sync effects pushing engine settings into Rust state. |
| `src/lib/native.ts` | `getTranscriptionEngines`, engine setters, `HardwareInfo`, engine-aware `TranscriptionResult`. |
| `src/lib/db.ts` | `transcripts.engine` column, save/select. |
| `src/pages/home.tsx` | Engine persisted with both hotkey + hands-free transcript paths. |
| `src/App.tsx` | Engine settings sync effects. |
| `src/pages/transcripts.tsx` | Engine badge in history. |
| `src/pages/models.tsx` | Hardware tier banner + "fits your Mac" badges. |
| `src/pages/settings.tsx` / `settings-sections.ts` / `settings-modal.tsx` | New Transcription section registered in both settings surfaces. |

## 2. New files

| File | Purpose |
|---|---|
| `src-tauri/src/engines/mod.rs` | `TranscriptionEngine` trait, registry, router (`route_transcribe`), auto-selection, fallback, shared sidecar helpers, EngineStatus/EngineFallback, engine availability. |
| `src-tauri/src/engines/whisper_engine.rs` | whisper.cpp engine (GPU + CPU fallback, prompts, language pinning). |
| `src-tauri/src/engines/parakeet_engine.rs` | Parakeet runtime engine (transcribe.cpp sidecar, GGUF). |
| `src-tauri/src/engines/apple_speech.rs` | Apple Speech engine (Swift sidecar, on-device). |
| `src-tauri/src/engines/audio.rs` | Shared audio normalization (16 kHz mono f32 / 16-bit WAV). |
| `src-tauri/apple-speech/main.swift` | Apple Speech sidecar CLI (Speech framework, on-device). |
| `src-tauri/src/hardware.rs` | Hardware detection + Fast/Balanced/Accurate tiers. |
| `scripts/build-apple-speech.mjs` | swiftc staging script (macOS-only no-op elsewhere). |
| `src-tauri/Info.plist` | + `NSSpeechRecognitionUsageDescription` (Tauri merges this automatically). |

## 3. Architecture

```
Hotkey / Hands-free / UI
        │
Tauri command (transcribe_recording)
        │
engines::route_transcribe()          ← single funnel, spec §31
  ├── explicit model?  → engine_for_model() (file format decides)
  ├── explicit engine? → engine.pick_model()
  └── "auto"           → choose_auto_engine()  (§7 strategy)
        │
        │  failure + fallback enabled → fallback engine chain (§8),
        │  switch reported via on_fallback → transcription_engine_fallback event
        ▼
TranscriptionEngine::transcribe()      ← engines never touch capture/UI
        │
        ▼
raw transcript ──► AI cleanup (sidecar LLM, None/Light/Medium/High)
        │           personal dictionary (canonical casing, all engines)
        └─────────► snippets → final text → insert → SQLite (raw + final + engine)
```

ASR engine = Audio → Raw Transcript. AI processing = Raw → Final. The
Intelligence layer (`vox-text-enhance` sidecar, pre-existing) is untouched and
now shared by all three engines.

**Engine registry**: `whisper` (whisper.rs + whisper-rs, Metal), `parakeet`
(transcribe.cpp CLI, GGUF), `apple` (Speech framework sidecar). New engines
join `engines::mod::registry()` and automatically appear in the UI, fallback
chain, and auto mode — no frontend change.

## 4. Default engine

`auto`: English + Parakeet installed → Parakeet · otherwise Whisper (multilingual,
"auto"/"hi"/"hinglish" always Whisper) · no third-party model installed → Apple
Speech · failures degrade through registered engines by availability. Explicit
model choice (Models page) always wins. Explicit engine is never silently
switched — only via configured fallback, which emits an event.

## 5–7. Integration of the three engines

- **Apple Speech** — Swift sidecar `src-tauri/apple-speech/main.swift`
  (`SFSpeechRecognizer`, `requiresOnDeviceRecognition`, i.e. never uploads
  audio). Staged via `swiftc` by `scripts/build-apple-speech.mjs`, registered in
  `externalBin`. No model file (`pick_model → None`). Voice-verified:
  `text: Hello this is a test of the Apple speech engine`.
- **Whisper** — unchanged whisper-rs backend, now `engines/whisper_engine.rs`.
- **Parakeet** — the pre-existing native `transcribe-cli` GGUF runtime per the
  spec's "adapt the existing implementation" carve-out; now an explicit engine
  instead of a hidden extension check inside `whisper::transcribe`.

## 8. Models

Download-on-demand from HuggingFace (unchanged pipeline, cancel/pause intact).
Path resolution split into `resolve_model_file` (explicit) and engine-owned
`pick_model` (preferred). Apple Speech needs nothing.

## 9–10. Auto + fallback

Documented in `engines/mod.rs::route_transcribe`. Engine switches are always
logged and emitted; the transcript is tagged with the engine that actually ran
(shown in history). Users additionally see:

- `transcription_engine_fallback` event → **warning toast** ("Parakeet fell back to Whisper — model was unavailable")
- `transcription_engine_changed` event → **success toast** when the router picked a different engine than the previous transcription

## 11. AI cleanup

Untouched `vox-text-enhance` sidecar: None/Light/Medium/High, rule-based fast
path + LLM pass for Medium/High, app-context styles, developer-mode protection.
New: **personal dictionary now applies to every engine** (word-boundary aware,
`"next js" → "Next.js"`).

## 12–14. Build / test / permissions

```bash
pnpm install
pnpm desktop:dev      # sidecars build automatically
pnpm desktop:build    # production bundle
cd src-tauri && cargo test   # 62 tests
pnpm typecheck && pnpm lint && pnpm build
```

macOS permissions: Microphone (existing), **Speech Recognition** (new —
`NSSpeechRecognitionUsageDescription` added to `src-tauri/Info.plist`), plus
Accessibility/Input-Monitoring as before. Apple Speech needs no model download.

## 15. Licenses to review

- Whisper GGML models — OpenAI Whisper MIT/Apache lineage (check per-file).
- Distil-Whisper — MIT, but inherits Whisper's terms.
- `handy-computer/parakeet-*` GGUF — NVIDIA's Parakeet model license (CC-BY-4.0
  upstream); **redistribution of the hosted GGUF conversions should be
  confirmed** with the repo owner.
- Apple Speech — OS component; on-device, no redistribution.

## 16. Known limitations

1. **Batch transcription only** — `transcription_partial` events (§11) are not
   implemented; the record→transcribe design doesn't stream. Deliberate.
2. **Parakeet = GGUF/transcribe.cpp**, not Core ML (allowed by §4's
   "existing native implementation" clause; transcribe.cpp targets Apple Silicon).
3. **Apple Speech in dev** requires the terminal host to hold Speech Recognition
   permission (TCC attributes sidecar prompts to the responsible process);
   production builds prompt through the app via `NSSpeechRecognitionUsageDescription`.
4. Apple Speech `--status`/language availability depends on OS speech resources;
   the availability probe deliberately doesn't trigger TCC prompts.
5. `SpeechAnalyzer`/`SpeechTranscriber` (macOS 26) is not used — SFSpeechRecognizer
   works 10.15→26; upgrading requires raising the deployment target.
6. Model sizes in the catalog are catalog constants (spec §24 prefers metadata;
   remote HEAD probing was out of scope).
7. Hinglish ("hi + en") still routes to Whisper; single-engine outputs are not
   yet language-switch aware.

## Test matrix

```bash
cd src-tauri && cargo test      # 62 passing (router, engines, cleanup, dictionary, hardware)
pnpm typecheck && pnpm lint && pnpm build   # all green
pnpm desktop:dev                # live verification: hotkey → record → insert → history badges
```

Verify manually per engine: Settings → Transcription → select engine → hotkey
dictation → check Transcript history shows the engine badge; force a fallback by
selecting a model-less engine with fallback enabled.