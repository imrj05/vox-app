import { useState } from "react";
import { cn } from "@/lib/utils";
import { DemoWindow } from "./window";

const ENGINES = [
  {
    id: "apple",
    name: "Apple Speech",
    kind: "System recognizer",
    status: "No download",
    detail: "Built into macOS",
  },
  {
    id: "parakeet",
    name: "Parakeet",
    kind: "Local model",
    status: "Downloaded",
    detail: "Runs in-process",
  },
  {
    id: "whisper",
    name: "Whisper",
    kind: "Local model",
    status: "7 sizes",
    detail: "Metal accelerated",
  },
] as const;

type EngineId = (typeof ENGINES)[number]["id"];

const FALLBACK: Record<EngineId, EngineId> = {
  apple: "whisper",
  parakeet: "apple",
  whisper: "parakeet",
};

export function RouteDemo() {
  const [selected, setSelected] = useState<EngineId>("apple");
  const fallback = ENGINES.find((engine) => engine.id === FALLBACK[selected]);

  return (
    <DemoWindow
      title="Engines"
      right={
        <span className="text-[10px] uppercase tracking-[0.12em] text-mint">
          On-device
        </span>
      }
    >
      <div role="radiogroup" aria-label="Transcription engine">
        {ENGINES.map((engine) => {
          const active = engine.id === selected;

          return (
            <button
              key={engine.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setSelected(engine.id)}
              className={cn(
                "flex w-full items-center gap-3 border-b border-code-edge px-4 py-3.5 text-left transition-colors last:border-b-0 sm:px-5",
                active ? "bg-white/[0.04]" : "hover:bg-white/[0.02]"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-3.5 shrink-0 place-items-center border",
                  active ? "border-mint" : "border-neutral-700"
                )}
              >
                {active && <span className="size-1.5 bg-mint" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-code-text">
                  {engine.name}
                </span>
                <span className="mt-0.5 block text-[11px] text-code-muted">
                  {engine.kind} · {engine.detail}
                </span>
              </span>
              <span className="whitespace-nowrap text-[10px] uppercase tracking-[0.1em] text-code-muted">
                {engine.status}
              </span>
            </button>
          );
        })}
      </div>

      <p className="border-t border-code-edge px-4 py-3 text-[10px] leading-5 text-code-muted sm:px-5">
        Fallback: <span className="text-code-text">{fallback?.name}</span> ·
        switches are announced in the widget, never silent.
      </p>
    </DemoWindow>
  );
}
