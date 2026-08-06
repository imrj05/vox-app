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
  Cpu,
  Database,
  Download,
  ExternalLink,
  Keyboard,
  LogIn,
  Mic,
  Monitor,
  Moon,
  Plus,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Volume2,
  XCircle,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
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
import { Spinner } from "@/components/ui/spinner";
import { AppToast } from "@/components/app-toast";
import { ABOUT_LINKS } from "@/lib/about";
import { openExternalLink } from "@/lib/external-link";
import {
  cleanupRecordings,
  deleteWhisperModel,
  formatShortcut,
  listWhisperModels,
  setGlobalShortcut,
  checkAccessibilityPermission,
  checkMicrophonePermission,
  getHotkeyDiagnostics,
  getNativeStatus,
  getStartAtLogin,
  isEventTapOnlyShortcut,
  requestAccessibilityPermission,
  requestMicrophonePermission,
  setStartAtLogin,
  setTriggerMode as setNativeTriggerMode,
  wipeLocalAppFiles,
} from "@/lib/native";
import { HotkeyPicker } from "@/components/hotkey-picker";
import {
  settingsSections,
  type SettingsSection,
} from "@/components/settings-sections";
import { clearAppData, clearTranscripts } from "@/lib/db";
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
        "rounded-2xl border border-border bg-card p-4",
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
    widgetEnabled,
    setWidgetEnabled,
    enhanceIconEnabled,
    setEnhanceIconEnabled,
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
              aria-label="Sound cues"
              checked={soundEnabled}
              onCheckedChange={(checked) => void setSoundEnabled(checked)}
            />
          }
        />
        <div className="h-px bg-border" />
        <SettingRow
          icon={<Monitor className="h-4 w-4" />}
          title="Floating widget"
          description="Show the small recording status window while Vox listens and transcribes."
          action={
            <Switch
              id="floating-widget"
              aria-label="Floating widget"
              checked={widgetEnabled}
              onCheckedChange={(checked) => void setWidgetEnabled(checked)}
            />
          }
        />
        <div className="h-px bg-border" />
        <SettingRow
          icon={<Sparkles className="h-4 w-4" />}
          title="Enhance icon"
          description="Show a small local rewrite button near focused macOS text inputs."
          action={
            <Switch
              id="enhance-icon"
              aria-label="Enhance icon"
              checked={enhanceIconEnabled}
              onCheckedChange={(checked) => void setEnhanceIconEnabled(checked)}
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
          description="Launch Vox automatically when you sign in to this device."
          action={
            <Switch
              id="start-at-login"
              aria-label="Start at login"
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

function formatModelBytes(bytes: number) {
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `~${gb.toFixed(2).replace(/\.?0+$/, "")} GB`;
  return `~${Math.round(bytes / 1024 / 1024)} MB`;
}

export function ModelsSection() {
  const {
    selectedModel,
    setSelectedModel,
    downloadingModels,
    pausedModels,
    modelDownloadProgress,
    downloadModel,
    pauseModel,
    resumeModel,
    cancelModel,
  } = useAppStore();
  const [models, setModels] = useState<Awaited<ReturnType<typeof listWhisperModels>>>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void listWhisperModels()
      .then((m) => {
        if (active) setModels(m);
      })
      .catch(() => {
        if (active) {
          setModels([]);
          setError("Model management is only available in the Tauri desktop app.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const refresh = async () => {
    setModels(await listWhisperModels());
  };

  const handleDownload = async (modelName: string) => {
    setError(null);
    try {
      await downloadModel(modelName);
      await refresh();
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
    setError(null);
    try {
      await setSelectedModel(modelName);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (modelName: string) => {
    setDeleting(modelName);
    setError(null);
    try {
      await deleteWhisperModel(modelName);
      await refresh();
      if (selectedModel === modelName) {
        await setSelectedModel("base.en");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(null);
    }
  };

  const activeModel = models.find((model) => model.name === selectedModel);
  const orderedModels = [...models].sort((a, b) => {
    if (a.name === selectedModel) return -1;
    if (b.name === selectedModel) return 1;
    return 0;
  });

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Models"
        description="Download, compare, and manage the local speech-to-text models used for dictation."
      />
      <SettingsCard className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Cpu className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Active model</p>
              <p className="truncate text-xs text-muted-foreground">
                {activeModel?.displayName ?? selectedModel}
              </p>
            </div>
          </div>
          <Badge variant="secondary" className="shrink-0">
            {activeModel?.downloaded ? "Ready" : "Not downloaded"}
          </Badge>
        </div>
        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </SettingsCard>

      {loading ? (
        <SettingsCard className="flex items-center gap-3 bg-muted/35 px-4 py-4">
          <Spinner className="size-4" />
          <div>
            <p className="text-sm font-medium text-foreground">Loading models</p>
            <p className="text-xs text-muted-foreground">Checking local model availability.</p>
          </div>
        </SettingsCard>
      ) : models.length > 0 ? (
        <SettingsCard className="space-y-2">
          {orderedModels.map((model) => {
            const isDownloading = downloadingModels.includes(model.name);
            const isPaused = pausedModels.includes(model.name);
            const isDeleting = deleting === model.name;
            const isActive = selectedModel === model.name;
            const dl = modelDownloadProgress[model.name];
            const pct =
              isDownloading && dl && dl.total > 0
                ? Math.round((dl.downloaded / dl.total) * 100)
                : null;
            return (
              <div
                key={model.name}
                className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">
                      {model.displayName}
                    </p>
                    {isActive && (
                      <Badge variant="secondary" className="h-5 bg-primary/10 text-primary">
                        <CheckCircle2 className="h-3 w-3" />
                        Active
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="font-mono tabular-nums">
                      {formatModelBytes(model.size)}
                    </span>
                    <span className="font-mono">
                      {model.downloaded ? "Downloaded" : "Not downloaded"}
                    </span>
                    {model.name.startsWith("parakeet") && (
                      <span className="font-medium uppercase tracking-[0.08em]">Parakeet</span>
                    )}
                  </div>
                  {isDownloading && (
                    <div className="mt-2 space-y-1">
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
                      <p className="text-[10px] text-muted-foreground">
                        {pct !== null ? `${pct}% downloaded` : "Connecting…"}
                      </p>
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
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleDelete(model.name)}
                        disabled={isDeleting || downloadingModels.length > 0}
                      >
                        {isDeleting ? (
                          <Spinner className="size-3.5" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
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
            );
          })}
        </SettingsCard>
      ) : (
        <SettingsCard className="px-4 py-6 text-center">
          <p className="text-sm font-medium text-foreground">No models available</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Open the desktop app to load local model availability.
          </p>
        </SettingsCard>
      )}
    </div>
  );
}
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
      <SettingsCard className="space-y-3 p-5">
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
      <SettingsCard className="min-h-48 p-5">
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
export function DataSection() {
  const {
    errorReportingEnabled,
    resetAppState,
    setErrorReportingEnabled,
  } = useAppStore();
  const [busyAction, setBusyAction] = useState<"history" | "recordings" | "app" | null>(null);
  const [diagnostics, setDiagnostics] = useState<Awaited<
    ReturnType<typeof getHotkeyDiagnostics>
  > | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let ignore = false;
    void getHotkeyDiagnostics()
      .then((next) => {
        if (!ignore) setDiagnostics(next);
      })
      .catch(() => {
        if (!ignore) setDiagnostics(null);
      });
    return () => {
      ignore = true;
    };
  }, []);
  const handleClearHistory = async () => {
    setBusyAction("history");
    setMessage(null);
    setError(null);
    try {
      await clearTranscripts();
      setMessage("Transcript history cleared.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };
  const handleClearAppData = async () => {
    setBusyAction("app");
    setMessage(null);
    setError(null);
    try {
      await clearAppData();
      await wipeLocalAppFiles();
      resetAppState();
      setMessage("All local Vox data, recordings, and downloaded models were removed.");
      setBusyAction(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusyAction(null);
    }
  };
  const handleCleanupRecordings = async () => {
    setBusyAction("recordings");
    setMessage(null);
    setError(null);
    try {
      const removed = await cleanupRecordings();
      setMessage(
        removed === 0
          ? "No leftover recording files were found."
          : `Removed ${removed} leftover recording file${removed === 1 ? "" : "s"}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Data"
        description="Clear local Vox data from this device, including leftover recordings or the full local app footprint."
      />
      <SettingsCard className="space-y-4">
        <div className="space-y-2 rounded-xl border border-border bg-background px-3 py-3 text-[11px] text-muted-foreground">
          <p>
            App data: <span className="font-mono">{diagnostics?.appDataDir ?? "Checking"}</span>
          </p>
          <p>
            Models: <span className="font-mono">{diagnostics?.modelsDir ?? "Checking"}</span>
          </p>
          <p>
            Recordings: <span className="font-mono">{diagnostics?.recordingsDir ?? "Checking"}</span>
          </p>
        </div>
        <div className="h-px bg-border" />
        <SettingRow
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Error reporting"
          description="Send anonymous crash and error reports to Vox Server. Vox does not send transcripts, audio, or personal identity."
          action={
            <Switch
              checked={errorReportingEnabled}
              onCheckedChange={(checked) => void setErrorReportingEnabled(checked)}
              aria-label="Toggle anonymous error reporting"
            />
          }
        />
        <div className="h-px bg-border" />
        <SettingRow
          icon={<Trash2 className="h-4 w-4" />}
          title="Clear transcript history"
          description="Delete all saved transcript history, activity stats, app usage, and recent transcripts."
          action={
            <ConfirmDataAction
              title="Clear transcript history?"
              description="This deletes all saved transcripts and dashboard history. Your app settings and downloaded models stay in place."
              actionLabel="Clear transcript history"
              busy={busyAction === "history"}
              onConfirm={handleClearHistory}
            />
          }
        />
        <div className="h-px bg-border" />
        <SettingRow
          icon={<Mic className="h-4 w-4" />}
          title="Clean leftover recordings"
          description="Delete any temporary .wav recording files left in Vox storage on this device."
          action={
            <ConfirmDataAction
              title="Delete leftover recordings?"
              description="This removes temporary local recording files from Vox storage. Saved transcript text and settings stay in place."
              actionLabel="Clean recordings"
              busy={busyAction === "recordings"}
              onConfirm={handleCleanupRecordings}
            />
          }
        />
        <div className="h-px bg-border" />
        <SettingRow
          icon={<Database className="h-4 w-4" />}
          title="Clean app entirely"
          description="Delete transcript history, saved settings, temporary recordings, and downloaded models, then return Vox to onboarding."
          action={
            <ConfirmDataAction
              title="Clean app entirely?"
              description="This deletes saved transcripts, preferences, temporary recordings, and downloaded models from this device. Vox will return to onboarding and you will need to download models again."
              actionLabel="Clean app"
              busy={busyAction === "app"}
              onConfirm={handleClearAppData}
            />
          }
        />
        {message && (
          <p className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
            {message}
          </p>
        )}
        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </SettingsCard>
    </div>
  );
}
function ConfirmDataAction({
  title,
  description,
  actionLabel,
  busy,
  onConfirm,
}: {
  title: string;
  description: string;
  actionLabel: string;
  busy: boolean;
  onConfirm: () => Promise<void>;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : null}
          {actionLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              void onConfirm();
            }}
          >
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
type PlatformKind = "macos" | "windows" | "linux" | "unknown";
interface PermissionRowProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: PermissionStatus;
  actionLabel: string;
  onAction: () => void;
  busy: boolean;
}
function platformKind(platform?: string): PlatformKind {
  const value = platform?.toLowerCase() ?? "";
  if (value.includes("macos")) return "macos";
  if (value.includes("windows")) return "windows";
  if (value.includes("linux")) return "linux";
  return "unknown";
}
function permissionCopy(kind: PlatformKind) {
  switch (kind) {
    case "macos":
      return {
        description: "macOS access required for local dictation and global shortcuts.",
        loading: "Vox is verifying Accessibility and Microphone access.",
        accessibilityTitle: "Accessibility",
        accessibilityDescription:
          "Required to detect global hotkeys like Globe, bare Option, or Fn keys via CGEventTap.",
        accessibilityAction: "Open Settings",
        microphoneDescription:
          "Required to capture your voice locally. Audio never leaves your device.",
        note: "If a permission was recently granted, it may take a moment to reflect here.",
      };
    case "windows":
      return {
        description: "Windows privacy settings and startup behavior for local dictation.",
        loading: "Vox is checking microphone access and desktop integration status.",
        accessibilityTitle: "Desktop input",
        accessibilityDescription:
          "Windows does not require macOS Accessibility permission. Global shortcuts use the desktop shortcut API.",
        accessibilityAction: "Refresh",
        microphoneDescription:
          "Required to capture your voice locally. If blocked, enable microphone access in Windows Privacy settings.",
        note: "For startup behavior, use Start at login in General settings and confirm Windows allows startup apps.",
      };
    case "linux":
      return {
        description: "Linux microphone access and input helper readiness for X11 and Wayland.",
        loading: "Vox is checking microphone access and Linux desktop integration status.",
        accessibilityTitle: "Input helpers",
        accessibilityDescription:
          "Linux does not use macOS Accessibility permission. For text insertion, install xdotool on X11 or wtype/dotool on Wayland.",
        accessibilityAction: "Refresh",
        microphoneDescription:
          "Required to capture your voice locally. Check PipeWire, PulseAudio, or ALSA if access is blocked.",
        note: "Wayland may restrict global shortcuts. Bind Vox CLI commands in your desktop keyboard settings when needed.",
      };
    default:
      return {
        description: "Desktop access required for local dictation and shortcuts.",
        loading: "Vox is checking desktop permissions.",
        accessibilityTitle: "Desktop input",
        accessibilityDescription:
          "Used for shortcuts and text insertion where the operating system allows it.",
        accessibilityAction: "Refresh",
        microphoneDescription:
          "Required to capture your voice locally. Audio never leaves your device.",
        note: "If a permission was recently granted, it may take a moment to reflect here.",
      };
  }
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
  const [platform, setPlatform] = useState<string | null>(null);
  const [accessibilityStatus, setAccessibilityStatus] =
    useState<PermissionStatus>("checking");
  const [micStatus, setMicStatus] = useState<PermissionStatus>("checking");
  const [accessibilityBusy, setAccessibilityBusy] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const kind = platformKind(platform ?? undefined);
  const copy = permissionCopy(kind);
  const isLoadingPermissions =
    accessibilityStatus === "checking" || micStatus === "checking";
  // Check both permissions on mount
  useEffect(() => {
    void getNativeStatus()
      .then((status) => setPlatform(status.platform))
      .catch(() => setPlatform("Unknown desktop shell"));
    void checkAccessibilityPermission().then((trusted) => {
      setAccessibilityStatus(trusted ? "granted" : "denied");
    });
    void checkMicrophonePermission()
      .then((granted) => setMicStatus(granted ? "granted" : "denied"))
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
        description={copy.description}
      />
      {isLoadingPermissions && (
        <SettingsCard className="flex items-center gap-3 bg-muted/35 px-4 py-4">
          <Spinner className="size-4" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Checking permissions
            </p>
            <p className="text-xs text-muted-foreground">
              {copy.loading}
            </p>
          </div>
        </SettingsCard>
      )}
      <SettingsCard className="space-y-3">
        <PermissionRow
          icon={<ShieldCheck className="h-4 w-4" />}
          title={copy.accessibilityTitle}
          description={copy.accessibilityDescription}
          status={accessibilityStatus}
          actionLabel={copy.accessibilityAction}
          onAction={handleGrantAccessibility}
          busy={accessibilityBusy}
        />
        <PermissionRow
          icon={<Mic className="h-4 w-4" />}
          title="Microphone"
          description={copy.microphoneDescription}
          status={micStatus}
          actionLabel="Allow"
          onAction={handleGrantMic}
          busy={micBusy}
        />
      </SettingsCard>
      <p className="text-[11px] text-muted-foreground">
        {copy.note}
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
        {
          label: "Text insertion",
          ok:
            diagnostics.textInsertion.directTypingSupported ||
            diagnostics.textInsertion.xdotoolAvailable ||
            diagnostics.textInsertion.wtypeAvailable ||
            diagnostics.textInsertion.dotoolAvailable,
          detail:
            diagnostics.textInsertion.guidance ??
            [
              diagnostics.textInsertion.directTypingSupported && "Direct typing",
              diagnostics.textInsertion.xdotoolAvailable && "xdotool",
              diagnostics.textInsertion.wtypeAvailable && "wtype",
              diagnostics.textInsertion.dotoolAvailable && "dotool",
            ]
              .filter(Boolean)
              .join(", "),
        },
      ]
    : [];
  const info = [
    { label: "Platform", value: diagnostics?.platform ?? "Checking" },
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
            <div className="space-y-1 rounded-xl border border-border bg-background px-3 py-2 text-[11px] text-muted-foreground">
              <p>
                App data: <span className="font-mono">{diagnostics.appDataDir ?? "Unavailable"}</span>
              </p>
              <p>
                Models: <span className="font-mono">{diagnostics.modelsDir ?? "Unavailable"}</span>
              </p>
              <p>
                Recordings: <span className="font-mono">{diagnostics.recordingsDir ?? "Unavailable"}</span>
              </p>
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
                onClick={(event) => {
                  event.preventDefault();
                  openExternalLink(item.href);
                }}
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
      case "models":
        return <ModelsSection />;
      case "dictionary":
        return <DictionarySection />;
      case "data":
        return <DataSection />;
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
