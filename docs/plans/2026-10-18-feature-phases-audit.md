# Feature Phase Audit — October 18, 2026

Audit of the four-phase roadmap against the current `vox-app` codebase (v0.0.10).

**Status legend**

- ✅ **Done** — shipped and wired end-to-end.
- 🟡 **Partial** — implementation exists but is incomplete, gated off, or not surfaced.
- ❌ **Missing** — no implementation found.

**Score:** Phase 1 ≈ 95% · Phase 2 ≈ 90% · Phase 3 ≈ 85% · Phase 4 ≈ 100% of in-scope work

> **Scope decision (2026-10-18): local-only.** Vox is an on-device app. Cross-device sync (17), cloud rewriting (19), and team dictionaries/shared snippets (20) are **not planned**. Only local rewriting is in scope.

---

## Phase 1 — Core Flow

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Global hotkey and recording states | ✅ | `src-tauri/src/event_tap.rs`, `set_global_shortcut` (`lib.rs:2567`), trigger modes (`app-store.ts:38-49`), widget modes (`widget.tsx:18`) |
| 2 | Reliable text insertion and undo | ✅ | Typing + optional restored-clipboard paste (`insert_text`), undo/retry (`LastInsertionState`), failure recovery |
| 3 | Filler removal, punctuation, and corrections | ✅ | `fast_cleanup`, always-on corrections, conservative punctuation restoration (`restore_punctuation`) |
| 4 | Raw and final transcript separation | 🟡 | True `asr_text` captured before any processing (`lib.rs:2329`), persisted (`db.ts:48`), and compared in the library (`transcripts.tsx`). Per-correction chips still missing. |
| 5 | Local history and privacy controls | ✅ | Retention + pruning (`App.tsx:161`, `db.ts:165`), privacy mode, opt-in error reporting, clear data, file wipe, and **Dictate Without Saving** |

### 1. Global hotkey and recording states — ✅ Done

- Dual hotkey backend: `tauri-plugin-global-shortcut` plus CGEventTap for bare modifiers (`lib.rs:2582-2593`).
- Hotkey picker, validation, diagnostics, Accessibility/Input Monitoring checks.
- Toggle, push-to-talk, and hands-free modes (`lib.rs:3516`, `lib.rs:3735`).
- Widget lifecycle: `idle → recording → transcribing → done/error`, live meter, elapsed timer, audio cues.

**Remaining todos**

- [ ] Add a visible "hotkey inactive — permission missing" banner outside Settings (currently only diagnostics).
- [ ] Add a cancel/discard path for an in-flight recording.

### 2. Reliable text insertion and undo — ✅ Done

- Dictation is typed via `enigo.text()` by default (`lib.rs`); transforms use AX value replacement with select-all fallback.
- **Resolved (2026-10-18):** successful insertions are recorded in `LastInsertionState`. `undo_last_insertion` removes the exact inserted text via AX when it is still at the end of the focused field, and falls back to Cmd+Z within 10 seconds. Undo is exposed in the widget done state and as a tray menu item (60-second window).
- **Resolved (2026-10-18):** Settings → General → **Text insertion** offers **Type at cursor** (default) and **Paste via clipboard**. The clipboard mode is faster and more reliable for long transcripts; it backs up and restores the previous text or image clipboard afterwards.
- Failed insertions keep the text in `LastInsertionState`, emit `vox-insertion-failed` (toast with Copy), and enable "Retry Insertion" in the tray for 5 minutes.
- Diagnostics exist (`text_insertion_diagnostics`).
- **Still missing:** a post-condition check that verifies the inserted character count and automated multi-line insertion tests.

**Remaining todos**

- [x] Track the last inserted transcript (text + target app + timestamp) and add `Undo last dictation` (widget action + tray item).
- [x] Surface insertion failure in the widget with a retry path.
- [x] Add an opt-in clipboard-paste fast path and restore the previous clipboard.
- [x] Verify insertion post-condition via AX where available (length/prefix check) before reporting success.
- [ ] Add tests for newline/symbol/multi-line insertion.

### 3. Filler removal, punctuation, and corrections — ✅ Done

