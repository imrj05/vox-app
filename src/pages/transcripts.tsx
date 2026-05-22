import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { deleteTranscript, getTranscripts, type TranscriptRow } from "@/lib/db";
import { resolveAppIcon } from "@/lib/native";

const TRANSCRIPT_LIBRARY_LIMIT = 1000;

export function TranscriptsPage() {
  const [history, setHistory] = useState<TranscriptRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [appIcons, setAppIcons] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let active = true;
    void getTranscripts(TRANSCRIPT_LIBRARY_LIMIT)
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
      });

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
        <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-5 p-6 lg:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-foreground">Transcript library</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Search, copy, and manage your local dictation history.
              </p>
            </div>
            <div className="relative w-full lg:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search transcripts or apps"
                className="h-11 rounded-xl bg-card pl-9"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
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
            <div className="grid gap-3">
              {filtered.map((item) => (
                <article key={item.id} className="surface-depth-soft rounded-2xl border border-border bg-card p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <AppBadge
                          name={item.app_name ?? "Unknown app"}
                          iconSrc={appIcons[item.app_name ?? "Unknown app"] ?? null}
                        />
                        <p className="text-sm font-medium text-foreground">{item.app_name ?? "Unknown app"}</p>
                        <span className="text-xs text-muted-foreground">{formatTranscriptDate(item.created_at)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/90">{item.text}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        <span className="rounded-full border border-border bg-background px-2.5 py-1 font-mono">
                          {countWords(item.text)} words
                        </span>
                        {item.duration_seconds ? (
                          <span className="rounded-full border border-border bg-background px-2.5 py-1 font-mono">
                            {formatDurationCompact(item.duration_seconds)} audio
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="outline" size="sm" onClick={() => void copyTranscript(item)}>
                        {copiedId === item.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        {copiedId === item.id ? "Copied" : "Copy"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => void removeTranscript(item.id)}>
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
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
    <div className="surface-depth-soft rounded-2xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold text-primary">{value}</p>
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
    <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-sidebar-accent font-mono text-[11px] font-semibold text-primary">
      {iconSrc ? (
        <img src={iconSrc} alt="" className="h-7 w-7 rounded-md object-cover" />
      ) : (
        initials
      )}
    </div>
  );
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
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
