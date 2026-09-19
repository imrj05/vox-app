import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Check, Download, Mic, Sparkles, Square, Trash2, Wand2 } from "@/components/icons";
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
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { saveCorrections, saveTranscript } from "@/lib/db";
import {
  deleteRecordingFile,
  deleteTextEnhancementModel,
  deleteWhisperModel,
  downloadTextEnhancementModel,
  getHardwareInfo,
  getNativeStatus,
  getTranscriptionEngines,
  listTextEnhancementModels,
  listWhisperModels,
  startRecording,
  stopRecording,
  transcribeRecording,
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

const MODEL_DESCRIPTIONS: Record<string, string> = {
  "tiny.en": "Fastest, lowest quality. Good for quick tests and very constrained machines.",
  "base.en": "Recommended default. Strong accuracy and real-time on Apple Silicon.",
  "small.en": "Better English accuracy with a moderate speed tradeoff. ~2x slower than base.",
  "medium.en": "Strong quality. ~4x slower than base; needs 8 GB+ RAM.",
  tiny: "Fastest multilingual model. Good for quick tests and non-English dictation.",
  base: "Multilingual base model. Good accuracy for English, Hindi, and other languages.",
  small: "Multilingual small model. Better accuracy across languages with a moderate speed tradeoff.",
  medium: "Multilingual medium model. Strong quality for Hindi/Hinglish and other languages.",
  "large-v3": "Best accuracy, all languages. ~8x slower than base; needs 16 GB+ RAM.",
  "distil-large-v3": "Recommended English upgrade: ~2x faster than large-v3 with near-identical accuracy.",
  "large-v3-turbo": "Near large-v3 accuracy at ~2x the speed. All languages. Needs 8 GB+ RAM.",
  "parakeet-tdt-0.6b-v2": "NVIDIA Parakeet. Top English accuracy with automatic punctuation and capitalization.",
  "parakeet-tdt-0.6b-v3": "NVIDIA Parakeet multilingual. Strong English plus 25 European languages.",
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
    hint: "Uses the Whisper model pinned in the library below.",
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
          const fallback =
            m.find((model) => model.downloaded && model.recommended) ??
            m.find((model) => model.downloaded);
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
        const fallback =
          updated.find((m) => m.downloaded && m.recommended) ??
          updated.find((m) => m.downloaded);
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
            status.windowTitle,
            status.previewText
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
  const selectedEngineCard =
    ENGINE_CARDS.find((option) => option.value === engine) ?? ENGINE_CARDS[0];
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
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
                <span className={cn("h-1.5 w-1.5 rounded-full", nativeStatus ? "bg-primary" : "bg-muted-foreground/35")} />
                {nativeStatus ? "Engine ready" : "Engine not checked"}
              </span>
            </div>
          </header>

          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* 1 — Engine selection: the control that decides which model runs */}
          <section className="panel p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Mic className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-medium text-foreground">Transcription engine</h2>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  All engines run locally on your device. The model library below follows your selection.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
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
                const selected = engine === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => void setEngine(option.value)}
                    disabled={unavailable}
                    aria-pressed={selected}
                    title={unavailable ? (status?.reason ?? undefined) : undefined}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-left transition-colors",
                      selected
                        ? "border-primary/45 bg-primary/[0.07] text-foreground"
                        : "border-border bg-background text-foreground hover:border-foreground/25 hover:bg-muted/40",
                      unavailable && "cursor-not-allowed opacity-45 hover:border-border hover:bg-background"
                    )}
                  >
                    <span className="text-sm font-medium">{option.label}</span>
                    {option.value !== "auto" && status ? (
                      <span className="inline-flex items-center" title={status.available ? "Ready" : needsModel ? "Model needed — download one below" : status.reason ?? "Unavailable"}>
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            status.available ? "bg-primary" : needsModel ? "bg-muted-foreground/50" : "bg-destructive/60"
                          )}
                          aria-hidden="true"
                        />
                        <span className="sr-only">
                          {status.available ? "Ready" : needsModel ? "Model needed" : "Unavailable"}
                        </span>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {selectedEngineCard.description}{" "}
              <span className="text-muted-foreground">{selectedEngineCard.hint}</span>
            </p>
            {hardware && (
              <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  {hardware.appleSilicon ? "Apple Silicon" : hardware.arch}
                </span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  {formatBytes(hardware.totalMemoryBytes).replace("~", "")} RAM
                </span>
                <span className="capitalize">{hardware.tier} tier</span>
                <span aria-hidden="true">·</span>
                <span>models up to {formatBytes(hardware.maxRecommendedModelBytes)} recommended</span>
              </p>
            )}
          </section>

          {/* 2 — Quick dictation: test the engine → model chain end-to-end */}
          <section className="panel px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Wand2 className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-medium text-foreground">Quick dictation</h2>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {activeModelLabel(engine, selectedModel, models)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    Test the current engine and model end-to-end.{" "}
                    <span className="tabular-nums">{quickStatus}.</span>
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
              <p className="mt-3 line-clamp-3 rounded-lg bg-muted/40 px-4 py-3 text-sm leading-6 text-foreground/90">
                {transcriptionResult.text}
              </p>
            )}
          </section>

          {/* 3 — Dictation models: one panel per engine family, never mixed */}
          <section className="space-y-4">
            <SectionHeader
              icon={<Mic className="h-4 w-4" />}
              title="Dictation models"
              description={
                engine === "apple"
                  ? "Apple Speech needs no model — it ships with macOS."
                  : "Speech-to-text models used while you dictate. Each engine family keeps its own library."
              }
              meta={loading ? undefined : libraryMeta}
            />

            {loading ? (
              <div className="flex items-center gap-3 panel px-5 py-6 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Loading models
              </div>
            ) : engine === "apple" ? (
              <div className="panel flex flex-col items-center gap-2 border-dashed px-6 py-12 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <Sparkles className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">Apple Speech needs no model</p>
                <p className="max-w-md text-xs leading-5 text-muted-foreground">
                  Vox uses the speech recognizers built into macOS — on-device, ready out of
                  the box, and updated by macOS itself. Switch the engine above to Whisper or
                  Parakeet to manage downloadable models.
                </p>
              </div>
            ) : models.length > 0 ? (
              <>
                {(engine === "whisper" || engine === "auto") && (
                  <ModelPanel
                    title="Whisper"
                    description={
                      engine === "auto"
                        ? "Used when Automatic routes your speech to Whisper. Pin one model."
                        : "The pinned model is what every transcription uses. Download alternatives to switch instantly."
                    }
                    nudge={
                      engine === "whisper" && !whisperLibrary.some((model) => model.downloaded)
                        ? "No Whisper model is downloaded yet — download one below; it becomes the active model automatically."
                        : undefined
                    }
                  >
                    <SttModelRows
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
                  </ModelPanel>
                )}
                {(engine === "parakeet" || engine === "auto") && (
                  <ModelPanel
                    title="Parakeet"
                    description={
                      engine === "auto"
                        ? "Used for English when installed — the newest download is picked automatically."
                        : "Parakeet automatically uses the newest downloaded model (v3 first), so manage downloads rather than pinning."
                    }
                    nudge={
                      engine === "parakeet" && !activeParakeet
                        ? "No Parakeet model is downloaded yet — download one to switch this engine on."
                        : undefined
                    }
                  >
                    <SttModelRows
                      models={parakeetLibrary}
                      hardware={hardware}
                      showSetActive={false}
                      autoPickName={activeParakeet?.name}
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
                  </ModelPanel>
                )}
              </>
            ) : (
              <div className="panel border-dashed px-5 py-10 text-center">
                <p className="text-sm font-medium text-foreground">No models available</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open the desktop app to load local model availability.
                </p>
              </div>
            )}
          </section>

          {/* 4 — Enhancement model: a separate language model, clearly apart */}
          <section className="space-y-4">
            <SectionHeader
              icon={<Sparkles className="h-4 w-4" />}
              title="Enhancement model"
              description="Powers the Enhance icon, AI cleanup, and transforms. This is a language model that rewrites text after dictation — it never transcribes audio, and it is separate from the dictation models above."
            />
            {enhancementLoading ? (
              <div className="flex items-center gap-3 panel px-5 py-6 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Loading enhancement model
              </div>
            ) : enhancementModels.length > 0 ? (
              <ModelPanel title="On-device LLM" description="Runs fully on your device, after dictation.">
                <div className="divide-y divide-border/70">
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
                      <ModelRow
                        key={model.name}
                        name={model.displayName}
                        description="Local Qwen2.5 instruct model for rewriting, cleanup, and transforms."
                        sizeBytes={model.size}
                        state={
                          isActive
                            ? { kind: "active", label: "Active" }
                            : model.downloaded
                              ? { kind: "downloaded", label: "Downloaded" }
                              : { kind: "none", label: "Not downloaded" }
                        }
                        recommended={model.recommended && !isActive}
                        isDeleting={isDeleting}
                        progress={
                          isDownloading ? (
                            <DownloadProgress pct={pct} downloadedMB={downloadedMB} totalMB={totalMB} />
                          ) : undefined
                        }
                        actions={
                          model.downloaded ? (
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
                              <DeleteButton
                                label={`Delete ${model.displayName}`}
                                busy={isDeleting}
                                disabled={enhancementDownloading !== null}
                                confirm={{
                                  title: "Delete model?",
                                  description: (
                                    <>
                                      Remove <span className="font-medium text-foreground">{model.displayName}</span> from this device. The Enhance icon and AI cleanup will stop working until you re-download it.
                                    </>
                                  ),
                                  onDelete: () => void handleEnhancementDelete(model.name),
                                }}
                              />
                            </>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => void handleEnhancementDownload(model.name)}
                              disabled={enhancementDownloading !== null}
                            >
                              {isDownloading ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                              {isDownloading ? "Downloading…" : "Download"}
                            </Button>
                          )
                        }
                      />
                    );
                  })}
                </div>
              </ModelPanel>
            ) : (
              <div className="panel border-dashed px-5 py-10 text-center">
                <p className="text-sm font-medium text-foreground">No enhancement model available</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open the desktop app to load local enhancement model availability.
                </p>
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

/** Section opener: icon tile, title, one-line description, optional meta. */
function SectionHeader({
  icon,
  title,
  description,
  meta,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  meta?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      {meta && (
        <p className="shrink-0 pt-1 text-[11px] tabular-nums text-muted-foreground">{meta}</p>
      )}
    </div>
  );
}

/** Panel with a quiet header, wrapping one family of model rows. */
function ModelPanel({
  title,
  description,
  nudge,
  children,
}: {
  title: string;
  description: string;
  nudge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border/70 px-5 py-3.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      {nudge && (
        <div className="border-b border-border/70 bg-primary/[0.05] px-5 py-2.5 text-xs leading-5 text-foreground">
          {nudge}
        </div>
      )}
      {children}
    </div>
  );
}

/** Speech-to-text rows for one engine family. */
function SttModelRows({
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
}) {
  if (models.length === 0) {
    return (
      <div className="px-5 py-6 text-center">
        <p className="text-xs text-muted-foreground">No models in this family.</p>
      </div>
    );
  }
  return (
    <div className="divide-y divide-border/70">
      {models.map((model) => {
        const isActive =
          activePinName != null && activePinName === model.name && model.downloaded;
        const isAutoPicked =
          autoPickName != null && autoPickName === model.name && model.downloaded;
        const isDownloading = downloadingModels.includes(model.name);
        const isPaused = pausedModels.includes(model.name);
        const isDeleting = deleting === model.name;
        const dl = modelDownloadProgress[model.name];
        const pct = isDownloading && dl && dl.total > 0 ? Math.round((dl.downloaded / dl.total) * 100) : null;
        const downloadedMB = dl ? Math.round(dl.downloaded / 1024 / 1024) : 0;
        const totalMB = dl ? Math.round(dl.total / 1024 / 1024) : 0;
        // Hardware-aware recommendation (spec §25): only nudge toward models
        // this Mac can actually hold, and only for not-yet-downloaded ones.
        const fitsHardware =
          hardware !== null && model.size <= hardware.maxRecommendedModelBytes;
        const parakeet = isParakeetModel(model.name);

        return (
          <ModelRow
            key={model.name}
            name={model.displayName}
            description={MODEL_DESCRIPTIONS[model.name]}
            sizeBytes={model.size}
            highlight={isActive || isAutoPicked}
            state={
              isActive
                ? { kind: "active", label: "Active" }
                : isAutoPicked
                  ? { kind: "active", label: "Auto-picked" }
                  : model.downloaded
                    ? { kind: "downloaded", label: "Downloaded" }
                    : { kind: "none", label: "Not downloaded" }
            }
            recommended={model.recommended && !isActive && !isAutoPicked}
            fitsHardware={fitsHardware && !model.downloaded && !isActive && !isAutoPicked}
            isDeleting={isDeleting}
            progress={
              isDownloading ? (
                <DownloadProgress pct={pct} downloadedMB={downloadedMB} totalMB={totalMB} />
              ) : undefined
            }
            actions={
              model.downloaded ? (
                <>
                  {showSetActive && !isActive && !isAutoPicked && onSetActive && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onSetActive(model.name)}
                      disabled={isDeleting}
                    >
                      Set active
                    </Button>
                  )}
                  <DeleteButton
                    label={`Delete ${model.displayName}`}
                    busy={isDeleting}
                    disabled={downloadingModels.length > 0}
                    confirm={{
                      title: "Delete model?",
                      description: (
                        <>
                          Remove <span className="font-medium text-foreground">{model.displayName}</span> from this device.{" "}
                          {parakeet
                            ? "Parakeet will fall back to another downloaded Parakeet model, or to Apple Speech if none remain."
                            : isActive
                              ? "Vox will switch back to base.en after deletion."
                              : "This deletes the local model file, not just the entry in Vox."}
                        </>
                      ),
                      onDelete: () => onDelete(model.name),
                    }}
                  />
                </>
              ) : isDownloading ? (
                <>
                  <Button variant="ghost" size="sm" onClick={() => void (isPaused ? resumeModel?.(model.name) : pauseModel?.(model.name))}>
                    {isPaused ? "Resume" : "Pause"}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => void cancelModel?.(model.name)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => onDownload(model.name)} disabled={downloadingModels.length > 0}>
                  <Download className="h-4 w-4" />
                  Download
                </Button>
              )
            }
          />
        );
      })}
    </div>
  );
}

