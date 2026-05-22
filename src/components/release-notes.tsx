import { type Update } from "@tauri-apps/plugin-updater"

export function getUpdateNotes(update: Update | null) {
  if (!update) return ""

  const updateWithNotes = update as Update & { body?: string; notes?: string }
  return updateWithNotes.body || updateWithNotes.notes || "No changelog was included for this update."
}

export function renderReleaseNotes(notes: string) {
  return notes.split("\n").map((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) return null

    if (trimmed.startsWith("## ")) {
      return (
        <p key={`${trimmed}-${index}`} className="mt-4 text-sm font-semibold text-foreground first:mt-0">
          {trimmed.replace(/^##\s+/, "")}
        </p>
      )
    }

    if (trimmed.startsWith("### ")) {
      return (
        <p key={`${trimmed}-${index}`} className="mt-3 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {trimmed.replace(/^###\s+/, "")}
        </p>
      )
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      return (
        <p key={`${trimmed}-${index}`} className="pl-3 text-sm leading-6 text-muted-foreground before:mr-2 before:content-['-']">
          {trimmed.replace(/^[-*]\s+/, "")}
        </p>
      )
    }

    return (
      <p key={`${trimmed}-${index}`} className="text-sm leading-6 text-muted-foreground">
        {trimmed}
      </p>
    )
  })
}
