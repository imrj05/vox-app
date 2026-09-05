import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, FileText, Mic, Plus, Search, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  deleteNote,
  getNotes,
  saveCorrections,
  saveNote,
  updateNote,
  type Note,
} from "@/lib/db";
import {
  startRecording,
  stopRecording,
  transcribeRecording,
} from "@/lib/native";
import { useAppStore } from "@/store/app-store";

const AUTOSAVE_DELAY_MS = 600;

export function NotesPage() {
  const { selectedModel, engine } = useAppStore();
  // Same rule as home: the pinned model only applies for the Whisper engine
  // (spec §7 — explicit engine selection is honored).
  const requestedModel = engine === "whisper" ? selectedModel : undefined;
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const saveTimer = useRef<number | null>(null);

  const selectNote = (note: Note) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setActiveId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setPreview(false);
  };

  // Load notes on mount
  useEffect(() => {
    let active = true;
    void getNotes()
      .then((rows) => {
        if (!active) return;
        setNotes(rows);
        setLoading(false);
        if (rows.length > 0) {
          setActiveId(rows[0].id);
          setTitle(rows[0].title);
          setContent(rows[0].content);
        }
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const createNote = async () => {
    setError(null);
    try {
      const id = await saveNote("Untitled note", "");
      const rows = await getNotes();
      setNotes(rows);
      const created = rows.find((note) => note.id === id);
      if (created) selectNote(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const scheduleSave = (nextTitle: string, nextContent: string) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (activeId === null) return;
      void updateNote(activeId, nextTitle, nextContent).catch(() => {});
      setNotes((prev) =>
        prev.map((note) =>
          note.id === activeId
            ? { ...note, title: nextTitle, content: nextContent, updated_at: Date.now() }
            : note
        )
      );
    }, AUTOSAVE_DELAY_MS);
  };

  const handleTitleChange = (value: string) => {
    setTitle(value);
    scheduleSave(value, content);
  };

  const handleContentChange = (value: string) => {
    setContent(value);
    scheduleSave(title, value);
  };

  const removeNote = async (id: number) => {
    setError(null);
    try {
      await deleteNote(id);
      const rows = await getNotes();
      setNotes(rows);
      if (activeId === id) {
        if (rows.length > 0) {
          selectNote(rows[0]);
        } else {
          setActiveId(null);
          setTitle("");
          setContent("");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const copyNote = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const toggleDictate = async () => {
    setError(null);
    if (recording) {
      setTranscribing(true);
      try {
        const status = await stopRecording();
        if (status.path) {
          const result = await transcribeRecording(
            status.path,
            requestedModel,
            status.appName,
            status.windowTitle
          );
          const nextContent = content.trim()
            ? `${content.trim()}\n\n${result.text}`
            : result.text;
          await saveCorrections(result.corrections ?? [], result.appName).catch(() => {});
          setContent(nextContent);
          scheduleSave(title, nextContent);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setTranscribing(false);
        setRecording(false);
      }
      return;
    }
    try {
      const status = await startRecording();
      setRecording(status.isRecording);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return notes;
    return notes.filter(
      (note) =>
        note.title.toLowerCase().includes(needle) ||
        note.content.toLowerCase().includes(needle)
    );
  }, [notes, query]);

  return (
    <div className="h-full overflow-hidden bg-background">
      <div className="flex h-full">
        <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card/40">
          <div className="flex items-center gap-2 p-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search notes"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search notes…"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Button
              size="icon-sm"
              variant="outline"
              onClick={() => void createNote()}
              aria-label="New note"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-1 px-2 pb-4">
              {loading ? (
                <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                  <Spinner className="size-3.5" />
                  Loading notes
                </div>
              ) : filtered.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  {query ? "No matching notes." : "No notes yet. Create one to start dictating."}
                </p>
              ) : (
                filtered.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => selectNote(note)}
                    className={cn(
                      "w-full rounded-lg px-3 py-2 text-left transition-colors",
                      activeId === note.id
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    <p className="truncate text-sm font-medium">{note.title || "Untitled note"}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {note.content || "Empty note"}
                    </p>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {activeId === null ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <FileText className="mx-auto h-8 w-8 text-muted-foreground/50" />
                <p className="mt-2 text-sm text-muted-foreground">
                  Select a note or create a new one.
                </p>
              </div>
            </div>
          ) : (
            <>
              <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <Input
                  value={title}
                  onChange={(event) => handleTitleChange(event.target.value)}
                  placeholder="Note title"
                  className="h-8 flex-1 border-transparent bg-transparent text-sm font-medium focus-visible:bg-background"
                />
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    variant={preview ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPreview((value) => !value)}
                  >
                    {preview ? "Edit" : "Preview"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void copyNote()}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void toggleDictate()}
                    disabled={transcribing}
                  >
                    <Mic className="h-4 w-4" />
                    {recording ? "Stop" : transcribing ? "Transcribing…" : "Dictate"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void removeNote(activeId)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </header>
              {error && (
                <p className="border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
                  {error}
                </p>
              )}
              <div className="min-h-0 flex-1">
                {preview ? (
                  <ScrollArea className="h-full">
                    <div className="px-5 py-4 text-sm leading-6 text-foreground/90">
                      {renderMarkdown(content)}
                    </div>
                  </ScrollArea>
                ) : (
                  <Textarea
                    value={content}
                    onChange={(event) => handleContentChange(event.target.value)}
                    placeholder="Start writing or dictate…"
                    className="h-full resize-none rounded-none border-0 bg-transparent px-5 py-4 text-sm leading-6 focus-visible:ring-0"
                  />
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Minimal markdown renderer (headings, lists, code, bold/italic)    */
/* ------------------------------------------------------------------ */

function renderMarkdown(markdown: string): React.ReactNode[] {
  const lines = markdown.split("\n");
  const nodes: React.ReactNode[] = [];
  let listItems: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];

  const flushList = (key: string) => {
    if (listItems.length === 0) return;
    nodes.push(
      <ul key={key} className="my-2 list-disc space-y-1 pl-5">
        {listItems.map((item, index) => (
          <li key={index}>{inlineMarkdown(item)}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((line, index) => {
    const key = `line-${index}`;
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCode) {
        nodes.push(
          <pre key={key} className="my-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
            {codeLines.join("\n")}
          </pre>
        );
        codeLines = [];
        inCode = false;
      } else {
        flushList(key);
        inCode = true;
      }
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      listItems.push(trimmed.slice(2));
      return;
    }
    flushList(key);

    if (trimmed.startsWith("### ")) {
      nodes.push(
        <h3 key={key} className="mb-1 mt-3 text-base font-semibold">
          {inlineMarkdown(trimmed.slice(4))}
        </h3>
      );
    } else if (trimmed.startsWith("## ")) {
      nodes.push(
        <h2 key={key} className="mb-1 mt-4 text-lg font-semibold">
          {inlineMarkdown(trimmed.slice(3))}
        </h2>
      );
    } else if (trimmed.startsWith("# ")) {
      nodes.push(
        <h1 key={key} className="mb-1 mt-4 text-xl font-semibold">
          {inlineMarkdown(trimmed.slice(2))}
        </h1>
      );
    } else if (trimmed === "") {
      nodes.push(<div key={key} className="h-3" />);
    } else {
      nodes.push(<p key={key} className="my-1.5">{inlineMarkdown(trimmed)}</p>);
    }
  });

  flushList("list-end");
  if (inCode && codeLines.length > 0) {
    nodes.push(
      <pre key="code-end" className="my-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
        {codeLines.join("\n")}
      </pre>
    );
  }
  return nodes;
}

function inlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}
