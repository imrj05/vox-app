import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowTurnBackward,
  Check,
  Copy,
  FileText,
  Mail,
  Pencil,
  Search,
  Trash2,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
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
import { cn } from "@/lib/utils";
import { deleteTranscript, getTranscripts, pruneTranscripts, updateTranscriptText, type TranscriptRow } from "@/lib/db";
import { resolveAppIcon } from "@/lib/native";
import { openExternalLink } from "@/lib/external-link";
import { useAppStore } from "@/store/app-store";

const TRANSCRIPT_LIBRARY_LIMIT = 1000;

export function TranscriptsPage() {
  const reduceMotion = useReducedMotion();
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
            <div className="panel divide-y divide-border overflow-hidden">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex gap-3.5 p-5">
                  <Skeleton className="size-8 shrink-0 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-44" />
                    <Skeleton className="h-3.5 w-full max-w-2xl" />
                    <Skeleton className="h-3.5 w-2/3 max-w-lg" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-4 text-sm text-destructive">
              {error}
            </div>
          ) : filtered.length > 0 ? (
            <div className="panel divide-y divide-border overflow-hidden">
              {filtered.map((item) => (
                <article
                  key={item.id}
                  className="flex gap-3.5 p-4 transition-colors hover:bg-muted/25 sm:p-5"
                >
                  <AppBadge
                    name={item.app_name ?? "Unknown app"}
                    iconSrc={appIcons[item.app_name ?? "Unknown app"] ?? null}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-sm font-medium text-foreground">
                        {item.app_name ?? "Unknown app"}
                      </p>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatTranscriptDate(item.created_at)}
                      </span>
                      {item.language ? (
                        <span className="text-xs text-muted-foreground">
                          · {item.language}
                        </span>
                      ) : null}
                      {item.engine ? (
                        <span className="text-xs capitalize text-muted-foreground">
                          · {item.engine}
                        </span>
                      ) : null}
                      {hasAiCleanup(item) ? (
                        <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                          AI cleaned
                        </Badge>
                      ) : null}
                      {editingId === item.id ? null : (
                        <div className="ml-auto flex shrink-0 items-center gap-0.5">
                          <RowAction label="Edit" onClick={() => startEdit(item)}>
                            <Pencil className="h-4 w-4" />
                          </RowAction>
                          {hasAiCleanup(item) ? (
                            <RowAction
                              label="Undo AI edit"
                              onClick={() => void undoAiEdit(item)}
                            >
                              <ArrowTurnBackward className="h-4 w-4" />
                            </RowAction>
                          ) : null}
                          <RowAction
                            label={copiedId === item.id ? "Copied" : "Copy"}
                            onClick={() => void copyTranscript(item)}
                          >
                            <span className="relative grid size-4 place-items-center [&>*]:col-start-1 [&>*]:row-start-1">
                              <AnimatePresence initial={false}>
                                {copiedId === item.id ? (
                                  <motion.span
                                    key="copied"
                                    initial={reduceMotion ? false : { opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                                    animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                                    exit={reduceMotion ? undefined : { opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                                    transition={reduceMotion ? { duration: 0 } : { type: "spring", duration: 0.3, bounce: 0 }}
                                  >
                                    <Check className="h-4 w-4 text-primary" />
                                  </motion.span>
                                ) : (
                                  <motion.span
                                    key="copy"
                                    initial={reduceMotion ? false : { opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                                    animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                                    exit={reduceMotion ? undefined : { opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                                    transition={reduceMotion ? { duration: 0 } : { type: "spring", duration: 0.3, bounce: 0 }}
                                  >
                                    <Copy className="h-4 w-4" />
                                  </motion.span>
                                )}
                              </AnimatePresence>
                            </span>
                          </RowAction>
                          <RowAction label="Report an issue" onClick={() => reportTranscript(item)}>
                            <Mail className="h-4 w-4" />
                          </RowAction>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <RowAction label="Delete" destructive>
                                <Trash2 className="h-4 w-4" />
                              </RowAction>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete transcript?</AlertDialogTitle>
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
                                  Delete transcript
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      )}
                    </div>
                    {editingId === item.id ? (
                      <div className="mt-2 space-y-2">
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
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground/90">
                        {item.text}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="font-mono tabular-nums">
                        {countWords(item.text)} words
                      </span>
                      {item.duration_seconds ? (
                        <>
                          <span aria-hidden>·</span>
                          <span className="font-mono tabular-nums">
                            {formatDurationCompact(item.duration_seconds)} audio
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card px-5 py-12 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                <FileText className="size-5 text-muted-foreground" />
              </div>
              <p className="mt-3 text-sm font-medium text-foreground">
                {query.trim() ? "No matching transcripts" : "No transcripts yet"}
              </p>
              <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                {query.trim()
                  ? "Try a different search — you can match on transcript text or app name."
                  : "Start dictating anywhere with your hotkey and your history will appear here."}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function RowAction({
  label,
  destructive,
  children,
  ...props
}: React.ComponentProps<"button"> & {
  label: string;
  destructive?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          className={cn(
            "text-muted-foreground",
            destructive
              ? "hover:bg-destructive/10 hover:text-destructive"
              : "hover:text-foreground"
          )}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
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
        <img
          src={iconSrc}
          alt=""
          width="28"
          height="28"
          loading="lazy"
          className="size-7 rounded-md object-cover outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
        />
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
