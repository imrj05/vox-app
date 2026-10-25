import { DemoWindow, LineNumber } from "./window";

const TRANSCRIPT =
  "Add a retry helper to the fetch wrapper, then run the full test suite.";

const DOC_LINES = [
  "# Standup",
  "",
  "- Ship the hotkey fix after the tests pass.",
  "- Move the retro to Thursday.",
  "",
];

export function LandDemo() {
  return (
    <DemoWindow
      title="notes.md"
      right={<span className="hidden sm:inline">⌘⇧ Space</span>}
    >
      <div className="px-0 py-3 text-xs leading-6 sm:text-[13px]">
        {DOC_LINES.map((line, index) => (
          <div key={index} className="flex">
            <LineNumber>{index + 1}</LineNumber>
            <span
              className={
                line.startsWith("#")
                  ? "min-h-6 py-0 pl-4 pr-4 text-code-key"
                  : "min-h-6 py-0 pl-4 pr-4 text-code-muted"
              }
            >
              {line || "\u00a0"}
            </span>
          </div>
        ))}

        <div className="flex">
          <LineNumber>6</LineNumber>
          <span className="min-h-[3rem] py-0 pl-4 pr-4 text-code-text">
            {TRANSCRIPT}
            <span
              aria-hidden="true"
              className="vox-caret ml-0.5 inline-block h-4 w-2 translate-y-[3px] bg-code-text align-middle"
            />
          </span>
        </div>

        <div className="flex">
          <LineNumber>7</LineNumber>
          <span className="py-0 pl-4 pr-4 text-code-muted/70">
            Long passages can paste instead, then the clipboard is restored.
          </span>
        </div>

        <div className="flex h-9 items-center justify-end px-3 sm:px-4">
          <p className="flex items-center gap-2 rounded bg-mint/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-mint">
            <span aria-hidden="true" className="size-1 bg-mint" />
            Inserted at cursor · 0:04
          </p>
        </div>
      </div>
    </DemoWindow>
  );
}
