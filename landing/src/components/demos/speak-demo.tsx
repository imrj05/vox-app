import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { DemoWindow, Waveform } from "./window";

const SPOKEN = "Let's move the retro to Thursday and book the same room.";
const SPOKEN_WORDS = SPOKEN.split(" ");

export function SpeakDemo() {
  const [count, setCount] = useState(0);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) return;

    const delay = count >= SPOKEN_WORDS.length ? 2600 : 260;
    const timer = window.setTimeout(() => {
      setCount((value) => (value >= SPOKEN_WORDS.length ? 0 : value + 1));
    }, delay);

    return () => window.clearTimeout(timer);
  }, [count, reduced]);

  const shown = reduced ? SPOKEN_WORDS.length : count;

  return (
    <DemoWindow
      title="Vox widget"
      right={
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-mint">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-mint" />
          Listening
        </span>
      }
    >
      <div className="px-5 py-8 sm:px-8">
        <div className="flex items-center justify-center gap-4">
          <span className="flex h-10 items-center">
            <Waveform bars={7} className="h-8" />
          </span>
          <span className="text-2xl tabular-nums text-code-text">0:03</span>
        </div>

        <p className="mx-auto mt-8 min-h-[4.5rem] max-w-[34ch] text-center text-[15px] leading-7 text-code-text">
          {SPOKEN_WORDS.slice(0, shown).join(" ")}
          <span
            aria-hidden="true"
            className="vox-caret ml-0.5 inline-block h-4 w-2 translate-y-[3px] bg-code-text align-middle"
          />
        </p>

        <div className="mt-7 flex items-center justify-between border-t border-code-edge pt-4 text-[10px] text-code-muted">
          <span>English · auto</span>
          <span>esc to cancel</span>
        </div>
      </div>
    </DemoWindow>
  );
}
