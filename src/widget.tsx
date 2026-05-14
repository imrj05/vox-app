import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import "./widget.css";

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const BAR_COUNT = 7;
const BAR_MIN_HEIGHT = 8;
const BAR_HEIGHT_RANGE = 34;

type WidgetMode = "idle" | "recording" | "transcribing" | "done" | "error";

interface WidgetState {
  mode: WidgetMode;
  message: string;
  elapsedSeconds?: number;
}

interface AudioLevelPayload {
  level: number;
}

interface AudioBarsPayload {
  bars: number[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatElapsed(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0
    ? `${m}:${String(sec).padStart(2, "0")}`
    : `${sec}s`;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function shapeVoiceLevel(value: number): number {
  return Math.pow(clamp01(value), 0.55);
}

function mapAudioBarsToMeter(bars: number[]): number[] {
  const levels = Array.from({ length: BAR_COUNT }, (_, index) => clamp01(bars[index] ?? 0));
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  const spread = max - min;

  if (max < 0.03 || spread < 0.01) {
    return levels;
  }

  // The raw buckets are often all high at once. Normalize each frame so the
  // widget reads as a visible waveform instead of a flat wall of tall bars.
  const volumeFloor = clamp01(max * 0.18);
  return levels.map((level) => {
    const relative = (level - min) / spread;
    return clamp01(volumeFloor + relative * (1 - volumeFloor));
  });
}

/* ------------------------------------------------------------------ */
/*  WaveformBars                                                      */
/* ------------------------------------------------------------------ */

function VoiceDots({
  mode,
  meterLevels,
  audioLevel,
  elapsed,
}: {
  mode: WidgetMode;
  meterLevels: number[];
  audioLevel: number;
  elapsed: number | undefined;
}) {
  // Glow intensity scales with audio level during recording
  const glowAlpha =
    mode === "recording"
      ? Math.min(0.5, Math.max(0, audioLevel - 0.002) * 0.9 + 0.03)
      : mode === "transcribing"
        ? 0.1
        : 0;

  return (
    <div className="widget-voice-container">
      <div
        className="widget-glow"
        style={{ opacity: glowAlpha }}
      />

      {mode === "transcribing" ? (
        <div className="widget-transcribing-wrap">
          <span
            className="widget-shimmer-text"
            data-text="Transcribing"
          >
            Transcribing
          </span>
        </div>
      ) : (
        <div className="widget-bars">
          {Array.from({ length: BAR_COUNT }).map((_, i) => {
            const level = mode === "recording" ? shapeVoiceLevel(meterLevels[i] ?? 0) : 0;
            const style = {
              height: `${(BAR_MIN_HEIGHT + level * BAR_HEIGHT_RANGE).toFixed(1)}px`,
              opacity: mode === "recording" ? 0.46 + level * 0.54 : 0.72,
            };

            return (
              <div
                key={i}
                className="widget-bar"
                style={style}
              />
            );
          })}
        </div>
      )}

      {/* Timer (recording only) */}
      {mode === "recording" && elapsed !== undefined && elapsed > 0 && (
        <span className="widget-timer">
          {formatElapsed(elapsed)}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Widget root                                                       */
/* ------------------------------------------------------------------ */

export function Widget() {
  const [state, setState] = useState<WidgetState>({
    mode: "idle",
    message: "",
  });
  const [audioLevel, setAudioLevel] = useState(0);
  const [meterLevels, setMeterLevels] = useState<number[]>(Array(BAR_COUNT).fill(0));

  // Listen for widget state events
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<WidgetState>("vox-widget-state", (event) => {
      setState(event.payload);
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<AudioBarsPayload>("vox-audio-bars", (event) => {
      setMeterLevels(mapAudioBarsToMeter(event.payload.bars));
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // Listen for audio level events
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<AudioLevelPayload>("vox-audio-level", (event) => {
      const level = clamp01(event.payload.level);
      setAudioLevel(level);
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const isActive =
    state.mode === "recording" ||
    state.mode === "transcribing";

  const isVisible =
    state.mode === "recording" ||
    state.mode === "transcribing" ||
    state.mode === "done" ||
    state.mode === "error";

  return (
    <div className="widget-root">
      <div className={`widget-capsule ${isActive ? "widget-active" : ""} ${isVisible ? "widget-visible" : "widget-hidden"}`}>
        <VoiceDots
          mode={state.mode}
          meterLevels={meterLevels}
          audioLevel={audioLevel}
          elapsed={state.elapsedSeconds}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Widget />
  </StrictMode>,
);
