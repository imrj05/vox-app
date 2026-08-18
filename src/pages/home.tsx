import { lazy, Suspense, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Check, CheckCircle2, Copy, Mic, Pencil, Trash2, Wand2 } from "@/components/icons";
import {
  deleteRecordingFile,
  getNativeStatus,
  resolveAppIcon,
  startRecording,
  stopRecording,
  transcribeRecording,
  setGlobalShortcut,
  formatShortcut,
  isEventTapOnlyShortcut,
  type NativeStatus,
  type RecordingStatus,
  type TranscriptionResult,
} from "@/lib/native";
import { AppToast } from "@/components/app-toast";
import {
  saveTranscript,
  getTranscripts,
  deleteTranscript,
  type TranscriptRow,
} from "@/lib/db";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { GlowRecordButton } from "@/components/glow-record-button";
import { HotkeyPicker } from "@/components/hotkey-picker";
import { withTimeout } from "@/lib/async";
import { useAppStore } from "@/store/app-store";

const HISTORY_LOAD_TIMEOUT_MS = 5000;
const ANALYTICS_HISTORY_LIMIT = 1000;

const AnalyticsPanels = lazy(() =>
  import("@/pages/home-analytics").then(({ AnalyticsPanels }) => ({ default: AnalyticsPanels }))
);

