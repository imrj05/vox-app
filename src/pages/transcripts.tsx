import { useEffect, useMemo, useState } from "react";
import { ArrowTurnBackward, Check, Copy, Pencil, Search, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { correctionPairs } from "@/lib/dictionary";
import { recordVocabularyCorrection } from "@/lib/vocabulary";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { deleteTranscript, getTranscripts, pruneTranscripts, updateTranscriptText, type TranscriptRow } from "@/lib/db";
import { resolveAppIcon } from "@/lib/native";
import { openExternalLink } from "@/lib/external-link";
import { useAppStore } from "@/store/app-store";

const TRANSCRIPT_LIBRARY_LIMIT = 1000;

export function TranscriptsPage() {
  const [history, setHistory] = useState<TranscriptRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [appIcons, setAppIcons] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let active = true;
    // Enforce configurable transcript retention before loading the library.
    const retention = useAppStore.getState().transcriptRetention;
    const prune = retention !== "forever"
      ? pruneTranscripts(Number(retention)).catch(() => 0)
      : Promise.resolve(0);
    void prune.then(() =>
      getTranscripts(TRANSCRIPT_LIBRARY_LIMIT)
        .then((rows) => {
          if (!active) return;
          setHistory(rows);
          setError(null);
        })
        .catch((err) => {
          if (!active) return;
          setError(err instanceof Error ? err.message : "Could not load transcripts");
        })
        .finally(() => {
          if (active) setLoading(false);
        })
    );

    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return history;

    return history.filter((item) => {
      const appName = item.app_name ?? "Unknown app";
      return item.text.toLowerCase().includes(needle) || appName.toLowerCase().includes(needle);
    });
  }, [history, query]);

  const copyTranscript = async (item: TranscriptRow) => {
    await navigator.clipboard.writeText(item.text);
    setCopiedId(item.id);
    window.setTimeout(() => setCopiedId(null), 1400);
  };

  const removeTranscript = async (id: number) => {
    await deleteTranscript(id);
    setHistory((items) => items.filter((item) => item.id !== id));
  };

  const undoAiEdit = async (item: TranscriptRow) => {
    if (!item.raw_text) return;
    await updateTranscriptText(item.id, item.raw_text);
    setHistory((items) =>
      items.map((entry) =>
        entry.id === item.id ? { ...entry, text: item.raw_text! } : entry
      )
    );
  };

  const startEdit = (item: TranscriptRow) => {
    setEditingId(item.id);
    setEditDraft(item.text);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft("");
  };

  const saveEdit = async (item: TranscriptRow) => {
    const next = editDraft.trim();
    if (!next) return;
    await updateTranscriptText(item.id, next);
    // Vocabulary Packs learning (spec §17): feed word-level corrections to the
    // local vocabulary engine so repeated corrections rank higher. Best-effort.
    for (const pair of correctionPairs(item.text, next)) {
      void recordVocabularyCorrection(pair.source, pair.canonical).catch(() => undefined);
    }
    setHistory((items) =>
      items.map((entry) => (entry.id === item.id ? { ...entry, text: next } : entry))
    );
    setEditingId(null);
    setEditDraft("");
  };

  const reportTranscript = (item: TranscriptRow) => {
    const subject = encodeURIComponent("Vox transcription issue");
    const body = encodeURIComponent(
      `App: ${item.app_name ?? "Unknown"}\n\nTranscript:\n${item.text.slice(0, 2000)}\n\n---\nDescribe the issue here.`
    );
    openExternalLink(`mailto:?subject=${subject}&body=${body}`);
  };

  useEffect(() => {
    const appNames = Array.from(
      new Set(history.map((item) => item.app_name ?? "Unknown app"))
    ).filter((name) => !(name in appIcons) && name !== "Unknown app");

    if (appNames.length === 0) return;

    let cancelled = false;
    void Promise.all(
      appNames.map(async (name) => [name, await resolveAppIcon(name).catch(() => null)] as const)
    ).then((entries) => {
      if (cancelled) return;
      setAppIcons((prev) => ({
        ...prev,
        ...Object.fromEntries(entries),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [history, appIcons]);

  return (
    <div className="h-full overflow-hidden bg-background">
      <ScrollArea className="h-full">
        <div className="page-shell">
          <header className="page-header">
            <div>
              <h1 className="page-title">Transcript Library</h1>
              <p className="page-description">
                Search, copy, and manage your local dictation history.
              </p>
            </div>
            <div className="relative w-full lg:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search transcripts or apps"
                name="transcript-search"
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search transcripts or apps…"
                className="h-10 rounded-lg bg-card pl-9"
              />
            </div>
          </header>

          <div className="stat-strip divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <LibraryStat label="Transcripts" value={history.length.toLocaleString()} />
            <LibraryStat label="Visible" value={filtered.length.toLocaleString()} />
            <LibraryStat label="Words" value={history.reduce((sum, item) => sum + countWords(item.text), 0).toLocaleString()} />
          </div>

          {loading ? (
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading transcript history
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-4 text-sm text-destructive">
              {error}
            </div>
          ) : filtered.length > 0 ? (
            <div className="panel divide-y divide-border overflow-hidden">
              {filtered.map((item) => (
                <article key={item.id} className="p-4 transition-colors hover:bg-muted/25">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <AppBadge
                          name={item.app_name ?? "Unknown app"}
                          iconSrc={appIcons[item.app_name ?? "Unknown app"] ?? null}
                        />
                        <p className="text-sm font-medium text-foreground">{item.app_name ?? "Unknown app"}</p>
                        <span className="text-xs text-muted-foreground">{formatTranscriptDate(item.created_at)}</span>
                        {item.language ? (
                          <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal">
                            {item.language}
                          </Badge>
                        ) : null}
                        {item.engine ? (
                          <Badge variant="outline" className="h-4 capitalize px-1.5 text-[10px] font-normal">
                            {item.engine}
                          </Badge>
                        ) : null}
                        {hasAiCleanup(item) ? (
                          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                            AI cleaned
                          </Badge>
                        ) : null}
                      </div>
                      {editingId === item.id ? (
                        <div className="space-y-2">
                          <Textarea
                            value={editDraft}
                            onChange={(event) => setEditDraft(event.target.value)}
                            rows={Math.min(8, Math.max(3, editDraft.split("\n").length))}
                            className="min-h-20 text-sm leading-6"
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => void saveEdit(item)} disabled={!editDraft.trim()}>
                              <Check className="h-4 w-4" />
                              Save
                            </Button>
                            <Button variant="ghost" size="sm" onClick={cancelEdit}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/90">{item.text}</p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        <span className="font-mono tabular-nums">
                          {countWords(item.text)} words
                        </span>
                        {item.duration_seconds ? (
                          <span className="font-mono tabular-nums">
                            {formatDurationCompact(item.duration_seconds)} audio
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {editingId === item.id ? null : (
                        <Button variant="outline" size="sm" onClick={() => startEdit(item)}>
                          <Pencil className="h-4 w-4" />
                          Edit
                        </Button>
                      )}
                      {hasAiCleanup(item) ? (
                        <Button variant="outline" size="sm" onClick={() => void undoAiEdit(item)}>
                          <ArrowTurnBackward className="h-4 w-4" />
                          Undo AI edit
                        </Button>
                      ) : null}
                      <Button variant="outline" size="sm" onClick={() => void copyTranscript(item)}>
                        {copiedId === item.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        {copiedId === item.id ? "Copied" : "Copy"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => reportTranscript(item)}>
                        Report
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Transcript?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This permanently removes the transcript from your local history.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => void removeTranscript(item.id)}
                            >
                              Delete Transcript
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center">
              <p className="text-sm font-medium text-foreground">No transcripts found</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Try a different search, or start dictating to build your local history.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function LibraryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-cell">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function AppBadge({
  name,
  iconSrc,
}: {
  name: string;
  iconSrc: string | null;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 font-mono text-[11px] font-semibold text-primary">
      {iconSrc ? (
        <img src={iconSrc} alt="" width="28" height="28" loading="lazy" className="h-7 w-7 rounded-md object-cover" />
      ) : (
        initials
      )}
    </div>
  );
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function hasAiCleanup(item: TranscriptRow): boolean {
  if (!item.raw_text) return false;
  return item.raw_text.trim() !== item.text.trim();
}

function formatDurationCompact(seconds: number) {
  if (!seconds || seconds <= 0) return "0m";
  if (seconds < 60) return `${seconds}s`;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatTranscriptDate(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
