import { useEffect, useMemo, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import {
  CircleHelp,
  Cpu,
  FileText,
  Home,
  Keyboard,
  ListBullet,
  Mic,
  Pencil,
  Settings,
  Sparkles,
  Wand2,
} from "@/components/icons";
import {
  getCorrections,
  getNotes,
  getTranscriptSearchIndex,
  type CorrectionRow,
  type Note,
  type TranscriptSearchRow,
} from "@/lib/db";
import { captureSelectedText } from "@/lib/native";
import { useAppStore } from "@/store/app-store";
import { COMMAND_TARGETS, emitCommand } from "@/lib/commands";

export type NavTarget =
  | "home"
  | "transcripts"
  | "vocabulary"
  | "notes"
  | "models"
  | "settings"
  | "about";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (target: NavTarget) => void;
}

type SearchHit =
  | { kind: "transcript"; item: TranscriptSearchRow }
  | { kind: "note"; item: Note }
  | { kind: "correction"; item: CorrectionRow };

const NAV_ITEMS: Array<{
  target: NavTarget;
  label: string;
  icon: typeof Home;
  shortcut: string;
}> = [
  { target: "home", label: "Dictation", icon: Home, shortcut: "⌘1" },
  { target: "transcripts", label: "Transcript Library", icon: FileText, shortcut: "⌘2" },
  { target: "vocabulary", label: "Vocabulary", icon: ListBullet, shortcut: "⌘3" },
  { target: "notes", label: "Notes", icon: Pencil, shortcut: "⌘4" },
  { target: "models", label: "Models", icon: Cpu, shortcut: "⌘5" },
  { target: "settings", label: "Settings", icon: Settings, shortcut: "⌘6" },
];

