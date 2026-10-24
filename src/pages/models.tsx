import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Check, Download, Mic, Plus, Sparkles, Square, Trash2, Wand2 } from "@/components/icons";
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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { saveTranscript } from "@/lib/db";
import {
  addCustomModel,
  deleteCustomModel,
  deleteRecordingFile,
  deleteTextEnhancementModel,
  deleteWhisperModel,
  downloadTextEnhancementModel,
  getNativeStatus,
  listCustomModels,
  listTextEnhancementModels,
  listWhisperModels,
  startRecording,
  stopRecording,
  transcribeRecording,
  type CustomModel,
  type CustomModelKind,
  type NativeStatus,
  type RecordingStatus,
  type TextEnhancementModelInfo,
  type TranscriptionResult,
  type WhisperModelInfo,
} from "@/lib/native";
import { useAppStore } from "@/store/app-store";

const MODEL_META: Record<string, { description: string; version: string; badges: string[] }> = {
  "tiny.en":          { description: "Fastest, lowest quality. Good for quick tests and very constrained machines.", version: "v1.0", badges: ["fastest", "english", "low memory"] },
  "base.en":          { description: "Recommended default. Strong accuracy and real-time on Apple Silicon.", version: "v1.0", badges: ["recommended", "balanced", "english"] },
  "small.en":         { description: "Better English accuracy with a moderate speed tradeoff. ~2x slower than base.", version: "v1.0", badges: ["accurate", "english", "medium"] },
  "medium.en":        { description: "Strong quality. ~4x slower than base; needs 8 GB+ RAM.", version: "v1.0", badges: ["high quality", "english", "8 GB+"] },
  "tiny":             { description: "Fastest multilingual model. Good for quick tests and non-English dictation.", version: "v1.0", badges: ["fastest", "multilingual", "low memory"] },
  "base":             { description: "Multilingual base model. Good accuracy for English, Hindi, and other languages.", version: "v1.0", badges: ["multilingual", "balanced"] },
  "small":            { description: "Multilingual small model. Better accuracy across languages with a moderate speed tradeoff.", version: "v1.0", badges: ["multilingual", "accurate"] },
  "medium":           { description: "Multilingual medium model. Strong quality for Hindi/Hinglish and other languages.", version: "v1.0", badges: ["multilingual", "high quality", "8 GB+"] },
  "large-v3":         { description: "Best accuracy, all languages. ~8x slower than base; needs 16 GB+ RAM.", version: "v3.0", badges: ["best accuracy", "multilingual", "16 GB+"] },
  "distil-large-v3":  { description: "Recommended English upgrade: ~2x faster than large-v3 with near-identical accuracy. English-focused.", version: "v3.0", badges: ["premium", "fast large", "english"] },
  "large-v3-turbo":   { description: "Premium: near large-v3 accuracy at ~2x the speed. All languages. Needs 8 GB+ RAM.", version: "v3.0", badges: ["premium", "turbo", "multilingual"] },
  "parakeet-tdt-0.6b-v2": { description: "NVIDIA Parakeet. Top English accuracy with automatic punctuation and capitalization.", version: "v2.0", badges: ["nvidia", "english", "punctuation"] },
  "parakeet-tdt-0.6b-v3": { description: "NVIDIA Parakeet multilingual. Strong English plus 25 European languages.", version: "v3.0", badges: ["nvidia", "multilingual", "punctuation"] },
};

function formatBytes(bytes: number) {
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `~${gb.toFixed(2).replace(/\.?0+$/, "")} GB`;
  return `~${Math.round(bytes / 1024 / 1024)} MB`;
}

