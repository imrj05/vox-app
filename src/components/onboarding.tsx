import { useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  CheckCircle2,
  Download,
  Keyboard,
  Mic,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  checkAccessibilityPermission,
  downloadWhisperModel,
  listWhisperModels,
  requestAccessibilityPermission,
  requestMicrophonePermission,
  formatShortcut,
} from "@/lib/native";
import { useAppStore, DEFAULT_SELECTED_MODEL } from "@/store/app-store";

interface DownloadProgress {
  modelName: string;
  downloaded: number;
  total: number;
}

const ONBOARDING_MODELS = [
  { name: "tiny.en",   displayName: "Whisper Tiny",            size: "~75 MB",   description: "Fastest, lowest quality. Good for quick tests.",              version: "v1.0" },
  { name: "base.en",   displayName: "Whisper Base",            size: "~150 MB",  description: "Recommended default. Strong accuracy on Apple Silicon.",      version: "v1.0", recommended: true },
  { name: "small.en",  displayName: "Whisper Small",           size: "~500 MB",  description: "Better accuracy, ~2x slower than base.",                      version: "v1.0" },
  { name: "medium.en", displayName: "Whisper Medium",          size: "~1.5 GB",  description: "Strong quality, ~4x slower. Needs 8 GB+ RAM.",               version: "v1.0" },
  { name: "large-v3",  displayName: "Whisper Large v3",        size: "~3.0 GB",  description: "Best accuracy, all languages. Needs 16 GB+ RAM.",            version: "v3.0" },
  { name: "distil-large-v3",  displayName: "Distil-Whisper Large v3", size: "~1.5 GB", description: "~2x faster than large-v3, near-identical accuracy.", version: "v3.0" },
  { name: "large-v3-turbo",   displayName: "Whisper Large v3 Turbo",  size: "~1.5 GB", description: "Near large-v3 accuracy at ~2x speed. Needs 8 GB+ RAM.", version: "v3.0" },
];

type Step = "accessibility" | "permission" | "model" | "hotkey";

export function Onboarding() {
  const { setOnboardingComplete, hotkey, setSelectedModel } = useAppStore();
  const [step, setStep] = useState<Step>("accessibility");
  const [accessibilityReady, setAccessibilityReady] = useState(false);
  const [permissionReady, setPermissionReady] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [hotkeyReady, setHotkeyReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chosenModel, setChosenModel] = useState(DEFAULT_SELECTED_MODEL);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [hotkeyMessage, setHotkeyMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check both permissions on mount — auto-advance if already granted
  useEffect(() => {
    const check = async () => {
      const trusted = await checkAccessibilityPermission();
      if (trusted) {
        setAccessibilityReady(true);
        // Also probe mic — if already granted skip to model step
        try {
          await requestMicrophonePermission();
          setPermissionReady(true);
          setStep("model");
        } catch {
          setStep("permission");
        }
      }
    };
    void check();
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
      try {
        await requestMicrophonePermission();
        setPermissionReady(true);
        setStep("model");
        clearInterval(interval);
      } catch {
        // not yet granted
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [step, permissionReady]);

  // Listen for download progress events
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<DownloadProgress>("vox-download-progress", (event) => {
      setDownloadProgress(event.payload);
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => { unlisten?.(); };
  }, []);

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

  const requestPermission = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestMicrophonePermission();
      setPermissionReady(true);
      setStep("model");
    } catch {
      setError(
        "Microphone access was denied. Open System Settings → Privacy & Security → Microphone and enable Vox."
      );
    } finally {
      setBusy(false);
    }
  };

  const downloadModel = async () => {
    setBusy(true);
    setError(null);
    setDownloadProgress(null);
    try {
      const models = await listWhisperModels();
      const already = models.find((m) => m.name === chosenModel);
      if (!already?.downloaded) {
        await downloadWhisperModel(chosenModel);
      }
      await setSelectedModel(chosenModel);
      setModelReady(true);
      setStep("hotkey");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setDownloadProgress(null);
    }
  };

  const finish = () => {
    setOnboardingComplete(true);
  };

  const setupSteps = [
    { id: "accessibility" as const, title: "Accessibility", done: accessibilityReady },
    { id: "permission" as const, title: "Microphone", done: permissionReady },
    { id: "model" as const, title: "Whisper model", done: modelReady },
    { id: "hotkey" as const, title: "Hotkey test", done: hotkeyReady },
  ];
  const activeStepIndex = setupSteps.findIndex((item) => item.id === step);
  const completedCount = setupSteps.filter((item) => item.done).length;
  const isDownloadingModel = busy && step === "model";
  const canFinish = accessibilityReady && permissionReady && modelReady && hotkeyReady;

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
              title="Whisper model"
              description="Download one local model."
              progress={busy && step === "model" && downloadProgress ? downloadProgress : null}
            >
              {modelReady ? (
                <StatusPill label="Cached" />
              ) : (
                <Button size="sm" onClick={downloadModel} disabled={busy || !permissionReady}>
                  {busy && step === "model"
                    ? downloadProgress
                      ? `${Math.round((downloadProgress.downloaded / downloadProgress.total) * 100)}%`
                      : "Downloading..."
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
              <div className="grid h-full grid-cols-2 gap-2 lg:grid-cols-4">
                {ONBOARDING_MODELS.map((m) => (
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
                        {m.size} · {m.version}
                      </p>
                    </div>
                    {m.recommended && (
                      <span className="mt-2 w-fit rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                        recommended
                      </span>
                    )}
                  </button>
                ))}
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
                  You can change model, hotkey, and system settings later.
                </p>
              )}
            </div>
            <Button
              onClick={step === "model" && !modelReady ? downloadModel : finish}
              disabled={
                step === "model" && !modelReady
                  ? busy || !permissionReady
                  : !canFinish
              }
              className="shrink-0"
            >
              {step === "model" && !modelReady ? (
                <Download className="h-4 w-4" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {step === "model" && !modelReady
                ? isDownloadingModel && downloadProgress
                  ? `${Math.round((downloadProgress.downloaded / downloadProgress.total) * 100)}% downloaded`
                  : isDownloadingModel
                    ? "Downloading..."
                    : "Download model"
                : "Start dictating"}
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
          <kbd className="min-w-14 rounded-xl border border-border bg-background px-4 py-3 text-center font-mono text-xl font-semibold text-foreground shadow-sm">
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
