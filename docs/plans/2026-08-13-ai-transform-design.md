# AI Transform / Rewrite

## Goal

Turn Vox from a dictation-only tool into a voice AI editor. Users press
**⌘+Shift+V** to open a small transform menu over the current app, pick a
preset (Polish, Concise, Professional, Casual, Summarize, Fix grammar) or enter
a custom prompt, and have the local Qwen enhancement model rewrite the
selected text in place.

## Architecture

### Trigger

- Rust registers a new global shortcut **⌘+Shift+V** for transforms.
- When triggered, Rust captures the currently selected text from the active
  application, then emits `vox-show-transform` to the frontend with the
  captured text.

### Selection capture

- Save the current clipboard contents.
- Simulate the platform copy shortcut (Cmd+C on macOS, Ctrl+C on Windows/Linux).
- Wait a short delay for the app to respond.
- Read the clipboard via the `arboard` crate.
- Restore the original clipboard after the transform is complete.

This approach works across macOS, Windows, and Linux without per-platform
accessibility selection APIs.

### Transform overlay (React)

- `App.tsx` listens for `vox-show-transform` and opens
  `TransformOverlay`.
- The overlay shows:
  - A preview of the selected text (truncated if very long).
  - Preset buttons: Polish, Make concise, Professional, Casual, Summarize,
    Fix grammar.
  - A custom prompt input.
  - Cancel / close.

### Preset prompts

Each preset maps to a system prompt sent to the local Qwen model:

- **Polish** — fix grammar, spelling, punctuation, and flow while preserving
  meaning.
- **Make concise** — shorten the text, remove redundancy.
- **Professional** — formal, polite, workplace-ready tone.
- **Casual** — friendly, relaxed, conversational tone.
- **Summarize** — brief bullet summary of key points.
- **Fix grammar** — minimal grammar/spelling fixes only.

### Running the transform

- The frontend calls a new Rust command `apply_transform { text, prompt }`.
- Rust prepends the system prompt to the selected text and runs it through the
  existing local Qwen enhancement pipeline (`text_enhancement.rs`).
- The rewritten text is pasted back into the active application via the
  clipboard/paste shortcut (Cmd+V / Ctrl+V), then the original clipboard is
  restored.

### Error handling

- If no text is selected, show a toast: “Select text first, then press
  ⌘+Shift+V.”
- If the enhancement model is missing, show: “Download the enhancement model
  in Settings → Models.”
- Clipboard errors are logged and surfaced as a short toast.

## Rust Changes

- Add `arboard` dependency for clipboard read/write.
- Register **⌘+Shift+V** as the transform shortcut in `setup`.
- Add `capture_selected_text()` helper using `arboard` + `enigo` copy shortcut.
- Add `apply_transform` invoke handler that:
  - checks model availability,
  - builds the full prompt,
  - calls the Qwen enhancement function,
  - pastes the result and restores clipboard.
- Emit `vox-show-transform` with the captured text and an error variant.

## Frontend Changes

- Add `TransformOverlay` component with preset grid + custom prompt input.
- Add `vox-show-transform` listener in `App.tsx`.
- Add `applyTransform(text, prompt)` helper in `src/lib/native.ts`.
- Add minimal toast feedback using a lightweight inline state (no new toast
  library; reuse the overlay’s own status text).

## Testing

- `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `cargo check` pass.
- ⌘+Shift+V opens the overlay when text is selected.
- Presets produce rewritten text and paste it back.
- Custom prompt transforms selected text.
- Empty selection surfaces a clear message.
- Clipboard is restored after transform.
