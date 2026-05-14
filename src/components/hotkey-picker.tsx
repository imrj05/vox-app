import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatShortcut, isEventTapOnlyShortcut } from "@/lib/native";

interface HotkeyPickerProps {
  open: boolean;
  currentShortcut: string;
  onSave: (shortcut: string) => void;
  onCancel: () => void;
}

// Keys that are pure modifiers in standard combos — we wait for a real key
// alongside them. Exception: AltLeft, AltRight, Globe/Fn are ALSO valid
// standalone trigger keys via CGEventTap, so they are handled separately.
const STANDARD_MODIFIERS = new Set([
  "Meta",
  "Control",
  "Shift",
  "OS",
  "Super",
]);

// Keys that can act as a standalone trigger (no other key required).
// These are only reachable via CGEventTap, not the OS hotkey API.
const STANDALONE_TRIGGER_KEYS = new Set([
  "AltLeft",
  "AltRight",
  "Globe",
  "Fn",
]);

/** Human-readable label for a standalone trigger key */
function standaloneLabel(code: string): string {
  switch (code) {
    case "AltLeft":
      return "⌥ Left Option";
    case "AltRight":
      return "⌥ Right Option";
    case "Globe":
    case "Fn":
      return "🌐 Globe / Fn";
    default:
      return code;
  }
}

/** Keys that are risky to bind without a modifier */
function riskyWarning(shortcut: string): string | null {
  const parts = shortcut.split("+");
  const hasModifier = parts.some((p) =>
    ["Meta", "Ctrl", "Control", "Alt", "AltLeft", "AltRight", "Shift"].includes(p)
  );
  if (hasModifier) return null;
  const key = parts[parts.length - 1];
  if (/^Key[A-Z]$/.test(key) || /^Digit\d$/.test(key)) {
    return "Binding a plain letter or digit will intercept that key everywhere. Consider adding a modifier (⌘ ⌃ ⌥ ⇧).";
  }
  return null;
}

// Quick-pick presets for the special keys the browser can't capture
const SPECIAL_PRESETS = [
  { label: "⌥L  Left Option", value: "AltLeft" },
  { label: "⌥R  Right Option", value: "AltRight" },
  { label: "🌐  Globe / Fn", value: "Globe" },
] as const;

interface ContentProps {
  currentShortcut: string;
  onSave: (shortcut: string) => void;
  onCancel: () => void;
}

function HotkeyPickerContent({
  currentShortcut,
  onSave,
  onCancel,
}: ContentProps) {
  const [captured, setCaptured] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTimeout(() => captureRef.current?.focus(), 50);
  }, []);

  const commit = (shortcut: string) => {
    setCaptured(shortcut);
    setWarning(riskyWarning(shortcut));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Bare Escape = cancel
    if (
      e.key === "Escape" &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey
    ) {
      onCancel();
      return;
    }

    // Detect standalone Option keys by code before treating Alt as a modifier.
    // AltLeft / AltRight pressed alone (no other non-modifier key) → standalone trigger.
    if ((e.code === "AltLeft" || e.code === "AltRight") && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      commit(e.code); // "AltLeft" or "AltRight" as a bare trigger
      return;
    }

    // Globe / Fn key — browser reports it as e.key === "Fn" or e.code === "Fn"
    if (e.key === "Fn" || e.code === "Fn" || e.key === "Globe") {
      commit("Globe");
      return;
    }

    // Standard modifier-only press — wait for a real key
    if (STANDARD_MODIFIERS.has(e.key)) return;

    // Build the shortcut string
    const parts: string[] = [];
    if (e.metaKey) parts.push("Meta");
    if (e.ctrlKey) parts.push("Ctrl");
    // Distinguish left vs right Option when used as a modifier in a combo
    if (e.altKey) {
      parts.push(e.code === "AltRight" ? "AltRight" : "AltLeft");
    }
    if (e.shiftKey) parts.push("Shift");
    parts.push(e.code);
    commit(parts.join("+"));
  };

  // Label shown in the capture area
  const capturedLabel = captured
    ? STANDALONE_TRIGGER_KEYS.has(captured)
      ? standaloneLabel(captured)
      : formatShortcut(captured)
    : null;
  const selectedShortcut = captured ?? currentShortcut;

  return (
    <>
      {/* Keyboard capture area */}
      <div
        ref={captureRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="flex h-16 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-border bg-background text-center transition-colors focus:border-primary focus:outline-none"
      >
        {capturedLabel ? (
          <span className="font-mono text-xl font-semibold tracking-widest text-foreground">
            {capturedLabel}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">
            Press any key or combo…
          </span>
        )}
      </div>

      {/* Quick-pick for special keys the browser may not surface */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground">
          Special keys (browser may not capture these — click to select):
        </p>
        <div className="flex flex-wrap gap-2">
          {SPECIAL_PRESETS.map((preset) => (
            <button
              key={preset.value}
              onClick={() => commit(preset.value)}
              className={[
                "rounded-md border px-2.5 py-1 text-xs font-mono transition-colors",
                captured === preset.value
                  ? "border-primary bg-accent text-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground",
              ].join(" ")}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {warning && (
        <p className="text-xs text-destructive">{warning}</p>
      )}

      <p className="text-[11px] text-muted-foreground">
        Current:{" "}
        <span className="font-mono font-semibold">
          {STANDALONE_TRIGGER_KEYS.has(currentShortcut)
            ? standaloneLabel(currentShortcut)
            : formatShortcut(currentShortcut)}
        </span>
      </p>

      {isEventTapOnlyShortcut(selectedShortcut) && (
        <p className="text-xs text-destructive">
          This binding uses CGEventTap instead of the macOS hotkey API. Accessibility permission must stay granted.
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!captured}
          onClick={() => {
            if (captured) onSave(captured);
          }}
        >
          Save
        </Button>
      </div>
    </>
  );
}

export function HotkeyPicker({
  open,
  currentShortcut,
  onSave,
  onCancel,
}: HotkeyPickerProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogTitle className="text-base font-semibold text-foreground">
          Set global hotkey
        </DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">
          Press a key combo, or click a special key below. Left/Right Option and
          Globe can be used as standalone triggers via CGEventTap.
        </DialogDescription>
        <HotkeyPickerContent
          key={String(open)}
          currentShortcut={currentShortcut}
          onSave={onSave}
          onCancel={onCancel}
        />
      </DialogContent>
    </Dialog>
  );
}
