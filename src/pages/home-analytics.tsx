import { useMemo } from "react";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { curveNatural } from "@visx/curve";
import {
  Bar,
  BarChart,
  BarXAxis,
  Grid,
  ChartTooltip,
  HeatmapCells,
  HeatmapChart,
  HeatmapInteractionBoundary,
  HeatmapInteractionProvider,
  HeatmapLegend,
  HeatmapTooltip,
  HeatmapXAxis,
  HeatmapYAxis,
  Line,
  LineChart,
  XAxis,
} from "@/components/charts";
import type { HeatmapColumn } from "@/components/charts/heatmap";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import type { PieData } from "@/components/charts/pie-context";

type ActivitySummary = {
  activeDays: number;
  bestDayCount: number;
  bestDayLabel: string;
  averagePerWeek: number;
};

type ActivityDay = { key: string; count: number };
type TopApp = { name: string; count: number; words: number };

type HourlyActivity = {
  values: number[];
  durations: number[];
  peakLabel: string;
  segments: {
    night: number;
    morning: number;
    afternoon: number;
    evening: number;
  };
};

type UsageTrendPoint = { label: string; count: number; duration: number };
type DailyWordPoint = { key: string; label: string; words: number; sessions: number };

type LatencySummary = {
  samples: number;
  totalP50: number;
  totalP95: number;
  asrP50: number;
  asrP95: number;
};

/** Grayscale slice ramp from the app's chart tokens (monochrome system). */
const piePalette = [
  // Ordered so adjacent slices (including the wrap-around pair) alternate
  // between dark and light steps of the grayscale ramp.
  "var(--chart-1)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-2)",
  "var(--chart-5)",
] as const;

const barDataKeyColor = "var(--chart-line-primary)";

