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
import {
  checkAccessibilityPermission,
  downloadWhisperModel,
  listWhisperModels,
  requestAccessibilityPermission,
  requestMicrophonePermission,
  formatShortcut,
} from "@/lib/native";
import { useAppStore } from "@/store/app-store";

interface DownloadProgress {
  modelName: string;
  downloaded: number;
  total: number;
}

type Step = "accessibility" | "permission" | "model" | "hotkey";

export function Onboarding() {
  const { setOnboardingComplete, hotkey } = useAppStore();
  const [step, setStep] = useState<Step>("accessibility");
  const [accessibilityReady, setAccessibilityReady] = useState(false);
  const [permissionReady, setPermissionReady] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [hotkeyReady, setHotkeyReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check if accessibility is already granted on mount
  useEffect(() => {
    checkAccessibilityPermission().then((trusted) => {
      if (trusted) {
        setAccessibilityReady(true);
        setStep("permission");
      }
    });
  }, []);

  // Poll for accessibility grant after the user opens System Settings
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
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      const baseModel = models.find((model) => model.name === "base.en");
      if (!baseModel?.downloaded) {
        await downloadWhisperModel("base.en");
      }
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

  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xl shadow-black/30">
        <div className="mb-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Vox setup
          </p>
          <h1 className="text-2xl font-semibold text-foreground">
            Set up voice to text
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Four steps: accessibility, microphone, Whisper model, then hotkey
            test.
          </p>
        </div>

        <div className="grid gap-3">
          {/* Step 1 — Accessibility */}
          <StepCard
            active={step === "accessibility"}
            done={accessibilityReady}
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Accessibility permission"
            description="Required to detect global hotkeys like Globe, Option, or Fn."
          >
            {accessibilityReady ? (
              <span className="text-xs font-medium text-primary">
                Granted
              </span>
            ) : (
              <div className="flex flex-col items-end gap-1">
                <Button
                  onClick={grantAccessibility}
                  disabled={busy && step === "accessibility"}
                >
                  {busy && step === "accessibility"
                    ? "Opening Settings…"
                    : "Grant access"}
                </Button>
                <span className="text-[10px] text-muted-foreground">
                  Waiting for grant…
                </span>
              </div>
            )}
          </StepCard>

          {/* Step 2 — Microphone */}
          <StepCard
            active={step === "permission"}
            done={permissionReady}
            icon={<Mic className="h-5 w-5" />}
            title="Microphone permission"
            description="Allow Vox to capture your voice locally."
          >
            <Button
              onClick={requestPermission}
              disabled={busy || permissionReady || !accessibilityReady}
            >
              {busy && step === "permission"
                ? "Requesting…"
                : "Allow microphone"}
            </Button>
          </StepCard>

          {/* Step 3 — Model */}
          <StepCard
            active={step === "model"}
            done={modelReady}
            icon={<Download className="h-5 w-5" />}
            title="Download Whisper model"
            description="Download Base English for a fast local first run."
            progress={
              busy && step === "model" && downloadProgress
                ? downloadProgress
                : null
            }
          >
            <Button
              onClick={downloadModel}
              disabled={busy || modelReady || !permissionReady}
            >
              {busy && step === "model"
                ? downloadProgress
                  ? `${Math.round((downloadProgress.downloaded / downloadProgress.total) * 100)}%`
                  : "Downloading…"
                : "Download model"}
            </Button>
          </StepCard>

          {/* Step 4 — Hotkey test */}
          <StepCard
            active={step === "hotkey"}
            done={hotkeyReady}
            icon={<Keyboard className="h-5 w-5" />}
            title="Test hotkey"
            description={`Press ${formatShortcut(hotkey)} to confirm the shortcut works.`}
          >
            <Button
              variant={hotkeyReady ? "default" : "secondary"}
              disabled={!modelReady}
              onClick={() => setHotkeyReady(true)}
            >
              {hotkeyReady ? "Hotkey detected" : "I pressed it"}
            </Button>
          </StepCard>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-border bg-background p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            You can change models later from Models.
          </p>
          <Button
            onClick={finish}
            disabled={
              !accessibilityReady ||
              !permissionReady ||
              !modelReady ||
              !hotkeyReady
            }
          >
            <Sparkles className="h-4 w-4" />
            Start dictating
          </Button>
        </div>
      </div>
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
        "flex flex-col gap-2 rounded-xl border p-4 transition-colors",
        active
          ? "border-primary bg-accent"
          : "border-border bg-background",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-card text-accent-foreground">
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
