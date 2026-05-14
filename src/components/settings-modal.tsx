import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Cpu,
  ExternalLink,
  Mic,
  Settings,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppToast } from "@/components/app-toast";
import {
  formatShortcut,
  setGlobalShortcut,
  checkAccessibilityPermission,
  getHotkeyDiagnostics,
  isEventTapOnlyShortcut,
  requestAccessibilityPermission,
  requestMicrophonePermission,
  setTriggerMode as setNativeTriggerMode,
} from "@/lib/native";
import { HotkeyPicker } from "@/components/hotkey-picker";
import { useAppStore } from "@/store/app-store";
import type { TriggerMode } from "@/store/app-store";

const settingsSections = [
  { id: "recording", label: "Recording", icon: Mic },
  { id: "transcription", label: "Transcription", icon: Cpu },
  { id: "permissions", label: "Permissions", icon: ShieldCheck },
  { id: "system", label: "System", icon: Settings },
] as const;

type SettingsSection = (typeof settingsSections)[number]["id"];

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function RecordingSection() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-sm font-semibold text-foreground">
          Recording
        </h3>
        <p className="text-xs text-muted-foreground">
          Controls for capturing microphone audio.
        </p>
      </div>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="record-local" className="flex-1 cursor-pointer text-sm">
            Save local WAV file after recording
          </Label>
          <Switch id="record-local" defaultChecked />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="record-keep" className="flex-1 cursor-pointer text-sm">
            Keep recordings after transcription
          </Label>
          <Switch id="record-keep" defaultChecked />
        </div>
      </div>
    </div>
  );
}

function TranscriptionSection() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-sm font-semibold text-foreground">
          Transcription
        </h3>
        <p className="text-xs text-muted-foreground">
          Download a model from Models before transcribing.
        </p>
      </div>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="transcribe-punctuation" className="flex-1 cursor-pointer text-sm">
            Prefer punctuation in output
          </Label>
          <Switch id="transcribe-punctuation" defaultChecked />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="transcribe-local" className="flex-1 cursor-pointer text-sm">
            Local processing only
          </Label>
          <Switch id="transcribe-local" defaultChecked />
        </div>
      </div>
    </div>
  );
}

type PermissionStatus = "checking" | "granted" | "denied";

interface PermissionRowProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: PermissionStatus;
  actionLabel: string;
  onAction: () => void;
  busy: boolean;
}

