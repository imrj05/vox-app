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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { saveCorrections, saveTranscript } from "@/lib/db";
import {
  addCustomModel,
  deleteCustomModel,
  deleteRecordingFile,
  deleteTextEnhancementModel,
  deleteWhisperModel,
  downloadTextEnhancementModel,
  getHardwareInfo,
  getNativeStatus,
  getTranscriptionEngines,
  listCustomModels,
  listTextEnhancementModels,
  listWhisperModels,
  startRecording,
  stopRecording,
  transcribeRecording,
  type CustomModel,
  type CustomModelKind,
  type HardwareInfo,
  type NativeStatus,
  type RecordingStatus,
  type TextEnhancementModelInfo,
  type TranscriptionEngineStatus,
  type TranscriptionResult,
  type WhisperModelInfo,
} from "@/lib/native";
import { activeModelLabel } from "@/lib/model-label";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";

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

const ENGINE_CARDS: Array<{
  value: "auto" | "whisper" | "parakeet" | "apple";
  label: string;
  description: string;
  hint: string;
}> = [
  {
    value: "auto",
    label: "Automatic",
    description: "Vox picks the best installed engine per language and hardware.",
    hint: "English prefers Parakeet when installed; otherwise Whisper; Apple Speech as a last resort.",
  },
  {
    value: "whisper",
    label: "Whisper",
    description: "Multilingual, GPU-accelerated on Apple Silicon. Best for Hindi and Hinglish.",
    hint: "Uses the Whisper model you pin in the library below.",
  },
  {
    value: "parakeet",
    label: "Parakeet",
    description: "Fast on-device transcription on Apple Silicon. English plus 25 European languages.",
    hint: "Automatically uses the newest downloaded Parakeet model (v3 first) — nothing to pin.",
  },
  {
    value: "apple",
    label: "Apple Speech",
    description: "Built into macOS — nothing to download. On-device with OS-provided recognizers.",
    hint: "No models to manage: this works out of the box and updates with macOS.",
  },
];

const isParakeetModel = (name: string) => name.startsWith("parakeet");

function formatBytes(bytes: number) {
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `~${gb.toFixed(2).replace(/\.?0+$/, "")} GB`;
  return `~${Math.round(bytes / 1024 / 1024)} MB`;
}

