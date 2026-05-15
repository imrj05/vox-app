import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  BookOpenText,
  CheckCircle2,
  ExternalLink,
  Keyboard,
  LogIn,
  Mic,
  Monitor,
  Moon,
  Plus,
  ShieldCheck,
  Sun,
  Trash2,
  Volume2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { AppToast } from "@/components/app-toast";
import { ABOUT_LINKS } from "@/lib/about";
import {
  formatShortcut,
  setGlobalShortcut,
  checkAccessibilityPermission,
  getHotkeyDiagnostics,
  getStartAtLogin,
  isEventTapOnlyShortcut,
  requestAccessibilityPermission,
  requestMicrophonePermission,
  setStartAtLogin,
  setTriggerMode as setNativeTriggerMode,
} from "@/lib/native";
import { HotkeyPicker } from "@/components/hotkey-picker";
import {
  settingsSections,
  type SettingsSection,
} from "@/components/settings-sections";
import { useAppStore } from "@/store/app-store";
import type {
  AppTheme,
  TranscriptFormattingMode,
  TriggerMode,
} from "@/store/app-store";
interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function SettingsCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-4 shadow-xs",
        className
      )}
    >
      {children}
    </div>
  );
}

function SettingRow({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {title}
          </p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {action}
    </div>
  );
}

