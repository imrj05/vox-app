import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { Sparkles, Check, LoaderCircle, X } from "@/components/icons";
import { enhanceFocusedInput } from "@/lib/native";
import "./enhance.css";

type EnhanceMode = "idle" | "enhancing" | "success" | "error";

interface EnhanceOverlayEvent {
  visible: boolean;
  snapshotId: string | null;
  x: number;
  y: number;
}

interface EnhanceStateEvent {
  mode: EnhanceMode;
  message: string;
}

export function EnhanceOverlay() {
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [mode, setMode] = useState<EnhanceMode>("idle");
  const [message, setMessage] = useState("Enhance text");
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    let unlistenOverlay: (() => void) | undefined;
    let unlistenState: (() => void) | undefined;

    void listen<EnhanceOverlayEvent>("vox-enhance-overlay", (event) => {
      setSnapshotId(event.payload.visible ? event.payload.snapshotId : null);
      if (event.payload.visible) {
        setMode("idle");
        setMessage("Enhance text");
      }
    }).then((cleanup) => {
      unlistenOverlay = cleanup;
    });

    void listen<EnhanceStateEvent>("vox-enhance-state", (event) => {
      setMode(event.payload.mode);
      setMessage(event.payload.message);
      if (resetTimer.current !== null) {
        window.clearTimeout(resetTimer.current);
      }
      if (event.payload.mode === "success" || event.payload.mode === "error") {
        resetTimer.current = window.setTimeout(() => setMode("idle"), 1200);
      }
    }).then((cleanup) => {
      unlistenState = cleanup;
    });

    return () => {
      unlistenOverlay?.();
      unlistenState?.();
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    };
  }, []);

  const enhance = async () => {
    if (!snapshotId || mode === "enhancing") return;
    setMode("enhancing");
    setMessage("Enhancing...");
    try {
      await enhanceFocusedInput(snapshotId);
      setMode("success");
      setMessage("Enhanced");
    } catch {
      setMode("error");
      setMessage((current) => current === "Enhancing..." ? "Could not enhance text" : current);
    }
  };

  const Icon = mode === "enhancing"
    ? LoaderCircle
    : mode === "success"
      ? Check
      : mode === "error"
        ? X
        : Sparkles;

  return (
    <div className="enhance-root">
      <button
        className="enhance-button"
        data-mode={mode}
        type="button"
        aria-label={message}
        aria-busy={mode === "enhancing"}
        title={message}
        disabled={!snapshotId || mode === "enhancing"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void enhance()}
      >
        <Icon aria-hidden="true" />
        <span className="enhance-status" aria-live="polite">
          {mode === "idle" ? "" : message}
        </span>
      </button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EnhanceOverlay />
  </StrictMode>
);
