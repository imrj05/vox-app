import { useState } from "react";
import { cn } from "@/lib/utils";
import { DemoWindow, Keycap } from "./window";

type TriggerMode = "toggle" | "hold";

export function PressDemo() {
  const [mode, setMode] = useState<TriggerMode>("toggle");

  return (
    <DemoWindow title="Vox · trigger">
      <div className="px-5 py-10 text-center sm:px-8">
        <div className="flex items-center justify-center gap-2">
          <Keycap>⌘</Keycap>
          <Keycap>⇧</Keycap>
          <Keycap wide>Space</Keycap>
        </div>

        <p className="mt-6 text-sm text-code-text/70">
          {mode === "toggle"
            ? "Tap once to start, again to stop."
            : "Hold the keys while you speak."}
        </p>

        <div
          role="radiogroup"
          aria-label="Trigger mode"
          className="mt-6 inline-flex border border-code-edge"
        >
          {(["toggle", "hold"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mode === option}
              onClick={() => setMode(option)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors",
                mode === option
                  ? "bg-white text-black"
                  : "text-code-muted hover:text-code-text"
              )}
            >
              {option === "toggle" ? "Toggle" : "Push-to-talk"}
            </button>
          ))}
        </div>

        <p className="mt-7 text-[10px] leading-5 tracking-wide text-code-muted">
          Native event tap · bare modifiers supported · works in any app
        </p>
      </div>
    </DemoWindow>
  );
}
