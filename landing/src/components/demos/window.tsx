import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const BAR_DELAYS = [
  "-0.9s",
  "-0.55s",
  "-0.2s",
  "-0.75s",
  "-0.35s",
  "-0.65s",
  "-0.05s",
];

interface DemoWindowProps {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function DemoWindow({
  title,
  right,
  children,
  className,
}: DemoWindowProps) {
  return (
    <div
      className={cn(
        "vox-demo flex w-full flex-col overflow-hidden rounded-lg border border-code-edge bg-code font-mono shadow-[0_30px_70px_-40px_rgba(0,0,0,0.85)]",
        className
      )}
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-code-edge px-3 py-2 sm:px-4 sm:py-2.5">
        <span aria-hidden="true" className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="min-w-0 truncate text-xs text-code-text/70">
          {title}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-code-muted">
          {right}
        </span>
      </div>
      {children}
    </div>
  );
}

export function LineNumber({ children }: { children: ReactNode }) {
  return (
    <span className="w-10 shrink-0 select-none border-r border-code-edge bg-black px-2 text-right text-[11px] leading-6 tabular-nums text-code-muted sm:w-12 sm:px-3 sm:text-xs">
      {children}
    </span>
  );
}

export function Waveform({
  bars = 5,
  className,
}: {
  bars?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("flex items-center gap-[3px]", className)}
    >
      {BAR_DELAYS.slice(0, bars).map((delay) => (
        <span
          key={delay}
          className="vox-bar h-full w-[3px] rounded-full bg-[linear-gradient(180deg,#dbe8fa,var(--live))]"
          style={{ animationDelay: delay }}
        />
      ))}
    </span>
  );
}

export function Keycap({
  children,
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-grid h-11 place-items-center border border-code-edge bg-black text-[15px] text-code-text",
        wide ? "min-w-24 px-4" : "w-11"
      )}
    >
      {children}
    </span>
  );
}