- Rule-based cleanup exists: fillers (`lib.rs:4773`), self-corrections (`lib.rs:4855`), repeated words, capitalization; LLM cleanup for Medium/High.
- Vocabulary correction is token-aware with fuzzy/anchor gating (`vocabulary/correct.rs`).
- **Resolved (2026-10-18):** the vocabulary correction pass was moved outside the AI cleanup gate and now runs in every transcript, including developer contexts. Developer contexts use `CorrectionOptions { developer_context: true }`, which only allows exact, plain lowercase multi-word phrases and skips fuzzy matching, single-token rewrites, and matches touching identifier/path separators (`correct.rs`).
- Filler removal is still gated by `cleanup_level` (default `none`).
- **Resolved (2026-10-18):** `restore_punctuation` runs on non-developer transcripts after formatting and before cleanup. It only touches unpunctuated single-line prose: first letter capitalized, terminal period added. Any existing `.`/`!`/`?`, multi-line text, lists, and headings are left alone.
- Punctuation is still primarily what the ASR engine emits; this pass is a conservative safety net, not a full reconstruction model.

**Remaining todos**

- [x] Move the deterministic vocabulary correction pass **outside** the cleanup gate and run it in developer mode with code-safe boundaries.
- [ ] Move light rule-based cleanup (fillers/self-corrections) outside the AI gate, or default new installs to `light`.
- [x] Add punctuation/capitalization restoration as a deterministic post-pass for engines without it.
- [x] Add regression tests asserting corrections apply with `cleanup_level = none` and in developer context.

### 4. Raw and final transcript separation — 🟡 Partial

- `asr_text` now stores the engine output exactly as produced, before formatting, cleanup, corrections, or snippets (`lib.rs:2329`).
- `raw_text` keeps its previous meaning: the text before a later stage changed it, used by "Undo AI edit".
- The transcript library has a **Show raw / Hide raw** comparison: final text first, then a labelled raw-speech panel with the engine name. Search matches both final and raw text.
- Gaps: no per-correction chips and no side-by-side word-level diff; older rows have `asr_text = null`.

**Remaining todos**

- [x] Capture `raw_asr_text` immediately after the engine returns, before formatting/cleanup/snippets.
- [x] Store `asr_text` alongside final text and `raw_text`.
- [x] Add a raw/final comparison in transcript history.
- [ ] Persist the applied correction list per transcript and show correction chips.
- [ ] Add a word-level diff for longer edits.

### 5. Local history and privacy controls — 🟡 Partial

- History is local SQLite only; retention `forever/7/30/90` with pruning on launch (`App.tsx:161`).
- Privacy mode disables error reporting and forces 7-day retention (`app-store.ts:setPrivacyMode`).
- Error reporting is opt-in and sanitized (`error-reporting.ts`).
- Clear-all, recording cleanup, and `wipe_local_app_files` exist.
- **Resolved (2026-10-18):** the menu bar has **Dictate Without Saving**. It runs the normal record → transcribe → insert loop but skips the history event, correction learning, and retains no audio; failure and voice-command paths also delete the recording.
- **Resolved (2026-10-18):** accounts and PocketBase auth were removed entirely. Vox has no sign-in, sync, or analytics fields.
- Gaps: no per-app history exclusion; no encryption at rest.

**Remaining todos**

- [x] Add "Don't save this dictation" / temporary history pause.
- [x] Remove accounts/analytics; only opt-in crash reporting remains networked.
- [ ] Add per-app history exclusion.
- [ ] Document every network surface in Settings (auth, model downloads, updates, error reporting).
- [ ] Consider SQLCipher or an encrypted history option.

---

## Phase 2 — Personalization

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 6 | Vocabulary packs and aliases | ✅ | `vocabulary/builtin.rs`, `store.rs`, alias editor (`settings-vocabulary.tsx:672`), import/export, app mapping, learning |
| 7 | Developer mode and technical terminology | 🟡 | Developer formatter (`lib.rs:5101`), context detection (`lib.rs:5037`), but corrections skipped in dev mode |
| 8 | App-aware writing profiles | ✅ | User-editable app → style mapping, default style, and built-in detection (`writing.rs`, `settings-writing.tsx`) |
| 9 | Snippets and custom styles | ✅ | Snippets (`lib.rs:2503`), user-defined writing styles (`writing.rs`), fixed transform presets |
| 10 | Confidence-aware corrections | ✅ | Whisper token probabilities + Apple segment confidence (`engines/`), threshold modulation (`correct.rs`), persisted per correction, review badge in Corrections |

