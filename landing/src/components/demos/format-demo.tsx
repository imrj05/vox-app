import { useState } from "react";
import { cn } from "@/lib/utils";
import { DemoWindow } from "./window";

const PHRASES = [
  {
    id: "camel",
    label: "camelCase",
    spoken: "camel case new api key",
    plain: "Camel case new API key.",
    developer: "newApiKey",
  },
  {
    id: "quotes",
    label: "quotes",
    spoken: "quote hello world quote comma new line",
    plain: "Quote hello world quote, new line.",
    developer: '"hello world",\n',
  },
  {
    id: "git",
    label: "git command",
    spoken: "git commit dash m fix the hotkey",
    plain: "Git commit dash m fix the hotkey.",
    developer: 'git commit -m "fix the hotkey"',
  },
] as const;

type FormattingMode = "plain" | "developer";

export function FormatDemo() {
  const [mode, setMode] = useState<FormattingMode>("developer");
  const [phraseId, setPhraseId] =
    useState<(typeof PHRASES)[number]["id"]>("git");
  const phrase = PHRASES.find((item) => item.id === phraseId) ?? PHRASES[0];

  return (
    <DemoWindow
      title="Developer formatting"
      right={
        <span className="hidden text-[10px] uppercase tracking-[0.12em] sm:inline">
          Preview
        </span>
      }
    >
      <div className="px-4 py-5 sm:px-5">
        <div role="group" aria-label="Formatting mode" className="flex gap-1">
          {(["plain", "developer"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                mode === option
                  ? "bg-white text-black"
                  : "text-code-muted hover:text-code-text"
              )}
            >
              {option}
            </button>
          ))}
        </div>

        <p className="mt-6 text-[10px] uppercase tracking-[0.14em] text-code-muted">
          Spoken
        </p>
        <p className="mt-1.5 text-[13px] leading-6 text-code-text">
          “{phrase.spoken}”
        </p>

        <div aria-hidden="true" className="my-5 h-px w-full bg-code-edge" />

        <p className="text-[10px] uppercase tracking-[0.14em] text-code-muted">
          At the cursor
        </p>
        <pre className="mt-1.5 min-h-[3.5rem] whitespace-pre-wrap break-words font-mono text-[13px] leading-6 text-code-string">
          {mode === "plain" ? phrase.plain : phrase.developer}
        </pre>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-code-edge px-4 py-3 sm:px-5">
        {PHRASES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={phraseId === item.id}
            onClick={() => setPhraseId(item.id)}
            className={cn(
              "border px-2 py-1 text-[10px] uppercase tracking-[0.08em] transition-colors",
              phraseId === item.id
                ? "border-code-edge text-code-text"
                : "border-transparent text-code-muted hover:border-code-edge hover:text-code-text"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </DemoWindow>
  );
}
