import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Download, Mic, Square, Trash2, Wand2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { saveTranscript } from "@/lib/db";
import {
  deleteRecordingFile,
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

const MODEL_META: Record<string, { description: string; version: string; badges: string[] }> = {
  "tiny.en":          { description: "Fastest, lowest quality. Good for quick tests and very constrained machines.", version: "v1.0", badges: ["fastest", "english", "low memory"] },
  "base.en":          { description: "Recommended default. Strong accuracy and real-time on Apple Silicon.", version: "v1.0", badges: ["recommended", "balanced", "english"] },
  "small.en":         { description: "Better English accuracy with a moderate speed tradeoff. ~2x slower than base.", version: "v1.0", badges: ["accurate", "english", "medium"] },
  "medium.en":        { description: "Strong quality. ~4x slower than base; needs 8 GB+ RAM.", version: "v1.0", badges: ["high quality", "english", "8 GB+"] },
  "large-v3":         { description: "Best accuracy, all languages. ~8x slower than base; needs 16 GB+ RAM.", version: "v3.0", badges: ["best accuracy", "multilingual", "16 GB+"] },
  "distil-large-v3":  { description: "Recommended English upgrade: ~2x faster than large-v3 with near-identical accuracy. English-focused.", version: "v3.0", badges: ["premium", "fast large", "english"] },
  "large-v3-turbo":   { description: "Premium: near large-v3 accuracy at ~2x the speed. All languages. Needs 8 GB+ RAM.", version: "v3.0", badges: ["premium", "turbo", "multilingual"] },
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
    let cleanupPath: string | null = null;
    try {
      if (!nativeStatus) {
        setNativeStatus(await getNativeStatus());
      }

      if (recordingStatus?.isRecording) {
        const status = await stopRecording();
        setRecordingStatus(status);
        cleanupPath = status.path;
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
          result.durationSeconds = status.durationSeconds;
          setTranscriptionResult(result);
          await saveTranscript(result.text, undefined, result.appName, result.durationSeconds);
          await deleteRecordingFile(result.audioPath).catch(() => {});
        }
        return;
      }

      const status = await startRecording();
      setRecordingStatus(status);
      if (status.isRecording) {
        setTranscriptionResult(null);
      }
    } catch (err) {
      if (cleanupPath) {
        await deleteRecordingFile(cleanupPath).catch(() => {});
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTranscribing(false);
      setRecordingBusy(false);
    }
  };

  const activeModel = models.find((model) => model.name === selectedModel);
  const downloadedModels = models.filter((model) => model.downloaded);
  const totalDownloadedSize = downloadedModels.reduce((sum, model) => sum + model.size, 0);
  const quickStatus = recordingStatus?.isRecording
    ? "Listening now"
    : transcribing
      ? "Transcribing audio"
      : nativeStatus
        ? "Engine ready"
        : "Check engine to start";

  return (
    <div className="h-full overflow-hidden bg-background">
      <ScrollArea className="h-full">
        <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-5 p-6 lg:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-foreground">Local Whisper models</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Download, compare, and manage the local models used for dictation.
              </p>
            </div>
            <div className="flex justify-start lg:justify-end">
              <span className="rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground">
                {nativeStatus ? "Engine ready" : "Engine not checked"}
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <LibraryStat label="Downloaded" value={downloadedModels.length.toLocaleString()} />
            <LibraryStat label="Stored" value={formatBytes(totalDownloadedSize)} />
            <LibraryStat label="Active" value={activeModel?.displayName ?? selectedModel} />
          </div>

          {error && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-4 text-sm text-destructive">
              {error}
            </div>
          )}

          <article className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-sidebar-accent text-primary">
                    <Wand2 className="h-4 w-4" />
                  </span>
                  <p className="text-sm font-medium text-foreground">Quick dictation</p>
                  <Badge variant="secondary" className="h-5">
                    {activeModel?.displayName ?? selectedModel}
                  </Badge>
                </div>
                <p className="text-sm leading-6 text-foreground/90">
                  Test the active model instantly before changing downloads or defaults.
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded-full border border-border bg-background px-2.5 py-1 font-mono">
                    {quickStatus}
                  </span>
                  <span className="rounded-full border border-border bg-background px-2.5 py-1 font-mono">
                    {selectedModel}
                  </span>
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
              <div className="mt-3 rounded-xl border border-border bg-background px-4 py-3">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Latest transcript
                </p>
                <p className="line-clamp-4 text-sm leading-6 text-foreground/90">
                  {transcriptionResult.text}
                </p>
              </div>
            )}
          </article>

          {loading ? (
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading Whisper models
            </div>
          ) : models.length > 0 ? (
            <div className="grid gap-3">
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
                  <article key={model.name} className="rounded-2xl border border-border bg-card p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-foreground">{model.displayName}</p>
                          {meta?.version && (
                            <span className="text-[11px] font-mono text-muted-foreground">{meta.version}</span>
                          )}
                          <span className="text-[11px] font-mono text-muted-foreground">STT</span>
                          {model.recommended && (
                            <Badge variant="secondary" className="text-[10px] uppercase tracking-[0.08em]">
                              recommended
                            </Badge>
                          )}
                          {isActive && (
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-primary">
                              active
                            </span>
                          )}
                        </div>

                        {meta?.description && (
                          <p className="text-sm leading-6 text-foreground/90">{meta.description}</p>
                        )}

                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                          <span className="rounded-full border border-border bg-background px-2.5 py-1 font-mono">
                            {formatBytes(model.size)}
                          </span>
                          <span className="rounded-full border border-border bg-background px-2.5 py-1 font-mono">
                            {isActive ? "Active" : model.downloaded ? "Downloaded" : "Not downloaded"}
                          </span>
                          {meta?.badges?.map((badge) => (
                            <span
                              key={badge}
                              className="rounded-full border border-border bg-background px-2.5 py-1 font-medium uppercase tracking-[0.08em]"
                            >
                              {badge}
                            </span>
                          ))}
                        </div>

                        {isDownloading && (
                          <div className="mt-3 space-y-1.5">
                            <div className="h-1.5 overflow-hidden rounded-full bg-border">
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
                                {pct !== null ? `${downloadedMB} MB / ${totalMB} MB` : "Connecting…"}
                              </span>
                              {pct !== null && <span>{pct}%</span>}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex shrink-0 gap-2">
                        {model.downloaded ? (
                          <>
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
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  disabled={isDeleting || downloading !== null}
                                >
                                  {isDeleting ? (
                                    "Removing…"
                                  ) : (
                                    <>
                                      <Trash2 className="h-4 w-4" />
                                      Delete
                                    </>
                                  )}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete model?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Remove <span className="font-medium text-foreground">{model.displayName}</span> from this device.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>

                                <div className="space-y-3 text-sm text-muted-foreground">
                                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                                    <div className="flex items-center justify-between gap-3">
                                      <span>Model</span>
                                      <span className="font-medium text-foreground">{model.displayName}</span>
                                    </div>
                                    <div className="mt-2 flex items-center justify-between gap-3">
                                      <span>Size</span>
                                      <span className="font-mono text-foreground">{formatBytes(model.size)}</span>
                                    </div>
                                    <div className="mt-2 flex items-center justify-between gap-3">
                                      <span>Status</span>
                                      <span className="font-medium text-foreground">
                                        {isActive ? "Active model" : "Downloaded model"}
                                      </span>
                                    </div>
                                  </div>

                                  <p>
                                    This deletes the local model file from your device, not just the entry in Vox.
                                  </p>

                                  {isActive && (
                                    <p>
                                      Vox will switch back to <span className="font-medium text-foreground">base.en</span> after deletion.
                                    </p>
                                  )}
                                </div>

                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    variant="destructive"
                                    onClick={() => {
                                      void handleDelete(model.name);
                                    }}
                                  >
                                    Delete model
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
                        ) : (
                          <Button
                            variant="default"
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
                                <Download className="h-4 w-4" />
                                Download
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center">
              <p className="text-sm font-medium text-foreground">No models available</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Open the desktop app to load local Whisper model availability.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function LibraryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold text-primary">{value}</p>
    </div>
  );
}
