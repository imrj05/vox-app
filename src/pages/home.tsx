import { lazy, Suspense, useEffect, useEffectEvent, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import NumberFlow from "@number-flow/react";
import { Check, Copy, Mic, OctagonXIcon, Pencil, Trash2, Wand2 } from "@/components/icons";
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
import { activeModelLabel } from "@/lib/model-label";
import { AppToast } from "@/components/app-toast";
import {
  saveCorrections,
  saveTranscript,
  getTranscripts,
  deleteTranscript,
  type TranscriptRow,
} from "@/lib/db";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { GlowRecordButton } from "@/components/glow-record-button";
import { cn } from "@/lib/utils";
import { HotkeyPicker } from "@/components/hotkey-picker";
import { withTimeout } from "@/lib/async";
import { useAppStore } from "@/store/app-store";
import { COMMAND_TARGETS, subscribeCommand } from "@/lib/commands";

const HISTORY_LOAD_TIMEOUT_MS = 5000;
const ANALYTICS_HISTORY_LIMIT = 1000;
// How long a deleted transcript can still be undone from the toast.
const UNDO_WINDOW_MS = 6000;

const InsightsPanel = lazy(() =>
  import("@/pages/home-analytics").then(({ InsightsPanel }) => ({ default: InsightsPanel }))
);

type LiveSession = {
  mode: "recording" | "transcribing";
  elapsedSeconds?: number;
  appName: string | null;
};

export function HomePage() {
  const {
    hotkey,
    setHotkey,
    selectedModel,
    triggerMode,
    engine,
    language,
    cleanupLevel,
    setIsRecording,
  } = useAppStore();
  // The pinned model only applies when the Whisper engine is selected (spec
  // §7: an explicit engine choice is honored — the stale "active model" pin
  // must never silently override Apple Speech / Parakeet).
  const requestedModel = engine === "whisper" ? selectedModel : undefined;
  const [nativeStatus, setNativeStatus] = useState<NativeStatus | null>(null);
  const [recordingStatus, setRecordingStatus] =
    useState<RecordingStatus | null>(null);
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
  // A transcript whose deletion is pending so the toast can undo it. The row
  // leaves the UI immediately; the database delete commits only after the
  // undo window expires without a click.
  const [pendingDelete, setPendingDelete] = useState<TranscriptRow | null>(null);
  const [toast, setToast] = useState<{
    title: string;
    detail?: string;
    tone?: "success" | "warning";
    duration?: number;
    action?: { label: string; onClick: () => void };
  } | null>(null);

  // Mirrors the native widget state so this page reflects sessions started with
  // the global shortcut, not only the ones started from the button below.
  const [liveSession, setLiveSession] = useState<LiveSession | null>(null);
  // Streaming partial transcript (Apple Speech only). Rendered live in the hero
  // so the user sees their words while speaking.
  const [liveText, setLiveText] = useState("");

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ text: string; isFinal: boolean }>(
      "vox-live-transcript",
      (event) => {
        setLiveText(event.payload?.text ?? "");
      }
    ).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // The command palette can trigger a recording from anywhere in the app.
  // The handler is registered further down, right after `toggleRecording` exists.

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ mode?: string; elapsedSeconds?: number; appName?: string | null }>(
      "vox-widget-state",
      (event) => {
        const { mode, elapsedSeconds, appName } = event.payload;
        setLiveSession(
          mode === "recording" || mode === "transcribing"
            ? { mode, elapsedSeconds, appName: appName ?? null }
            : null
        );
      }
    ).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // Local ticking for sessions started from this page — the widget event
  // stream only carries elapsed time when the floating widget is enabled.
  const pageRecording = recordingStatus?.isRecording ?? false;
  const [sessionSeconds, setSessionSeconds] = useState(0);

  useEffect(() => {
    if (!pageRecording) return;
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      setSessionSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => {
      window.clearInterval(id);
      setSessionSeconds(0);
    };
  }, [pageRecording]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), toast.duration ?? 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  // Verify the native engine on mount so recording is ready without requiring
  // the user to discover a manual check first.
  useEffect(() => {
    let ignore = false;
    void getNativeStatus()
      .then((status) => {
        if (!ignore) setNativeStatus(status);
      })
      .catch(() => {
        if (!ignore) setNativeStatus(null);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const saveHotkey = async (shortcut: string) => {
    await setGlobalShortcut(shortcut);
    await setHotkey(shortcut);
  };

  const applyTranscriptionResult = async (result: TranscriptionResult) => {
    await saveTranscript(result.text, undefined, result.appName, result.durationSeconds, result.rawText ?? null, result.asrText ?? null, result.language ?? "en", result.engine ?? null, result.timings ?? null);
    await saveCorrections(result.corrections ?? [], result.appName).catch(() => {});
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
      setLiveText("");
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

  // Engine switches (spec §8: never silently change engines). Warn when a
  // fallback fired and inform when the router picked a different engine.
  useEffect(() => {
    let unlistenFallback: (() => void) | undefined;
    let unlistenChanged: (() => void) | undefined;

    void listen<{ from?: string; to?: string; reason?: string }>(
      "transcription_engine_fallback",
      (event) => {
        const { from, to, reason } = event.payload;
        const reasonText =
          reason === "model_unavailable"
            ? "the model was unavailable"
            : "the engine failed";
        setToast({
          title: "Transcription engine switched",
          detail: `${engineDisplayName(from) ?? "The engine"} fell back to ${engineDisplayName(to)} — ${reasonText}.`,
          tone: "warning",
        });
      }
    ).then((cleanup) => {
      unlistenFallback = cleanup;
    });

    void listen<{ from?: string; to?: string }>("transcription_engine_changed", (event) => {
      const { from, to } = event.payload;
      if (!to) return;
      setToast({
        title: `Engine changed to ${engineDisplayName(to)}`,
        detail: `Previous transcription ran on ${engineDisplayName(from) ?? "a different engine"}.`,
        tone: "success",
      });
    }).then((cleanup) => {
      unlistenChanged = cleanup;
    });

    return () => {
      unlistenFallback?.();
      unlistenChanged?.();
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

  // Surface insertion failures. The transcript is already saved to History,
  // so the user can copy it here or retry from the Vox menu bar icon.
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<{ text: string; error: string; appName?: string | null }>(
      "vox-insertion-failed",
      (event) => {
        setToast({
          title: "Couldn't insert text",
          detail: "Saved to History. Retry from the Vox menu bar icon.",
          tone: "warning",
          duration: 6000,
          action: {
            label: "Copy",
            onClick: () => {
              void navigator.clipboard
                .writeText(event.payload.text)
                .catch(() => {});
              setToast(null);
            },
          },
        });
      }
    ).then((cleanup) => {
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
      asrText?: string | null;
      rawText?: string | null;
      appName?: string | null;
      language?: string | null;
      engine?: string | null;
      corrections?: {
        source: string;
        canonical: string;
        confidence?: number;
        asrConfidence?: number | null;
      }[];
      timings?: {
        audioPreflightMs: number;
        transcribeMs: number;
        postprocessMs: number;
        totalMs: number;
      } | null;
    }>("vox-hands-free-segment", async (event) => {
      const { text, asrText, rawText, appName, language, engine, corrections, timings } = event.payload;
      if (!text?.trim()) return;
      try {
        await saveTranscript(text, undefined, appName ?? null, null, rawText ?? null, asrText ?? null, language ?? "en", engine ?? null, timings ?? null);
        await saveCorrections(corrections ?? [], appName ?? null).catch(() => {});
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
      setError("Recording isn't available right now. Restart the Vox app and try again.");
    } finally {
      setChecking(false);
    }
  };

  const toggleRecording = async () => {
    setRecordingBusy(true);
    setError(null);
    setRetryPath(null);
    let failedPath: string | null = null;
    setLiveText("");

    try {
      if (recordingStatus?.isRecording) {
        const status = await stopRecording();
        setRecordingStatus(status);
        failedPath = status.path;

        if (status.path) {
          setTranscribing(true);
          const result = await transcribeRecording(
            status.path,
            requestedModel,
            status.appName,
            status.windowTitle,
            status.previewText,
            status.previewConfidence,
            !status.private
          );
          result.appName = status.appName;
          result.durationSeconds = status.durationSeconds;
          await applyTranscriptionResult(result);
        }
        return;
      }

      const status = await startRecording(triggerMode === "handsFree");
      setRecordingStatus(status);
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

  // The command palette can trigger a recording from anywhere in the app.
  // `useEffectEvent` keeps the handler stable while always calling the latest
  // `toggleRecording`.
  const handleToggleRecordingEvent = useEffectEvent(() => {
    void toggleRecording();
  });
  useEffect(() => {
    return subscribeCommand(COMMAND_TARGETS.home, (command) => {
      if (command.kind === "toggle-recording") {
        handleToggleRecordingEvent();
      }
    });
  }, []);

  // Mirror the recording state so the command palette can label its action.
  useEffect(() => {
    setIsRecording(Boolean(recordingStatus?.isRecording) || liveSession?.mode === "recording");
  }, [recordingStatus?.isRecording, liveSession?.mode, setIsRecording]);

  const retryTranscription = async () => {
    if (!retryPath) return;

    setTranscribing(true);
    setError(null);
    try {
      const result = await transcribeRecording(
        retryPath,
        requestedModel,
        recordingStatus?.appName ?? null,
        recordingStatus?.windowTitle ?? null,
        undefined,
        undefined,
        !recordingStatus?.private
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

  const deleteRowFromDb = async (id: number) => {
    try {
      await deleteTranscript(id);
    } catch {
      // non-fatal
    }
  };

  const handleDelete = (id: number) => {
    const row = history.find((t) => t.id === id);
    if (!row) return;
    // Only one deletion can be undone at a time — commit any earlier one now.
    if (pendingDelete && pendingDelete.id !== id) {
      void deleteRowFromDb(pendingDelete.id);
    }
    setHistory((prev) => prev.filter((t) => t.id !== id));
    setPendingDelete(row);
    setToast({
      title: "Transcript deleted",
      detail: "Removed from your history.",
      tone: "warning",
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Undo",
        onClick: () => {
          setHistory((prev) =>
            [...prev, row].sort((a, b) => b.created_at - a.created_at)
          );
          setPendingDelete(null);
          setToast(null);
        },
      },
    });
  };

  // Commit the pending delete once the undo window closes.
  useEffect(() => {
    if (!pendingDelete) return;
    const timeout = window.setTimeout(() => {
      void deleteRowFromDb(pendingDelete.id);
      setPendingDelete(null);
    }, UNDO_WINDOW_MS);
    return () => window.clearTimeout(timeout);
  }, [pendingDelete]);

  const analytics = useMemo(() => {
    const totalWords = history.reduce((sum, item) => sum + countWords(item.text), 0);
    const totalDurationSeconds = history.reduce(
      (sum, item) => sum + (item.duration_seconds ?? 0),
      0
    );
    return {
      totalWords,
      totalDurationSeconds,
      timeSavedMinutes: Math.round(totalWords / 40),
      activityDays: buildActivityDays(history),
      streaks: calculateStreaks(history),
      activitySummary: buildActivitySummary(history),
      hourlyActivity: buildHourlyActivity(history),
      usageTrend: buildUsageTrend(history),
      topApps: buildTopApps(history),
      dailyWordTrend: buildDailyWordTrend(history),
      latency: buildLatencySummary(history),
    };
  }, [history]);
  const {
    totalWords,
    totalDurationSeconds,
    timeSavedMinutes,
    activityDays,
    streaks: { currentStreak, longestStreak },
    activitySummary,
    hourlyActivity,
    usageTrend,
    topApps,
    dailyWordTrend,
    latency,
  } = analytics;
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
      <div className="page-shell">
        <header className="page-header">
          <div>
            <h1 className="page-title">Dictation</h1>
            <p className="page-description">
              Press your shortcut anywhere, or record here. Audio and text never
              leave this device.
            </p>
          </div>
        </header>

        <DictationPanel
          hotkey={hotkey}
          engine={engine}
          selectedModel={selectedModel}
          language={language}
          cleanupLevel={cleanupLevel}
          triggerMode={triggerMode}
          nativeStatus={nativeStatus}
          recordingStatus={recordingStatus}
          liveSession={liveSession}
          liveText={liveText}
          pageElapsedSeconds={sessionSeconds}
          recordingBusy={recordingBusy}
          checking={checking}
          transcribing={transcribing}
          lastDuration={lastDuration}
          onToggleRecording={toggleRecording}
          onCheckEngine={checkEngine}
          onEditHotkey={() => setHotkeyPickerOpen(true)}
        />

        {error && (
          <Alert variant="destructive">
            <OctagonXIcon />
            <AlertTitle>Dictation ran into a problem</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            {retryPath && !transcribing && (
              <AlertAction>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void retryTranscription()}
                >
                  <Wand2 data-icon="inline-start" />
                  Retry
                </Button>
              </AlertAction>
            )}
          </Alert>
        )}

        <section
          aria-label="Dictation summary"
          className="stat-strip divide-y divide-border sm:grid-cols-4 sm:divide-x sm:divide-y-0"
        >
          <StatCell label="Words dictated" value={<NumberFlow value={totalWords} isolate willChange />} />
          <StatCell label="Sessions" value={<NumberFlow value={history.length} isolate willChange />} />
          <StatCell label="Time saved" value={`${timeSavedMinutes}m`} />
          <StatCell
            label="Median speed"
            value={latency.samples > 0 ? formatMs(latency.totalP50) : "—"}
          />
        </section>

        <RecentTranscripts
          history={history}
          historyLoading={historyLoading}
          historyError={historyError}
          appIcons={appIcons}
          onDelete={handleDelete}
        />

        <Suspense fallback={<AnalyticsLoading />}>
          <InsightsPanel
            currentStreak={currentStreak}
            longestStreak={longestStreak}
            totalWords={totalWords}
            historyCount={history.length}
            activitySummary={activitySummary}
            activityDays={activityDays}
            topApps={topApps}
            appIcons={appIcons}
            historyLoading={historyLoading}
            hourlyActivity={hourlyActivity}
            usageTrend={usageTrend}
            dailyWordTrend={dailyWordTrend}
            totalDurationSeconds={totalDurationSeconds}
            latency={latency}
          />
        </Suspense>
      </div>

      <HotkeyPicker
        open={hotkeyPickerOpen}
        currentShortcut={hotkey}
        onSave={handleSaveHotkey}
        onCancel={() => setHotkeyPickerOpen(false)}
      />
      {toast && (
        <AppToast
          title={toast.title}
          detail={toast.detail}
          tone={toast.tone}
          action={toast.action}
        />
      )}
    </ScrollArea>
  );
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function engineDisplayName(engine?: string | null) {
  switch (engine) {
    case "whisper":
      return "Whisper";
    case "parakeet":
      return "Parakeet";
    case "apple":
      return "Apple Speech";
    default:
      return engine ? engine.charAt(0).toUpperCase() + engine.slice(1) : null;
  }
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
  const buckets = new Map<string, { key: string; label: string; words: number; sessions: number }>();

  for (let index = 13; index >= 0; index -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - index);
    const key = dayKey(date.getTime());
    buckets.set(key, {
      key,
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

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil((p / 100) * values.length) - 1)
  );
  return values[index];
}

function buildLatencySummary(history: TranscriptRow[]) {
  const totals = history
    .map((item) => item.total_ms)
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b);
  const asr = history
    .map((item) => item.transcribe_ms)
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b);

  return {
    samples: totals.length,
    totalP50: percentile(totals, 50),
    totalP95: percentile(totals, 95),
    asrP50: percentile(asr, 50),
    asrP95: percentile(asr, 95),
  };
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

function DictationPanel({
  hotkey,
  engine,
  selectedModel,
  language,
  cleanupLevel,
  triggerMode,
  nativeStatus,
  recordingStatus,
  liveSession,
  liveText,
  pageElapsedSeconds,
  recordingBusy,
  checking,
  transcribing,
  lastDuration,
  onToggleRecording,
  onCheckEngine,
  onEditHotkey,
}: {
  hotkey: string;
  engine: string;
  selectedModel: string;
  language: string;
  cleanupLevel: string;
  triggerMode: string;
  nativeStatus: NativeStatus | null;
  recordingStatus: RecordingStatus | null;
  liveSession: LiveSession | null;
  liveText: string;
  pageElapsedSeconds: number;
  recordingBusy: boolean;
  checking: boolean;
  transcribing: boolean;
  lastDuration: number;
  onToggleRecording: () => void;
  onCheckEngine: () => void;
  onEditHotkey: () => void;
}) {
  const pageRecording = recordingStatus?.isRecording ?? false;
  const shortcutSession =
    liveSession?.mode === "recording" || liveSession?.mode === "transcribing";
  const isRecording = pageRecording || liveSession?.mode === "recording";
  const isTranscribing = transcribing || liveSession?.mode === "transcribing";
  const tone: "ready" | "recording" | "busy" | "down" = isRecording
    ? "recording"
    : isTranscribing || recordingBusy
      ? "busy"
      : nativeStatus
        ? "ready"
        : "down";
  const elapsedSeconds = pageRecording
    ? pageElapsedSeconds
    : liveSession?.elapsedSeconds;
  const elapsedText =
    isRecording && elapsedSeconds != null ? formatElapsed(elapsedSeconds) : null;

  const statusLabel = isRecording
    ? elapsedText
      ? `Recording ${elapsedText}`
      : "Recording"
    : isTranscribing
      ? "Transcribing"
      : recordingBusy
        ? "Working"
        : nativeStatus
          ? "Ready"
          : "Unavailable";

  const primaryLine = isRecording
    ? liveSession?.appName
      ? `Listening for ${liveSession.appName}.`
      : "Listening locally."
    : isTranscribing
      ? "Turning your audio into text."
      : nativeStatus
        ? "Ready when you are."
        : "Recording isn't ready.";

  const secondaryLine = isRecording
    ? "Press stop when you're done. The text is inserted where you're typing."
    : isTranscribing
      ? "This usually takes a few seconds."
      : nativeStatus
        ? lastDuration > 0
          ? `Click the mic or press ${formatShortcut(hotkey)}. Last dictation ${formatDurationCompact(lastDuration)}.`
          : `Click the mic or press ${formatShortcut(hotkey)}.`
        : "Restart Vox, or recheck the engine below.";

  return (
    <section className="panel hero-surface overflow-hidden" data-tone={tone}>
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
        <GlowRecordButton
          isRecording={isRecording}
          disabled={
            !nativeStatus || recordingBusy || transcribing || (shortcutSession && !pageRecording)
          }
          onClick={onToggleRecording}
        />
        <div className="min-w-0 flex-1">
          <StatusPill tone={tone} label={statusLabel} />
          <span className="sr-only" aria-live="polite" aria-atomic="true">
            {statusLabel}
            {liveText ? `. ${liveText}` : ""}
          </span>
          {liveText ? (
            <p
              aria-live="polite"
              className="mt-2 line-clamp-3 text-[15px] leading-6 font-medium tracking-tight text-foreground"
            >
              {liveText}
            </p>
          ) : (
            <p className="mt-2 text-[15px] leading-6 font-semibold tracking-tight text-foreground">{primaryLine}</p>
          )}
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">{secondaryLine}</p>
        </div>

        {(isRecording || isTranscribing) && (
          <div className="hidden shrink-0 flex-col items-end gap-2 sm:flex" aria-hidden="true">
            {isRecording ? (
              <>
                {elapsedText && (
                  <p className="font-mono text-3xl font-semibold tabular-nums leading-none tracking-tight text-foreground">
                    {elapsedText}
                  </p>
                )}
                <span className="flex h-5 items-end gap-1">
                  {EQ_BAR_HEIGHTS.map((height, index) => (
                    <span
                      key={index}
                      className="eq-bar w-[3px] rounded-full bg-destructive/80"
                      style={{ height, animationDelay: `${index * 0.12}s` }}
                    />
                  ))}
                </span>
              </>
            ) : (
              <>
                <Spinner className="size-5" />
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Processing
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <dl className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border px-5 py-3 sm:px-6">
        <MetaCell label="Engine" value={engineDisplayName(engine) ?? "Auto"} />
        <MetaCell label="Model" value={activeModelLabel(engine, selectedModel)} />
        <MetaCell label="Language" value={languageLabel(language)} />
        <MetaCell label="Cleanup" value={cleanupLevelLabel(cleanupLevel)} />
        <MetaCell label="Mode" value={triggerModeLabel(triggerMode)} />
        <div className="min-w-0">
          <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Shortcut
          </dt>
          <dd className="mt-1">
            <button
              type="button"
              onClick={onEditHotkey}
              className="group inline-flex cursor-pointer items-center gap-1.5 rounded-md text-xs text-foreground transition-colors hover:text-primary"
            >
              <Kbd>{formatShortcut(hotkey)}</Kbd>
              <Pencil className="h-3 w-3 opacity-50 transition-opacity group-hover:opacity-100" />
            </button>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Transform
          </dt>
          <dd className="mt-1">
            <Kbd className="text-muted-foreground">{TRANSFORM_SHORTCUT}</Kbd>
          </dd>
        </div>

        {!nativeStatus && (
          <div className="ml-auto">
            <Button variant="ghost" size="sm" onClick={onCheckEngine} disabled={checking}>
              {checking ? "Checking…" : "Recheck engine"}
            </Button>
          </div>
        )}
      </dl>
    </section>
  );
}

const EQ_BAR_HEIGHTS = [16, 20, 13, 22, 15];

/** Native transform shortcut, registered in Rust as ⌘⇧V. */
const TRANSFORM_SHORTCUT = "⌘⇧V";

function StatusPill({
  tone,
  label,
}: {
  tone: "ready" | "recording" | "busy" | "down";
  label: string;
}) {
  const pillStyles = {
    ready: "bg-primary/10 text-primary",
    recording: "bg-destructive/10 text-destructive",
    busy: "bg-muted text-muted-foreground",
    down: "bg-muted text-muted-foreground",
  };
  const dotStyles = {
    ready: "bg-primary",
    recording: "bg-destructive",
    busy: "bg-primary/70",
    down: "bg-muted-foreground/60",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        pillStyles[tone]
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          dotStyles[tone],
          (tone === "recording" || tone === "busy") && "animate-pulse"
        )}
      />
      {label}
    </span>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate font-mono text-xs text-foreground">{value}</dd>
    </div>
  );
}

function languageLabel(language: string) {
  switch (language) {
    case "en":
      return "English";
    case "hi":
      return "Hindi";
    case "hinglish":
      return "Hinglish";
    default:
      return "Auto";
  }
}

function cleanupLevelLabel(level: string) {
  if (level === "none") return "Off";
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function triggerModeLabel(mode: string) {
  switch (mode) {
    case "pushToTalk":
      return "Push to talk";
    case "handsFree":
      return "Hands-free";
    default:
      return "Toggle";
  }
}

function StatCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat-cell">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </p>
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
    <section className="panel overflow-hidden" aria-label="Recent transcripts">
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Recent transcripts</h2>
          {history.length > 0 && (
            <Badge variant="secondary" className="px-1.5 font-mono tabular-nums">
              {history.length}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {historyLoading ? "Loading…" : "Newest first"}
        </p>
      </header>

      {historyLoading ? (
        <div className="divide-y divide-border">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex gap-3 px-5 py-3.5">
              <div className="h-7 w-7 shrink-0 rounded-md bg-muted" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3 w-40 rounded bg-muted" />
                <div className="h-3 w-full max-w-xl rounded bg-muted/70" />
              </div>
            </div>
          ))}
        </div>
      ) : historyError ? (
        <p className="px-5 py-4 text-sm text-destructive">{historyError}</p>
      ) : recent.length > 0 ? (
        <div className="divide-y divide-border">
          {recent.map((item, index) => (
            <TranscriptRow
              key={item.id}
              item={item}
              latest={index === 0}
              iconSrc={appIcons[item.app_name ?? "Unknown app"] ?? null}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : (
        <Empty className="gap-3 p-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Mic />
            </EmptyMedia>
            <EmptyTitle className="text-base">No transcripts yet</EmptyTitle>
            <EmptyDescription>
              Your first dictation shows up here the moment you stop recording.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </section>
  );
}

function TranscriptRow({
  item,
  latest,
  iconSrc,
  onDelete,
}: {
  item: TranscriptRow;
  latest: boolean;
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
    <article className="group flex gap-3 px-4 py-3.5 transition-colors hover:bg-muted/30 sm:px-5">
      <AppBadge name={appName} iconSrc={iconSrc} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-xs font-medium text-foreground">{appName}</p>
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {formatTranscriptDate(item.created_at)}
          </span>
          {latest && (
            <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[10px]">
              Latest
            </Badge>
          )}
          <div
            className={cn(
              "ml-auto flex shrink-0 items-center gap-0.5 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
              latest ? "opacity-100" : "opacity-0"
            )}
          >
            <button
              onClick={() => void copyTranscript()}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Copy transcript"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={() => onDelete(item.id)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              aria-label="Delete transcript"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <p className="mt-1 line-clamp-2 text-sm leading-6 text-foreground/90">{item.text}</p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span className="font-mono tabular-nums">
            {words.toLocaleString()} {words === 1 ? "word" : "words"}
          </span>
          {item.duration_seconds ? (
            <span>· {formatDurationCompact(item.duration_seconds)}</span>
          ) : null}
          {item.engine ? <span>· {item.engine}</span> : null}
          {item.language ? <span>· {item.language}</span> : null}
        </div>
      </div>
    </article>
  );
}

function AppBadge({ name, iconSrc }: { name: string; iconSrc: string | null }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";

  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/60 font-mono text-[10px] font-semibold text-muted-foreground">
      {iconSrc ? (
        <img src={iconSrc} alt="" width="20" height="20" loading="lazy" className="h-full w-full object-cover" />
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

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatMs(ms: number) {
  if (!ms || ms <= 0) return "0ms";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
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