export function GeneralSection() {
  const {
    soundEnabled,
    setSoundEnabled,
    theme,
    setTheme,
    transcriptFormattingMode,
    setTranscriptFormattingMode,
  } = useAppStore();
  const [startAtLogin, setStartAtLoginState] = useState(false);
  const [startAtLoginLoading, setStartAtLoginLoading] = useState(true);
  const [startAtLoginError, setStartAtLoginError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    void getStartAtLogin()
      .then((enabled) => {
        if (!ignore) setStartAtLoginState(enabled);
      })
      .catch((err) => {
        if (!ignore) {
          setStartAtLoginError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!ignore) setStartAtLoginLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const handleStartAtLoginChange = async (enabled: boolean) => {
    const previous = startAtLogin;
    setStartAtLoginState(enabled);
    setStartAtLoginLoading(true);
    setStartAtLoginError(null);
    try {
      await setStartAtLogin(enabled);
    } catch (err) {
      setStartAtLoginState(previous);
      setStartAtLoginError(err instanceof Error ? err.message : String(err));
    } finally {
      setStartAtLoginLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <SectionHeader
          title="General"
          description="Keep the everyday Vox behaviors here. Advanced or inactive preferences have been removed."
        />
      </div>
      <SettingsCard className="space-y-4">
        <div className="space-y-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Monitor className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                Appearance
              </p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                Choose how Vox and the floating widget should look.
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {themeOptions.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  onClick={() => void setTheme(option.value)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                    theme === option.value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="font-medium">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="h-px bg-border" />
        <SettingRow
          icon={<Volume2 className="h-4 w-4" />}
          title="Sound cues"
          description="Play a short cue when recording starts or stops."
          action={
            <Switch
              id="sound-cues"
              checked={soundEnabled}
              onCheckedChange={(checked) => void setSoundEnabled(checked)}
            />
          }
        />
        <div className="h-px bg-border" />
        <div className="space-y-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <BookOpenText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                Context-aware formatting
              </p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                Auto switches to developer formatting in coding apps, so punctuation, line breaks, indentation, and identifier styles paste like code.
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {formattingModeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => void setTranscriptFormattingMode(option.value)}
                className={cn(
                  "rounded-xl border px-3 py-3 text-left transition-colors",
                  transcriptFormattingMode === option.value
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {option.description}
                </span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Examples: "camel case user name", "new line", "arrow function", and "try catch".
          </p>
        </div>
        <div className="h-px bg-border" />
        <SettingRow
          icon={<LogIn className="h-4 w-4" />}
          title="Start at login"
          description="Launch Vox automatically when you sign in to this Mac."
          action={
            <Switch
              id="start-at-login"
              checked={startAtLogin}
              disabled={startAtLoginLoading}
              onCheckedChange={(checked) => void handleStartAtLoginChange(checked)}
            />
          }
        />
        {startAtLoginError && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {startAtLoginError}
          </p>
        )}
      </SettingsCard>
    </div>
  );
}

const themeOptions: Array<{
  value: AppTheme;
  label: string;
  icon: typeof Monitor;
}> = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

const formattingModeOptions: Array<{
  value: TranscriptFormattingMode;
  label: string;
  description: string;
}> = [
  {
    value: "auto",
    label: "Auto",
    description: "Use code punctuation and structure in coding apps and plain text everywhere else.",
  },
  {
    value: "plain",
    label: "Plain text",
    description: "Keep spoken punctuation as normal words unless Whisper already converts it.",
  },
  {
    value: "developer",
    label: "Developer",
    description: "Always prefer code punctuation, structure, identifier formatting, and template snippets.",
  },
];

export function DictionarySection() {
  const { dictionary, setDictionary } = useAppStore();
  const [wordInput, setWordInput] = useState("");
  const [hintInput, setHintInput] = useState("");
  const [categoryInput, setCategoryInput] = useState("General");
  const entries = parseDictionaryEntries(dictionary);

  const saveEntries = (nextEntries: DictionaryEntry[]) => {
    void setDictionary(serializeDictionaryEntries(nextEntries));
  };

  const handleAddEntries = () => {
    const words = wordInput
      .split(",")
      .map((word) => word.trim())
      .filter(Boolean);
    if (words.length === 0) return;

    const nextEntries = [
      ...entries,
      ...words.map((word) => ({
        word,
        hint: hintInput.trim(),
        category: categoryInput,
      })),
    ];
    saveEntries(dedupeDictionaryEntries(nextEntries));
    setWordInput("");
    setHintInput("");
  };

  const handleRemoveEntry = (entry: DictionaryEntry) => {
    saveEntries(entries.filter((item) => dictionaryEntryKey(item) !== dictionaryEntryKey(entry)));
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Dictionary"
        description="Add specialized words so transcription recognizes names, jargon, acronyms, and product terms accurately."
      />
      <SettingsCard className="space-y-3 bg-muted/55 p-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Input
            value={wordInput}
            onChange={(event) => setWordInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleAddEntries();
            }}
            placeholder="e.g. names, company terms, acronyms, product names"
            className="h-11 rounded-xl bg-background px-4"
          />
          <Button
            onClick={handleAddEntries}
            disabled={!wordInput.trim()}
            className="h-11 rounded-xl px-5"
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <Input
            value={hintInput}
            onChange={(event) => setHintInput(event.target.value)}
            placeholder="Pronunciation hint (optional)"
            className="h-11 rounded-xl bg-background px-4"
          />
          <Select
            value={categoryInput}
            onValueChange={setCategoryInput}
          >
            <SelectTrigger className="h-11 w-full rounded-xl bg-background px-4">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="General">Category</SelectItem>
              <SelectItem value="People">People</SelectItem>
              <SelectItem value="Product">Product</SelectItem>
              <SelectItem value="Technical">Technical</SelectItem>
              <SelectItem value="Company">Company</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          Separate multiple words with commas to add them at once.
        </p>
      </SettingsCard>

      <SettingsCard className="min-h-48 bg-muted/55 p-5">
        {entries.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center text-center">
            <BookOpenText className="h-10 w-10 text-muted-foreground/45" />
            <p className="mt-4 text-sm font-medium text-muted-foreground">
              No words yet.
            </p>
            <p className="mt-1 text-sm text-muted-foreground/80">
              Add your first word above to improve transcription accuracy.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div
                key={dictionaryEntryKey(entry)}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">
                      {entry.word}
                    </p>
                    <Badge variant="secondary" className="h-5">
                      {entry.category}
                    </Badge>
                  </div>
                  {entry.hint && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Pronunciation: {entry.hint}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveEntry(entry)}
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <p className="pt-2 text-xs text-muted-foreground">
              {entries.length} {entries.length === 1 ? "entry" : "entries"} used as transcription context.
            </p>
          </div>
        )}
      </SettingsCard>
    </div>
  );
}

interface DictionaryEntry {
  word: string;
  hint: string;
  category: string;
}

function parseDictionaryEntries(dictionary: string): DictionaryEntry[] {
  return dictionary
    .split("\n")
    .flatMap((line) => {
      const parts = line.split("|").map((part) => part.trim());
      if (parts.length > 1) {
        return [{ word: parts[0], hint: parts[1] ?? "", category: parts[2] || "General" }];
      }
      return line
        .split(",")
        .map((word) => word.trim())
        .filter(Boolean)
        .map((word) => ({ word, hint: "", category: "General" }));
    })
    .filter((entry) => entry.word);
}

function serializeDictionaryEntries(entries: DictionaryEntry[]) {
  return entries
    .map((entry) => [entry.word, entry.hint, entry.category].join(" | "))
    .join("\n");
}

function dedupeDictionaryEntries(entries: DictionaryEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = entry.word.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dictionaryEntryKey(entry: DictionaryEntry) {
  return `${entry.word}|${entry.hint}|${entry.category}`;
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
    <div className="flex items-start gap-4 rounded-xl border border-border bg-background p-4 transition-colors hover:bg-muted/30">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">
            {title}
          </p>
          {status === "checking" && (
            <Badge variant="secondary" className="h-5 gap-1.5">
              <Spinner className="size-3" />
              Checking
            </Badge>
          )}
          {status === "granted" && (
            <Badge variant="secondary" className="h-5 bg-primary/10 text-primary">
              <CheckCircle2 className="h-3 w-3" />
              Granted
            </Badge>
          )}
          {status === "denied" && (
            <Badge variant="destructive" className="h-5">
              <XCircle className="h-3 w-3" />
              Not granted
            </Badge>
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
export function PermissionsSection() {
  const [accessibilityStatus, setAccessibilityStatus] =
    useState<PermissionStatus>("checking");
  const [micStatus, setMicStatus] = useState<PermissionStatus>("checking");
  const [accessibilityBusy, setAccessibilityBusy] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const isLoadingPermissions =
    accessibilityStatus === "checking" || micStatus === "checking";
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
    <div className="space-y-5">
      <SectionHeader
        title="Permissions"
        description="macOS access required for local dictation and global shortcuts."
      />
      {isLoadingPermissions && (
        <SettingsCard className="flex items-center gap-3 bg-muted/35 px-4 py-4">
          <Spinner className="size-4" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Checking permissions
            </p>
            <p className="text-xs text-muted-foreground">
              Vox is verifying Accessibility and Microphone access.
            </p>
          </div>
        </SettingsCard>
      )}
      <SettingsCard className="space-y-3">
        <PermissionRow
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Accessibility"
          description="Required to detect global hotkeys like Globe, bare Option, or Fn keys via CGEventTap."
          status={accessibilityStatus}
          actionLabel="Open Settings"
          onAction={handleGrantAccessibility}
          busy={accessibilityBusy}
        />
        <PermissionRow
          icon={<Mic className="h-4 w-4" />}
          title="Microphone"
          description="Required to capture your voice locally. Audio never leaves your device."
          status={micStatus}
          actionLabel="Allow"
          onAction={handleGrantMic}
          busy={micBusy}
        />
      </SettingsCard>
      <p className="text-[11px] text-muted-foreground">
        If a permission was recently granted, it may take a moment to reflect here.
      </p>
    </div>
  );
}
export function ShortcutsSection() {
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
    { label: "Version", value: "0.0.1" },
    { label: "Desktop shell", value: "Tauri v2" },
    { label: "Audio format", value: "16-bit WAV" },
  ];
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Shortcuts"
        description="Configure the global dictation shortcut and check whether it is ready."
      />
      <SettingsCard className="space-y-4">
        <SettingRow
          icon={<Keyboard className="h-4 w-4" />}
          title="Global hotkey"
          description="Starts and stops dictation from anywhere."
          action={
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs text-muted-foreground">
                {formatShortcut(hotkey)}
              </span>
              <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                Edit
              </Button>
            </div>
          }
        />
        {hotkeyError && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {hotkeyError}
          </p>
        )}
        <div className="h-px bg-border" />
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              Trigger mode
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Choose whether the hotkey toggles recording or works while held.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["toggle", "pushToTalk"] as TriggerMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => void handleTriggerModeChange(mode)}
                className={cn(
                  "rounded-xl border px-3 py-3 text-left text-xs transition-colors",
                  triggerMode === mode
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <span className="block text-sm font-medium">
                  {mode === "toggle" ? "Toggle" : "Push to talk"}
                </span>
                <span className="mt-1 block leading-4 text-muted-foreground">
                  {mode === "toggle"
                    ? "Press once to start, press again to stop."
                    : "Hold to record, release to transcribe."}
                </span>
              </button>
            ))}
          </div>
        </div>
      </SettingsCard>
      <SettingsCard className="space-y-1">
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
      </SettingsCard>
      <SettingsCard className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">
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
                className="flex items-start justify-between gap-4 rounded-xl border border-border bg-background px-3 py-2"
              >
                <div>
                  <p className="text-sm text-foreground">
                    {row.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {row.detail}
                  </p>
                </div>
                <Badge
                  variant={row.ok ? "secondary" : "destructive"}
                  className={cn("shrink-0", row.ok && "bg-primary/10 text-primary")}
                >
                  {row.ok ? "OK" : "Needs action"}
                </Badge>
              </div>
            ))}
            <div className="rounded-xl border border-border bg-background px-3 py-2 text-[11px] text-muted-foreground">
              Active shortcut: <span className="font-mono">{formatShortcut(diagnostics.currentShortcut)}</span>
              {" · "}
              Recording: <span className="font-medium">{diagnostics.isRecording ? "Yes" : "No"}</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-3">
            <Spinner className="size-4" />
            <div>
              <p className="text-sm font-medium text-foreground">Loading diagnostics</p>
              <p className="text-xs text-muted-foreground">Checking shortcut readiness and permissions.</p>
            </div>
          </div>
        )}
      </SettingsCard>
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

export function AboutSection() {
  return (
    <div className="space-y-5">
      <SectionHeader
        title="About"
        description="App details, project links, and contact information for Vox."
      />
      <SettingsCard className="space-y-4 p-5">
        <div className="rounded-2xl border border-border bg-muted/35 p-5">
          <p className="text-lg font-semibold text-foreground">Vox</p>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Local voice dictation with a focused desktop workflow for fast transcription,
            private processing, and a clean desktop-first experience.
          </p>
        </div>
        {ABOUT_LINKS.map((item) => (
          <div
            key={item.label}
            className="flex flex-col gap-3 rounded-xl border border-border bg-background px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{item.label}</p>
              <p className="break-all text-xs text-muted-foreground sm:truncate">{item.value}</p>
            </div>
            {item.href ? (
              <a
                href={item.href}
                target={item.href.startsWith("mailto:") ? undefined : "_blank"}
                rel={item.href.startsWith("mailto:") ? undefined : "noreferrer"}
                className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-colors hover:bg-muted"
              >
                {item.action}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <span className="font-mono text-xs text-muted-foreground">{item.value}</span>
            )}
          </div>
        ))}
      </SettingsCard>
    </div>
  );
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("general");
  const renderContent = () => {
    switch (activeSection) {
      case "general":
        return <GeneralSection />;
      case "dictionary":
        return <DictionarySection />;
      case "permissions":
        return <PermissionsSection />;
      case "shortcuts":
        return <ShortcutsSection />;
      case "about":
        return <AboutSection />;
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[460px] min-w-150 max-w-200 overflow-hidden p-0">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Configure voice-to-text settings
        </DialogDescription>
        <div className="absolute inset-0 flex overflow-hidden rounded-xl">
          <nav className="w-[190px] shrink-0 overflow-hidden border-r border-border bg-sidebar px-2 py-4">
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