/** Visual state of a model row's status chip. */
type ModelState =
  | { kind: "active"; label: string }
  | { kind: "downloaded"; label: string }
  | { kind: "none"; label: string };

/** Shared model row: name + chips, one description line, size, actions. */
function ModelRow({
  name,
  description,
  sizeBytes,
  state,
  recommended,
  fitsHardware,
  highlight,
  isDeleting,
  progress,
  actions,
}: {
  name: string;
  description?: string;
  sizeBytes: number;
  state: ModelState;
  recommended?: boolean;
  fitsHardware?: boolean;
  highlight?: boolean;
  isDeleting?: boolean;
  progress?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <article
      className={cn(
        "px-5 py-4 transition-colors",
        highlight ? "bg-primary/[0.04]" : "hover:bg-muted/30"
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">{name}</p>
            {state.kind === "active" && <ActiveChip>{state.label}</ActiveChip>}
            {recommended && <QuietChip>Recommended</QuietChip>}
            {fitsHardware && (
              <QuietChip title="Fits this Mac's memory budget comfortably">Fits your Mac</QuietChip>
            )}
          </div>
          {description && (
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{description}</p>
          )}
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] tabular-nums text-muted-foreground">
            <span>{formatBytes(sizeBytes)}</span>
            <span aria-hidden="true">·</span>
            <span>{isDeleting ? "Removing…" : state.label}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
      </div>
      {progress}
    </article>
  );
}

/** Primary-tinted chip for the model currently in use. */
function ActiveChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
      <Check className="h-3 w-3" aria-hidden="true" />
      {children}
    </span>
  );
}

/** Muted chip for advisory metadata (recommended, fits your Mac). */
function QuietChip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
    >
      {children}
    </span>
  );
}

/** Ghost trash button with confirmation — destructive actions stay quiet. */
function DeleteButton({
  label,
  busy,
  disabled,
  confirm,
}: {
  label: string;
  busy: boolean;
  disabled?: boolean;
  confirm: {
    title: string;
    description: React.ReactNode;
    onDelete: () => void;
  };
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          title={label}
          disabled={busy || disabled}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          {busy ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirm.onDelete}>
            Delete model
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
      <div className="flex items-center justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>
          {pct !== null ? `${downloadedMB} MB / ${totalMB} MB` : "Connecting…"}
        </span>
        {pct !== null && <span>{pct}%</span>}
      </div>
    </div>
  );
}