export function HomePage() {
  const { hotkey, setHotkey, selectedModel, dictionary, triggerMode } = useAppStore();
  const [nativeStatus, setNativeStatus] = useState<NativeStatus | null>(null);
  const [recordingStatus, setRecordingStatus] =
    useState<RecordingStatus | null>(null);
  const [transcriptionResult, setTranscriptionResult] =
    useState<TranscriptionResult | null>(null);
  const [history, setHistory] = useState<TranscriptRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryPath, setRetryPath] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [hotkeyPickerOpen, setHotkeyPickerOpen] = useState(false);
  const [appIcons, setAppIcons] = useState<Record<string, string | null>>({});
  const [toast, setToast] = useState<{
    title: string;
    detail?: string;
    tone?: "success" | "warning";
  } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const saveHotkey = async (shortcut: string) => {
    await setGlobalShortcut(shortcut);
    await setHotkey(shortcut);
  };

  const widgetMode = recordingStatus?.isRecording
    ? "recording"
    : transcribing
      ? "transcribing"
      : null;

  const applyTranscriptionResult = async (result: TranscriptionResult) => {
    setTranscriptionResult(result);
    await saveTranscript(result.text, undefined, result.appName, result.durationSeconds, result.rawText ?? null, result.language ?? "en");
    await deleteRecordingFile(result.audioPath).catch(() => {});
    setHistory(await getTranscripts(ANALYTICS_HISTORY_LIMIT));
  };

  // Load transcript history on mount
  useEffect(() => {
    let active = true;

    void withTimeout(
      getTranscripts(ANALYTICS_HISTORY_LIMIT),
      HISTORY_LOAD_TIMEOUT_MS,
      "Timed out loading transcript history"
    )
      .then((rows) => {
        if (!active) return;
        setHistory(rows);
        setHistoryError(null);
      })
      .catch((err) => {
        if (!active) return;
        setHistory([]);
        setHistoryError(err instanceof Error ? err.message : "Could not load transcript history");
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Listen for hotkey-triggered transcriptions (from Rust background flow)
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<TranscriptionResult>("vox-transcription-complete", async (event) => {
      const result = event.payload;
      setTranscribing(false);
      setRecordingBusy(false);
      setRecordingStatus({
        isRecording: false,
        path: result.audioPath,
        appName: result.appName,
        windowTitle: null,
        durationSeconds: result.durationSeconds,
      });
      try {
        await applyTranscriptionResult(result);
      } catch {
        // DB errors are non-fatal
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  // Surface background-flow transcription failures (hotkey path) with a retry
  // path so the user can re-run transcription on the kept recording file.
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<{
      path?: string | null;
      error: string;
      appName?: string | null;
      windowTitle?: string | null;
    }>("vox-transcription-error", (event) => {
      const { path, error: message, appName, windowTitle } = event.payload;
      setTranscribing(false);
      setRecordingBusy(false);
      setError(message);
      if (path) {
        setRetryPath(path);
        setRecordingStatus((prev) => ({
          isRecording: false,
          path,
          appName: appName ?? prev?.appName ?? null,
          windowTitle: windowTitle ?? prev?.windowTitle ?? null,
          durationSeconds: prev?.durationSeconds ?? null,
        }));
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  // Hands-free mode: each auto-segmented utterance is transcribed in the
  // background and emitted here. Save it to history without touching the
  // recording state (the session is still live).
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<{
      text: string;
      rawText?: string | null;
      appName?: string | null;
      language?: string | null;
    }>("vox-hands-free-segment", async (event) => {
      const { text, rawText, appName, language } = event.payload;
      if (!text?.trim()) return;
      try {
        await saveTranscript(text, undefined, appName ?? null, null, rawText ?? null, language ?? "en");
        setHistory(await getTranscripts(ANALYTICS_HISTORY_LIMIT));
      } catch {
        // DB errors are non-fatal; the text was already inserted.
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const checkEngine = async () => {
    setChecking(true);
    setError(null);

    try {
      setNativeStatus(await getNativeStatus());
    } catch {
      setNativeStatus(null);
      setError("Run the desktop app with `pnpm desktop:dev` to use recording.");
    } finally {
      setChecking(false);
    }
  };

  const toggleRecording = async () => {
    setRecordingBusy(true);
    setError(null);
    setRetryPath(null);
    let failedPath: string | null = null;

    try {
      if (recordingStatus?.isRecording) {
        const status = await stopRecording();
        setRecordingStatus(status);
        failedPath = status.path;

        if (status.path) {
          setTranscribing(true);
          const result = await transcribeRecording(
            status.path,
            selectedModel,
            dictionary,
            status.appName,
            status.windowTitle
          );
          result.appName = status.appName;
          result.durationSeconds = status.durationSeconds;
          await applyTranscriptionResult(result);
        }
        return;
      }

      const status = await startRecording(triggerMode === "handsFree");
      setRecordingStatus(status);

      if (status.isRecording) {
        setTranscriptionResult(null);
      }
    } catch (err) {
      // Keep the recording file so the user can retry transcription.
      if (failedPath) {
        setRetryPath(failedPath);
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTranscribing(false);
      setRecordingBusy(false);
    }
  };

  const transcribe = async () => {
    if (!recordingStatus?.path) return;

    setTranscribing(true);
    setError(null);

    try {
      const result = await transcribeRecording(
        recordingStatus.path,
        selectedModel,
        dictionary,
        recordingStatus.appName,
        recordingStatus.windowTitle
      );
      result.appName = recordingStatus.appName;
      result.durationSeconds = recordingStatus.durationSeconds;
      await applyTranscriptionResult(result);
      setRetryPath(null);
    } catch (err) {
      // Keep the recording file so the user can retry transcription.
      setRetryPath(recordingStatus.path);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTranscribing(false);
    }
  };

  const retryTranscription = async () => {
    if (!retryPath) return;

    setTranscribing(true);
    setError(null);

    try {
      const result = await transcribeRecording(
        retryPath,
        selectedModel,
        dictionary,
        recordingStatus?.appName ?? null,
        recordingStatus?.windowTitle ?? null
      );
      result.appName = recordingStatus?.appName ?? null;
      result.durationSeconds = recordingStatus?.durationSeconds ?? null;
      await applyTranscriptionResult(result);
      setRetryPath(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTranscribing(false);
    }
  };

  const handleSaveHotkey = async (shortcut: string) => {
    try {
      await saveHotkey(shortcut);
      setToast({
        title: `Hotkey updated to ${formatShortcut(shortcut)}`,
        detail: isEventTapOnlyShortcut(shortcut)
          ? "Handled via CGEventTap. Accessibility permission must remain granted."
          : "The new global shortcut is active now.",
        tone: isEventTapOnlyShortcut(shortcut) ? "warning" : "success",
      });
      setHotkeyPickerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setHotkeyPickerOpen(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteTranscript(id);
      setHistory((prev) => prev.filter((t) => t.id !== id));
    } catch {
      // non-fatal
    }
  };

  const totalWords = history.reduce((sum, item) => sum + countWords(item.text), 0);
  const totalDurationSeconds = history.reduce(
    (sum, item) => sum + (item.duration_seconds ?? 0),
    0
  );
  const timeSavedMinutes = Math.round(totalWords / 40);
  const activityDays = buildActivityDays(history);
  const { currentStreak, longestStreak } = calculateStreaks(history);
  const activitySummary = buildActivitySummary(history);
  const hourlyActivity = buildHourlyActivity(history);
  const usageTrend = buildUsageTrend(history);
  const topApps = buildTopApps(history);
  const dailyWordTrend = buildDailyWordTrend(history);
  const lastDuration = recordingStatus?.durationSeconds ?? 0;

  useEffect(() => {
    const visibleAppNames = [
      ...topApps.map((app) => app.name),
      ...history.slice(0, 6).map((item) => item.app_name ?? "Unknown app"),
    ];
    const missingAppNames = Array.from(new Set(visibleAppNames))
      .filter((name) => !(name in appIcons) && name !== "Unknown app");

    if (missingAppNames.length === 0) return;

    let cancelled = false;
    void Promise.all(
      missingAppNames.map(async (name) => [name, await resolveAppIcon(name).catch(() => null)] as const)
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
  }, [topApps, history, appIcons]);

  return (
    <ScrollArea className="h-full">
      <div className="page-shell relative">
        {widgetMode && <DictationWidget mode={widgetMode} />}

        <header className="page-header">
          <div>
            <h1 className="page-title">Dictation</h1>
            <p className="page-description">
              Your personal local dictation dashboard.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setHotkeyPickerOpen(true)}
            className="group flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <span className="font-mono font-semibold tracking-widest">
              {formatShortcut(hotkey)}
            </span>
            <Pencil className="h-3 w-3 opacity-50 transition-opacity group-hover:opacity-100" />
          </button>
        </header>

        <CommandCenterCard
          hotkey={hotkey}
          selectedModel={selectedModel}
          nativeStatus={nativeStatus}
          recordingStatus={recordingStatus}
          recordingBusy={recordingBusy}
          checking={checking}
          transcribing={transcribing}
          onToggleRecording={toggleRecording}
          onCheckEngine={checkEngine}
          onTranscribe={transcribe}
          onEditHotkey={() => setHotkeyPickerOpen(true)}
        />

        <section aria-label="Dictation summary" className="stat-strip divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 md:grid-cols-4">
          <InsightStat label="Words dictated" value={totalWords.toLocaleString()} />
          <InsightStat label="Transcriptions" value={history.length.toLocaleString()} />
          <InsightStat label="Time saved" value={`${timeSavedMinutes}m`} />
          <InsightStat
            label="Time spent"
            value={formatDurationCompact(totalDurationSeconds || lastDuration)}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="panel p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-6">
                <div>
                  <p className="font-mono text-4xl font-semibold text-primary">
                    {currentStreak}
                  </p>
                  <p className="text-sm text-muted-foreground">day streak</p>
                </div>
                <div className="h-12 w-px bg-border" />
                <div>
                  <p className="text-sm text-muted-foreground">Longest streak</p>
                  <p className="text-lg font-medium text-foreground">
                    {longestStreak} {longestStreak === 1 ? "day" : "days"}
                  </p>
                </div>
              </div>
              <p className="hidden text-sm text-muted-foreground sm:block">
                {currentStreak > 0 ? "Keep it going." : "Start today."}
              </p>
            </div>
          </div>

          <div className="panel p-5">
            <p className="mb-4 text-sm font-semibold text-foreground">Current setup</p>
            <div className="grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-3 border-b border-border py-2">
                <span className="text-muted-foreground">Model</span>
                <span className="font-mono text-xs text-foreground">{selectedModel}</span>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-border py-2">
                <span className="text-muted-foreground">Shortcut</span>
                <button
                  onClick={() => setHotkeyPickerOpen(true)}
                  className="font-mono text-xs text-primary transition-colors hover:text-foreground"
                >
                  {formatShortcut(hotkey)}
                </button>
              </div>
              <div className="flex items-center justify-between gap-3 py-2">
                <span className="text-muted-foreground">Engine</span>
                <span className="text-xs font-medium text-foreground">
                  {nativeStatus ? "Ready" : checking ? "Checking" : "Not checked"}
                </span>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-5">
          <Suspense fallback={<AnalyticsLoading />}>
            <AnalyticsPanels
              activitySummary={activitySummary}
              activityDays={activityDays}
              topApps={topApps}
              appIcons={appIcons}
              historyLoading={historyLoading}
              hourlyActivity={hourlyActivity}
              usageTrend={usageTrend}
              dailyWordTrend={dailyWordTrend}
              totalDurationSeconds={totalDurationSeconds}
            />
          </Suspense>
        </div>

        <section className="panel p-5">
          <RecentTranscripts
            history={history}
            historyLoading={historyLoading}
            historyError={historyError}
            appIcons={appIcons}
            onDelete={handleDelete}
          />
        </section>

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0">{error}</span>
              {retryPath && !transcribing && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void retryTranscription()}
                  className="shrink-0"
                >
                  <Wand2 className="h-4 w-4" />
                  Retry transcription
                </Button>
              )}
            </div>
          </div>
        )}

        {transcriptionResult && (
          <section className="panel p-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Latest transcript
            </p>
            <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
              {transcriptionResult.text}
            </p>
          </section>
        )}
      </div>

      <HotkeyPicker
        open={hotkeyPickerOpen}
        currentShortcut={hotkey}
        onSave={handleSaveHotkey}
        onCancel={() => setHotkeyPickerOpen(false)}
      />
      {toast && (
        <AppToast title={toast.title} detail={toast.detail} tone={toast.tone} />
      )}
    </ScrollArea>
  );
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function dayKey(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildActivityDays(history: TranscriptRow[]) {
  const counts = new Map<string, number>();
  history.forEach((item) => {
    const key = dayKey(item.created_at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  return Array.from({ length: 182 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (181 - index));
    const key = dayKey(date.getTime());
    return { key, count: counts.get(key) ?? 0 };
  });
}

function calculateStreaks(history: TranscriptRow[]) {
  const activeDays = new Set(history.map((item) => dayKey(item.created_at)));
  let currentStreak = 0;
  const cursor = new Date();
  while (activeDays.has(dayKey(cursor.getTime()))) {
    currentStreak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const sortedDays = Array.from(activeDays).sort();
  let longestStreak = 0;
  let running = 0;
  let previous: Date | null = null;
  sortedDays.forEach((key) => {
    const current = new Date(key);
    const diff = previous
      ? Math.round((current.getTime() - previous.getTime()) / 86_400_000)
      : 1;
    running = diff === 1 ? running + 1 : 1;
    longestStreak = Math.max(longestStreak, running);
    previous = current;
  });

  return { currentStreak, longestStreak };
}

function buildHourlyActivity(history: TranscriptRow[]) {
  const values = Array.from({ length: 24 }, () => 0);
  const durations = Array.from({ length: 24 }, () => 0);
  history.forEach((item) => {
    const hour = new Date(item.created_at).getHours();
    values[hour] += 1;
    durations[hour] += item.duration_seconds ?? 0;
  });

  const peakHour = values.reduce(
    (best, value, hour) => (value > values[best] ? hour : best),
    0
  );
  const totalSessions = values.reduce((sum, value) => sum + value, 0);

  return {
    values,
    durations,
    peakHour,
    peakLabel: totalSessions > 0 ? formatHourLabel(peakHour) : "No activity yet",
    segments: {
      night: values.slice(0, 6).reduce((sum, value) => sum + value, 0),
      morning: values.slice(6, 12).reduce((sum, value) => sum + value, 0),
      afternoon: values.slice(12, 18).reduce((sum, value) => sum + value, 0),
      evening: values.slice(18).reduce((sum, value) => sum + value, 0),
    },
  };
}

function buildActivitySummary(history: TranscriptRow[]) {
  const byDay = new Map<string, number>();
  history.forEach((item) => {
    const key = dayKey(item.created_at);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  });

  const bestDay = Array.from(byDay.entries()).sort((a, b) => b[1] - a[1])[0];

  return {
    activeDays: byDay.size,
    bestDayCount: bestDay?.[1] ?? 0,
    bestDayLabel: bestDay
      ? new Date(bestDay[0]).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "No activity yet",
    averagePerWeek: history.length / 8,
  };
}

function buildUsageTrend(history: TranscriptRow[]) {
  const buckets = new Map<string, { label: string; count: number; duration: number }>();

  for (let index = 7; index >= 0; index -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - index * 7);
    const start = startOfWeek(date);
    const key = dayKey(start.getTime());
    buckets.set(key, {
      label: start.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      count: 0,
      duration: 0,
    });
  }

  history.forEach((item) => {
    const bucketStart = startOfWeek(new Date(item.created_at));
    const key = dayKey(bucketStart.getTime());
    const bucket = buckets.get(key);
    if (!bucket) return;
    bucket.count += 1;
    bucket.duration += item.duration_seconds ?? 0;
  });

  return Array.from(buckets.values());
}

function buildDailyWordTrend(history: TranscriptRow[]) {
  const buckets = new Map<string, { label: string; words: number; sessions: number }>();

  for (let index = 13; index >= 0; index -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - index);
    const key = dayKey(date.getTime());
    buckets.set(key, {
      label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      words: 0,
      sessions: 0,
    });
  }

  history.forEach((item) => {
    const key = dayKey(item.created_at);
    const bucket = buckets.get(key);
    if (!bucket) return;
    bucket.words += countWords(item.text);
    bucket.sessions += 1;
  });

  return Array.from(buckets.values());
}

function buildTopApps(history: TranscriptRow[]) {
  const counts = new Map<string, { count: number; words: number }>();
  history.forEach((item) => {
    const app = item.app_name ?? "Unknown app";
    const current = counts.get(app) ?? { count: 0, words: 0 };
    counts.set(app, {
      count: current.count + 1,
      words: current.words + countWords(item.text),
    });
  });
  return Array.from(counts.entries())
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.words - a.words)
    .slice(0, 12);
}

function AnalyticsLoading() {
  return (
    <div className="panel flex items-center gap-3 px-5 py-4 text-sm text-muted-foreground">
      <Spinner className="size-4" />
      Loading analytics charts…
    </div>
  );
}

function CommandCenterCard({
  hotkey,
  selectedModel,
  nativeStatus,
  recordingStatus,
  recordingBusy,
  checking,
  transcribing,
  onToggleRecording,
  onCheckEngine,
  onTranscribe,
  onEditHotkey,
}: {
  hotkey: string;
  selectedModel: string;
  nativeStatus: NativeStatus | null;
  recordingStatus: RecordingStatus | null;
  recordingBusy: boolean;
  checking: boolean;
  transcribing: boolean;
  onToggleRecording: () => void;
  onCheckEngine: () => void;
  onTranscribe: () => void;
  onEditHotkey: () => void;
}) {
  const isRecording = recordingStatus?.isRecording ?? false;
  const statusLabel = isRecording
    ? "Recording"
    : transcribing
      ? "Transcribing"
      : recordingBusy
        ? "Working"
        : nativeStatus
          ? "Ready"
          : "Check engine";
  const helperText = isRecording
    ? "Listening locally. Press stop when you are done."
    : transcribing
      ? "Converting your audio into text."
      : nativeStatus
        ? "Start a local dictation session from here or use the global shortcut."
        : "Verify the native engine before recording.";

  return (
    <section className="surface-depth overflow-hidden rounded-xl border border-primary/20 bg-card p-5">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <GlowRecordButton
            isRecording={isRecording}
            disabled={!nativeStatus || recordingBusy || transcribing}
            onClick={onToggleRecording}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-lg font-semibold text-foreground">Start Dictating</p>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                {statusLabel}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{helperText}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              <button
                onClick={onEditHotkey}
                className="rounded-md bg-background/75 px-2.5 py-1 font-mono transition-colors hover:bg-muted hover:text-foreground"
              >
                {formatShortcut(hotkey)}
              </button>
              <span className="px-1 font-mono">
                {selectedModel}
              </span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
          <Button variant="secondary" onClick={onCheckEngine} disabled={checking || recordingBusy || transcribing}>
            <CheckCircle2 className="h-4 w-4" />
            {checking ? "Checking…" : nativeStatus ? "Engine Ready" : "Check Engine"}
          </Button>
          <Button onClick={onToggleRecording} disabled={!nativeStatus || recordingBusy || transcribing}>
            <Mic className="h-4 w-4" />
            {isRecording ? "Stop Recording" : "Start Recording"}
          </Button>
          <Button
            variant="outline"
            onClick={onTranscribe}
            disabled={!recordingStatus?.path || isRecording || transcribing}
          >
            <Wand2 className="h-4 w-4" />
            {transcribing ? "Transcribing…" : "Transcribe Last"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function InsightStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-cell">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function RecentTranscripts({
  history,
  historyLoading,
  historyError,
  appIcons,
  onDelete,
}: {
  history: TranscriptRow[];
  historyLoading: boolean;
  historyError: string | null;
  appIcons: Record<string, string | null>;
  onDelete: (id: number) => void;
}) {
  const recent = history.slice(0, 6);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Recent transcripts</h3>
        </div>
        {history.length > 0 && (
          <span className="rounded-full border border-border bg-background px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
            {history.length} total
          </span>
        )}
      </div>

      {historyLoading ? (
        <div className="grid gap-2 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="rounded-xl border border-border bg-background p-3">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-muted" />
                <div className="space-y-2">
                  <div className="h-3 w-24 rounded bg-muted" />
                  <div className="h-2.5 w-32 rounded bg-muted/70" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : historyError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {historyError}
        </div>
      ) : recent.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-2">
          {recent.map((item) => (
            <TranscriptCard
              key={item.id}
              item={item}
              iconSrc={appIcons[item.app_name ?? "Unknown app"] ?? null}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-background px-5 py-6 text-center">
          <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Mic className="h-4 w-4" />
          </div>
          <p className="text-sm font-medium text-foreground">No transcripts yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
            Start a dictation session and your latest transcript previews will appear here.
          </p>
        </div>
      )}
    </div>
  );
}

function TranscriptCard({
  item,
  iconSrc,
  onDelete,
}: {
  item: TranscriptRow;
  iconSrc: string | null;
  onDelete: (id: number) => void;
}) {
  const appName = item.app_name ?? "Unknown app";
  const words = countWords(item.text);
  const [copied, setCopied] = useState(false);

  const copyTranscript = async () => {
    await navigator.clipboard.writeText(item.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <article
      className="group relative overflow-hidden rounded-xl border border-border bg-background px-3 py-2.5 transition-colors hover:border-ring"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="mb-2 flex items-center justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <AppBadge name={appName} iconSrc={iconSrc} className="h-8 w-8 rounded-lg text-[11px]" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{appName}</p>
            <p className="text-[11px] text-muted-foreground">{formatTranscriptDate(item.created_at)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={() => void copyTranscript()}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Copy transcript"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={() => onDelete(item.id)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            aria-label="Delete transcript"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <p className="line-clamp-2 text-sm leading-5 text-foreground/90">
        {item.text}
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
        <span className="rounded-full border border-border bg-card px-2 py-0.5 font-mono">
          {words} {words === 1 ? "word" : "words"}
        </span>
        {item.duration_seconds ? (
          <span className="rounded-full border border-border bg-card px-2 py-0.5 font-mono">
            {formatDurationCompact(item.duration_seconds)} audio
          </span>
        ) : null}
      </div>
    </article>
  );
}

function AppBadge({
  name,
  iconSrc,
  className,
}: {
  name: string;
  iconSrc: string | null;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

  return (
    <div className={["flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-sidebar-accent font-mono text-xs font-semibold text-primary", className].filter(Boolean).join(" ")}>
      {iconSrc ? (
        <img src={iconSrc} alt="" width="28" height="28" loading="lazy" className="h-7 w-7 rounded-md object-cover" />
      ) : (
        initials
      )}
    </div>
  );
}

function formatHourLabel(hour: number) {
  const normalizedHour = hour % 24;
  const suffix = normalizedHour >= 12 ? "PM" : "AM";
  const hour12 = normalizedHour % 12 || 12;
  return `${hour12}:00 ${suffix}`;
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
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (dayKey(timestamp) === dayKey(today.getTime())) {
    return `Today, ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }

  if (dayKey(timestamp) === dayKey(yesterday.getTime())) {
    return `Yesterday, ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = (day + 6) % 7;
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() - diff);
  return next;
}

function DictationWidget({ mode }: { mode: "recording" | "transcribing" }) {
  const isRecording = mode === "recording";

  return (
    <div
      className="fixed right-6 top-14 z-40 flex items-center gap-3 rounded-full border border-border bg-muted px-4 py-2"
    >
      <div
        className={[
          "flex h-8 w-8 items-center justify-center rounded-full",
          isRecording
            ? "bg-destructive/20 text-destructive"
            : "bg-accent text-accent-foreground",
        ].join(" ")}
      >
        {isRecording ? <Mic className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground">
          {isRecording ? "Recording" : "Transcribing"}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {isRecording ? "Listening locally" : "Converting voice to text"}
        </p>
      </div>
      <span
        className={[
          "h-2 w-2 rounded-full",
          isRecording
            ? "animate-pulse bg-destructive"
            : "animate-pulse bg-primary",
        ].join(" ")}
      />
    </div>
  );
}
