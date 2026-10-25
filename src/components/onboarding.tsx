import { useCallback, useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  CheckCircle2,
  Download,
  Keyboard,
  Mic,
  ShieldCheck,
  Sparkles,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  checkAccessibilityPermission,
  checkMicrophonePermission,
  checkSpeechPermission,
  listWhisperModels,
  microphoneAuthorizationStatus,
  requestAccessibilityPermission,
  requestMicrophonePermission,
  requestSpeechPermission,
  formatShortcut,
  type WhisperModelInfo,
} from "@/lib/native";
import { useAppStore } from "@/store/app-store";

interface DownloadProgress {
  modelName: string;
  downloaded: number;
  total: number;
}

/**
 * Downloadable alternatives to Apple on-device, in the same order and with the
 * same names as the Models page catalog. Every entry must exist in
 * `src-tauri/src/whisper.rs` — setup downloads by name.
 */
const ONBOARDING_MODELS = [
  { name: "parakeet-ultra",      displayName: "Parakeet Ultra",   size: "~706 MB", family: "Parakeet", recommended: true },
  { name: "parakeet-tdt-0.6b-v3", displayName: "Parakeet v3",     size: "~705 MB", family: "Parakeet" },
  { name: "parakeet-tdt-0.6b-v2", displayName: "Parakeet v2",     size: "~696 MB", family: "Parakeet" },
  { name: "parakeet-tdt_ctc-110m", displayName: "Parakeet 110M",  size: "~129 MB", family: "Parakeet" },
  { name: "large-v3-turbo",      displayName: "Whisper Turbo",    size: "~1.51 GB", family: "Whisper" },
  { name: "large-v3-turbo-q5_0", displayName: "Whisper Turbo (compressed)", size: "~547 MB", family: "Whisper" },
  { name: "small",               displayName: "Whisper Small",    size: "~465 MB", family: "Whisper" },
];

type Step = "accessibility" | "permission" | "model" | "hotkey";

