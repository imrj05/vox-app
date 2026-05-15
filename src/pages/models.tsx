import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CheckCircle2, Download, Mic, Square, Trash2, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  downloadWhisperModel,
  deleteWhisperModel,
  getNativeStatus,
  listWhisperModels,
  startRecording,
  stopRecording,
  transcribeRecording,
  type NativeStatus,
  type RecordingStatus,
  type TranscriptionResult,
  type WhisperModelInfo,
} from "@/lib/native";
import { useAppStore } from "@/store/app-store";

interface DownloadProgress {
  modelName: string;
  downloaded: number;
  total: number;
}

const MODEL_META: Record<string, { description: string; version: string }> = {
  "tiny.en":          { description: "Fastest, lowest quality. Good for quick tests and very constrained machines.", version: "v1.0" },
  "base.en":          { description: "Recommended default. Strong accuracy and real-time on Apple Silicon.", version: "v1.0" },
  "small.en":         { description: "Better accuracy, especially for non-English. ~2x slower than base.", version: "v1.0" },
  "medium.en":        { description: "Strong multilingual quality. ~4x slower than base; needs 8 GB+ RAM.", version: "v1.0" },
  "large-v3":         { description: "Best accuracy, all languages. ~8x slower than base; needs 16 GB+ RAM.", version: "v3.0" },
  "distil-large-v3":  { description: "Recommended English upgrade: ~2x faster than large-v3 with near-identical accuracy. English-focused.", version: "v3.0" },
  "large-v3-turbo":   { description: "Premium: near large-v3 accuracy at ~2x the speed. All languages. Needs 8 GB+ RAM.", version: "v3.0" },
};

function formatBytes(bytes: number) {
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `~${gb.toFixed(2).replace(/\.?0+$/, "")} GB`;
  return `~${Math.round(bytes / 1024 / 1024)} MB`;
}