const SETTINGS_SECTIONS = [
  { id: "general", label: "Settings · General" },
  { id: "transcription", label: "Settings · Transcription" },
  { id: "writing", label: "Settings · Writing" },
  { id: "snippets", label: "Settings · Snippets" },
  { id: "shortcuts", label: "Settings · Shortcuts" },
  { id: "permissions", label: "Settings · Permissions" },
  { id: "privacy", label: "Settings · Privacy" },
  { id: "data", label: "Settings · Data" },
];

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
}: CommandPaletteProps) {
  const { engine, setEngine, isRecording } = useAppStore();
  const [query, setQuery] = useState("");
  const [transcripts, setTranscripts] = useState<TranscriptSearchRow[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [corrections, setCorrections] = useState<CorrectionRow[]>([]);

  // Load the searchable content once per open. The lists are small (capped by
  // the DB queries), so filtering in memory keeps the palette instant.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all([
      getTranscriptSearchIndex(1000).catch(() => []),
      getNotes().catch(() => []),
      getCorrections().catch(() => []),
    ]).then(([t, n, c]) => {
      if (cancelled) return;
      setTranscripts(t);
      setNotes(n);
      setCorrections(c);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const hits = useMemo<SearchHit[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    const transcriptHits: SearchHit[] = transcripts
      .filter(
        (item) =>
          item.preview.toLowerCase().includes(needle) ||
          (item.app_name ?? "").toLowerCase().includes(needle)
      )
      .slice(0, 6)
      .map((item) => ({ kind: "transcript", item }));

    const noteHits: SearchHit[] = notes
      .filter(
        (item) =>
          item.title.toLowerCase().includes(needle) ||
          item.content.toLowerCase().includes(needle)
      )
      .slice(0, 5)
      .map((item) => ({ kind: "note", item }));

    const correctionHits: SearchHit[] = corrections
      .filter(
        (item) =>
          item.source.toLowerCase().includes(needle) ||
          item.canonical.toLowerCase().includes(needle)
      )
      .slice(0, 5)
      .map((item) => ({ kind: "correction", item }));

    return [...transcriptHits, ...noteHits, ...correctionHits];
  }, [query, transcripts, notes, corrections]);

  const run = (action: () => void) => {
    setQuery("");
    onOpenChange(false);
    // Let the dialog close before the action mutates the page underneath.
    window.setTimeout(action, 0);
  };

  const startTransform = async () => {
    try {
      const text = await captureSelectedText();
      emitCommand(COMMAND_TARGETS.app, "show-transform", text);
    } catch (error) {
      emitCommand(COMMAND_TARGETS.app, "show-transform", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const isSearching = query.trim().length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
      title="Command palette"
      description="Search your dictations, notes, and vocabulary, or run a command."
    >
      <Command className="h-auto">
        <CommandInput
          placeholder="Search transcripts, notes, vocabulary…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>

          {isSearching ? (
            hits.length > 0 ? (
              <CommandGroup heading="Search results">
                {hits.map((hit) => {
                  if (hit.kind === "transcript") {
                    return (
                      <CommandItem
                        key={`t-${hit.item.id}`}
                        value={`transcript ${hit.item.id} ${hit.item.preview} ${hit.item.app_name ?? ""}`}
                        onSelect={() =>
                          run(() => {
                            onNavigate("transcripts");
                            emitCommand(
                              COMMAND_TARGETS.transcripts,
                              "focus-transcript",
                              hit.item.id
                            );
                          })
                        }
                      >
                        <FileText />
                        <span className="min-w-0 truncate">{hit.item.preview}</span>
                        <CommandShortcut>{hit.item.app_name ?? "Unknown"}</CommandShortcut>
                      </CommandItem>
                    );
                  }
                  if (hit.kind === "note") {
                    return (
                      <CommandItem
                        key={`n-${hit.item.id}`}
                        value={`note ${hit.item.id} ${hit.item.title} ${hit.item.content}`}
                        onSelect={() =>
                          run(() => {
                            onNavigate("notes");
                            emitCommand(COMMAND_TARGETS.notes, "focus-note", hit.item.id);
                          })
                        }
                      >
                        <Pencil />
                        <span className="min-w-0 truncate">
                          {hit.item.title || "Untitled note"}
                        </span>
                        <CommandShortcut>Note</CommandShortcut>
                      </CommandItem>
                    );
                  }
                  return (
                    <CommandItem
                      key={`c-${hit.item.source}-${hit.item.canonical}`}
                      value={`correction ${hit.item.source} ${hit.item.canonical}`}
                      onSelect={() =>
                        run(() => {
                          onNavigate("vocabulary");
                          emitCommand(
                            COMMAND_TARGETS.vocabulary,
                            "focus-correction",
                            hit.item
                          );
                        })
                      }
                    >
                      <ListBullet />
                      <span className="min-w-0 truncate">
                        {hit.item.source} → {hit.item.canonical}
                      </span>
                      <CommandShortcut>{hit.item.count}×</CommandShortcut>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null
          ) : (
            <>
              <CommandGroup heading="Actions">
                <CommandItem
                  value="toggle dictation"
                  onSelect={() =>
                    run(() => {
                      onNavigate("home");
                      emitCommand(COMMAND_TARGETS.home, "toggle-recording");
                    })
                  }
                >
                  <Mic />
                  <span>{isRecording ? "Stop dictation" : "Start dictation"}</span>
                  <CommandShortcut>⌘⇧D</CommandShortcut>
                </CommandItem>
                <CommandItem
                  value="new note"
                  onSelect={() =>
                    run(() => {
                      onNavigate("notes");
                      emitCommand(COMMAND_TARGETS.notes, "new-note");
                    })
                  }
                >
                  <Pencil />
                  <span>New note</span>
                  <CommandShortcut>⌘N</CommandShortcut>
                </CommandItem>
                <CommandItem
                  value="transform selected text"
                  onSelect={() => run(() => void startTransform())}
                >
                  <Wand2 />
                  <span>Transform selected text</span>
                  <CommandShortcut>⌘⇧V</CommandShortcut>
                </CommandItem>
                <CommandItem
                  value="new meeting note"
                  onSelect={() =>
                    run(() => {
                      onNavigate("notes");
                      emitCommand(COMMAND_TARGETS.notes, "new-note", "meeting");
                    })
                  }
                >
                  <Sparkles />
                  <span>New meeting note</span>
                </CommandItem>
              </CommandGroup>

              <CommandSeparator />

              <CommandGroup heading="Go to">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <CommandItem
                      key={item.target}
                      value={`go ${item.label}`}
                      onSelect={() => run(() => onNavigate(item.target))}
                    >
                      <Icon />
                      <span>{item.label}</span>
                      <CommandShortcut>{item.shortcut}</CommandShortcut>
                    </CommandItem>
                  );
                })}
                <CommandItem
                  value="go About"
                  onSelect={() => run(() => onNavigate("about"))}
                >
                  <CircleHelp />
                  <span>About</span>
                </CommandItem>
              </CommandGroup>

              <CommandSeparator />

              <CommandGroup heading="Switch engine">
                {(["apple", "whisper", "parakeet"] as const).map((value) => (
                  <CommandItem
                    key={value}
                    value={`engine ${value}`}
                    onSelect={() => run(() => void setEngine(value))}
                  >
                    <Cpu />
                    <span className="capitalize">{engineLabel(value)}</span>
                    {engine === value ? (
                      <Badge variant="secondary" className="ml-auto">
                        Active
                      </Badge>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>

              <CommandSeparator />

              <CommandGroup heading="Settings">
                {SETTINGS_SECTIONS.map((section) => (
                  <CommandItem
                    key={section.id}
                    value={section.label}
                    onSelect={() =>
                      run(() => {
                        onNavigate("settings");
                        emitCommand(
                          COMMAND_TARGETS.settings,
                          "open-settings-section",
                          section.id
                        );
                      })
                    }
                  >
                    <Settings />
                    <span>{section.label}</span>
                  </CommandItem>
                ))}
                <CommandItem
                  value="Vocabulary Packs"
                  onSelect={() =>
                    run(() => {
                      onNavigate("vocabulary");
                      emitCommand(
                        COMMAND_TARGETS.vocabulary,
                        "open-vocabulary-tab",
                        "packs"
                      );
                    })
                  }
                >
                  <ListBullet />
                  <span>Vocabulary · Packs</span>
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Keyboard className="size-3.5" />
          ↑↓ to navigate · ↵ to run · esc to close
        </span>
        <span>Searches {transcripts.length + notes.length + corrections.length} items</span>
      </div>
    </CommandDialog>
  );
}

function engineLabel(value: string) {
  switch (value) {
    case "apple":
      return "Apple Speech";
    case "whisper":
      return "Whisper";
    case "parakeet":
      return "Parakeet";
    default:
      return value;
  }
}