### 6. Vocabulary packs and aliases — ✅ Done

- Built-in developer/technology/business/etc. packs, user packs, aliases, pronunciation variants, priorities, enable/disable, import/export, app mapping, usage/recency ranking, learning from accepted corrections, Corrections review page.
- Corrections now run regardless of cleanup level and in developer contexts with the restricted code-safe policy (2026-10-18).

**Remaining todos**

- [ ] Add duplicate-alias and canonical-collision validation in the entry editor.

### 7. Developer mode and technical terminology — 🟡 Partial

- Identifier styles, symbols, templates, newline/indent/outdent phrases, `literal`/`word` escapes, and auto app detection (`lib.rs:5037-5171`).
- Technical vocabulary packs and developer context prompt enrichment exist.
- Vocabulary corrections now run in developer contexts, but only for exact plain multi-word phrases; fuzzy and single-token corrections remain disabled there (`correct.rs`).
- Gaps: formatting is all-or-nothing per app; no user override per app; comment/prose text inside IDEs gets code formatting.

**Remaining todos**

- [x] Run vocabulary correction in developer mode with punctuation/code-boundary safety.
- [ ] Add per-app formatting overrides (`auto/plain/developer`).
- [ ] Expand language/tool templates (JS/TS, Python, Rust, Go, SQL, shell).
- [ ] Add a formatting preview/test panel in Settings.

### 8. App-aware writing profiles — 🟡 Partial

- **Resolved (2026-10-18):** app → style mappings are user-editable in **Settings → Writing**. Each profile matches an app or window name, can point at a built-in or custom style, and can opt out with “No style”.
- Precedence is explicit profile → built-in email/chat/document heuristic → default style. Developer contexts never receive a prose style.
- The configuration is stored locally as `writing-profiles.json`; it is loaded at startup so the hotkey path works before Settings is opened.
- Gaps: profiles only steer AI cleanup (Medium/High); per-app cleanup level and formatting mode are still global.

**Remaining todos**

- [x] Settings UI: app → writing style mapping with a global fallback.
- [ ] Per-app cleanup level and formatting mode.
- [x] Profile precedence rules (explicit → built-in → default).
- [x] Store profiles locally and clear them on “Clear all app data”.

### 9. Snippets and custom styles — 🟡 Partial

- Trigger → expansion snippets with word-boundary, case-insensitive replacement, synced to Rust for hotkey dictation (`lib.rs:2503`), managed in Settings.
- **Resolved (2026-10-18):** custom writing styles are user-defined in **Settings → Writing** (name + plain-language instruction) and can be selected as an app profile or the default style.
- Built-in transform presets (Polish, Concise, Professional, Casual, Summarize, Fix Grammar, Prompt) remain available via the transform overlay and voice commands.
- Gaps: no snippet variables, grouping/per-app scoping, or snippet import/export.

**Remaining todos**

- [x] User-defined style presets (name + instruction) usable in AI cleanup.
- [ ] Expose custom styles in the transform overlay and voice commands.
- [ ] Snippet variables: date/time, clipboard, app name, selection.
- [ ] Per-app or per-pack snippet groups.
- [ ] Import/export snippets and detect trigger conflicts.

### 10. Confidence-aware corrections — 🟡 Partial

- Corrections use lexical similarity with `auto_correct_threshold` and a cautious 0.80–0.92 band that requires a canonical anchor nearby (`correct.rs`).
- **Resolved (2026-10-18):** ASR confidence now flows end-to-end.
  - Whisper: average non-special token probability.
  - Apple Speech: average `SFSpeechRecognitionSegment.confidence`, including the live final used for latency reuse.
  - Parakeet: no confidence signal; corrections use the previous defaults.
- Low confidence raises the fuzzy-match bar (`<0.85 → 0.93`, `<0.70 → 0.95`, `<0.55 → 0.97`) and disables the cautious band below 0.70. Exact alias matches stay deterministic.
- `match_confidence` and `asr_confidence` are stored per correction. The Corrections page shows a **Low confidence** badge and a **Needs review** count.
- Zero/unknown confidence is treated as “not reported”, not as certain failure.

