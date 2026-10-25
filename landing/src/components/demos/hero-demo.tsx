import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";
import { DemoWindow, LineNumber, Waveform } from "./window";

const TRANSCRIPT =
  "Add a retry helper to the fetch wrapper, then run the full test suite.";
const TRANSCRIPT_WORDS = TRANSCRIPT.split(" ");

const DOC_BEFORE = [
  "# Release notes",
  "",
  "- Tighten the notes before shipping.",
  "- Add the new engine picker to the docs.",
  "",
];

const DOC_AFTER = [
  "",
  "## After the retro",
  "- Move the retro to Thursday.",
  "",
  "- Ask Kai to review the migration.",
];

type Phase = "idle" | "recording" | "transcribing" | "typing" | "done";

export function HeroDemo() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [visibleWords, setVisibleWords] = useState(0);
  const [run, setRun] = useState(0);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) return;

    let cancelled = false;
    const timeouts: number[] = [];

    const at = (ms: number, fn: () => void) => {
      timeouts.push(
        window.setTimeout(() => {
          if (!cancelled) fn();
        }, ms)
      );
    };

    at(0, () => {
      setPhase("recording");
      setElapsed(0);
      setVisibleWords(0);
    });
    at(700, () => setElapsed(1));
    at(1400, () => setElapsed(2));
    at(2100, () => setElapsed(3));
    at(2200, () => setPhase("transcribing"));
    at(3100, () => {
      setPhase("typing");
      TRANSCRIPT_WORDS.forEach((_, index) => {
        at(3100 + index * 55, () => setVisibleWords(index + 1));
      });
      at(3100 + TRANSCRIPT_WORDS.length * 55 + 500, () => setPhase("done"));
    });

    return () => {
      cancelled = true;
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
    };
  }, [run, reduced]);

  const shownPhase: Phase = reduced ? "done" : phase;
  const shownElapsed = reduced ? 3 : elapsed;
  const shownWords = reduced ? TRANSCRIPT_WORDS.length : visibleWords;
  const listening = shownPhase === "recording" || shownPhase === "transcribing";
  const typed = TRANSCRIPT_WORDS.slice(0, shownWords).join(" ");

  return (
    <DemoWindow
      title="notes.md"
      className="rounded-none"
      right={
        <>
          <span className="hidden text-[11px] sm:inline">⌘⇧ Space</span>
          <button
            type="button"
            onClick={() => setRun((value) => value + 1)}
            className="rounded px-1.5 py-0.5 text-[11px] transition-colors hover:bg-code-edge hover:text-code-text"
          >
            Replay
          </button>
        </>
      }
    >
      <div className="relative">
        <div className="px-0 pb-2 pt-3 text-xs leading-6 sm:text-[13px]">
          {DOC_BEFORE.map((line, index) => (
            <div key={`top-${index}`} className="flex">
              <LineNumber>{index + 1}</LineNumber>
              <span
                className={cn(
                  "min-h-6 py-0 pl-4 pr-4",
                  line.startsWith("#") ? "text-code-key" : "text-code-muted"
                )}
              >
                {line || "\u00a0"}
              </span>
            </div>
          ))}

          <div className="flex">
            <LineNumber>6</LineNumber>
            <span className="min-h-[5rem] py-0 pl-4 pr-4 text-code-text sm:min-h-[3rem]">
              {typed}
              {shownPhase === "typing" && (
                <span
                  aria-hidden="true"
                  className="vox-caret ml-0.5 inline-block h-4 w-2 translate-y-[3px] bg-code-text align-middle"
                />
              )}
              {!typed && shownPhase === "idle" && (
                <span className="text-neutral-600">
                  Waiting for your voice…
                </span>
              )}
            </span>
          </div>

          {DOC_AFTER.map((line, index) => (
            <div key={`bottom-${index}`} className="flex">
              <LineNumber>{index + 7}</LineNumber>
              <span
                className={cn(
                  "min-h-6 py-0 pl-4 pr-4",
                  line.startsWith("#") ? "text-code-key" : "text-code-muted"
                )}
              >
                {line || "\u00a0"}
              </span>
            </div>
          ))}
        </div>

        <div className="flex h-9 items-center justify-end px-3 sm:px-4">
          <p
            className={cn(
              "flex items-center gap-2 rounded bg-mint/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-mint transition-opacity duration-300",
              shownPhase === "done"
                ? "visible opacity-100"
                : "invisible opacity-0"
            )}
          >
            <span aria-hidden="true" className="size-1 bg-mint" />
            Inserted at cursor · 0:04
          </p>
        </div>

        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-12 flex justify-center px-4 transition-all duration-300 ease-out",
            listening
              ? "translate-y-0 opacity-100"
              : "translate-y-2 opacity-0"
          )}
        >
          <div className="flex items-center gap-3 rounded-full border border-code-edge bg-neutral-900 px-4 py-2.5 text-white shadow-[0_18px_40px_-12px_rgba(0,0,0,0.9)]">
            {shownPhase === "recording" && !reduced ? (
              <>
                <Waveform className="h-5" />
                <span className="tabular-nums text-[11px] text-white/70">
                  {shownElapsed}s
                </span>
              </>
            ) : shownPhase === "recording" ? (
              <span className="text-[11px] text-white/85">
                Listening · {shownElapsed}s
              </span>
            ) : (
              <span className="vox-shimmer text-[11px]">Transcribing</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-code-edge px-3 py-2.5 text-[10px] text-code-muted sm:px-4 sm:text-[11px]">
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full transition-colors",
              listening ? "bg-mint" : "bg-neutral-700"
            )}
          />
          apple-speech · on-device
          {shownPhase === "typing" && (
            <span
              aria-hidden="true"
              className="h-3 w-1.5 animate-pulse bg-code-text"
            />
          )}
        </span>
        <span>0 network calls</span>
      </div>
    </DemoWindow>
  );
}
