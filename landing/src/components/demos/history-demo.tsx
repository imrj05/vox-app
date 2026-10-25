import { cn } from "@/lib/utils";
import { DemoWindow } from "./window";

const HISTORY = [
  {
    text: "Rename the migration to include the tenant id",
    time: "0:06",
    app: "VS Code",
  },
  { text: "Ship it after the hotkey test passes", time: "0:03", app: "Slack" },
  { text: "Move the retro to Thursday", time: "0:04", app: "Mail" },
];

const ACTIVITY = [34, 48, 29, 66, 43, 58, 82];

export function HistoryDemo() {
  return (
    <DemoWindow
      title="Transcripts"
      right={
        <span className="text-[10px] uppercase tracking-[0.12em]">Local</span>
      }
    >
      <ul>
        {HISTORY.map((row) => (
          <li
            key={row.text}
            className="flex items-baseline justify-between gap-4 border-b border-code-edge px-4 py-3.5 last:border-b-0 sm:px-5"
          >
            <span className="min-w-0 truncate text-[13px] leading-5 text-code-text">
              {row.text}
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-code-muted">
              {row.app} · {row.time}
            </span>
          </li>
        ))}
      </ul>

      <div className="border-t border-code-edge px-4 py-4 sm:px-5">
        <div aria-hidden="true" className="flex h-9 items-end gap-1">
          {ACTIVITY.map((value, index) => (
            <span
              key={index}
              className={cn(
                "flex-1",
                index === ACTIVITY.length - 1 ? "bg-mint" : "bg-neutral-800"
              )}
              style={{ height: `${value}%` }}
            />
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between text-[10px] text-code-muted">
          <span>Words per day · last 7</span>
          <span>sqlite · local</span>
        </div>
      </div>
    </DemoWindow>
  );
}
