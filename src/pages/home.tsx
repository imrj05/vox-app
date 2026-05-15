import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CheckCircle2, Mic, Pencil, Trash2, Wand2 } from "lucide-react";
import {
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
import { GlowRecordButton } from "@/components/glow-record-button";
import { HotkeyPicker } from "@/components/hotkey-picker";
import { useAppStore } from "@/store/app-store";

export function HomePage() {
  const { hotkey, setHotkey, selectedModel, dictionary } = useAppStore();
  const [nativeStatus, setNativeStatus] = useState<NativeStatus | null>(null);
  const [recordingStatus, setRecordingStatus] =
    useState<RecordingStatus | null>(null);
  const [transcriptionResult, setTranscriptionResult] =
    useState<TranscriptionResult | null>(null);
  const [history, setHistory] = useState<TranscriptRow[]>([]);
  const [error, setError] = useState<string | null>(null);
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
    await saveTranscript(result.text, result.audioPath, result.appName, result.durationSeconds);
    setHistory(await getTranscripts());
  };

  // Load transcript history on mount
  useEffect(() => {
    void getTranscripts().then(setHistory).catch(() => {});
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

    try {
      if (recordingStatus?.isRecording) {
        const status = await stopRecording();
        setRecordingStatus(status);

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

      const status = await startRecording();
      setRecordingStatus(status);

      if (status.isRecording) {
        setTranscriptionResult(null);
      }
    } catch (err) {
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
  const lastDuration = recordingStatus?.durationSeconds ?? 0;

  useEffect(() => {
    const missingAppNames = topApps
      .map((app) => app.name)
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
  }, [topApps, appIcons]);

  return (
    <ScrollArea className="h-full">
      <div className="relative mx-auto flex min-h-full max-w-6xl flex-col gap-5 p-6">
        {widgetMode && <DictationWidget mode={widgetMode} />}

        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              Insights
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your personal local dictation dashboard.
            </p>
          </div>
          <button
            onClick={() => setHotkeyPickerOpen(true)}
            className="group flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            <span className="font-mono font-semibold tracking-widest">
              {formatShortcut(hotkey)}
            </span>
            <Pencil className="h-3 w-3 opacity-50 transition-opacity group-hover:opacity-100" />
          </button>
        </div>

        <section className="grid gap-3 md:grid-cols-4">
          <InsightStat label="Words dictated" value={totalWords.toLocaleString()} />
          <InsightStat label="Transcriptions" value={history.length.toLocaleString()} />
          <InsightStat label="Time saved" value={`${timeSavedMinutes}m`} />
          <InsightStat
            label="Time spent"
            value={formatDurationCompact(totalDurationSeconds || lastDuration)}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-border bg-card p-5">
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

          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="mb-4 text-sm font-semibold text-foreground">Quick dictation</p>
            <div className="flex items-center gap-4">
              <GlowRecordButton
                isRecording={recordingStatus?.isRecording ?? false}
                disabled={!nativeStatus || recordingBusy}
                onClick={toggleRecording}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {recordingStatus?.isRecording
                    ? "Recording"
                    : recordingBusy
                      ? "Working"
                      : "Ready to record"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {nativeStatus ? "Engine ready" : "Check engine before recording"}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={checkEngine} disabled={checking}>
                <CheckCircle2 className="h-4 w-4" />
                {checking ? "Checking..." : "Check engine"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={transcribe}
                disabled={!recordingStatus?.path || recordingStatus.isRecording || transcribing}
              >
                <Wand2 className="h-4 w-4" />
                {transcribing ? "Transcribing..." : "Transcribe"}
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-foreground">Activity</h3>
            <p className="text-xs text-muted-foreground">Last 6 months of dictation</p>
          </div>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <MetricPill label="Active days" value={activitySummary.activeDays.toLocaleString()} />
            <MetricPill
              label="Best day"
              value={activitySummary.bestDayCount > 0 ? `${activitySummary.bestDayCount} sessions` : "No data"}
              detail={activitySummary.bestDayLabel}
            />
            <MetricPill
              label="Weekly average"
              value={`${activitySummary.averagePerWeek.toFixed(1)} sessions`}
            />
          </div>
          <ActivityGrid days={activityDays} />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="mb-4 text-lg font-semibold text-foreground">Top apps</h3>
            {topApps.length > 0 ? (
              <TopApps apps={topApps} appIcons={appIcons} />
            ) : (
              <p className="text-sm text-muted-foreground">App usage will appear after new transcriptions.</p>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Time of day</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Usage by hour, plus where most of your dictation time goes.
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  Peak hour
                </p>
                <p className="text-sm font-medium text-foreground">{hourlyActivity.peakLabel}</p>
              </div>
            </div>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <MetricPill label="Morning" value={hourlyActivity.segments.morning.toLocaleString()} />
              <MetricPill label="Afternoon" value={hourlyActivity.segments.afternoon.toLocaleString()} />
              <MetricPill label="Evening" value={hourlyActivity.segments.evening.toLocaleString()} />
            </div>
            <HourlyChart values={hourlyActivity.values} durations={hourlyActivity.durations} />
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Usage over time</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Track how often you dictate and how much time you spend across the last 8 weeks.
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Total recorded
              </p>
              <p className="text-sm font-medium text-foreground">
                {formatDurationCompact(totalDurationSeconds)}
              </p>
            </div>
          </div>
          <UsageTrendChart points={usageTrend} />
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <h3 className="mb-4 text-lg font-semibold text-foreground">Recent transcripts</h3>
          {history.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
              {history.slice(0, 6).map((t) => (
                <div
                  key={t.id}
                  className="group flex items-start gap-3 rounded-xl border border-border bg-background p-3 transition-colors hover:border-ring"
                >
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm leading-5 text-foreground">
                      {t.text}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t.app_name ?? "Unknown app"} · {new Date(t.created_at).toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    aria-label="Delete transcript"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No transcripts yet.</p>
          )}
        </section>

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {transcriptionResult && (
          <section className="rounded-2xl border border-border bg-card p-5">
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
  return new Date(timestamp).toISOString().slice(0, 10);
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

  return {
    values,
    durations,
    peakHour,
    peakLabel: formatHourLabel(peakHour),
    segments: {
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

function InsightStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 font-mono text-3xl font-semibold text-primary">{value}</p>
    </div>
  );
}

function MetricPill({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function ActivityGrid({ days }: { days: Array<{ key: string; count: number }> }) {
  const max = Math.max(1, ...days.map((day) => day.count));
  const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, index) =>
    days.slice(index * 7, index * 7 + 7)
  );
  const seenMonths = new Set<string>();
  const monthLabels = weeks.map((week, index) => {
    const firstOfMonth = week.find((day) => new Date(day.key).getDate() <= 7);
    if (!firstOfMonth) {
      return { key: `${week[0]?.key ?? index}`, label: "" };
    }

    const date = new Date(firstOfMonth.key);
    const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
    if (seenMonths.has(monthKey)) {
      return { key: `${firstOfMonth.key}-${index}`, label: "" };
    }

    seenMonths.add(monthKey);
    return {
      key: `${firstOfMonth.key}-${index}`,
      label: date.toLocaleString(undefined, { month: "short", year: "numeric" }),
    };
  });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[repeat(26,minmax(0,1fr))] gap-1 text-[11px] text-muted-foreground">
        {monthLabels.map((month) => (
          <span key={month.key}>{month.label}</span>
        ))}
      </div>
      <div className="grid grid-cols-[repeat(26,minmax(0,1fr))] gap-1 overflow-hidden">
        {weeks.map((week, weekIndex) => (
          <div key={week[0]?.key ?? weekIndex} className="grid grid-rows-7 gap-1">
            {week.map((day) => (
              <div
                key={day.key}
                title={`${day.key}: ${day.count} transcriptions`}
                className={[
                  "aspect-square rounded-[3px]",
                  day.count === 0
                    ? "bg-muted"
                    : day.count / max > 0.66
                      ? "bg-primary"
                      : day.count / max > 0.33
                        ? "bg-primary/65"
                        : "bg-primary/30",
                ].join(" ")}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Less</span>
        <span className="h-4 w-4 rounded bg-muted" />
        <span className="h-4 w-4 rounded bg-primary/30" />
        <span className="h-4 w-4 rounded bg-primary/65" />
        <span className="h-4 w-4 rounded bg-primary" />
        <span>More</span>
      </div>
    </div>
  );
}

function HourlyChart({ values, durations }: { values: number[]; durations: number[] }) {
  const max = Math.max(1, ...values);
  const maxDuration = Math.max(1, ...durations);
  return (
    <div className="space-y-4">
      <div className="flex h-52 items-end gap-1 rounded-xl border border-border bg-background p-3">
        {values.map((value, hour) => (
          <div key={hour} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex h-36 w-full items-end gap-1">
              <div
                className="w-1/2 rounded-t bg-primary transition-all"
                style={{ height: `${Math.max(6, (value / max) * 100)}%`, opacity: value ? 1 : 0.18 }}
                title={`${formatHourLabel(hour)}: ${value} transcriptions`}
              />
              <div
                className="w-1/2 rounded-t bg-primary/35 transition-all"
                style={{
                  height: `${Math.max(6, (durations[hour] / maxDuration) * 100)}%`,
                  opacity: durations[hour] ? 1 : 0.18,
                }}
                title={`${formatHourLabel(hour)}: ${formatDurationCompact(durations[hour])} recorded`}
              />
            </div>
            {hour % 6 === 0 && (
              <span className="text-[10px] text-muted-foreground">{hour === 0 ? "12a" : `${hour}h`}</span>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" />
          Sessions
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-primary/35" />
          Time spent
        </div>
      </div>
    </div>
  );
}

function UsageTrendChart({
  points,
}: {
  points: Array<{ label: string; count: number; duration: number }>;
}) {
  const maxCount = Math.max(1, ...points.map((point) => point.count));
  const maxDuration = Math.max(1, ...points.map((point) => point.duration));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-background p-4">
        <div className="space-y-3">
          {points.map((point) => (
            <div key={point.label} className="grid grid-cols-[56px_1fr_84px] items-center gap-3">
              <span className="text-xs text-muted-foreground">{point.label}</span>
              <div className="space-y-1">
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(6, (point.count / maxCount) * 100)}%` }}
                  />
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/35"
                    style={{ width: `${Math.max(6, (point.duration / maxDuration) * 100)}%` }}
                  />
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium text-foreground">{point.count} sessions</p>
                <p className="text-[11px] text-muted-foreground">
                  {formatDurationCompact(point.duration)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" />
          Usage count
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-primary/35" />
          Time spent
        </div>
      </div>
    </div>
  );
}

function TopApps({
  apps,
  appIcons,
}: {
  apps: Array<{ name: string; count: number; words: number }>;
  appIcons: Record<string, string | null>;
}) {
  const totalWords = Math.max(1, apps.reduce((sum, app) => sum + app.words, 0));
  const max = Math.max(1, ...apps.map((app) => app.words));
  return (
    <ScrollArea className="h-80 pr-3">
      <div className="space-y-4">
        {apps.map((app) => (
          <div key={app.name} className="grid grid-cols-[36px_1fr] items-center gap-3">
            <AppBadge name={app.name} iconSrc={appIcons[app.name] ?? null} />
            <div className="min-w-0">
              <div className="mb-1 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{app.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {app.count} {app.count === 1 ? "dictation" : "dictations"} · {app.words.toLocaleString()} words
                  </p>
                </div>
                <p className="font-mono text-xs text-muted-foreground">
                  {Math.round((app.words / totalWords) * 100)}%
                </p>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(6, (app.words / max) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function AppBadge({ name, iconSrc }: { name: string; iconSrc: string | null }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-sidebar-accent font-mono text-xs font-semibold text-primary">
      {iconSrc ? (
        <img src={iconSrc} alt="" className="h-7 w-7 rounded-lg object-cover" />
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
    <div className="fixed right-6 top-14 z-40 flex items-center gap-3 rounded-full border border-border bg-muted px-4 py-2 shadow-2xl shadow-black/40">
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
