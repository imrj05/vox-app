import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { Spinner } from "@/components/ui/spinner";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

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
type DailyWordPoint = { label: string; words: number; sessions: number };
type DurationBucket = { label: string; sessions: number };

const hourlyChartConfig = {
  sessions: {
    label: "Sessions",
    color: "var(--primary)",
  },
  minutes: {
    label: "Minutes",
    color: "color-mix(in oklch, var(--primary) 45%, transparent)",
  },
} satisfies ChartConfig;

const usageChartConfig = {
  sessions: {
    label: "Sessions",
    color: "var(--primary)",
  },
  minutes: {
    label: "Minutes recorded",
    color: "color-mix(in oklch, var(--primary) 55%, transparent)",
  },
} satisfies ChartConfig;

const activityChartConfig = {
  sessions: {
    label: "Sessions",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

const topAppsChartConfig = {
  words: {
    label: "Words",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

const dailyWordsChartConfig = {
  words: {
    label: "Words",
    color: "var(--primary)",
  },
  sessions: {
    label: "Sessions",
    color: "color-mix(in oklch, var(--primary) 42%, transparent)",
  },
} satisfies ChartConfig;

const appShareChartConfig = {
  words: {
    label: "Words",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

const durationChartConfig = {
  sessions: {
    label: "Sessions",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

const piePalette = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

export function AnalyticsPanels({
  activitySummary,
  activityDays,
  topApps,
  appIcons,
  historyLoading,
  hourlyActivity,
  usageTrend,
  dailyWordTrend,
  durationBuckets,
  totalDurationSeconds,
}: {
  activitySummary: ActivitySummary;
  activityDays: ActivityDay[];
  topApps: TopApp[];
  appIcons: Record<string, string | null>;
  historyLoading: boolean;
  hourlyActivity: HourlyActivity;
  usageTrend: UsageTrendPoint[];
  dailyWordTrend: DailyWordPoint[];
  durationBuckets: DurationBucket[];
  totalDurationSeconds: number;
}) {
  return (
    <>
      <section className="surface-depth-soft rounded-2xl border border-border bg-card p-6">
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
        <div className="surface-depth-soft rounded-2xl border border-border bg-card p-5">
          <h3 className="mb-4 text-lg font-semibold text-foreground">Top apps</h3>
          {historyLoading ? (
            <LoadingInline label="Loading app usage..." />
          ) : topApps.length > 0 ? (
            <TopApps apps={topApps} appIcons={appIcons} />
          ) : (
            <p className="text-sm text-muted-foreground">App usage will appear after new transcriptions.</p>
          )}
        </div>

        <div className="surface-depth-soft rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Time of day</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Usage by hour, plus where most of your dictation time goes.
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Peak hour</p>
              <p className="text-sm font-medium text-foreground">{hourlyActivity.peakLabel}</p>
            </div>
          </div>
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <MetricPill label="Night" value={hourlyActivity.segments.night.toLocaleString()} />
            <MetricPill label="Morning" value={hourlyActivity.segments.morning.toLocaleString()} />
            <MetricPill label="Afternoon" value={hourlyActivity.segments.afternoon.toLocaleString()} />
            <MetricPill label="Evening" value={hourlyActivity.segments.evening.toLocaleString()} />
          </div>
          <HourlyChart values={hourlyActivity.values} durations={hourlyActivity.durations} />
        </div>
      </section>

      <section className="surface-depth-soft rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Usage over time</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Track how often you dictate and how much time you spend across the last 8 weeks.
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Total recorded</p>
            <p className="text-sm font-medium text-foreground">{formatDurationCompact(totalDurationSeconds)}</p>
          </div>
        </div>
        <UsageTrendChart points={usageTrend} />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="surface-depth-soft rounded-2xl border border-border bg-card p-5">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-foreground">Daily words</h3>
            <p className="mt-1 text-xs text-muted-foreground">Word output and session count over the last two weeks.</p>
          </div>
          <DailyWordsChart points={dailyWordTrend} />
        </div>

        <div className="surface-depth-soft rounded-2xl border border-border bg-card p-5">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-foreground">App share</h3>
            <p className="mt-1 text-xs text-muted-foreground">Where your dictated words are going most often.</p>
          </div>
          <AppShareChart apps={topApps} />
        </div>

        <div className="surface-depth-soft rounded-2xl border border-border bg-card p-5">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-foreground">Session length</h3>
            <p className="mt-1 text-xs text-muted-foreground">A quick view of short vs longer dictation sessions.</p>
          </div>
          <SessionLengthChart buckets={durationBuckets} />
        </div>
      </section>
    </>
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

function ActivityGrid({ days }: { days: ActivityDay[] }) {
  const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, index) =>
    days.slice(index * 7, index * 7 + 7)
  );
  const data = weeks.map((week, index) => {
    const firstDay = week[0]?.key;
    const date = firstDay ? new Date(firstDay) : new Date();
    const sessions = week.reduce((sum, day) => sum + day.count, 0);

    return {
      week: index + 1,
      label: index % 4 === 0 ? date.toLocaleString(undefined, { month: "short" }) : "",
      tooltipLabel: `Week of ${date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })}`,
      sessions,
    };
  });

  return (
    <ChartContainer config={activityChartConfig} className="h-64 w-full rounded-xl border border-border bg-background p-3">
      <BarChart data={data} margin={{ left: -18, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={0} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => payload[0]?.payload?.tooltipLabel ?? ""}
              formatter={(value) => (
                <>
                  <span className="text-muted-foreground">Sessions</span>
                  <span className="ml-auto font-mono font-medium text-foreground">{value}</span>
                </>
              )}
            />
          }
        />
        <Bar dataKey="sessions" fill="var(--color-sessions)" radius={[6, 6, 2, 2]} animationDuration={650} />
      </BarChart>
    </ChartContainer>
  );
}

function HourlyChart({ values, durations }: { values: number[]; durations: number[] }) {
  const data = values.map((value, hour) => ({
    hour,
    tooltipLabel: formatHourLabel(hour),
    sessions: value,
    minutes: Math.round((durations[hour] / 60) * 10) / 10,
  }));

  return (
    <ChartContainer config={hourlyChartConfig} className="h-64 w-full rounded-xl border border-border bg-background p-3">
      <BarChart data={data} margin={{ left: -18, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="hour"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval={0}
          tickFormatter={(hour) => (hour % 6 === 0 ? (hour === 0 ? "12a" : `${hour}h`) : "")}
        />
        <YAxis yAxisId="sessions" tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
        <YAxis yAxisId="minutes" orientation="right" tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => payload[0]?.payload?.tooltipLabel ?? ""}
              formatter={(value, name) => (
                <>
                  <span className="text-muted-foreground">
                    {name === "minutes" ? "Minutes" : "Sessions"}
                  </span>
                  <span className="ml-auto font-mono font-medium text-foreground">
                    {name === "minutes" ? `${value}m` : value}
                  </span>
                </>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar yAxisId="sessions" dataKey="sessions" fill="var(--color-sessions)" radius={[6, 6, 2, 2]} animationDuration={650} />
        <Bar yAxisId="minutes" dataKey="minutes" fill="var(--color-minutes)" radius={[6, 6, 2, 2]} animationDuration={650} />
      </BarChart>
    </ChartContainer>
  );
}

function UsageTrendChart({ points }: { points: UsageTrendPoint[] }) {
  const data = points.map((point) => ({
    label: point.label,
    sessions: point.count,
    minutes: Math.round((point.duration / 60) * 10) / 10,
  }));

  return (
    <ChartContainer config={usageChartConfig} className="h-72 w-full rounded-xl border border-border bg-background p-3">
      <ComposedChart data={data} margin={{ left: -18, right: -12, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis yAxisId="sessions" tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
        <YAxis yAxisId="minutes" orientation="right" tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <>
                  <span className="text-muted-foreground">
                    {name === "minutes" ? "Minutes" : "Sessions"}
                  </span>
                  <span className="ml-auto font-mono font-medium text-foreground">
                    {name === "minutes" ? `${value}m` : value}
                  </span>
                </>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar yAxisId="sessions" dataKey="sessions" fill="var(--color-sessions)" radius={[6, 6, 2, 2]} animationDuration={650} />
        <Line
          yAxisId="minutes"
          dataKey="minutes"
          type="monotone"
          stroke="var(--color-minutes)"
          strokeWidth={2.5}
          dot={{ r: 3, fill: "var(--color-minutes)" }}
          activeDot={{ r: 5 }}
          animationDuration={650}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

function DailyWordsChart({ points }: { points: DailyWordPoint[] }) {
  return (
    <ChartContainer config={dailyWordsChartConfig} className="h-72 w-full rounded-xl border border-border bg-background p-3">
      <ComposedChart data={points} margin={{ left: -18, right: -12, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={14} />
        <YAxis yAxisId="words" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis yAxisId="sessions" orientation="right" tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <>
                  <span className="text-muted-foreground">
                    {name === "sessions" ? "Sessions" : "Words"}
                  </span>
                  <span className="ml-auto font-mono font-medium text-foreground">
                    {Number(value).toLocaleString()}
                  </span>
                </>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Area
          yAxisId="words"
          dataKey="words"
          type="monotone"
          fill="var(--color-words)"
          fillOpacity={0.18}
          stroke="var(--color-words)"
          strokeWidth={2.5}
          animationDuration={650}
        />
        <Line
          yAxisId="sessions"
          dataKey="sessions"
          type="monotone"
          stroke="var(--color-sessions)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--color-sessions)" }}
          activeDot={{ r: 5 }}
          animationDuration={650}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

function AppShareChart({ apps }: { apps: TopApp[] }) {
  const top = apps.slice(0, 4);
  const otherWords = apps.slice(4).reduce((sum, app) => sum + app.words, 0);
  const data = [
    ...top.map((app, index) => ({
      name: app.name,
      words: app.words,
      fill: piePalette[index % piePalette.length],
    })),
    ...(otherWords > 0
      ? [{ name: "Other", words: otherWords, fill: piePalette[4] }]
      : []),
  ].filter((item) => item.words > 0);

  if (data.length === 0) {
    return <EmptyChartState label="No app usage yet" />;
  }

  return (
    <div className="space-y-3">
      <ChartContainer config={appShareChartConfig} className="h-56 w-full rounded-xl border border-border bg-background p-3">
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(value, name) => (
                  <>
                    <span className="text-muted-foreground">{name}</span>
                    <span className="ml-auto font-mono font-medium text-foreground">
                      {Number(value).toLocaleString()} words
                    </span>
                  </>
                )}
              />
            }
          />
          <Pie
            data={data}
            dataKey="words"
            nameKey="name"
            innerRadius={52}
            outerRadius={82}
            paddingAngle={3}
            strokeWidth={4}
            animationDuration={650}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="grid gap-2 text-xs text-muted-foreground">
        {data.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: entry.fill }} />
              <span className="truncate">{entry.name}</span>
            </span>
            <span className="font-mono text-foreground">{entry.words.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionLengthChart({ buckets }: { buckets: DurationBucket[] }) {
  const hasData = buckets.some((bucket) => bucket.sessions > 0);

  if (!hasData) {
    return <EmptyChartState label="No recorded durations yet" />;
  }

  return (
    <ChartContainer config={durationChartConfig} className="h-72 w-full rounded-xl border border-border bg-background p-3">
      <BarChart data={buckets} margin={{ left: -18, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Bar dataKey="sessions" fill="var(--color-sessions)" radius={[7, 7, 2, 2]} animationDuration={650} />
      </BarChart>
    </ChartContainer>
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
    shortName: app.name.length > 18 ? `${app.name.slice(0, 16)}...` : app.name,
    share: Math.round((app.words / totalWords) * 100),
  }));

  return (
    <div className="space-y-4">
      <ChartContainer config={topAppsChartConfig} className="h-80 w-full rounded-xl border border-border bg-background p-3">
        <BarChart data={data} layout="vertical" margin={{ left: 6, right: 24, top: 6, bottom: 6 }}>
          <CartesianGrid horizontal={false} strokeDasharray="3 3" />
          <XAxis type="number" hide />
          <YAxis
            dataKey="shortName"
            type="category"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={112}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => payload[0]?.payload?.name ?? ""}
                formatter={(value, _name, item) => (
                  <>
                    <span className="text-muted-foreground">
                      {item.payload.count} {item.payload.count === 1 ? "dictation" : "dictations"}
                    </span>
                    <span className="ml-auto font-mono font-medium text-foreground">
                      {Number(value).toLocaleString()} words · {item.payload.share}%
                    </span>
                  </>
                )}
              />
            }
          />
          <Bar dataKey="words" fill="var(--color-words)" radius={[0, 7, 7, 0]} animationDuration={650} />
        </BarChart>
      </ChartContainer>
      <div className="grid gap-2 sm:grid-cols-2">
        {data.slice(0, 4).map((app) => (
          <div key={app.name} className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
            <AppBadge name={app.name} iconSrc={appIcons[app.name] ?? null} />
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-foreground">{app.name}</p>
              <p className="text-[11px] text-muted-foreground">{app.share}% of words</p>
            </div>
          </div>
        ))}
      </div>
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