**Remaining todos**

- [x] Capture engine confidence (Whisper token probabilities, Apple segment confidence).
- [x] Feed confidence into correction acceptance and store it in the corrections table.
- [x] Surface uncertain corrections in the Corrections page.
- [ ] Calibrate the confidence bands against the eval dataset with real recordings.
- [ ] Add Parakeet confidence if the sidecar can expose token probabilities.

---

## Phase 3 — Intelligence

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 11 | Multilingual and Hinglish handling | 🟡 | Language setting + routing (`app-store.ts:50`, `engines/mod.rs`), Whisper auto-detect, Parakeet v3 locales, Apple locale mapping. Hinglish maps to "auto". |
| 12 | Smart formatting and voice commands | ✅ | Lists/headings (`lib.rs:4491-4660`), developer formatting, voice commands (`lib.rs:1851`), snippets |
| 13 | Model manager and engine fallback | ✅ | Models page, download/pause/resume/cancel, custom models, engine routing + fallback events |
| 14 | Optional live transcription preview | ✅ | Apple Speech partials render in the widget (`widget.tsx`), throttled and toggleable in Settings → General |
| 15 | Latency and accuracy evaluation | ✅ | Per-stage timings persisted (`transcripts.asr_ms` etc.), p50/p95 Speed card, `vocabulary_eval` command + Corrections quality check, `cargo test` in CI |

### 11. Multilingual and Hinglish handling — 🟡 Partial

- `auto/en/hi/hinglish` setting, multilingual Whisper models, Whisper auto-detect, English-only model guard, Parakeet v3 25-language checks, Apple BCP-47 locale mapping, fallback when a language is unsupported.
- Gaps: Hinglish is simply treated as "auto" (`whisper_engine.rs:128`, `apple_speech.rs:220`). No code-switch prompting, transliteration policy, script normalization, or Hinglish-specific evaluation. Voice commands are English-only.

**Remaining todos**

- [ ] Add a Hinglish evaluation set and accuracy baseline.
- [ ] Choose and implement a transliteration/romanization policy (Devanagari vs Latin output).
- [ ] Add code-switch-aware prompts and per-language formatting.
- [ ] Localize voice-command matching (at least Hindi/Hinglish).
- [ ] Show detected language and engine in the widget (transparency).

### 12. Smart formatting and voice commands — ✅ Done

- Rule-based numbered lists, bullets, headings; developer formatting; voice commands for transforms and custom instructions; snippets; enable/disable toggle.
- Caveats: commands require selected text and only match English phrases.

**Remaining todos**

- [ ] Add formatting voice commands ("new paragraph", "bullet list") for plain dictation.
- [ ] Surface the available command list in-app.
- [ ] Localize command phrases.

### 13. Model manager and engine fallback — ✅ Done

- Engine selection (auto/Apple/Whisper/Parakeet), model download with progress/pause/resume/cancel, delete, custom HF model registry, hardware-aware recommendation, explicit fallback with events and UI listeners (`home.tsx:183-226`).
- English/language-aware auto routing and failure reasons.

**Remaining todos**

- [ ] Add a persistent "last engine switch" entry in Settings so it is visible after the toast.
- [ ] Surface per-engine measured speed/accuracy in the Models page.

### 14. Optional live transcription preview — 🟡 Partial

- Apple Speech sidecar runs in live mode during recording and emits `vox-live-transcript` partials/finals (`live_transcript.rs:150-190`).
- The final live result is reused for the final transcript when Apple Speech is selected (`lib.rs:2199-2210`) — a real latency win.
- **Resolved (2026-10-18):** the widget listens for partials and shows the latest words as a single truncated line (last 90 characters) while recording. Updates are coalesced to 150 ms so the native window is not resized on every token, and finals apply immediately.
- Settings → General has a **Live preview** toggle, persisted in SQLite and mirrored to `localStorage` for the widget. The sidecar still runs when the preview is hidden because its final result is reused by the transcription pass.
- Non-Apple engines emit no preview events, so the line simply stays absent.

