import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import "./widget.css";

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const BAR_COUNT = 7;
const THEME_KEY = "theme";

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
  return m > 0 ? `${m}:${String(sec).padStart(2, "0")}` : `${sec}s`;
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
/*  Icons                                                             */
/* ------------------------------------------------------------------ */

function CheckIcon() {
  return (
    <svg className="widget-status-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.2 8.4 6.6 11.8 12.8 4.6"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg className="widget-status-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 5.2v3.6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="8" cy="11.6" r="1" fill="currentColor" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  VoiceDots                                                         */
/* ------------------------------------------------------------------ */

function VoiceDots({
  mode,
  meterLevels,
  audioLevel,
  elapsed,
  message,
}: {
  mode: WidgetMode;
  meterLevels: number[];
  audioLevel: number;
  elapsed: number | undefined;
  message: string;
}) {
  const isRecording = mode === "recording";

  // Glow intensity scales with audio level during recording
  const glowAlpha = isRecording
    ? Math.min(0.35, Math.max(0, audioLevel - 0.002) * 0.6 + 0.02)
    : mode === "transcribing"
      ? 0.08
      : 0;

  return (
    <div className="widget-voice-container">
      {/* Theme-aware Vox logo (light mark on light, dark mark on dark) */}
      <div className="widget-logo-wrap">
        <img src="/logo-dark.png" alt="" className="widget-logo widget-logo-dark" />
        <img src="/logo-light.png" alt="" className="widget-logo widget-logo-light" />
      </div>

      <div className="widget-glow" style={{ opacity: glowAlpha }} />

      {mode === "transcribing" && (
        <div className="widget-transcribing-wrap">
          <span className="widget-shimmer-text" data-text="Transcribing…">
            Transcribing…
          </span>
        </div>
      )}

      {mode === "done" && (
        <div className="widget-status widget-status-done">
          <CheckIcon />
          <span className="widget-status-text">{message || "Done"}</span>
        </div>
      )}

      {mode === "error" && (
        <div className="widget-status widget-status-error">
          <AlertIcon />
          <span className="widget-status-text">{message || "Something went wrong"}</span>
        </div>
      )}

      {isRecording && (
        <>
          <div className="widget-bars">
            {Array.from({ length: BAR_COUNT }).map((_, i) => {
              const level = shapeVoiceLevel(meterLevels[i] ?? 0);
              return (
                <div
                  key={i}
                  className="widget-bar"
                  style={{
                    height: `${(6 + level * 26).toFixed(1)}px`,
                    opacity: 0.5 + level * 0.5,
                  }}
                />
              );
            })}
          </div>

          {elapsed !== undefined && elapsed > 0 && (
            <span className="widget-timer">{formatElapsed(elapsed)}</span>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Audio cues                                                        */
/* ------------------------------------------------------------------ */

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    sharedAudioCtx = new AudioContext();
  }
  return sharedAudioCtx;
}

/** Soft high click — signals recording has started. */
function playStartTone() {
  try {
    const ctx = getAudioContext();
    const play = () => {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(1050, t);
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      osc.start(t);
      osc.stop(t + 0.09);
    };
    if (ctx.state === "suspended") {
      void ctx.resume().then(play);
    } else {
      play();
    }
  } catch {
    // AudioContext unavailable — ignore
  }
}

/** Soft low click — signals recording has stopped. */
function playStopTone() {
  try {
    const ctx = getAudioContext();
    const play = () => {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(700, t);
      gain.gain.setValueAtTime(0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      osc.start(t);
      osc.stop(t + 0.1);
    };
    if (ctx.state === "suspended") {
      void ctx.resume().then(play);
    } else {
      play();
    }
  } catch {
    // AudioContext unavailable — ignore
  }
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
  const prevMode = useRef<WidgetMode>("idle");

  useEffect(() => {
    const applyTheme = () => {
      const storedTheme = localStorage.getItem(THEME_KEY);
      const theme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : "system";
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.dataset.theme =
        theme === "dark" || (theme === "system" && prefersDark) ? "dark" : "light";
    };
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    applyTheme();
    media.addEventListener("change", applyTheme);
    window.addEventListener("storage", applyTheme);
    const interval = window.setInterval(applyTheme, 1000);
    return () => {
      media.removeEventListener("change", applyTheme);
      window.removeEventListener("storage", applyTheme);
      window.clearInterval(interval);
    };
  }, []);

  // Listen for widget state events
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<WidgetState>("vox-widget-state", (event) => {
      const next = event.payload.mode;
      const prev = prevMode.current;
      const soundOn = localStorage.getItem("sound_enabled") !== "false";
      if (soundOn && next === "recording" && prev !== "recording") playStartTone();
      if (soundOn && prev === "recording" && next !== "recording") playStopTone();
      prevMode.current = next;
      setState(event.payload);
    }).then((cleanup) => {
      unlisten = cleanup;
    }).catch((err) => console.error("[vox-widget] failed to listen vox-widget-state:", err));
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
    }).catch((err) => console.error("[vox-widget] failed to listen vox-audio-bars:", err));
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
    }).catch((err) => console.error("[vox-widget] failed to listen vox-audio-level:", err));
    return () => {
      unlisten?.();
    };
  }, []);

  const isActive = state.mode === "recording" || state.mode === "transcribing";

  const isVisible =
    state.mode === "recording" ||
    state.mode === "transcribing" ||
    state.mode === "done" ||
    state.mode === "error";

  return (
    <div className="widget-root">
      <div
        className={`widget-capsule ${isActive ? "widget-active" : ""} ${isVisible ? "widget-visible" : "widget-hidden"}`}
      >
        <VoiceDots
          mode={state.mode}
          meterLevels={meterLevels}
          audioLevel={audioLevel}
          elapsed={state.elapsedSeconds}
          message={state.message}
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