function PermissionRow({
  icon,
  title,
  description,
  status,
  actionLabel,
  onAction,
  busy,
}: PermissionRowProps) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-border bg-background p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">
            {title}
          </p>
          {status === "checking" && (
            <span className="text-[11px] text-muted-foreground">
              Checking…
            </span>
          )}
          {status === "granted" && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-primary">
              <CheckCircle2 className="h-3 w-3" />
              Granted
            </span>
          )}
          {status === "denied" && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-destructive">
              <XCircle className="h-3 w-3" />
              Not granted
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {description}
        </p>
      </div>
      {status !== "granted" && (
        <Button
          variant="outline"
          size="sm"
          onClick={onAction}
          disabled={busy || status === "checking"}
          className="shrink-0"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

function PermissionsSection() {
  const [accessibilityStatus, setAccessibilityStatus] =
    useState<PermissionStatus>("checking");
  const [micStatus, setMicStatus] = useState<PermissionStatus>("checking");
  const [accessibilityBusy, setAccessibilityBusy] = useState(false);
  const [micBusy, setMicBusy] = useState(false);

  // Check both permissions on mount
  useEffect(() => {
    void checkAccessibilityPermission().then((trusted) => {
      setAccessibilityStatus(trusted ? "granted" : "denied");
    });
    // Microphone: attempt a silent probe — if it succeeds the permission is granted
    void requestMicrophonePermission()
      .then(() => setMicStatus("granted"))
      .catch(() => setMicStatus("denied"));
  }, []);

  // Poll accessibility while denied (user may grant in System Settings)
  useEffect(() => {
    if (accessibilityStatus !== "denied") return;
    const interval = setInterval(async () => {
      const trusted = await checkAccessibilityPermission();
      if (trusted) {
        setAccessibilityStatus("granted");
        clearInterval(interval);
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [accessibilityStatus]);

  const handleGrantAccessibility = async () => {
    setAccessibilityBusy(true);
    try {
      const trusted = await requestAccessibilityPermission();
      if (trusted) setAccessibilityStatus("granted");
      // Polling will catch it if not yet granted
    } finally {
      setAccessibilityBusy(false);
    }
  };

  const handleGrantMic = async () => {
    setMicBusy(true);
    try {
      await requestMicrophonePermission();
      setMicStatus("granted");
    } catch {
      setMicStatus("denied");
    } finally {
      setMicBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-sm font-semibold text-foreground">
          Permissions
        </h3>
        <p className="text-xs text-muted-foreground">
          macOS permissions required for Vox to function. All processing stays on-device.
        </p>
      </div>

      <div className="space-y-3">
        <PermissionRow
          icon={<ShieldCheck className="h-4 w-4 text-accent-foreground" />}
          title="Accessibility"
          description="Required to detect global hotkeys like Globe, bare Option, or Fn keys via CGEventTap."
          status={accessibilityStatus}
          actionLabel="Open Settings"
          onAction={handleGrantAccessibility}
          busy={accessibilityBusy}
        />
        <PermissionRow
          icon={<Mic className="h-4 w-4 text-accent-foreground" />}
          title="Microphone"
          description="Required to capture your voice locally. Audio never leaves your device."
          status={micStatus}
          actionLabel="Allow"
          onAction={handleGrantMic}
          busy={micBusy}
        />
      </div>

      <p className="text-[11px] text-muted-foreground">
        If a permission was recently granted, it may take a moment to reflect here.
      </p>
    </div>
  );
}

function SystemSection() {
  const { hotkey, setHotkey, triggerMode, setTriggerMode } = useAppStore();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    title: string;
    detail?: string;
    tone?: "success" | "warning";
  } | null>(null);
  const [diagnostics, setDiagnostics] = useState<Awaited<
    ReturnType<typeof getHotkeyDiagnostics>
  > | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const refreshDiagnostics = async () => {
    try {
      const next = await getHotkeyDiagnostics();
      setDiagnostics(next);
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshDiagnostics();
    }, 0);
    const interval = window.setInterval(() => {
      void refreshDiagnostics();
    }, 3000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, []);

  const handleSaveHotkey = async (shortcut: string) => {
    try {
      await setGlobalShortcut(shortcut);
      await setHotkey(shortcut);
      await refreshDiagnostics();
      setToast({
        title: `Hotkey updated to ${formatShortcut(shortcut)}`,
        detail: isEventTapOnlyShortcut(shortcut)
          ? "Handled via CGEventTap. Accessibility permission must remain granted."
          : "The new global shortcut is active now.",
        tone: isEventTapOnlyShortcut(shortcut) ? "warning" : "success",
      });
      setPickerOpen(false);
      setHotkeyError(null);
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : String(err));
      setPickerOpen(false);
    }
  };

  const handleTriggerModeChange = async (mode: TriggerMode) => {
    await setNativeTriggerMode(mode);
    await setTriggerMode(mode);
    await refreshDiagnostics();
  };

  const diagnosticsRows = diagnostics
    ? [
        {
          label: "Accessibility",
          ok: diagnostics.accessibilityTrusted,
          detail: diagnostics.accessibilityTrusted
            ? "Granted"
            : "Grant permission in System Settings > Privacy & Security > Accessibility",
        },
        {
          label: "Event tap",
          ok: diagnostics.eventTapActive,
          detail:
            diagnostics.eventTapError ??
            (diagnostics.eventTapActive ? "Active" : "Inactive"),
        },
        {
          label: "Whisper model",
          ok: diagnostics.hasDownloadedModel,
          detail: diagnostics.hasDownloadedModel
            ? "Ready"
            : "Download a model from the Models page",
        },
        {
          label: "Mode",
          ok: true,
          detail:
            diagnostics.triggerMode === "pushToTalk"
              ? "Hold to record, release to transcribe"
              : "Press once to start, press again to stop",
        },
      ]
    : [];

  const info = [
    { label: "Version", value: "0.1.0-alpha" },
    { label: "Desktop shell", value: "Tauri v2" },
    { label: "Audio format", value: "16-bit WAV" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-sm font-semibold text-foreground">
          System
        </h3>
        <p className="text-xs text-muted-foreground">
          Minimal voice-to-text app status.
        </p>
      </div>

      {/* Hotkey row */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Global hotkey
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            {formatShortcut(hotkey)}
          </p>
          {hotkeyError && (
            <p className="mt-0.5 text-[11px] text-destructive">
              {hotkeyError}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
          Edit
        </Button>
      </div>

      {/* Trigger mode row */}
      <div className="space-y-2">
        <div>
          <p className="text-sm text-muted-foreground">
            Trigger mode
          </p>
          <p className="text-xs text-muted-foreground">
            How the hotkey starts and stops recording.
          </p>
        </div>
        <div className="flex gap-2">
          {(["toggle", "pushToTalk"] as TriggerMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => void handleTriggerModeChange(mode)}
              className={cn(
                "flex-1 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                triggerMode === mode
                  ? "border-primary bg-sidebar-accent font-medium text-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-sidebar-accent"
              )}
            >
              <span className="block font-medium">
                {mode === "toggle" ? "Toggle" : "Push to Talk"}
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {mode === "toggle"
                  ? "Press once to start, press again to stop."
                  : "Hold to record, release to transcribe."}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        {info.map((item) => (
          <div key={item.label} className="flex items-center justify-between py-1.5">
            <span className="text-sm text-muted-foreground">
              {item.label}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {item.value}
            </span>
          </div>
        ))}
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-background p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">
              Hotkey diagnostics
            </p>
            <p className="text-xs text-muted-foreground">
              Shows why the global shortcut may not start listening.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refreshDiagnostics()}>
            Refresh
          </Button>
        </div>

        {diagnostics ? (
          <div className="space-y-2">
            {diagnosticsRows.map((row) => (
              <div
                key={row.label}
                className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card px-3 py-2"
              >
                <div>
                  <p className="text-sm text-foreground">
                    {row.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {row.detail}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    row.ok
                      ? "bg-primary/15 text-primary"
                      : "bg-destructive/15 text-destructive"
                  )}
                >
                  {row.ok ? "OK" : "Needs action"}
                </span>
              </div>
            ))}
            <div className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
              Active shortcut: <span className="font-mono">{formatShortcut(diagnostics.currentShortcut)}</span>
              {" · "}
              Recording: <span className="font-medium">{diagnostics.isRecording ? "Yes" : "No"}</span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Loading diagnostics…</p>
        )}
      </div>

      <HotkeyPicker
        open={pickerOpen}
        currentShortcut={hotkey}
        onSave={handleSaveHotkey}
        onCancel={() => setPickerOpen(false)}
      />
      {toast && (
        <AppToast title={toast.title} detail={toast.detail} tone={toast.tone} />
      )}
    </div>
  );
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("recording");

  const renderContent = () => {
    switch (activeSection) {
      case "recording":
        return <RecordingSection />;
      case "transcription":
        return <TranscriptionSection />;
      case "permissions":
        return <PermissionsSection />;
      case "system":
        return <SystemSection />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[460px] max-w-[640px] overflow-hidden p-0">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Configure voice-to-text settings
        </DialogDescription>
        <div className="flex h-full">
          <nav className="w-[190px] shrink-0 border-r border-border bg-sidebar px-2 py-4">
            <p className="px-3 pb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Settings
            </p>
            <div className="space-y-0.5">
              {settingsSections.map((section) => {
                const Icon = section.icon;

                return (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                      activeSection === section.id
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{section.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
          <ScrollArea className="flex-1">
            <div className="p-6">{renderContent()}</div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