**Remaining todos**

- [x] Subscribe in `widget.tsx` and render a one-line partial transcript.
- [x] Add a setting to enable/disable the preview.
- [x] Handle non-Apple engines gracefully (no event, no line).
- [x] Cap/truncate text and avoid per-token window resizes.
- [ ] Manually verify Apple Speech permission denial never interrupts dictation.
- [ ] Consider showing the preview in the main window during in-app recording.

### 15. Latency and accuracy evaluation — 🟡 Partial

- **Resolved (2026-10-18):**
  - `TranscriptionResult.timings` reports audio preflight, ASR, postprocess, and total time.
  - Timings are stored per transcript (`audio_preflight_ms`, `transcribe_ms`, `postprocess_ms`, `total_ms`).
  - The dashboard has a **Speed** section with p50/p95 total and p50/p95 ASR time.
  - `vocabulary_eval` runs the TTER/WER/false-correction dataset against the active packs; the Corrections page exposes it as a **Quality check**.
  - CI runs `cargo test --workspace`, which includes the vocabulary eval suite.
- Gaps: insertion/paste time is not in the persisted total; metrics are not split per engine; the dataset is still small and synthetic.

**Remaining todos**

- [x] Return per-stage timings and show p50/p95 in the app.
- [x] Add a `vocabulary_eval` command and run the eval suite in CI.
- [ ] Include insertion/paste time in latency metrics.
- [ ] Split latency and accuracy by engine and model.
- [ ] Expand the dataset with real recordings and per-engine cases.
- [ ] Track correction acceptance/rejection as a production accuracy proxy.

---

## Phase 4 — Differentiation

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 16 | Meeting notes and action items | ✅ | Meeting template, transcript capture, on-device summary/action-item extraction (`note_transform`), Markdown checklists |
| 17 | Cross-device settings synchronization | ✖ | Out of scope — local-only product decision |
| 18 | Advanced voice macros | ✅ | Variables, app scoping, ordered text/key/combo/wait steps, exact-utterance matching, wait + quit-shortcut guards |
| 19 | Optional cloud or local rewriting models | ✅ | Local GGUF rewriting + custom models; cloud is explicitly out of scope |
| 20 | Team dictionaries and shared snippets | ✖ | Out of scope — local-only product decision |

### 16. Meeting notes and action items — ✅ Done

- **Resolved (2026-10-18):** the Notes page now has a meeting workflow.
  - **New meeting note** creates a structured template (Attendees, Notes, Decisions, Action items, Transcript).
  - Dictation into a note whose title starts with “Meeting” appends a timestamped `### Transcript · …` section.
  - **Summarize** and **Action items** run the local text-enhancement model through `note_transform` and append a clearly labelled AI section. Nothing is pasted or uploaded.
  - Preview renders Markdown checklists (`- [ ]` / `- [x]`) as boxed action items.
- Gaps: no speaker diarization, no per-utterance timestamps, no interactive checkbox toggling in preview, and long recordings are limited by the existing 30-minute cap and in-memory WAV loading.

**Remaining todos**

- [x] Meeting note template + transcript capture.
- [x] Local summary and action-item extraction.
- [x] Render action items as a Markdown checklist.
- [ ] Speaker labels / diarization.
- [ ] Interactive checkbox toggling in preview.
- [ ] Segment-level timestamps and a dedicated action-items panel.
- [ ] Export meeting notes (Markdown) from the UI.

### 17. Cross-device settings synchronization — ✖ Out of scope

Product decision (2026-10-18): Vox is local-only. Settings, snippets, vocabulary, and profiles stay on the device; no sync, accounts, or merge model will be built.

- [x] Removed from the roadmap.

### 18. Advanced voice macros — ✅ Done

- **Resolved (2026-10-18):** snippets are now variable macros with ordered steps.
  - Variables: `{date}`, `{time}`, `{datetime}`, `{day}`, `{app}`, `{clipboard}` — resolved at dictation time.
  - Optional app pattern: the snippet only applies when the active app name contains the pattern (case-insensitive).
  - Key steps: `{enter}`, `{tab}`, `{escape}`, `{backspace}`, `{delete}`, arrows, `{home}`, `{end}`, `{pageup}`, `{pagedown}`.
  - Combos: `{cmd+a}`, `{cmd+shift+p}`, `{ctrl+c}`, etc.
  - Waits: `{wait:200}` (capped at 5s each, 10s total).
  - Macros run only when the entire utterance matches the trigger. `cmd+q` is blocked, and steps are capped at 64.
