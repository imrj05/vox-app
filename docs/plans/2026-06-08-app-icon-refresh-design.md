# Vox App Icon Refresh Design

## Goal

Refresh the Vox app icon so it matches the product's current teal visual system and clearly communicates voice dictation at small desktop, taskbar, and favicon sizes.

## Direction

Use the supplied icon direction as the source of truth: a white rounded tile with teal microphone and waveform forms, a dark text insertion cue, and soft depth. The SVG keeps the outer canvas transparent and changes tile/text colors with `prefers-color-scheme` for light and dark mode. It combines three functional cues:

- Microphone: voice capture and push-to-talk recording.
- Waveform: live audio and transcription activity.
- Text line: dictated speech being inserted as text.

This replaces the older blue-on-white illustration with a mark that feels closer to Vox's UI palette and remains readable when rendered as 16px, 32px, and platform bundle icons.

## Asset Plan

Create one responsive SVG source at `public/logo.svg`, use it directly for the web favicon and in-app logo display, export `public/logo.png` for static fallbacks, and regenerate `src-tauri/icons/*` from a concrete light-mode source at `src-tauri/icons/icon-source.svg`.

## Validation

Check the generated 512px, 128px, and 32px assets visually. Confirm the web build still passes after replacing the icon references.
