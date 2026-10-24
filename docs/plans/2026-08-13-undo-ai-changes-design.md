# Undo AI Changes UI

## Goal

Let users recover the original raw transcription after AI cleanup ran. The
backend already preserves `raw_text` whenever AI cleanup is applied; this
feature surfaces that backup in the Transcript Library with a single
**Undo AI edit** action.

## Design

### Visibility

- Each transcript row that has a non-empty `raw_text` value, and where
  `raw_text` differs from the cleaned `text`, shows:
  - An **“AI cleaned”** badge next to the app/date line.
  - An **“Undo AI edit”** button in the row actions.
- Rows with no `raw_text` or where `raw_text == text` look the same as today.

### Action

- Clicking **Undo AI edit** updates the row in place so `text = raw_text`.
- The change is persisted to SQLite.
- The list refreshes locally without a full reload.
- After undo, the badge and button disappear for that row because the values now
  match.

### Data model

No schema changes. Reuse the existing `raw_text` column on the `transcripts`
table and add an `UPDATE` helper in `src/lib/db.ts`.

## Backend Changes

- Add `updateTranscriptText(id: number, text: string): Promise<void>` in
  `src/lib/db.ts` that executes:
  ```sql
  UPDATE transcripts SET text = $1 WHERE id = $2
  ```

## Frontend Changes

- In `src/pages/transcripts.tsx`:
  - Add a helper `hasAiCleanup(item)` that returns true when `raw_text` exists and
    differs from `text`.
  - Render an **“AI cleaned”** badge when that helper returns true.
  - Add an **“Undo AI edit”** button next to Copy/Delete for cleaned rows.
  - Implement `undoAiEdit(item)` that calls `updateTranscriptText` and replaces
    the row in local state with the restored `text`.

## Testing

- `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `cargo check` pass.
- A transcript produced with AI cleanup shows the badge and undo button.
- Clicking Undo restores the original text, hides the badge/button, and updates
  the word count.
- Plain transcripts (no AI cleanup) never show the badge or button.