export function InsightsPanel({
  currentStreak,
  longestStreak,
  totalWords,
  historyCount,
  activitySummary,
  activityDays,
  topApps,
  appIcons,
  historyLoading,
  hourlyActivity,
  usageTrend,
  dailyWordTrend,
  totalDurationSeconds,
  latency,
}: {
  currentStreak: number;
  longestStreak: number;
  totalWords: number;
  historyCount: number;
  activitySummary: ActivitySummary;
  activityDays: ActivityDay[];
  topApps: TopApp[];
  appIcons: Record<string, string | null>;
  historyLoading: boolean;
  hourlyActivity: HourlyActivity;
  usageTrend: UsageTrendPoint[];
  dailyWordTrend: DailyWordPoint[];
  totalDurationSeconds: number;
  latency: LatencySummary;
}) {
  const chartStatus = historyLoading ? ("loading" as const) : ("ready" as const);
  const wordsPerSession = historyCount > 0 ? Math.round(totalWords / historyCount) : 0;

  return (
    <section className="panel overflow-hidden" aria-label="Dictation insights">
      <Tabs defaultValue="activity" className="gap-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <TabsList>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="output">Output</TabsTrigger>
            <TabsTrigger value="apps">Apps</TabsTrigger>
            <TabsTrigger value="speed">Speed</TabsTrigger>
          </TabsList>
          <p className="hidden text-xs text-muted-foreground sm:block">Last 6 months</p>
        </div>

        <TabsContent
          value="activity"
          className="flex flex-col gap-5 p-4 duration-200 animate-in fade-in slide-in-from-top-1 sm:p-5"
        >
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border sm:grid-cols-4">
            <InsightStat label="Day streak" value={currentStreak.toLocaleString()} />
            <InsightStat label="Longest streak" value={longestStreak.toLocaleString()} />
            <InsightStat label="Active days" value={activitySummary.activeDays.toLocaleString()} />
            <InsightStat
              label="Best day"
              value={
                activitySummary.bestDayCount > 0
                  ? `${activitySummary.bestDayCount} sessions`
                  : "—"
              }
            />
          </div>
          <ContributionHeatmap days={activityDays} status={chartStatus} />
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-xs font-medium text-foreground">Sessions per week</h3>
              <p className="text-[11px] text-muted-foreground">
                {formatDurationCompact(totalDurationSeconds)} recorded
              </p>
            </div>
            <UsageTrendChart points={usageTrend} status={chartStatus} />
          </div>
        </TabsContent>

        <TabsContent
          value="output"
          className="flex flex-col gap-5 p-4 duration-200 animate-in fade-in slide-in-from-top-1 sm:p-5"
        >
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border sm:grid-cols-3">
            <InsightStat label="Words dictated" value={totalWords.toLocaleString()} />
            <InsightStat label="Per session" value={wordsPerSession.toLocaleString()} />
            <InsightStat label="Recorded" value={formatDurationCompact(totalDurationSeconds)} />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-xs font-medium text-foreground">Daily words</h3>
              <p className="text-[11px] text-muted-foreground">Last 14 days</p>
            </div>
            <DailyWordsChart points={dailyWordTrend} status={chartStatus} />
          </div>
        </TabsContent>

        <TabsContent
          value="apps"
          className="p-4 duration-200 animate-in fade-in slide-in-from-top-1 sm:p-5"
        >
          <div className="grid gap-5 xl:grid-cols-2">
            <div className="min-w-0">
              <h3 className="mb-3 text-xs font-medium text-foreground">Top apps</h3>
              {historyLoading ? (
                <LoadingInline label="Loading app usage…" />
              ) : topApps.length > 0 ? (
                <TopApps apps={topApps} appIcons={appIcons} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  App usage appears after your next dictation.
                </p>
              )}
            </div>
            <div className="min-w-0">
              <h3 className="mb-3 text-xs font-medium text-foreground">App share</h3>
              <AppShareChart apps={topApps} />
            </div>
          </div>
        </TabsContent>

        <TabsContent
          value="speed"
          className="flex flex-col gap-5 p-4 duration-200 animate-in fade-in slide-in-from-top-1 sm:p-5"
        >
          {latency.samples > 0 ? (
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border sm:grid-cols-4">
              <InsightStat label="Median total" value={formatMs(latency.totalP50)} />
              <InsightStat label="p95 total" value={formatMs(latency.totalP95)} />
              <InsightStat label="Median ASR" value={formatMs(latency.asrP50)} />
              <InsightStat label="p95 ASR" value={formatMs(latency.asrP95)} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Latency appears after your next dictation.
            </p>
          )}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-medium text-foreground">Time of day</h3>
              <p className="text-[11px] text-muted-foreground">Peak {hourlyActivity.peakLabel}</p>
            </div>
            <HourlyChart values={hourlyActivity.values} status={chartStatus} />
            <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border sm:grid-cols-4">
              <InsightStat label="Night" value={hourlyActivity.segments.night.toLocaleString()} />
              <InsightStat label="Morning" value={hourlyActivity.segments.morning.toLocaleString()} />
              <InsightStat label="Afternoon" value={hourlyActivity.segments.afternoon.toLocaleString()} />
              <InsightStat label="Evening" value={hourlyActivity.segments.evening.toLocaleString()} />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}

function LoadingInline({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner className="size-4" />
      <span>{label}</span>
    </div>
  );
}

function formatMs(ms: number) {
  if (!ms || ms <= 0) return "0ms";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function InsightStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

/**
 * GitHub-style contribution grid built on the bklit heatmap. Source days are
 * regrouped into Sunday-first week columns; days outside the recorded range
 * become ghost bins and are hidden by the chart.
 */
function ContributionHeatmap({
  days,
  status,
}: {
  days: ActivityDay[];
  status: "loading" | "ready";
}) {
  const columns = useMemo(
    () => buildHeatmapColumns(days, new Map(days.map((day) => [day.key, day.count]))),
    [days]
  );
  const rangeEnd = days.length > 0 ? parseDayKey(days[days.length - 1].key) : undefined;
  const rangeStart = days.length > 0 ? parseDayKey(days[0].key) : undefined;

  return (
    <HeatmapInteractionProvider>
      <HeatmapInteractionBoundary>
        <div className="flex w-full flex-col items-stretch gap-3">
          <HeatmapChart
            data={columns}
            layout="fluid"
            gap={2}
            status={status}
            loadingLabel={status === "loading" ? "Loading activity…" : undefined}
            xDomain={
              rangeStart && rangeEnd
                ? [
                    new Date(rangeStart.getTime() - 86_400_000),
                    new Date(rangeEnd.getTime() + 86_400_000),
                  ]
                : undefined
            }
            margin={{ top: 24, right: 8, bottom: 4, left: 36 }}
          >
            <HeatmapCells cornerRadius={2} />
            <HeatmapXAxis />
            <HeatmapYAxis tickFilter="odd" />
            <HeatmapTooltip formatLabel={formatHeatmapSessionsLabel} />
          </HeatmapChart>
          <HeatmapLegend lessLabel="Less" moreLabel="More" align="end" />
        </div>
      </HeatmapInteractionBoundary>
    </HeatmapInteractionProvider>
  );
}

function buildHeatmapColumns(
  days: ActivityDay[],
  counts: Map<string, number>
): HeatmapColumn[] {
  if (days.length === 0) return [];

  const first = parseDayKey(days[0].key);
  const last = parseDayKey(days[days.length - 1].key);

  // Start at the Sunday on or before the first recorded day.
  const cursor = new Date(first);
  cursor.setDate(cursor.getDate() - cursor.getDay());

  const columns: HeatmapColumn[] = [];
  let weekIndex = 0;
  while (cursor.getTime() <= last.getTime()) {
    const bins = Array.from({ length: 7 }, (_, bin) => {
      const date = new Date(cursor);
      date.setDate(cursor.getDate() + bin);
      const key = formatDayKey(date);
      return { bin, count: counts.get(key) ?? 0, date };
    });
    columns.push({ bin: weekIndex, bins });
    cursor.setDate(cursor.getDate() + 7);
    weekIndex += 1;
  }
  return columns;
}

function parseDayKey(key: string) {
  return new Date(`${key}T00:00:00`);
}

function formatDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function formatHeatmapSessionsLabel(count: number) {
  return `${count} ${count === 1 ? "session" : "sessions"}`;
}

function HourlyChart({
  values,
  status,
}: {
  values: number[];
  status: "loading" | "ready";
}) {
  const data = values.map((value, hour) => ({
    label: formatHourLabel(hour),
    sessions: value,
  }));

  return (
    <div className="rounded-xl border border-border bg-background px-2 py-3">
      <BarChart
        data={data}
        xDataKey="label"
        status={status}
        aspectRatio="4 / 1"
        margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
      >
        <Grid horizontal />
        <Bar dataKey="sessions" fill={barDataKeyColor} lineCap="round" />
        <BarXAxis maxLabels={6} />
        <ChartTooltip />
      </BarChart>
    </div>
  );
}

function UsageTrendChart({
  points,
  status,
}: {
  points: UsageTrendPoint[];
  status: "loading" | "ready";
}) {
  const data = points.map((point) => ({
    label: point.label,
    sessions: point.count,
  }));

  return (
    <div className="rounded-xl border border-border bg-background px-2 py-3">
      <BarChart
        data={data}
        xDataKey="label"
        status={status}
        aspectRatio="5 / 1"
        barWidth={56}
        margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
      >
        <Grid horizontal />
        <Bar dataKey="sessions" fill={barDataKeyColor} lineCap="round" />
        <BarXAxis maxLabels={8} />
        <ChartTooltip />
      </BarChart>
    </div>
  );
}

function DailyWordsChart({
  points,
  status,
}: {
  points: DailyWordPoint[];
  status: "loading" | "ready";
}) {
  const data = points.map((point) => ({
    date: parseDayKey(point.key),
    words: point.words,
  }));

  return (
    <div className="rounded-xl border border-border bg-background px-2 py-3">
      <LineChart
        data={data}
        status={status}
        loadingLabel="Loading words…"
        aspectRatio="3 / 1"
        margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
      >
        <Grid horizontal />
        <Line
          dataKey="words"
          stroke={barDataKeyColor}
          curve={curveNatural}
          showMarkers
        />
        <XAxis numTicks={5} />
        <ChartTooltip />
      </LineChart>
    </div>
  );
}

function AppShareChart({ apps }: { apps: TopApp[] }) {
  const top = apps.slice(0, 4);
  const otherWords = apps.slice(4).reduce((sum, app) => sum + app.words, 0);
  const data: PieData[] = [
    ...top.map((app, index) => ({
      label: app.name,
      value: app.words,
      color: piePalette[index % piePalette.length],
    })),
    ...(otherWords > 0
      ? [{ label: "Other", value: otherWords, color: piePalette[4] }]
      : []),
  ].filter((item) => item.value > 0);

  if (data.length === 0) {
    return <EmptyChartState label="No app usage yet" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-56 items-center justify-center rounded-xl border border-border bg-background py-4">
        <PieChart data={data} size={190} innerRadius={62} padAngle={0.03} cornerRadius={4}>
          {data.map((slice, index) => (
            <PieSlice key={slice.label} index={index} color={slice.color} />
          ))}
        </PieChart>
      </div>
      <div className="grid gap-2 text-xs text-muted-foreground">
        {data.map((entry) => (
          <div key={entry.label} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: entry.color }}
              />
              <span className="truncate">{entry.label}</span>
            </span>
            <span className="font-mono text-foreground">{entry.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopApps({
  apps,
  appIcons,
}: {
  apps: TopApp[];
  appIcons: Record<string, string | null>;
}) {
  const totalWords = Math.max(1, apps.reduce((sum, app) => sum + app.words, 0));
  const data = apps.slice(0, 8).map((app) => ({
    ...app,
    share: Math.round((app.words / totalWords) * 100),
  }));

  return (
    <div className="flex flex-col gap-2.5">
      {data.map((app) => (
        <div
          key={app.name}
          className="group flex min-w-0 items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5"
        >
          <AppBadge name={app.name} iconSrc={appIcons[app.name] ?? null} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-sm font-medium text-foreground">{app.name}</p>
              <p className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                {app.share}%
              </p>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${Math.max(app.share, 2)}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyChartState({ label }: { label: string }) {
  return (
    <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-border bg-background text-sm text-muted-foreground">
      {label}
    </div>
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
        <img src={iconSrc} alt="" className="h-7 w-7 rounded-md object-cover" />
      ) : (
        initials
      )}
    </div>
  );
}

function formatHourLabel(hour: number) {
  const normalizedHour = hour % 24;
  const suffix = normalizedHour >= 12 ? "p" : "a";
  const hour12 = normalizedHour % 12 || 12;
  return `${hour12}${suffix}`;
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