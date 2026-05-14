import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CheckCircle2, Mic, Pencil, Trash2, Wand2 } from "lucide-react";
import {
  getNativeStatus,
  startRecording,
  stopRecording,
  transcribeRecording,
  setGlobalShortcut,
  formatShortcut,
  isEventTapOnlyShortcut,
  type NativeStatus,
  type RecordingStatus,
  type TranscriptionResult,
} from "@/lib/native";
import { AppToast } from "@/components/app-toast";
import {
  saveTranscript,
  getTranscripts,
  deleteTranscript,
  type TranscriptRow,
} from "@/lib/db";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GlowRecordButton } from "@/components/glow-record-button";
import { HotkeyPicker } from "@/components/hotkey-picker";
import { useAppStore } from "@/store/app-store";

export function HomePage() {
  const { hotkey, setHotkey, selectedModel } = useAppStore();
  const [nativeStatus, setNativeStatus] = useState<NativeStatus | null>(null);
  const [recordingStatus, setRecordingStatus] =
    useState<RecordingStatus | null>(null);
  const [transcriptionResult, setTranscriptionResult] =
    useState<TranscriptionResult | null>(null);
  const [history, setHistory] = useState<TranscriptRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [hotkeyPickerOpen, setHotkeyPickerOpen] = useState(false);
  const [toast, setToast] = useState<{
    title: string;
    detail?: string;
    tone?: "success" | "warning";
  } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const saveHotkey = async (shortcut: string) => {
    await setGlobalShortcut(shortcut);
    await setHotkey(shortcut);
  };

  const widgetMode = recordingStatus?.isRecording
    ? "recording"
    : transcribing
      ? "transcribing"
      : null;

  const applyTranscriptionResult = async (result: TranscriptionResult) => {
    setTranscriptionResult(result);
    await saveTranscript(result.text, result.audioPath);
    setHistory(await getTranscripts());
  };

  // Load transcript history on mount
  useEffect(() => {
    void getTranscripts().then(setHistory).catch(() => {});
  }, []);

  // Listen for hotkey-triggered transcriptions (from Rust background flow)
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<TranscriptionResult>("vox-transcription-complete", async (event) => {
      const result = event.payload;
      setTranscribing(false);
      setRecordingBusy(false);
      setRecordingStatus({
        isRecording: false,
        path: result.audioPath,
        durationSeconds: null,
      });
      try {
        await applyTranscriptionResult(result);
      } catch {
        // DB errors are non-fatal
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const checkEngine = async () => {
    setChecking(true);
    setError(null);

    try {
      setNativeStatus(await getNativeStatus());
    } catch {
      setNativeStatus(null);
      setError("Run the desktop app with `pnpm desktop:dev` to use recording.");
    } finally {
      setChecking(false);
    }
  };

  const toggleRecording = async () => {
    setRecordingBusy(true);
    setError(null);

    try {
      if (recordingStatus?.isRecording) {
        const status = await stopRecording();
        setRecordingStatus(status);

        if (status.path) {
          setTranscribing(true);
          const result = await transcribeRecording(status.path, selectedModel);
          await applyTranscriptionResult(result);
        }
        return;
      }

      const status = await startRecording();
      setRecordingStatus(status);

      if (status.isRecording) {
        setTranscriptionResult(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTranscribing(false);
      setRecordingBusy(false);
    }
  };

  const transcribe = async () => {
    if (!recordingStatus?.path) return;

    setTranscribing(true);
    setError(null);

    try {
      const result = await transcribeRecording(recordingStatus.path, selectedModel);
      await applyTranscriptionResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTranscribing(false);
    }
  };

  const handleSaveHotkey = async (shortcut: string) => {
    try {
      await saveHotkey(shortcut);
      setToast({
        title: `Hotkey updated to ${formatShortcut(shortcut)}`,
        detail: isEventTapOnlyShortcut(shortcut)
          ? "Handled via CGEventTap. Accessibility permission must remain granted."
          : "The new global shortcut is active now.",
        tone: isEventTapOnlyShortcut(shortcut) ? "warning" : "success",
      });
      setHotkeyPickerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setHotkeyPickerOpen(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteTranscript(id);
      setHistory((prev) => prev.filter((t) => t.id !== id));
    } catch {
      // non-fatal
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="relative mx-auto flex min-h-full max-w-3xl flex-col justify-center p-6 gap-6">
        {widgetMode && <DictationWidget mode={widgetMode} />}

        <section className="rounded-2xl border border-border bg-card p-6 shadow-2xl shadow-black/20">
          {/* Header */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Voice to text
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              Record audio. Get text.
            </h2>
            <p className="max-w-xl text-sm text-muted-foreground">
              A focused local dictation flow. Download a model, record your
              voice, then transcribe it on-device.
            </p>
          </div>

          {/* Glow button + hotkey badge */}
          <div className="mt-8 flex flex-col items-center gap-4">
            <GlowRecordButton
              isRecording={recordingStatus?.isRecording ?? false}
              disabled={!nativeStatus || recordingBusy}
              onClick={toggleRecording}
            />

            <p className="text-xs text-muted-foreground">
              {recordingStatus?.isRecording
                ? "Recording — press again or use the hotkey to stop"
                : recordingBusy
                  ? "Working…"
                  : "Press to record"}
            </p>

            {/* Hotkey badge */}
            <button
              onClick={() => setHotkeyPickerOpen(true)}
              className="group flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              <span className="font-mono font-semibold tracking-widest">
                {formatShortcut(hotkey)}
              </span>
              <Pencil className="h-3 w-3 opacity-50 transition-opacity group-hover:opacity-100" />
            </button>
          </div>

          {/* Secondary actions */}
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="secondary" onClick={checkEngine} disabled={checking}>
              <CheckCircle2 className="h-4 w-4" />
              {checking ? "Checking..." : "Check engine"}
            </Button>

            <Button
              variant="secondary"
              onClick={transcribe}
              disabled={
                !recordingStatus?.path ||
                recordingStatus.isRecording ||
                transcribing
              }
            >
              <Wand2 className="h-4 w-4" />
              {transcribing ? "Transcribing..." : "Transcribe"}
            </Button>
          </div>

          {/* Status panel */}
          <div className="mt-6 rounded-xl border border-border bg-background p-4">
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : nativeStatus ? (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Engine:{" "}
                  <span className="text-primary">ready</span>
                </p>
                {recordingStatus?.path && (
                  <p className="truncate">Recording: {recordingStatus.path}</p>
                )}
                {recordingStatus?.durationSeconds !== null &&
                  recordingStatus?.durationSeconds !== undefined && (
                    <p>Duration: {recordingStatus.durationSeconds}s</p>
                  )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Check the engine before recording.
              </p>
            )}
          </div>

          {/* Latest transcript */}
          {transcriptionResult && (
            <div className="mt-4 rounded-xl border border-border bg-background p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Latest transcript
              </p>
              <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                {transcriptionResult.text}
              </p>
            </div>
          )}
        </section>

        {/* Transcript history */}
        {history.length > 0 && (
          <section className="rounded-2xl border border-border bg-card p-6 shadow-xl shadow-black/10">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              History
            </p>
            <div className="grid gap-2">
              {history.map((t) => (
                <div
                  key={t.id}
                  className="group flex items-start gap-3 rounded-xl border border-border bg-background p-3 transition-colors hover:border-ring"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-5 text-foreground line-clamp-3">
                      {t.text}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {new Date(t.created_at).toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    aria-label="Delete transcript"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <HotkeyPicker
        open={hotkeyPickerOpen}
        currentShortcut={hotkey}
        onSave={handleSaveHotkey}
        onCancel={() => setHotkeyPickerOpen(false)}
      />
      {toast && (
        <AppToast title={toast.title} detail={toast.detail} tone={toast.tone} />
      )}
    </ScrollArea>
  );
}

function DictationWidget({ mode }: { mode: "recording" | "transcribing" }) {
  const isRecording = mode === "recording";

  return (
    <div className="fixed right-6 top-14 z-40 flex items-center gap-3 rounded-full border border-border bg-muted px-4 py-2 shadow-2xl shadow-black/40">
      <div
        className={[
          "flex h-8 w-8 items-center justify-center rounded-full",
          isRecording
            ? "bg-destructive/20 text-destructive"
            : "bg-accent text-accent-foreground",
        ].join(" ")}
      >
        {isRecording ? <Mic className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground">
          {isRecording ? "Recording" : "Transcribing"}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {isRecording ? "Listening locally" : "Converting voice to text"}
        </p>
      </div>
      <span
        className={[
          "h-2 w-2 rounded-full",
          isRecording
            ? "animate-pulse bg-destructive"
            : "animate-pulse bg-primary",
        ].join(" ")}
      />
    </div>
  );
}
