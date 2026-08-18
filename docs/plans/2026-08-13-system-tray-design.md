# System Tray Enhancements

## Goal

Turn the existing minimal system tray into a useful control surface for Vox:
quickly start/cancel dictation, open the app, jump to Settings, and quit. Also
make the main-window close button hide the app to the tray instead of exiting,
so Vox can stay running in the background like other dictation utilities.

## Design

### Tray Menu Items

| Item | Behavior |
|---|---|
| Show Vox | Show and focus the main window. |
| Start Dictation | Begin a new recording if none is active. |
| Cancel Dictation | Cancel the active recording. Visible only while recording. |
| Settings | Show the main window and open the Settings screen. |
| Quit | Exit Vox completely. |

The dictation item is dynamic: it reads the recorder state and changes its
label and action between **Start Dictation** and **Cancel Dictation**. This
keeps the menu compact and avoids a disabled state.

### Minimize-to-Tray on Close

When the user clicks the main window close button, Vox intercepts the
`CloseRequested` event, prevents the default close, and hides the main window.
The app continues running and remains accessible from the tray. Users fully exit
via **Quit** in the tray menu.

### Cross-Platform Notes

- Tauri's tray icon already works on macOS, Windows, and Linux in Vox.
- Menu labels are plain text, so they work everywhere Tauri menus are supported.
- The dynamic menu is rebuilt from the current recorder state on each recording
transition, avoiding platform-specific mutable menu APIs where possible.

## Rust Changes

- Add tray item ID constants for the new actions.
- Introduce `create_tray_menu(app, is_recording)` helper that builds the menu
  with the correct dictation label/action.
- Add `refresh_tray_menu(app)` that reads `RecorderState` and rebuilds the tray
  menu.
- Hook menu events to call existing functions: `show_main_window`,
  `start_recording_flow`, `cancel_recording`, and emit `vox-open-settings`.
- Call `refresh_tray_menu` after recording starts, stops, or cancels.
- Attach a `CloseRequested` handler to the main window in `setup` to hide the
  window instead of closing.

## Frontend Changes

- In `App.tsx`, listen for the `vox-open-settings` event and set `activeNav` to
  `"settings"`.

## Testing

- Build passes on macOS (`cargo check`, `pnpm typecheck`, `pnpm build`).
- Tray menu shows the correct dictation action before and during recording.
- Closing the main window hides it; tray still shows Vox.
- Quit from tray exits the app.
- Settings tray item opens the main window on the Settings page.