export function Onboarding() {
  const {
    setOnboardingComplete,
    hotkey,
    setEngine,
    setSelectedModel,
    downloadingModels,
    pausedModels,
    modelDownloadProgress,
    downloadModel: downloadModelFromStore,
    pauseModel,
    resumeModel,
    cancelModel,
  } = useAppStore();
  const [step, setStep] = useState<Step>("accessibility");
  const [accessibilityReady, setAccessibilityReady] = useState(false);
  const [permissionReady, setPermissionReady] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [hotkeyReady, setHotkeyReady] = useState(false);
  const [busy, setBusy] = useState(false);
  // Speech Recognition access: required only by the built-in Apple engine.
  const [speechReady, setSpeechReady] = useState(false);
  // `null` = Apple on-device (built in, nothing to download); a name = a
  // downloadable Whisper or Parakeet model.
  const [chosenModel, setChosenModel] = useState<string | null>(null);
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [hotkeyMessage, setHotkeyMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The model step is satisfied by Apple on-device as soon as Speech
   * Recognition is allowed — there is nothing to download. Without that
   * permission the user has to pick a downloadable model instead, so the step
   * opens on the model chooser.
   */
  const continueAfterPermissions = useCallback(async () => {
    const speech = speechReady || (await checkSpeechPermission().catch(() => false));
    if (speech) {
      setSpeechReady(true);
      setModelReady(true);
      setStep("hotkey");
    } else {
      setStep("model");
    }
  }, [speechReady]);

  // Check permissions on mount — auto-advance to whichever grant is missing.
  useEffect(() => {
    const check = async () => {
      const trusted = await checkAccessibilityPermission();
      if (!trusted) return;
      setAccessibilityReady(true);
      const microphoneReady = await checkMicrophonePermission();
      if (!microphoneReady) {
        setStep("permission");
        return;
      }
      setPermissionReady(true);
      await continueAfterPermissions();
    };
    void check();
  }, [continueAfterPermissions]);

  // Downloadable models drive whether the chosen model still needs a download.
  useEffect(() => {
    let active = true;
    void listWhisperModels()
      .then((list) => { if (active) setModels(list); })
      .catch(() => { if (active) setModels([]); });
    return () => { active = false; };
  }, []);

  // Poll for accessibility grant while on that step
  useEffect(() => {
    if (step !== "accessibility" || accessibilityReady) return;
    const interval = setInterval(async () => {
      const trusted = await checkAccessibilityPermission();
      if (trusted) {
        setAccessibilityReady(true);
        setStep("permission");
        clearInterval(interval);
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [step, accessibilityReady]);

  // Poll for mic grant while on permission step (user may grant via System Settings)
  useEffect(() => {
    if (step !== "permission" || permissionReady) return;
    const interval = setInterval(async () => {
      const microphoneReady = await checkMicrophonePermission();
      if (microphoneReady) {
        setPermissionReady(true);
        clearInterval(interval);
        await continueAfterPermissions();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [step, permissionReady, continueAfterPermissions]);

  // Poll Speech Recognition while Apple is chosen and the grant is pending:
  // a user who answers the prompt late, or grants it in System Settings,
  // advances without touching anything here.
  useEffect(() => {
    if (step !== "model" || speechReady || chosenModel !== null) return;
    const interval = setInterval(async () => {
      const granted = await checkSpeechPermission().catch(() => false);
      if (granted) {
        setSpeechReady(true);
        clearInterval(interval);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [step, speechReady, chosenModel]);

  // Listen for download progress events
  // (handled globally in App.tsx and persisted to the store)

  // Detect the configured hotkey on the hotkey step
  useEffect(() => {
    if (step !== "hotkey") return;
    let unlisten: (() => void) | undefined;
    void listen("vox-hotkey-pressed", () => {
      setHotkeyReady(true);
      setHotkeyMessage("Hot-key registered automatically");
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    const parts = hotkey.split("+");
    const onKeyDown = (event: KeyboardEvent) => {
      const metaRequired = parts.includes("Meta");
      const shiftRequired = parts.includes("Shift");
      const ctrlRequired = parts.includes("Ctrl") || parts.includes("Control");
      const altRequired = parts.includes("Alt") || parts.includes("AltLeft") || parts.includes("AltRight");
      const keyPart = parts[parts.length - 1];

      const metaOk = metaRequired ? event.metaKey : !event.metaKey;
      const shiftOk = shiftRequired ? event.shiftKey : !event.shiftKey;
      const ctrlOk = ctrlRequired ? event.ctrlKey : !event.ctrlKey;
      const altOk = altRequired ? event.altKey : !event.altKey;

      const codeMatch =
        event.code === keyPart ||
        event.code === `Key${keyPart}` ||
        event.key === keyPart ||
        (keyPart === "Space" && event.code === "Space");

      if (metaOk && shiftOk && ctrlOk && altOk && codeMatch) {
        event.preventDefault();
        setHotkeyReady(true);
        setHotkeyMessage("Hot-key registered automatically");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unlisten?.();
    };
  }, [step, hotkey]);

  const grantAccessibility = async () => {
    setBusy(true);
    setError(null);
    try {
      // This opens System Settings and returns current state
      const trusted = await requestAccessibilityPermission();
      if (trusted) {
        setAccessibilityReady(true);
        setStep("permission");
      }
      // If not yet trusted, the polling useEffect above will detect it
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * The macOS prompt is answered asynchronously: `requestMicrophonePermission`
   * returns as soon as the audio stream starts, which is typically before the
   * user has clicked anything. Poll the real TCC state instead of concluding
   * "not granted" from a check that ran a moment too early.
   */
  const awaitMicrophoneDecision = async (timeoutMs = 6000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await microphoneAuthorizationStatus().catch(() => 0);
      if (status === 3) return "granted" as const;
      // 1 = restricted, 2 = denied: macOS never re-prompts, so stop waiting.
      if (status === 1 || status === 2) return "denied" as const;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return "pending" as const;
  };

  const requestPermission = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestMicrophonePermission();
      const outcome = await awaitMicrophoneDecision();
      if (outcome === "granted") {
        setPermissionReady(true);
        // Speech Recognition may already be granted, in which case the built-in
        // Apple model needs nothing else and setup skips straight ahead.
        await continueAfterPermissions();
      } else if (outcome === "denied") {
        setError(
          "Microphone access was denied. Open System Settings → Privacy & Security → Microphone and enable Vox."
        );
      } else {
        // Still unanswered — not a failure. The poller keeps watching.
        setError(
          "Waiting for macOS to confirm microphone access. If no prompt appeared, open System Settings → Privacy & Security → Microphone and enable Vox — this screen advances automatically."
        );
      }
    } catch {
      setError(
        "Microphone access was denied. Open System Settings → Privacy & Security → Microphone and enable Vox."
      );
    } finally {
      setBusy(false);
    }
  };

  const completeModelStep = () => {
    setModelReady(true);
    setStep("hotkey");
  };

  /** Apple on-device: the only thing standing between the user and dictation is one permission. */
  const allowSpeechRecognition = async () => {
    setBusy(true);
    setError(null);
    try {
      const granted = await requestSpeechPermission();
      if (granted) {
        setSpeechReady(true);
        await setEngine("apple");
        completeModelStep();
      } else {
        setError(
          "Speech Recognition wasn't allowed yet. Choose Allow on the prompt, or enable Vox in System Settings → Privacy & Security → Speech Recognition — this screen updates automatically. You can also download a model below to dictate without it."
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const pinModel = async (name: string) => {
    await setSelectedModel(name);
    // Choosing a model chooses its engine, matching the Models page.
    await setEngine(name.startsWith("parakeet") ? "parakeet" : "whisper");
  };

  const downloadAndUseModel = async (name: string) => {
    setError(null);
    try {
      const already = models.find((m) => m.name === name);
      if (!already?.downloaded) {
        await downloadModelFromStore(name);
      }
      await pinModel(name);
      setModels(await listWhisperModels());
      completeModelStep();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes("cancelled")) {
        setError(message);
      }
    }
  };

  // One action for the whole step: Apple asks for permission, a model downloads
  // (or is used straight away when it is already cached).
  const handleModelAction = async () => {
    if (chosenModel === null) {
      if (speechReady) {
        await setEngine("apple");
        completeModelStep();
      } else {
        await allowSpeechRecognition();
      }
      return;
    }
    setBusy(true);
    try {
      await downloadAndUseModel(chosenModel);
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    setOnboardingComplete(true);
  };

  const appleChoice = chosenModel === null;
  const chosenModelInfo = chosenModel ? models.find((m) => m.name === chosenModel) : undefined;
  const chosenDownloaded = !!chosenModelInfo?.downloaded;
  const chosenLabel = appleChoice
    ? "Apple on-device"
    : chosenModelInfo?.displayName ??
      ONBOARDING_MODELS.find((m) => m.name === chosenModel)?.displayName ??
      "the selected model";

  const setupSteps = [
    { id: "accessibility" as const, title: "Accessibility", done: accessibilityReady },
    { id: "permission" as const, title: "Microphone", done: permissionReady },
    { id: "model" as const, title: "Speech model", done: modelReady },
    { id: "hotkey" as const, title: "Hotkey test", done: hotkeyReady },
  ];
  const activeStepIndex = setupSteps.findIndex((item) => item.id === step);
  const completedCount = setupSteps.filter((item) => item.done).length;
  const downloadProgress =
    chosenModel && modelDownloadProgress[chosenModel]
      ? { modelName: chosenModel, ...modelDownloadProgress[chosenModel] }
      : null;
  const isDownloadingModel =
    !!chosenModel && ((busy && step === "model") || downloadingModels.includes(chosenModel));
  const canFinish = accessibilityReady && permissionReady && modelReady && hotkeyReady;
  const modelActionLabel = appleChoice
    ? speechReady
      ? "Continue"
      : "Allow speech"
    : chosenDownloaded
      ? `Use ${chosenLabel}`
      : isDownloadingModel && downloadProgress
        ? `${Math.round((downloadProgress.downloaded / downloadProgress.total) * 100)}% downloaded`
        : isDownloadingModel
          ? "Downloading..."
          : "Download model";

  return (
    <div className="flex h-full overflow-hidden bg-background px-6 pb-5 pt-11">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col">
        <header className="mb-4 flex shrink-0 items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Vox setup
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              Set up voice to text
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Step {Math.max(activeStepIndex + 1, 1)} of {setupSteps.length}. Everything stays local.
            </p>
          </div>
          <div className="hidden rounded-xl border border-border bg-card px-4 py-2 text-right sm:block">
            <p className="font-mono text-xl font-semibold text-foreground">
              {completedCount}/{setupSteps.length}
            </p>
            <p className="text-[11px] text-muted-foreground">complete</p>
          </div>
        </header>

        <div className="grid shrink-0 grid-cols-4 gap-2">
          {setupSteps.map((item, index) => (
            <StepRailItem
              key={item.id}
              title={item.title}
              index={index + 1}
              active={item.id === step}
              done={item.done}
            />
          ))}
        </div>

        <main className="mt-4 grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <StepCard
              active={step === "accessibility"}
              done={accessibilityReady}
              icon={<ShieldCheck className="h-5 w-5" />}
              title="Accessibility"
              description="Detect global shortcuts outside Vox."
            >
              {accessibilityReady ? (
                <StatusPill label="Granted" />
              ) : (
                <Button
                  size="sm"
                  onClick={grantAccessibility}
                  disabled={busy && step === "accessibility"}
                >
                  {busy && step === "accessibility" ? "Opening..." : "Grant"}
                </Button>
              )}
            </StepCard>

            <StepCard
              active={step === "permission"}
              done={permissionReady}
              icon={<Mic className="h-5 w-5" />}
              title="Microphone"
              description="Allow local voice capture."
            >
              {permissionReady ? (
                <StatusPill label="Allowed" />
              ) : (
                <Button
                  size="sm"
                  onClick={requestPermission}
                  disabled={busy || !accessibilityReady}
                >
                  {busy && step === "permission" ? "Requesting..." : "Allow"}
                </Button>
              )}
            </StepCard>

            <StepCard
              active={step === "model"}
              done={modelReady}
              icon={<Download className="h-5 w-5" />}
              title="Speech model"
              description={
                appleChoice
                  ? "Apple on-device is built in. Nothing to download."
                  : `Download ${chosenLabel} to dictate with it instead.`
              }
              progress={busy && step === "model" && downloadProgress ? downloadProgress : null}
            >
              {modelReady ? (
                <StatusPill label={appleChoice ? "Built in" : "Cached"} />
              ) : isDownloadingModel && chosenModel ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void (pausedModels.includes(chosenModel)
                        ? resumeModel(chosenModel)
                        : pauseModel(chosenModel))
                    }
                    disabled={!permissionReady}
                  >
                    {pausedModels.includes(chosenModel) ? "Resume" : "Pause"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => void cancelModel(chosenModel)}
                    disabled={!permissionReady}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button size="sm" onClick={handleModelAction} disabled={busy || !permissionReady}>
                  {appleChoice ? <ShieldCheck className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                  {busy && step === "model"
                    ? appleChoice
                      ? "Requesting..."
                      : "Starting..."
                    : appleChoice
                      ? "Allow"
                      : "Download"}
                </Button>
              )}
            </StepCard>

            <StepCard
              active={step === "hotkey"}
              done={hotkeyReady}
              icon={<Keyboard className="h-5 w-5" />}
              title="Hotkey"
              description={`Press ${formatShortcut(hotkey)} to confirm.`}
            >
              <Button
                size="sm"
                variant={hotkeyReady ? "default" : "secondary"}
                disabled={!modelReady}
                onClick={() => setHotkeyReady(true)}
              >
                {hotkeyReady ? "Detected" : "I pressed it"}
              </Button>
            </StepCard>
          </div>

          <div className="min-h-0 rounded-2xl border border-border bg-card p-3">
            {step === "model" && !modelReady ? (
              <div className="grid h-full grid-cols-2 gap-2 overflow-y-auto lg:grid-cols-4">
                <button
                  disabled={busy}
                  onClick={() => setChosenModel(null)}
                  className={cn(
                    "flex min-h-0 flex-col justify-between rounded-xl border p-3 text-left transition-colors",
                    chosenModel === null
                      ? "border-primary bg-sidebar-accent"
                      : "border-border bg-background hover:border-ring"
                  )}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold leading-tight text-foreground">
                        Apple on-device
                      </p>
                      {chosenModel === null && (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                      )}
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      Built in · no download
                    </p>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                      Uses the speech model that ships with macOS.
                    </p>
                  </div>
                  <span className="mt-2 w-fit rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                    recommended
                  </span>
                </button>

                {ONBOARDING_MODELS.map((m) => {
                  const cached = models.find((model) => model.name === m.name)?.downloaded;
                  return (
                    <button
                      key={m.name}
                      disabled={busy}
                      onClick={() => setChosenModel(m.name)}
                      className={cn(
                        "flex min-h-0 flex-col justify-between rounded-xl border p-3 text-left transition-colors",
                        chosenModel === m.name
                          ? "border-primary bg-sidebar-accent"
                          : "border-border bg-background hover:border-ring"
                      )}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold leading-tight text-foreground">
                            {m.displayName}
                          </p>
                          {chosenModel === m.name && (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                          )}
                        </div>
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                          {m.size} · {m.family}
                        </p>
                      </div>
                      {cached ? (
                        <span className="mt-2 w-fit rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          already downloaded
                        </span>
                      ) : (
                        m.recommended && (
                          <span className="mt-2 w-fit rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                            recommended
                          </span>
                        )
                      )}
                    </button>
                  );
                })}
              </div>
            ) : step === "hotkey" ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Current shortcut
                </p>
                <ShortcutDisplay shortcut={hotkey} />
                {hotkeyMessage && (
                  <p className="mt-4 text-sm font-medium text-primary">
                    {hotkeyMessage}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-center">
                <p className="max-w-sm text-sm text-muted-foreground">
                  Complete each setup item above. Vox will move to the next step automatically when permissions are granted.
                </p>
              </div>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-border pt-3">
            <div className="min-w-0">
              {error ? (
                <p className="truncate text-sm text-destructive">{error}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Apple on-device needs no download. You can change the model, hotkey, and
                  system settings later.
                </p>
              )}
            </div>
            <Button
              onClick={step === "model" && !modelReady ? handleModelAction : finish}
              disabled={
                step === "model" && !modelReady
                  ? busy || !permissionReady
                  : !canFinish
              }
              className="shrink-0"
            >
              {step === "model" && !modelReady ? (
                appleChoice && !speechReady ? (
                  <ShieldCheck className="h-4 w-4" />
                ) : (
                  <Download className="h-4 w-4" />
                )
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {step === "model" && !modelReady ? modelActionLabel : "Start dictating"}
            </Button>
          </footer>
        </main>
      </div>
    </div>
  );
}

function StepRailItem({
  title,
  index,
  active,
  done,
}: {
  title: string;
  index: number;
  active: boolean;
  done: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors",
        active ? "bg-sidebar-accent text-foreground" : "text-muted-foreground"
      )}
    >
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
          done
            ? "border-primary bg-primary text-primary-foreground"
            : active
              ? "border-primary text-primary"
              : "border-border"
        )}
      >
        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : index}
      </div>
      <span className={cn(active && "font-medium")}>{title}</span>
    </div>
  );
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary">
      <CheckCircle2 className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function ShortcutDisplay({ shortcut }: { shortcut: string }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
      {shortcut.split("+").map((key, index, keys) => (
        <div key={`${key}-${index}`} className="flex items-center gap-3">
          <kbd className="min-w-14 rounded-xl border border-border bg-background px-4 py-3 text-center font-mono text-xl font-semibold text-foreground">
            {formatShortcut(key)}
          </kbd>
          {index < keys.length - 1 && (
            <span className="font-mono text-xl font-semibold text-muted-foreground">
              +
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function StepCard({
  active,
  done,
  icon,
  title,
  description,
  progress,
  children,
}: {
  active: boolean;
  done: boolean;
  icon: ReactNode;
  title: string;
  description: string;
  progress?: DownloadProgress | null;
  children: ReactNode;
}) {
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.downloaded / progress.total) * 100)
      : null;

  return (
    <div
      className={[
        "flex flex-col gap-2 rounded-xl border p-3 transition-colors",
        active
          ? "border-primary bg-accent"
          : "border-border bg-background",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card text-accent-foreground">
            {done ? (
              <CheckCircle2 className="h-5 w-5 text-primary" />
            ) : (
              icon
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">
              {title}
            </h2>
            <p className="text-xs text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
        <div className="shrink-0">{children}</div>
      </div>

      {pct !== null && (
        <div className="space-y-1 px-1">
          <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            {pct}% — {Math.round((progress?.downloaded ?? 0) / 1024 / 1024)} / {Math.round((progress?.total ?? 0) / 1024 / 1024)} MB
          </p>
        </div>
      )}
    </div>
  );
}