export function ModelsPage() {
  const {
    selectedModel,
    setSelectedModel,
    engine,
    setEngine,
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
  const [engines, setEngines] = useState<TranscriptionEngineStatus[]>([]);
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus | null>(null);
  const [transcriptionResult, setTranscriptionResult] = useState<TranscriptionResult | null>(null);
  const [checkingEngine, setCheckingEngine] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  // Verify the native engine on mount so status is truthful without requiring
  // the user to discover the manual check first.
  useEffect(() => {
    let active = true;
    void getNativeStatus()
      .then((status) => { if (active) setNativeStatus(status); })
      .catch(() => { if (active) setNativeStatus(null); });
    return () => { active = false; };
  }, []);

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

  // Hardware awareness (spec §25): drive per-model recommendations.
  useEffect(() => {
    let active = true;
    void getHardwareInfo()
      .then((info) => { if (active) setHardware(info); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Engine availability mirrors Settings → Transcription (same runtime probe).
  useEffect(() => {
    let active = true;
    void getTranscriptionEngines()
      .then((list) => { if (active) setEngines(list); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Load the text-enhancement model (powers the Enhance icon + AI cleanup).
  useEffect(() => {
    let active = true;
    void listTextEnhancementModels()
      .then((m) => {
        if (!active) return;
        setEnhancementModels(m);
        // A pin that points at a model that isn't on disk can't run (fresh
        // install default or a deleted file) — heal it to a downloaded model
        // so the Enhance feature only ever runs with a present model.
        const { enhancementModel: pinned, setEnhancementModel: setPin } =
          useAppStore.getState();
        const pinnedInfo = m.find((model) => model.name === pinned);
        if (pinnedInfo && !pinnedInfo.downloaded) {
          const fallback = m.find((model) => model.downloaded);
          if (fallback) {
            void setPin(fallback.name);
          }
        }
      })
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
      // Auto-set the Whisper pin if nothing is pinned yet. Parakeet has no
      // pin — the engine auto-picks its newest downloaded model.
      if (!isParakeetModel(modelName) && (!selectedModel || selectedModel === "base.en")) {
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
      // If the deleted model was the pinned Whisper model, fall back to base.en.
      // Parakeet pins do not exist — its engine auto-picks.
      if (selectedModel === modelName && !isParakeetModel(modelName)) {
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
      // If the deleted model was the active pin, fall back to another
      // downloaded model so the Enhance feature keeps working (mirrors the
      // Whisper delete fallback to base.en).
      if (enhancementModel === modelName) {
        const fallback = updated.find((m) => m.downloaded);
        if (fallback) {
          await setEnhancementModel(fallback.name);
        }
      }
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
      setError("Recording isn't available right now. Restart the Vox app and try again.");
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
          // The pinned model only applies when the Whisper engine is selected
          // (spec §7): a stale "active model" pin must never override Apple
          // Speech / Parakeet.
          const result = await transcribeRecording(
            status.path,
            (engine as string) === "whisper" ? selectedModel : undefined,
            status.appName,
            status.windowTitle
          );
          result.appName = status.appName;
          result.durationSeconds = status.durationSeconds;
          setTranscriptionResult(result);
          await saveTranscript(result.text, undefined, result.appName, result.durationSeconds, undefined, result.language ?? "en");
          await saveCorrections(result.corrections ?? [], result.appName).catch(() => {});
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

  // --- Engine-scoped library (the page's primary task path) -----------------
  const whisperLibrary = [...models]
    .filter((model) => !isParakeetModel(model.name))
    .sort((a, b) => {
      const pinned = selectedModel === a.name ? -1 : selectedModel === b.name ? 1 : 0;
      return pinned;
    });
  const parakeetLibrary = [...models].filter((model) => isParakeetModel(model.name)).reverse();
  const engineStatusFor = (value: string) => engines.find((engineStatus) => engineStatus.id === value);
  // Truthful active states: the Whisper pin is live only under the Whisper
  // engine (the library passes it as `activePinName` only in that mode);
  // Parakeet always auto-picks (v3 first, like the router).
  const activeParakeet =
    parakeetLibrary.find((model) => model.name.includes("v3") && model.downloaded) ??
    parakeetLibrary.find((model) => model.downloaded);
  const downloadedModels = models.filter((model) => model.downloaded);
  const totalDownloadedSize = downloadedModels.reduce((sum, model) => sum + model.size, 0);
  const libraryMeta = `${downloadedModels.length} of ${models.length} downloaded · ${formatBytes(totalDownloadedSize)} stored`;
  const libraryTitle =
    engine === "whisper" ? "Whisper models" :
    engine === "parakeet" ? "Parakeet models" :
    engine === "apple" ? "Apple Speech" : "Model library";
  const libraryDescription =
    engine === "whisper"
      ? "The pinned model is what every transcription uses. Download alternatives to switch instantly."
      : engine === "parakeet"
        ? "Parakeet automatically uses the newest downloaded model (v3 first), so manage downloads rather than pinning."
        : engine === "auto"
          ? "Everything available to the Automatic engine. Only a Whisper pin applies when it routes to Whisper."
          : "Switch the engine above to Whisper or Parakeet to manage downloadable models.";
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
        <div className="page-shell">
          <header className="page-header">
            <div>
              <h1 className="page-title">Models</h1>
              <p className="page-description">
                Pick the engine that powers dictation, then manage the local models it uses.
              </p>
            </div>
            <div className="flex justify-start lg:justify-end">
              <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span className={`h-2 w-2 rounded-full ${nativeStatus ? "bg-primary" : "bg-muted-foreground/35"}`} />
                {nativeStatus ? "Engine ready" : "Engine not checked"}
              </span>
            </div>
          </header>

          {error && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* 1 — Engine selection: the control that decides which model runs */}
          <section className="panel space-y-3 p-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Mic className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Transcription engine</p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  All engines run locally on your device. The model library below follows your selection.
                </p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {ENGINE_CARDS.map((option) => {
                const status = engineStatusFor(option.value);
                // A missing model is fixable on this page (download from the
                // library below), so it must never lock engine selection —
                // that would gate the download behind the engine it enables.
                // Only a broken runtime is truly unavailable.
                const needsModel =
                  !!status && !status.available && /no .+ model/i.test(status.reason ?? "");
                const unavailable =
                  option.value !== "auto" && !!status && !status.available && !needsModel;
                return (
                  <button
                    key={option.value}
                    onClick={() => void setEngine(option.value)}
                    disabled={unavailable}
                    aria-pressed={engine === option.value}
                    title={unavailable ? (status?.reason ?? undefined) : undefined}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left transition-colors",
                      engine === option.value
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      unavailable && "cursor-not-allowed opacity-50"
                    )}
                  >
                    <span className="flex items-center justify-between gap-2 text-sm font-medium">
                      {option.label}
                      {status && option.value !== "auto" ? (
                        <span
                          className={cn(
                            "text-[10px] font-normal",
                            status.available && option.value === engine
                              ? "text-primary"
                              : "text-muted-foreground"
                          )}
                        >
                          {status.available ? "Ready" : needsModel ? "Model needed" : "Unavailable"}
                        </span>
                      ) : null}
                    </span>
                    <span className={cn(
                      "mt-1 block text-xs leading-5",
                      needsModel && option.value === engine && "font-medium text-foreground"
                    )}>
                      {unavailable
                        ? status?.reason ?? option.description
                        : option.description}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
              {ENGINE_CARDS.find((option) => option.value === engine)?.hint ??
                ENGINE_CARDS[0].hint}
            </p>
          </section>

          {hardware && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {hardware.appleSilicon ? "Apple Silicon" : hardware.arch}
              </span>
              <span className="font-mono">
                {formatBytes(hardware.totalMemoryBytes).replace("~", "")} RAM
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-foreground">
                {hardware.tier}
              </span>
              <span>
                Recommended: models up to {formatBytes(hardware.maxRecommendedModelBytes)} for your machine.
              </span>
            </div>
          )}

          {/* 2 — Quick dictation: test the engine → model chain end-to-end */}
          <article className="surface-depth panel p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-sidebar-accent text-primary">
                    <Wand2 className="h-4 w-4" />
                  </span>
                  <p className="text-sm font-medium text-foreground">Quick dictation</p>
                  <Badge variant="secondary" className="h-5">
                    {activeModelLabel(engine, selectedModel, models)}
                  </Badge>
                </div>
                <p className="text-sm leading-6 text-foreground/90">
                  Test the current engine and model end-to-end before changing downloads or defaults.
                </p>
                <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                  {quickStatus}
                </p>
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

          {/* 3 — Model library, scoped to the selected engine */}
          {loading ? (
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading models
            </div>
          ) : engine === "apple" ? (
            <article className="panel flex flex-col items-center gap-2 border-dashed px-6 py-10 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Sparkles className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-foreground">Apple Speech needs no model</p>
              <p className="max-w-md text-xs leading-5 text-muted-foreground">
                Vox uses the speech recognizers built into macOS — on-device, ready out of
                the box, and updated by macOS itself. Switch the engine above to Whisper or
                Parakeet to manage downloadable models.
              </p>
            </article>
          ) : models.length > 0 ? (
            <div className="panel overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{libraryTitle}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{libraryDescription}</p>
                </div>
                <p className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{libraryMeta}</p>
              </div>

              {engine === "parakeet" && !activeParakeet && (
                <div className="border-b border-border bg-primary/5 px-4 py-3 text-xs leading-5 text-foreground">
                  No Parakeet model is downloaded yet — grab one from the list below to switch
                  this engine on.
                </div>
              )}
              {engine === "whisper" && !whisperLibrary.some((model) => model.downloaded) && (
                <div className="border-b border-border bg-primary/5 px-4 py-3 text-xs leading-5 text-foreground">
                  No Whisper model is downloaded yet — grab one below; it automatically becomes
                  the active model.
                </div>
              )}

              {engine === "whisper" ? (
                <SttModelGroup
                  models={whisperLibrary}
                  hardware={hardware}
                  showSetActive
                  activePinName={selectedModel}
                  onSetActive={handleSetActive}
                  onDownload={handleDownload}
                  onDelete={handleDelete}
                  deleting={deleting}
                  downloadingModels={downloadingModels}
                  pausedModels={pausedModels}
                  modelDownloadProgress={modelDownloadProgress}
                  pauseModel={(name) => void pauseModel(name)}
                  resumeModel={(name) => void resumeModel(name)}
                  cancelModel={(name) => void cancelModel(name)}
                />
              ) : engine === "parakeet" ? (
                <SttModelGroup
                  models={parakeetLibrary}
                  hardware={hardware}
                  showSetActive={false}
                  autoPickName={activeParakeet?.name}
                  onSetActive={handleSetActive}
                  onDownload={handleDownload}
                  onDelete={handleDelete}
                  deleting={deleting}
                  downloadingModels={downloadingModels}
                  pausedModels={pausedModels}
                  modelDownloadProgress={modelDownloadProgress}
                  pauseModel={(name) => void pauseModel(name)}
                  resumeModel={(name) => void resumeModel(name)}
                  cancelModel={(name) => void cancelModel(name)}
                />
              ) : (
                <>
                  <GroupSubHeader
                    title="Whisper"
                    description="Used when Automatic routes to Whisper — pin one below."
                  />
                  <SttModelGroup
                    models={whisperLibrary}
                    hardware={hardware}
                    showSetActive
                    onSetActive={handleSetActive}
                    onDownload={handleDownload}
                    onDelete={handleDelete}
                    deleting={deleting}
                    downloadingModels={downloadingModels}
                    pausedModels={pausedModels}
                    modelDownloadProgress={modelDownloadProgress}
                    pauseModel={(name) => void pauseModel(name)}
                    resumeModel={(name) => void resumeModel(name)}
                    cancelModel={(name) => void cancelModel(name)}
                  />
                  <GroupSubHeader
                    title="Parakeet"
                    description="Used for English when installed — the newest download is auto-picked."
                  />
                  <SttModelGroup
                    models={parakeetLibrary}
                    hardware={hardware}
                    showSetActive={false}
                    autoPickName={activeParakeet?.name}
                    onSetActive={handleSetActive}
                    onDownload={handleDownload}
                    onDelete={handleDelete}
                    deleting={deleting}
                    downloadingModels={downloadingModels}
                    pausedModels={pausedModels}
                    modelDownloadProgress={modelDownloadProgress}
                    pauseModel={(name) => void pauseModel(name)}
                    resumeModel={(name) => void resumeModel(name)}
                    cancelModel={(name) => void cancelModel(name)}
                  />
                </>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center">
              <p className="text-sm font-medium text-foreground">No models available</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Open the desktop app to load local model availability.
              </p>
            </div>
          )}

          {/* 4 — Text enhancement model — powers the Enhance icon + AI cleanup */}
          <section className="mt-1">
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
                  // A pin to a model that isn't on disk cannot run — it must
                  // never present itself as active.
                  const isActive = enhancementModel === model.name && model.downloaded;
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
                            <DownloadProgress pct={pct} downloadedMB={downloadedMB} totalMB={totalMB} />
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

          {/* 5 — Custom models — add any Hugging Face model URL */}
          <section>
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
                  <Select
                    value={customModelKind}
                    onValueChange={(value) => setCustomModelKind(value as "auto" | CustomModelKind)}
                  >
                    <SelectTrigger className="h-9 w-[170px] bg-background" aria-label="Model type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto-detect</SelectItem>
                      <SelectItem value="stt">Speech-to-text</SelectItem>
                      <SelectItem value="enhance">Text enhancement</SelectItem>
                    </SelectContent>
                  </Select>
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
                    (model.kind === "stt"
                      ? selectedModel === model.name
                      : enhancementModel === model.name) && model.downloaded;
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
                          {!model.downloaded && !isDownloading && (
                            <p className="mt-2 text-[11px] text-muted-foreground">
                              The download didn't finish. Remove this model and add it again to retry.
                            </p>
                          )}
                          {isDownloading && (
                            <DownloadProgress pct={pct} downloadedMB={downloadedMB} totalMB={totalMB} />
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
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Delete custom model"
                                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                                disabled={isDeleting || isDownloading}
                              >
                                {isDeleting ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete custom model?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Remove <span className="font-medium text-foreground">{model.name}</span> and its downloaded file from this device.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  variant="destructive"
                                  onClick={() => {
                                    void handleCustomModelDelete(model.name);
                                  }}
                                >
                                  Delete model
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
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

/** Shared download progress bar (MB counter + percent) for all model types. */
function DownloadProgress({
  pct,
  downloadedMB,
  totalMB,
}: {
  pct: number | null;
  downloadedMB: number;
  totalMB: number;
}) {
  return (
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
  );
}

/** Shared props for a single speech-to-text model row (Whisper or Parakeet). */
interface SttModelRowProps {
  model: WhisperModelInfo;
  hardware: HardwareInfo | null;
  /** Green badge text, e.g. "active" or "auto-picked"; omit for none. */
  activeBadge?: string;
  /** Show the "Set active" control when downloaded (Whisper only). */
  showSetActive: boolean;
  onSetActive?: (name: string) => void;
  onDownload: (name: string) => void;
  onDelete: (name: string) => void;
  deleting?: string | null;
  downloadingModels: string[];
  pausedModels: string[];
  modelDownloadProgress: Record<string, { downloaded: number; total: number }>;
  pauseModel?: (name: string) => void;
  resumeModel?: (name: string) => void;
  cancelModel?: (name: string) => void;
}

function SttModelRow({
  model,
  hardware,
  activeBadge,
  showSetActive,
  onSetActive,
  onDownload,
  onDelete,
  deleting,
  downloadingModels,
  pausedModels,
  modelDownloadProgress,
  pauseModel,
  resumeModel,
  cancelModel,
}: SttModelRowProps) {
  const isDownloading = downloadingModels.includes(model.name);
  const isPaused = pausedModels.includes(model.name);
  // Only delete confirmation state is passed down; the busy flag guards
  // destructive actions while any download is in flight.
  const isDeleting = deleting === model.name;
  const meta = MODEL_META[model.name];
  const dl = modelDownloadProgress[model.name];
  const pct = isDownloading && dl && dl.total > 0 ? Math.round((dl.downloaded / dl.total) * 100) : null;
  const downloadedMB = dl ? Math.round(dl.downloaded / 1024 / 1024) : 0;
  const totalMB = dl ? Math.round(dl.total / 1024 / 1024) : 0;
  // Hardware-aware recommendation (spec §25).
  const fitsHardware = hardware !== null && model.size <= hardware.maxRecommendedModelBytes;
  const parakeet = isParakeetModel(model.name);

  return (
    <article className="p-4 transition-colors hover:bg-muted/25">
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
            {fitsHardware && (
              <Badge
                variant="outline"
                className="text-[10px] uppercase tracking-[0.08em] text-primary"
                title="Fits this Mac's memory budget comfortably"
              >
                fits your Mac
              </Badge>
            )}
            {activeBadge && <CheckBadge>{activeBadge}</CheckBadge>}
          </div>

          {meta?.description && (
            <p className="text-sm leading-6 text-foreground/90">{meta.description}</p>
          )}

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="font-mono tabular-nums">
              {formatBytes(model.size)}
            </span>
            <span className="font-mono">
              {activeBadge ? (parakeet ? "Auto-picked" : "Active")
                : model.downloaded ? "Downloaded" : "Not downloaded"}
            </span>
            {meta?.badges?.map((badge) => (
              <span key={badge} className="font-medium uppercase tracking-[0.08em]">
                {badge}
              </span>
            ))}
          </div>

          {isDownloading && (
            <DownloadProgress pct={pct} downloadedMB={downloadedMB} totalMB={totalMB} />
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          {model.downloaded ? (
            <>
              {showSetActive && !activeBadge && onSetActive && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSetActive(model.name)}
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
                          {activeBadge ? "Active model" : "Downloaded model"}
                        </span>
                      </div>
                    </div>

                    <p>
                      This deletes the local model file from your device, not just the entry in Vox.
                    </p>

                    {parakeet ? (
                      <p>
                        Parakeet will fall back to another downloaded Parakeet model, or to Apple Speech if none remain.
                      </p>
                    ) : (
                      activeBadge && (
                        <p>
                          Vox will switch back to <span className="font-medium text-foreground">base.en</span> after deletion.
                        </p>
                      )
                    )}
                  </div>

                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => {
                        onDelete(model.name);
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
                      void (isPaused ? resumeModel?.(model.name) : pauseModel?.(model.name))
                    }
                  >
                    {isPaused ? "Resume" : "Pause"}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => cancelModel?.(model.name)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => onDownload(model.name)}
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
}

/** Green state badge shared by "active" pins and "auto-picked" models. */
function CheckBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/35 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">
      <Check className="h-3 w-3" aria-hidden="true" />
      {children}
    </span>
  );
}

/** Sub-header splitting the library into runtime families (Automatic mode). */
function GroupSubHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-y border-border bg-muted/40 px-4 py-2">
      <p className="text-xs font-medium text-foreground">{title}</p>
      <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</p>
    </div>
  );
}

/**
 * A group of speech-to-text model rows. `activePinName` marks the Whisper
 * pin as Active (only when it actually resolves); `autoPickName` marks the
 * Parakeet model the router would auto-pick.
 */
function SttModelGroup({
  models,
  hardware,
  showSetActive,
  activePinName,
  autoPickName,
  onSetActive,
  onDownload,
  onDelete,
  deleting,
  downloadingModels,
  pausedModels,
  modelDownloadProgress,
  pauseModel,
  resumeModel,
  cancelModel,
}: {
  models: WhisperModelInfo[];
  hardware: HardwareInfo | null;
  showSetActive: boolean;
  activePinName?: string | null;
  autoPickName?: string | null;
  onSetActive: (name: string) => void;
  onDownload: (name: string) => void;
  onDelete: (name: string) => void;
  deleting?: string | null;
  downloadingModels: string[];
  pausedModels: string[];
  modelDownloadProgress: Record<string, { downloaded: number; total: number }>;
  pauseModel?: (name: string) => void;
  resumeModel?: (name: string) => void;
  cancelModel?: (name: string) => void;
}) {
  if (models.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-xs text-muted-foreground">No models in this family.</p>
      </div>
    );
  }
  return (
    <div className="divide-y divide-border">
      {models.map((model) => {
        const active =
          activePinName != null && activePinName === model.name && model.downloaded
            ? "active"
            : autoPickName != null && autoPickName === model.name && model.downloaded
              ? "auto-picked"
              : undefined;
        return (
          <SttModelRow
            key={model.name}
            model={model}
            hardware={hardware}
            activeBadge={active}
            showSetActive={showSetActive}
            onSetActive={onSetActive}
            onDownload={onDownload}
            onDelete={onDelete}
            deleting={deleting}
            downloadingModels={downloadingModels}
            pausedModels={pausedModels}
            modelDownloadProgress={modelDownloadProgress}
            pauseModel={pauseModel}
            resumeModel={resumeModel}
            cancelModel={cancelModel}
          />
        );
      })}
    </div>
  );
}

function ActiveBadge() {
  return <CheckBadge>active</CheckBadge>;
}