export function ModelsPage() {
  const { selectedModel, setSelectedModel, dictionary } = useAppStore();
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nativeStatus, setNativeStatus] = useState<NativeStatus | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus | null>(null);
  const [transcriptionResult, setTranscriptionResult] = useState<TranscriptionResult | null>(null);
  const [checkingEngine, setCheckingEngine] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  useEffect(() => {
    let active = true;
    void listWhisperModels()
      .then((m) => { if (active) setModels(m); })
      .catch(() => {
        if (active) {
          setModels([]);
          setError("Model management is only available in the Tauri desktop app.");
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<DownloadProgress>("vox-download-progress", (event) => {
      setProgress(event.payload);
    }).then((cleanup) => { unlisten = cleanup; });
    return () => { unlisten?.(); };
  }, []);

  const handleDownload = async (modelName: string) => {
    setDownloading(modelName);
    setProgress(null);
    setError(null);
    try {
      await downloadWhisperModel(modelName);
      const updated = await listWhisperModels();
      setModels(updated);
      // Auto-set as active if nothing else is set
      if (!selectedModel || selectedModel === "base.en") {
        await setSelectedModel(modelName);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(null);
      setProgress(null);
    }
  };

  const handleSetActive = async (modelName: string) => {
    await setSelectedModel(modelName);
  };

  const handleDelete = async (modelName: string) => {
    setDeleting(modelName);
    setError(null);
    try {
      await deleteWhisperModel(modelName);
      const updated = await listWhisperModels();
      setModels(updated);
      // If the deleted model was active, fall back to base.en
      if (selectedModel === modelName) {
        await setSelectedModel("base.en");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(null);
    }
  };

  const checkEngine = async () => {
    setCheckingEngine(true);
    setError(null);
    try {
      setNativeStatus(await getNativeStatus());
    } catch {
      setNativeStatus(null);
      setError("Run the desktop app with `pnpm desktop:dev` to use quick dictation.");
    } finally {
      setCheckingEngine(false);
    }
  };

  const toggleQuickDictation = async () => {
    setRecordingBusy(true);
    setError(null);
    try {
      if (!nativeStatus) {
        setNativeStatus(await getNativeStatus());
      }

      if (recordingStatus?.isRecording) {
        const status = await stopRecording();
        setRecordingStatus(status);
        if (status.path) {
          setTranscribing(true);
          const result = await transcribeRecording(
            status.path,
            selectedModel,
            dictionary,
            status.appName,
            status.windowTitle
          );
          result.appName = status.appName;
          setTranscriptionResult(result);
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

  const activeModel = models.find((model) => model.name === selectedModel);
  const quickStatus = recordingStatus?.isRecording
    ? "Listening now"
    : transcribing
      ? "Transcribing audio"
      : nativeStatus
        ? "Engine ready"
        : "Check engine to start";

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6 max-w-3xl">
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-1">
            Local Whisper Models
          </h2>
          <p className="text-xs text-muted-foreground">
            Models are downloaded from HuggingFace and cached locally. Only the active model is used for transcription.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-border bg-card p-3 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
                <Wand2 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    Quick dictation
                  </h3>
                  <Badge variant="secondary" className="h-5">
                    {activeModel?.displayName ?? selectedModel}
                  </Badge>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Test the active model instantly before changing downloads or defaults.
                </p>
                <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {quickStatus}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void checkEngine()}
                disabled={checkingEngine || recordingBusy || transcribing}
              >
                {checkingEngine ? "Checking…" : nativeStatus ? "Ready" : "Check"}
              </Button>
              <Button
                size="sm"
                onClick={() => void toggleQuickDictation()}
                disabled={recordingBusy || transcribing}
              >
                {recordingStatus?.isRecording ? (
                  <>
                    <Square className="h-3.5 w-3.5" />
                    Stop
                  </>
                ) : transcribing ? (
                  "Transcribing…"
                ) : (
                  <>
                    <Mic className="h-3.5 w-3.5" />
                    Record
                  </>
                )}
              </Button>
            </div>
          </div>
          {transcriptionResult && (
            <div className="border-t border-border bg-muted/35 px-5 py-4">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Latest transcript
              </p>
              <p className="line-clamp-3 text-sm leading-6 text-foreground">
                {transcriptionResult.text}
              </p>
            </div>
          )}
        </div>

        <div className="grid gap-3">
          {loading && (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <Spinner className="size-4" />
              <div>
                <p className="text-sm font-medium text-foreground">Loading models</p>
                <p className="text-xs text-muted-foreground">Checking local Whisper status and downloads.</p>
              </div>
            </div>
          )}

          {models.map((model) => {
            const isDownloading = downloading === model.name;
            const isDeleting = deleting === model.name;
            const isActive = selectedModel === model.name;
            const meta = MODEL_META[model.name];
            const pct =
              isDownloading && progress && progress.total > 0
                ? Math.round((progress.downloaded / progress.total) * 100)
                : null;
            const downloadedMB = progress ? Math.round(progress.downloaded / 1024 / 1024) : 0;
            const totalMB = progress ? Math.round(progress.total / 1024 / 1024) : 0;

            return (
              <div
                key={model.name}
                className={`flex items-start gap-4 p-4 rounded-xl border transition-colors ${
                  isActive
                    ? "border-primary bg-sidebar-accent"
                    : "border-border bg-card hover:border-ring"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-foreground">
                      {model.displayName}
                    </h3>
                    {meta?.version && (
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {meta.version}
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground font-mono">STT</span>
                    {model.recommended && (
                      <Badge variant="secondary" className="text-[10px]">default</Badge>
                    )}
                    {isActive && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                        active
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {formatBytes(model.size)}
                  </p>

                  {meta?.description && (
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {meta.description}
                    </p>
                  )}

                  {/* Download progress */}
                  {isDownloading && (
                    <div className="mt-3 space-y-1.5">
                      <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
                        {pct !== null ? (
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-150"
                            style={{ width: `${pct}%` }}
                          />
                        ) : (
                          <div className="h-full w-1/3 rounded-full bg-primary animate-pulse" />
                        )}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>
                          {pct !== null
                            ? `${downloadedMB} MB / ${totalMB} MB`
                            : "Connecting…"}
                        </span>
                        {pct !== null && <span>{pct}%</span>}
                      </div>
                    </div>
                  )}
                </div>

                <div className="shrink-0 flex flex-col items-end gap-2 pt-0.5">
                  {model.downloaded ? (
                    <>
                      <div className="flex items-center gap-1.5 text-primary">
                        <CheckCircle2 className="h-4 w-4" />
                        <span className="text-xs font-medium">Downloaded</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {!isActive && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleSetActive(model.name)}
                            disabled={isDeleting}
                          >
                            Set active
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleDelete(model.name)}
                          disabled={isDeleting || downloading !== null}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          {isDeleting ? (
                            <span className="text-xs">Removing…</span>
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleDownload(model.name)}
                      disabled={downloading !== null}
                    >
                      {isDownloading ? (
                        <>
                          <Spinner className="size-3.5" />
                          {pct !== null ? `${pct}%` : "Starting…"}
                        </>
                      ) : (
                        <>
                          <Download className="h-3.5 w-3.5" />
                          Download
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
}