export function ModelsPage() {
  const {
    selectedModel,
    setSelectedModel,
    dictionary,
    enhancementModel,
    setEnhancementModel,
    downloadingModels,
    pausedModels,
    modelDownloadProgress,
    downloadModel,
    pauseModel,
    resumeModel,
    cancelModel,
  } = useAppStore();
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enhancementModels, setEnhancementModels] = useState<TextEnhancementModelInfo[]>([]);
  const [enhancementLoading, setEnhancementLoading] = useState(true);
  const [enhancementDeleting, setEnhancementDeleting] = useState<string | null>(null);
  const [enhancementDownloading, setEnhancementDownloading] = useState<string | null>(null);
  const [enhancementProgress, setEnhancementProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [customModels, setCustomModels] = useState<CustomModel[]>([]);
  const [customModelUrl, setCustomModelUrl] = useState("");
  const [customModelKind, setCustomModelKind] = useState<"auto" | CustomModelKind>("auto");
  const [customModelAdding, setCustomModelAdding] = useState(false);
  const [customModelDeleting, setCustomModelDeleting] = useState<string | null>(null);
  const [customModelDownloading, setCustomModelDownloading] = useState<string | null>(null);
  const [customModelProgress, setCustomModelProgress] = useState<{ downloaded: number; total: number } | null>(null);
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

  // Load the text-enhancement model (powers the Enhance icon + AI cleanup).
  useEffect(() => {
    let active = true;
    void listTextEnhancementModels()
      .then((m) => { if (active) setEnhancementModels(m); })
      .catch(() => { if (active) setEnhancementModels([]); })
      .finally(() => { if (active) setEnhancementLoading(false); });
    return () => { active = false; };
  }, []);

  // Track enhancement model download progress.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ modelName: string; downloaded: number; total: number }>(
      "vox-text-model-download-progress",
      (event) => {
        const { modelName, downloaded, total } = event.payload;
        setEnhancementDownloading(modelName);
        setEnhancementProgress({ downloaded, total });
      }
    ).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // Load custom models and track their download progress.
  useEffect(() => {
    let active = true;
    void listCustomModels()
      .then((models) => { if (active) setCustomModels(models); })
      .catch(() => { if (active) setCustomModels([]); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ modelName: string; downloaded: number; total: number }>(
      "vox-custom-model-download-progress",
      (event) => {
        const { modelName, downloaded, total } = event.payload;
        setCustomModelDownloading(modelName);
        setCustomModelProgress({ downloaded, total });
      }
    ).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const handleDownload = async (modelName: string) => {
    setError(null);
    try {
      await downloadModel(modelName);
      const updated = await listWhisperModels();
      setModels(updated);
      // Auto-set as active if nothing else is set
      if (!selectedModel || selectedModel === "base.en") {
        await setSelectedModel(modelName);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes("cancelled")) {
        setError(message);
      }
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

  const handleEnhancementDownload = async (modelName: string) => {
    setError(null);
    try {
      await downloadTextEnhancementModel(modelName);
      const updated = await listTextEnhancementModels();
      setEnhancementModels(updated);
      setEnhancementDownloading(null);
      setEnhancementProgress(null);
      await setEnhancementModel(modelName);
    } catch (err) {
      setEnhancementDownloading(null);
      setEnhancementProgress(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleEnhancementSetActive = async (modelName: string) => {
    await setEnhancementModel(modelName);
  };

  const handleEnhancementDelete = async (modelName: string) => {
    setEnhancementDeleting(modelName);
    setError(null);
    try {
      await deleteTextEnhancementModel(modelName);
      const updated = await listTextEnhancementModels();
      setEnhancementModels(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnhancementDeleting(null);
    }
  };

  const handleAddCustomModel = async () => {
    const url = customModelUrl.trim();
    if (!url) return;
    setCustomModelAdding(true);
    setError(null);
    try {
      const model = await addCustomModel(url, customModelKind === "auto" ? undefined : customModelKind);
      setCustomModelUrl("");
      setCustomModelKind("auto");
      setCustomModels(await listCustomModels());
      // Auto-activate the new model in its pipeline.
      if (model.kind === "stt") {
        await setSelectedModel(model.name);
      } else {
        await setEnhancementModel(model.name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCustomModelAdding(false);
    }
  };

  const handleCustomModelSetActive = async (model: CustomModel) => {
    if (model.kind === "stt") {
      await setSelectedModel(model.name);
    } else {
      await setEnhancementModel(model.name);
    }
  };

  const handleCustomModelDelete = async (name: string) => {
    setCustomModelDeleting(name);
    setError(null);
    try {
      await deleteCustomModel(name);
      setCustomModels(await listCustomModels());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCustomModelDeleting(null);
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
          await saveTranscript(result.text, undefined, result.appName, result.durationSeconds, undefined, result.language ?? "en");
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
  const orderedModels = [...models].sort((a, b) => {
    if (a.name === selectedModel) return -1;
    if (b.name === selectedModel) return 1;
    return 0;
  });
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
        <div className="page-shell max-w-5xl">
          <header className="page-header">
            <div>
              <h1 className="page-title">Local Whisper Models</h1>
              <p className="page-description">
                Download, compare, and manage the local models used for dictation.
              </p>
            </div>
            <div className="flex justify-start lg:justify-end">
              <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span className={`h-2 w-2 rounded-full ${nativeStatus ? "bg-emerald-500" : "bg-muted-foreground/35"}`} />
                {nativeStatus ? "Engine ready" : "Engine not checked"}
              </span>
            </div>
          </header>

          <div className="stat-strip divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <LibraryStat label="Downloaded" value={downloadedModels.length.toLocaleString()} />
            <LibraryStat label="Stored" value={formatBytes(totalDownloadedSize)} />
            <LibraryStat label="Active" value={activeModel?.displayName ?? selectedModel} />
          </div>

          {error && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-4 text-sm text-destructive">
              {error}
            </div>
          )}

          <article className="surface-depth panel p-4">
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
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="font-mono">
                    {quickStatus}
                  </span>
                  <span className="font-mono">
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
            <div className="panel divide-y divide-border overflow-hidden">
              {orderedModels.map((model) => {
                const isDownloading = downloadingModels.includes(model.name);
                const isPaused = pausedModels.includes(model.name);
                const isDeleting = deleting === model.name;
                const isActive = selectedModel === model.name;
                const meta = MODEL_META[model.name];
                const dl = modelDownloadProgress[model.name];
                const pct =
                  isDownloading && dl && dl.total > 0
                    ? Math.round((dl.downloaded / dl.total) * 100)
                    : null;
                const downloadedMB = dl ? Math.round(dl.downloaded / 1024 / 1024) : 0;
                const totalMB = dl ? Math.round(dl.total / 1024 / 1024) : 0;

                return (
                  <article key={model.name} className="p-4 transition-colors hover:bg-muted/25">
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
                          {isActive && <ActiveBadge />}
                        </div>

                        {meta?.description && (
                          <p className="text-sm leading-6 text-foreground/90">{meta.description}</p>
                        )}

                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                          <span className="font-mono tabular-nums">
                            {formatBytes(model.size)}
                          </span>
                          <span className="font-mono">
                            {isActive ? "Active" : model.downloaded ? "Downloaded" : "Not downloaded"}
                          </span>
                          {meta?.badges?.map((badge) => (
                            <span
                              key={badge}
                              className="font-medium uppercase tracking-[0.08em]"
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
                                  className="h-full rounded-full bg-primary transition-[width] duration-150"
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
                                  disabled={isDeleting || downloadingModels.length > 0}
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
                          <div className="flex shrink-0 gap-2">
                            {isDownloading ? (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    void (isPaused
                                      ? resumeModel(model.name)
                                      : pauseModel(model.name))
                                  }
                                >
                                  {isPaused ? "Resume" : "Pause"}
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => void cancelModel(model.name)}
                                >
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => void handleDownload(model.name)}
                                disabled={downloadingModels.length > 0}
                              >
                                <Download className="h-4 w-4" />
                                Download
                              </Button>
                            )}
                          </div>
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

          {/* Text enhancement model — powers the Enhance icon + AI cleanup */}
          <section className="mt-6">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-sidebar-accent text-primary">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">Text enhancement</p>
                <p className="text-xs text-muted-foreground">
                  Powers the Enhance icon on focused inputs, AI cleanup, and transforms. Runs fully on-device.
                </p>
              </div>
            </div>
            {enhancementLoading ? (
              <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Loading enhancement model
              </div>
            ) : enhancementModels.length > 0 ? (
              <div className="panel divide-y divide-border overflow-hidden">
                {enhancementModels.map((model) => {
                  const isDownloading = enhancementDownloading === model.name;
                  const isDeleting = enhancementDeleting === model.name;
                  const isActive = enhancementModel === model.name;
                  const pct =
                    isDownloading && enhancementProgress && enhancementProgress.total > 0
                      ? Math.round((enhancementProgress.downloaded / enhancementProgress.total) * 100)
                      : null;
                  const downloadedMB = enhancementProgress ? Math.round(enhancementProgress.downloaded / 1024 / 1024) : 0;
                  const totalMB = enhancementProgress ? Math.round(enhancementProgress.total / 1024 / 1024) : 0;

                  return (
                    <article key={model.name} className="p-4 transition-colors hover:bg-muted/25">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{model.displayName}</p>
                            <span className="text-[11px] font-mono text-muted-foreground">LLM</span>
                            {model.recommended && (
                              <Badge variant="secondary" className="text-[10px] uppercase tracking-[0.08em]">
                                recommended
                              </Badge>
                            )}
                            {isActive && <ActiveBadge />}
                          </div>
                          <p className="text-sm leading-6 text-foreground/90">
                            Local Qwen2.5 instruct model for rewriting, cleanup, and transforms. Needed for the Enhance icon and AI cleanup.
                          </p>
                          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                            <span className="font-mono tabular-nums">{formatBytes(model.size)}</span>
                            <span className="font-mono">
                              {isActive ? "Active" : model.downloaded ? "Downloaded" : "Not downloaded"}
                            </span>
                          </div>
                          {isDownloading && (
                            <div className="mt-3 space-y-1.5">
                              <div className="h-1.5 overflow-hidden rounded-full bg-border">
                                {pct !== null ? (
                                  <div
                                    className="h-full rounded-full bg-primary transition-[width] duration-150"
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
                                  onClick={() => void handleEnhancementSetActive(model.name)}
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
                                    disabled={isDeleting || enhancementDownloading !== null}
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
                                      Remove <span className="font-medium text-foreground">{model.displayName}</span> from this device. The Enhance icon and AI cleanup will stop working until you re-download it.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      variant="destructive"
                                      onClick={() => {
                                        void handleEnhancementDelete(model.name);
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
                              onClick={() => void handleEnhancementDownload(model.name)}
                              disabled={enhancementDownloading !== null}
                            >
                              {isDownloading ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                              {isDownloading ? "Downloading…" : "Download"}
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
                <p className="text-sm font-medium text-foreground">No enhancement model available</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open the desktop app to load local enhancement model availability.
                </p>
              </div>
            )}
          </section>

          {/* Custom models — add any Hugging Face model URL */}
          <section className="mt-6">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-sidebar-accent text-primary">
                <Download className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">Custom models</p>
                <p className="text-xs text-muted-foreground">
                  Add any Hugging Face model URL. Vox detects whether it is for speech-to-text or text enhancement.
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  aria-label="Hugging Face model URL"
                  placeholder="https://huggingface.co/.../model.gguf"
                  value={customModelUrl}
                  onChange={(event) => setCustomModelUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && customModelUrl.trim()) {
                      event.preventDefault();
                      void handleAddCustomModel();
                    }
                  }}
                  className="flex-1"
                />
                <div className="flex shrink-0 gap-2">
                  <select
                    aria-label="Model type"
                    value={customModelKind}
                    onChange={(event) => setCustomModelKind(event.target.value as "auto" | CustomModelKind)}
                    className="h-9 rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <option value="auto">Auto-detect</option>
                    <option value="stt">Speech-to-text</option>
                    <option value="enhance">Text enhancement</option>
                  </select>
                  <Button
                    size="sm"
                    onClick={() => void handleAddCustomModel()}
                    disabled={!customModelUrl.trim() || customModelAdding}
                  >
                    {customModelAdding ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    {customModelAdding ? "Adding…" : "Add model"}
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Auto-detect uses the file extension and model family: <span className="font-mono">.bin</span>/
                <span className="font-mono">.ggml</span> → speech-to-text, <span className="font-mono">.gguf</span> with an LLM
                family (Qwen, Llama, Mistral…) → text enhancement, Parakeet → speech-to-text.
              </p>
            </div>
            {customModels.length > 0 && (
              <div className="panel mt-3 divide-y divide-border overflow-hidden">
                {customModels.map((model) => {
                  const isDownloading = customModelDownloading === model.name;
                  const isDeleting = customModelDeleting === model.name;
                  const isActive =
                    model.kind === "stt" ? selectedModel === model.name : enhancementModel === model.name;
                  const pct =
                    isDownloading && customModelProgress && customModelProgress.total > 0
                      ? Math.round((customModelProgress.downloaded / customModelProgress.total) * 100)
                      : null;
                  const downloadedMB = customModelProgress ? Math.round(customModelProgress.downloaded / 1024 / 1024) : 0;
                  const totalMB = customModelProgress ? Math.round(customModelProgress.total / 1024 / 1024) : 0;

                  return (
                    <article key={model.name} className="p-4 transition-colors hover:bg-muted/25">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <p className="truncate font-mono text-sm font-medium text-foreground" title={model.name}>
                              {model.name}
                            </p>
                            <Badge variant="secondary" className="text-[10px] uppercase tracking-[0.08em]">
                              {model.kind === "stt" ? "STT" : "LLM"}
                            </Badge>
                            {isActive && <ActiveBadge />}
                          </div>
                          <p className="truncate text-[11px] text-muted-foreground" title={model.url}>
                            {model.url}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                            <span className="font-mono tabular-nums">
                              {model.size > 0 ? formatBytes(model.size) : "—"}
                            </span>
                            <span className="font-mono">
                              {isActive ? "Active" : model.downloaded ? "Downloaded" : "Not downloaded"}
                            </span>
                          </div>
                          {isDownloading && (
                            <div className="mt-3 space-y-1.5">
                              <div className="h-1.5 overflow-hidden rounded-full bg-border">
                                {pct !== null ? (
                                  <div
                                    className="h-full rounded-full bg-primary transition-[width] duration-150"
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
                          {!isActive && model.downloaded && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void handleCustomModelSetActive(model)}
                              disabled={isDeleting}
                            >
                              Set active
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => void handleCustomModelDelete(model.name)}
                            disabled={isDeleting || isDownloading}
                          >
                            {isDeleting ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

function LibraryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-cell">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-xl font-semibold tabular-nums text-foreground" title={value}>{value}</p>
    </div>
  );
}

function ActiveBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-600 dark:text-emerald-400">
      <Check className="h-3 w-3" aria-hidden="true" />
      active
    </span>
  );
}