- Gaps: no conditional logic, no confirmation step, and no dedicated macro import/export.

**Remaining todos**

- [x] Macro variables.
- [x] App-scoped macros and matching.
- [x] Multi-step macros: text, key, and wait steps.
- [ ] Conditions and an explicit confirmation step for destructive/external actions.
- [ ] Macro import/export and a dedicated macro editor.

### 19. Optional cloud or local rewriting models — ✅ Done (local only)

- Local rewriting is shipped: GGUF sidecar, cleanup levels, transform presets, Enhance overlay, and a custom model registry for STT/enhance.
- Cloud rewriting is explicitly out of scope. Vox keeps the offline path as the only path.

- [x] Local rewriting models.
- [x] Custom local model registry.
- [x] Cloud marked as a non-goal.

### 20. Team dictionaries and shared snippets — ✖ Out of scope

Product decision (2026-10-18): no teams, shared libraries, or organization accounts. Vocabulary packs and snippets remain local. Local JSON import/export stays available for manual backup.

- [x] Removed from the roadmap.

### 20a. Local backup and portability

- Vocabulary packs can be exported/imported as JSON manually. Snippets have no export yet.
- Scope is manual local backup only: no sharing, roles, or remote source.

**Remaining todos**

- [x] Vocabulary pack JSON import/export.
- [ ] Snippet JSON import/export.
- [ ] One local backup file for settings, snippets, vocabulary, and writing profiles.

---

## Cross-Cutting Findings

1. **Resolved (P0) — Corrections no longer depend on AI cleanup.** The pass now runs for every transcript and in developer contexts with a restricted policy. Filler removal remains opt-in by design.
2. **Resolved (P1) — Live preview is visible.** The widget renders Apple Speech partials behind a Settings toggle.
3. **Resolved (P1) — Raw ASR is captured and viewable.** `asr_text` is stored before processing and the library compares it with the final text.
4. **Resolved (P1) — Undo for insertion exists.** The widget and tray offer `Undo last dictation`; failed insertions emit a toast and can be retried from the tray.
5. **Resolved (P2) — App profiles and custom styles are user-editable.** Settings → Writing owns both, with local JSON persistence.
6. **Resolved (P2) — Eval and latency are product surfaces.** The Speed card and Corrections quality check expose them; CI runs the Rust suite.
7. **Docs drift:** `features.md` still describes cross-platform Windows/Linux goals while `PRODUCT.md` states macOS-only. Worth reconciling.
8. **Resolved (2026-10-18) — Account surface removed.** PocketBase GitHub OAuth, the onboarding sign-in gate, Settings → Account, and the `pocketbase` dependency were deleted. Vox now starts directly at onboarding and stays entirely on-device.

## Suggested Order of Work

1. ~~Fix the cleanup/corrections gating and add regression tests (Phase 1.3).~~ Done 2026-10-18.
2. ~~Add undo-last-dictation and insertion-failure recovery (Phase 1.2).~~ Done 2026-10-18.
3. ~~Capture true raw ASR text and add a raw/final diff view (Phase 1.4).~~ Done 2026-10-18.
4. ~~Surface live preview in the widget (Phase 3.14).~~ Done 2026-10-18.
5. ~~Make app profiles user-editable (Phase 2.8) and add user styles (Phase 2.9).~~ Done 2026-10-18.
6. ~~Capture engine confidence and use it in correction decisions (Phase 2.10).~~ Done 2026-10-18.
7. ~~Expose latency/accuracy metrics and wire eval into CI (Phase 3.15).~~ Done 2026-10-18.
8. ~~Only then start Phase 4, beginning with meeting notes.~~ Done 2026-10-18.
9. ~~Phase 4 in-scope work: meeting notes + local macros.~~ Done 2026-10-18.
10. Local-only polish: decide on default light filler cleanup, add insertion tests, and add a full local backup export.
