import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AppleLogo, Check, Download, Mic, Sparkles, Square, Trash2, Wand2 } from "@/components/icons";
import {
  AlertDialog,
  AlertDialogClose,
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

/** One-line description per model, phrased for the Models page. */
const MODEL_DESCRIPTIONS: Record<string, string> = {
  "parakeet-ultra":
    "Parakeet TDT v3 further trained by Moondream for fewer mistakes, with punctuation, the same 25 European languages and the same speed.",
  "parakeet-tdt-0.6b-v3":
    "NVIDIA's multilingual model for 25 European languages, with punctuation. Fast on the Neural Engine.",
  "parakeet-tdt-0.6b-v2":
    "NVIDIA's English-only model, tuned for English accuracy, with punctuation.",
  "parakeet-tdt_ctc-110m":
    "A small English-only model for Macs with less memory to spare.",
  "large-v3-turbo":
    "Broadest language coverage, including languages Parakeet does not support.",
  "large-v3-turbo-q5_0":
    "The languages of Whisper Large v3 Turbo in a compressed build that takes less disk space.",
  small: "A lighter multilingual Whisper model with a smaller download.",
};

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
      // Downloading never switches dictation: Apple stays active until the
      // user picks the new model explicitly with Use.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes("cancelled")) {
        setError(message);
      }
    }
  };

  /** Apple needs no model file, so using it only changes the engine. */
  const handleUseApple = async () => {
    setError(null);
    try {
      await setEngine("apple");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /**
   * Choosing a model chooses its engine. The pin is written first so a
   * transcription started mid-switch can never run the new engine against the
   * previous model.
   */
  const handleUseModel = async (modelName: string) => {
    setError(null);
    try {
      await setSelectedModel(modelName);
      await setEngine(isParakeetModel(modelName) ? "parakeet" : "whisper");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (modelName: string) => {
    setDeleting(modelName);
    setError(null);
    try {
      await deleteWhisperModel(modelName);
      const updated = await listWhisperModels();
      setModels(updated);
      // Deleting the active model returns dictation to Apple on-device: it
      // needs no model on disk, so it is always a working destination.
      if (selectedModel === modelName && engine !== "apple") {
        await setEngine("apple");
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
            engine === "whisper" || engine === "parakeet" ? selectedModel : undefined,
            status.appName,
            status.windowTitle,
            status.previewText,
            status.previewConfidence,
            !status.private
          );
          result.appName = status.appName;
          result.durationSeconds = status.durationSeconds;
          setTranscriptionResult(result);
          await saveTranscript(result.text, undefined, result.appName, result.durationSeconds, undefined, result.asrText ?? null, result.language ?? "en", result.engine ?? null, result.timings ?? null);
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

  // --- One list: Apple first, then Parakeet, then Whisper -------------------
  // The pin names the model of the selected engine family, so a row is active
  // only when both match. Apple has no model file and is active on engine
  // alone.
  const engineStatusFor = (value: string) => engines.find((engineStatus) => engineStatus.id === value);
  const appleStatus = engineStatusFor("apple");
  const appleActive = engine === "apple";
  // Apple can be selectable but unavailable (Speech permission or a missing
  // language pack). Say why instead of silently letting dictation fail later.
  const appleUnavailable = !!appleStatus && !appleStatus.available;
  // The unavailable reason is long; it belongs on the description line, not
  // the metadata line where it would wrap badly.
  const appleDescription = appleUnavailable
    ? appleStatus?.reason ?? "Apple Speech is unavailable on this Mac."
    : "Uses an available macOS language pack. No cloud fallback.";
  // The backend catalog already lists Parakeet before Whisper in display
  // order, so the families are only partitioned, never re-sorted.
  const parakeetLibrary = models.filter((model) => isParakeetModel(model.name));
  const whisperLibrary = models.filter((model) => !isParakeetModel(model.name));
  const allModels = [...parakeetLibrary, ...whisperLibrary];
  const downloadedModels = models.filter((model) => model.downloaded);
  const totalDownloadedSize = downloadedModels.reduce((sum, model) => sum + model.size, 0);
  const libraryMeta = `${downloadedModels.length} of ${models.length} downloaded · ${formatBytes(totalDownloadedSize)} stored`;
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
                Apple Speech works out of the box. Download any other model to switch dictation to it — one model runs at a time.
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

          {/* 2 — Dictation models: Apple first, then downloadable models */}
          <section className="space-y-4">
            <SectionHeader
              icon={<Mic className="h-4 w-4" />}
              title="On this Mac"
              description="Apple Speech ships with macOS and works immediately. Download another model to run dictation on it — choosing a model chooses its engine, and only one model is active at a time. Every model transcribes on this Mac; the network is used only to download one."
              meta={loading ? undefined : libraryMeta}
            />

            {loading ? (
              <div className="flex items-center gap-3 panel px-5 py-6 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Loading models
              </div>
            ) : (
              <div className="panel overflow-hidden">
                <div className="divide-y divide-border/70">
                  <ModelRow
                    name="Apple on-device"
                    icon={<AppleLogo className="h-4 w-4" />}
                    description={appleDescription}
                    meta="System managed · System speech"
                    state={
                      appleUnavailable
                        ? { kind: "none", label: "Unavailable" }
                        : appleActive
                          ? { kind: "active", label: "Active" }
                          : { kind: "downloaded", label: "Built in" }
                    }
                    actions={
                      appleActive ? (
                        <ActiveCheck />
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleUseApple()}
                          disabled={appleUnavailable}
                          title={appleUnavailable ? (appleStatus?.reason ?? undefined) : undefined}
                        >
                          Use
                        </Button>
                      )
                    }
                  />

                  {allModels.map((model) => {
                    const parakeet = isParakeetModel(model.name);
                    const rowEngine = parakeet ? "parakeet" : "whisper";
                    const isActive =
                      engine === rowEngine && selectedModel === model.name && model.downloaded;
                    const isDownloading = downloadingModels.includes(model.name);
                    const isPaused = pausedModels.includes(model.name);
                    const isDeleting = deleting === model.name;
                    const dl = modelDownloadProgress[model.name];
                    const pct =
                      isDownloading && dl && dl.total > 0
                        ? Math.round((dl.downloaded / dl.total) * 100)
                        : null;
                    const downloadedMB = dl ? Math.round(dl.downloaded / 1024 / 1024) : 0;
                    const totalMB = dl ? Math.round(dl.total / 1024 / 1024) : 0;
                    const status = engineStatusFor(rowEngine);
                    // A missing model is fixable on this page, so it must never
                    // block selection. Only a broken runtime is truly unusable.
                    const needsModel =
                      !!status && !status.available && /no .+ model/i.test(status.reason ?? "");
                    const unusable = !!status && !status.available && !needsModel;
                    // Hardware-aware nudge (spec §25): only for models this Mac
                    // can hold, and only before they are downloaded.
                    const fitsHardware =
                      hardware !== null && model.size <= hardware.maxRecommendedModelBytes;

                    return (
                      <ModelRow
                        key={model.name}
                        name={model.displayName}
                        icon={<Mic className="h-4 w-4" />}
                        description={MODEL_DESCRIPTIONS[model.name]}
                        meta={`${formatBytes(model.size)} · ${parakeet ? "Parakeet" : "Whisper"} · ${parakeet ? "Neural Engine" : "Apple Silicon"}`}
                        state={
                          isActive
                            ? { kind: "active", label: "Active" }
                            : model.downloaded
                              ? { kind: "downloaded", label: "Downloaded" }
                              : { kind: "none", label: "Not downloaded" }
                        }
                        recommended={model.recommended && !isActive}
                        fitsHardware={fitsHardware && !model.downloaded && !isActive}
                        isDeleting={isDeleting}
                        progress={
                          isDownloading ? (
                            <DownloadProgress
                              pct={pct}
                              downloadedMB={downloadedMB}
                              totalMB={totalMB}
                            />
                          ) : undefined
                        }
                        actions={
                          model.downloaded ? (
                            <>
                              {isActive ? (
                                <ActiveCheck />
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void handleUseModel(model.name)}
                                  disabled={isDeleting || unusable}
                                  title={unusable ? (status?.reason ?? undefined) : undefined}
                                >
                                  Use
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
                                      {isActive
                                        ? "Vox switches back to Apple on-device after deletion."
                                        : "This deletes the local model file, not just the entry in Vox."}
                                    </>
                                  ),
                                  onDelete: () => void handleDelete(model.name),
                                }}
                              />
                            </>
                          ) : isDownloading ? (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void (isPaused ? resumeModel(model.name) : pauseModel(model.name))}
                              >
                                {isPaused ? "Resume" : "Pause"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => void cancelModel(model.name)}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => void handleDownload(model.name)}
                              disabled={downloadingModels.length > 0}
                            >
                              <Download className="h-4 w-4" />
                              Download
                            </Button>
                          )
                        }
                      />
                    );
                  })}
                </div>
                <p className="border-t border-border/70 px-5 py-3 text-[11px] leading-5 text-muted-foreground">
                  These models process audio on your Mac. Parakeet and Whisper need an
                  internet connection only for installation.
                </p>
                {hardware && (
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/70 px-5 py-3 text-[11px] text-muted-foreground">
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
              </div>
            )}
          </section>

          {/* 3 — Enhancement model: a separate language model, clearly apart */}
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

/** Visual state of a model row's status chip. */
type ModelState =
  | { kind: "active"; label: string }
  | { kind: "downloaded"; label: string }
  | { kind: "none"; label: string };

/** Shared model row: name + chips, one description line, size, actions. */
function ModelRow({
  name,
  icon,
  description,
  meta,
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
  icon?: React.ReactNode;
  description?: string;
  /** Replaces the default "size · state" line (e.g. Apple's "System managed"). */
  meta?: string;
  sizeBytes?: number;
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
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              {icon}
            </span>
          )}
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
              {meta ? (
                <span>{isDeleting ? "Removing…" : meta}</span>
              ) : (
                <>
                  <span>{formatBytes(sizeBytes ?? 0)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{isDeleting ? "Removing…" : state.label}</span>
                </>
              )}
            </p>
          </div>
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

/** Checkmark standing in for the action button on the active model. */
function ActiveCheck() {
  return (
    <span
      className="flex h-8 w-8 items-center justify-center text-primary"
      title="This model is in use"
    >
      <Check className="h-5 w-5" aria-hidden="true" />
      <span className="sr-only">Active model</span>
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
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            title={label}
            disabled={busy || disabled}
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          />
        }
      >
        {busy ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <AlertDialogClose
            render={<Button variant="destructive" />}
            onClick={confirm.onDelete}
          >
            Delete model
          </AlertDialogClose>
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
