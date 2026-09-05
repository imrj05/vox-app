import { useCallback, useEffect, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ArrowCounterClockwise,
  BookOpenText,
  Check,
  CheckCircle2,
  Database,
  ExternalLink,
  Github,
  Globe,
  Keyboard,
  ListBullet,
  LogIn,
  Mic,
  Monitor,
  Moon,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Volume2,
  XCircle,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { SectionHeader, SettingsCard, SettingRow } from "@/components/settings-primitives";
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
import {
  cleanupRecordings,
  formatShortcut,
  setGlobalShortcut,
  checkAccessibilityPermission,
  microphoneAuthorizationStatus,
  openSystemSettings,
  checkInputMonitoringPermission,
  getHotkeyDiagnostics,
  getNativeStatus,
  getStartAtLogin,
  isEventTapOnlyShortcut,
  requestAccessibilityPermission,
  requestMicrophonePermission,
  requestInputMonitoringPermission,
  setStartAtLogin,
  setTriggerMode as setNativeTriggerMode,
  wipeLocalAppFiles,
} from "@/lib/native";
import { HotkeyPicker } from "@/components/hotkey-picker";
import { clearAppData, clearTranscripts } from "@/lib/db";
import { useAppStore } from "@/store/app-store";
import { getPocketBase } from "@/lib/pocketbase";
import type {
  AppTheme,
  CleanupLevel,
  DictationLanguage,
  TranscriptFormattingMode,
  TranscriptRetention,
  TriggerMode,
} from "@/store/app-store";
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
    cleanupLevel,
    setCleanupLevel,
    language,
    setLanguage,
    voiceCommandsEnabled,
    setVoiceCommandsEnabled,
    whisperMode,
    setWhisperMode,
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
          description="Appearance, sound, formatting, and language for everyday dictation."
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
          description="Show the Enhance action in the dictation widget after you dictate, so you can rewrite the text you just typed."
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
        <div className="space-y-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                AI cleanup
              </p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                Automatically clean up dictated text with the local enhancement model. Removes filler words, fixes grammar and punctuation, and resolves self-corrections. Disabled in developer mode to protect code.
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {cleanupLevelOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => void setCleanupLevel(option.value)}
                className={cn(
                  "rounded-xl border px-3 py-3 text-left transition-colors",
                  cleanupLevel === option.value
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
        </div>
        <div className="h-px bg-border" />
        <div className="space-y-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Globe className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Dictation language</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                Choose the language Vox should transcribe. Auto detects the language from your speech. Hinglish (Hindi + English) works best with a multilingual model.
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {languageOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => void setLanguage(option.value)}
                className={cn(
                  "rounded-xl border px-3 py-3 text-left transition-colors",
                  language === option.value
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
        </div>
        <div className="h-px bg-border" />
        <SettingRow
          icon={<Sparkles className="h-4 w-4" />}
          title="Voice commands"
          description="Dictate instructions like &quot;make this professional&quot; or &quot;summarize this&quot; to transform the selected text instead of pasting the words."
          action={
            <Switch
              id="voice-commands"
              aria-label="Voice commands"
              checked={voiceCommandsEnabled}
              onCheckedChange={(checked) => void setVoiceCommandsEnabled(checked)}
            />
          }
        />
        <div className="h-px bg-border" />
        <SettingRow
          icon={<Mic className="h-4 w-4" />}
          title="Whisper mode"
          description="Boost quiet or whispered speech so it transcribes reliably. Great for quiet environments."
          action={
            <Switch
              id="whisper-mode"
              aria-label="Whisper mode"
              checked={whisperMode}
              onCheckedChange={(checked) => void setWhisperMode(checked)}
            />
          }
        />
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

const cleanupLevelOptions: Array<{
  value: CleanupLevel;
  label: string;
  description: string;
}> = [
  {
    value: "none",
    label: "None",
    description: "Paste the raw transcription as-is, no AI changes.",
  },
  {
    value: "light",
    label: "Light",
    description: "Instant rule-based cleanup: remove fillers and self-corrections, fix capitalization. No AI model needed.",
  },
  {
    value: "medium",
    label: "Medium",
    description: "Rule-based cleanup plus AI: remove filler words and self-corrections, fix grammar, and make sentences concise.",
  },
  {
    value: "high",
    label: "High",
    description: "Rule-based cleanup plus AI rewrite: rephrase for clarity and format into paragraphs and lists.",
  },
];

const languageOptions: Array<{
  value: DictationLanguage;
  label: string;
  description: string;
}> = [
  {
    value: "auto",
    label: "Auto",
    description: "Detect the language from your speech automatically.",
  },
  {
    value: "en",
    label: "English",
    description: "Transcribe English. Works with all models.",
  },
  {
    value: "hi",
    label: "Hindi",
    description: "Transcribe Hindi. Requires a multilingual model.",
  },
  {
    value: "hinglish",
    label: "Hinglish",
    description: "Hindi + English mix. Requires a multilingual model.",
  },
];

export function SnippetsSection() {
  const { snippets, addSnippet, updateSnippet, removeSnippet } = useAppStore();
  const [triggerInput, setTriggerInput] = useState("");
  const [expansionInput, setExpansionInput] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTrigger, setEditTrigger] = useState("");
  const [editExpansion, setEditExpansion] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    const trigger = triggerInput.trim();
    const expansion = expansionInput.trim();
    if (!trigger || !expansion) return;
    setError(null);
    setMessage(null);
    try {
      await addSnippet(trigger, expansion);
      setTriggerInput("");
      setExpansionInput("");
      setMessage(`Snippet "${trigger}" added.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const startEdit = (id: number, trigger: string, expansion: string) => {
    setEditingId(id);
    setEditTrigger(trigger);
    setEditExpansion(expansion);
  };

  const saveEdit = async (id: number) => {
    const trigger = editTrigger.trim();
    const expansion = editExpansion.trim();
    if (!trigger || !expansion) return;
    setError(null);
    try {
      await updateSnippet(id, trigger, expansion);
      setEditingId(null);
      setMessage(`Snippet "${trigger}" updated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRemove = async (id: number, trigger: string) => {
    setError(null);
    try {
      await removeSnippet(id);
      setMessage(`Snippet "${trigger}" removed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Snippets"
        description="Voice-triggered text expansion. Say the trigger while dictating and Vox replaces it with the expansion."
      />
      <SettingsCard className="space-y-4">
        <div className="space-y-2">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <ListBullet className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">New snippet</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                Example: trigger &quot;my email&quot; expands to &quot;rajeshwar@example.com&quot; whenever you dictate it.
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              aria-label="Trigger phrase"
              placeholder="Trigger phrase (e.g. my email)"
              value={triggerInput}
              onChange={(event) => setTriggerInput(event.target.value)}
            />
            <Input
              aria-label="Expansion text"
              placeholder="Expansion text (e.g. rajeshwar@example.com)"
              value={expansionInput}
              onChange={(event) => setExpansionInput(event.target.value)}
            />
          </div>
          <Button
            size="sm"
            onClick={() => void handleAdd()}
            disabled={!triggerInput.trim() || !expansionInput.trim()}
          >
            <Plus className="h-4 w-4" />
            Add snippet
          </Button>
        </div>
        {message && (
          <p className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">{message}</p>
        )}
        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
        )}
        <div className="h-px bg-border" />
        {snippets.length > 0 ? (
          <div className="space-y-2">
            {snippets.map((snippet) => (
              <div key={snippet.id} className="rounded-xl border border-border bg-background p-3">
                {editingId === snippet.id ? (
                  <div className="space-y-2">
                    <Input
                      aria-label="Trigger phrase"
                      value={editTrigger}
                      onChange={(event) => setEditTrigger(event.target.value)}
                    />
                    <Input
                      aria-label="Expansion text"
                      value={editExpansion}
                      onChange={(event) => setEditExpansion(event.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => void saveEdit(snippet.id)}
                        disabled={!editTrigger.trim() || !editExpansion.trim()}
                      >
                        <Check className="h-4 w-4" />
                        Save
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">&quot;{snippet.trigger}&quot;</p>
                      <p className="mt-0.5 break-words text-xs text-muted-foreground">{snippet.expansion}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => startEdit(snippet.id, snippet.trigger, snippet.expansion)}
                      >
                        <Pencil className="h-4 w-4" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => void handleRemove(snippet.id, snippet.trigger)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <p className="pt-1 text-xs text-muted-foreground">
              {snippets.length} {snippets.length === 1 ? "snippet" : "snippets"} expanded in new transcriptions.
            </p>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border bg-background px-3 py-4 text-center text-xs text-muted-foreground">
            No snippets yet. Add one above to start expanding dictated phrases.
          </p>
        )}
      </SettingsCard>
    </div>
  );
}
export function AccountSection() {
  const { authUser, authStatus, signInWithGithub, signOut } = useAppStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGithub();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const lower = message.toLowerCase();
      if (lower.includes("cancelled")) {
        setError("Sign-in was cancelled.");
      } else if (lower.includes("timed out")) {
        setError(message);
      } else {
        setError(
          "Couldn't reach the Vox server. Check your connection and try again."
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await signOut();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const displayName =
    authUser?.name || authUser?.username || authUser?.email || "GitHub user";
  const avatarUrl = authUser?.avatar
    ? getPocketBase().files.getURL(authUser, authUser.avatar)
    : null;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Account"
        description="Your Vox account is linked to GitHub. We don't store any data in the cloud — everything stays on this device. Your account details are used only for analytics."
      />
      <SettingsCard className="space-y-4">
        {authUser ? (
          <>
            <div className="flex items-center gap-3">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-10 w-10 rounded-full border border-border object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Github className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {displayName}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {authUser?.email ?? "Signed in with GitHub"}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Sign out</p>
                <p className="text-xs text-muted-foreground">
                  You'll be asked to sign in again on next launch.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => void handleSignOut()}
                disabled={busy}
                className="shrink-0"
              >
                {busy ? <Spinner className="size-4" /> : <LogIn className="size-4" />}
                Sign out
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                Not signed in
              </p>
              <p className="text-xs text-muted-foreground">
                Sign in with GitHub to link your account. Vox works fully
                without an account.
              </p>
            </div>
            <Button
              onClick={() => void handleSignIn()}
              disabled={busy || authStatus === "loading"}
              className="shrink-0 gap-2"
            >
              {busy ? (
                <Spinner className="size-4" />
              ) : (
                <Github className="size-4" />
              )}
              {busy ? "Opening your browser…" : "Sign in with GitHub"}
            </Button>
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </SettingsCard>
    </div>
  );
}

export function DataSection() {
  const {
    resetAppState,
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

export function PrivacySection() {
  const {
    privacyMode,
    setPrivacyMode,
    transcriptRetention,
    setTranscriptRetention,
    errorReportingEnabled,
    setErrorReportingEnabled,
  } = useAppStore();

  const retentionOptions: Array<{
    value: TranscriptRetention;
    label: string;
    description: string;
  }> = [
    { value: "forever", label: "Forever", description: "Keep transcripts until you delete them." },
    { value: "7", label: "7 days", description: "Auto-delete transcripts older than a week." },
    { value: "30", label: "30 days", description: "Auto-delete transcripts older than a month." },
    { value: "90", label: "90 days", description: "Auto-delete transcripts older than three months." },
  ];

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Privacy"
        description="Control what Vox keeps on this device. All processing is local — audio and transcripts never leave your machine."
      />
      <SettingsCard className="space-y-4">
        <SettingRow
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Privacy mode"
          description="Disables error reporting and auto-deletes transcripts after 7 days. Raw audio is never stored."
          action={
            <Switch
              id="privacy-mode"
              aria-label="Privacy mode"
              checked={privacyMode}
              onCheckedChange={(checked) => void setPrivacyMode(checked)}
            />
          }
        />
        <div className="h-px bg-border" />
        <div className="space-y-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Database className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Transcript retention</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                Automatically delete transcripts older than the selected period. Applied on app launch and when the library opens.
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {retentionOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => void setTranscriptRetention(option.value)}
                className={cn(
                  "rounded-xl border px-3 py-3 text-left transition-colors",
                  transcriptRetention === option.value
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
        </div>
        <div className="h-px bg-border" />
        <SettingRow
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Error reporting"
          description="Send anonymized crash reports to help fix bugs. Transcript text is never included."
          action={
            <Switch
              id="error-reporting"
              aria-label="Error reporting"
              checked={errorReportingEnabled}
              disabled={privacyMode}
              onCheckedChange={(checked) => void setErrorReportingEnabled(checked)}
            />
          }
        />
        <div className="rounded-xl border border-border bg-background px-3 py-3 text-[11px] leading-5 text-muted-foreground">
          <p className="font-medium text-foreground">What Vox stores</p>
          <p className="mt-1">
            • Raw audio is deleted immediately after transcription — it is never kept on disk.
          </p>
          <p className="mt-1">
            • Transcripts are stored locally in SQLite and never leave this device.
          </p>
          <p className="mt-1">
            • Whisper and AI cleanup models run fully on-device.
          </p>
        </div>
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
        inputMonitoringDescription:
          "Required for the global hotkey to receive keyboard events from other apps.",
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
        inputMonitoringDescription: "",
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
        inputMonitoringDescription: "",
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
        inputMonitoringDescription: "",
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
  const [micState, setMicState] = useState<number | null>(null);
  const [inputMonitoringStatus, setInputMonitoringStatus] =
    useState<PermissionStatus>("checking");
  const [accessibilityBusy, setAccessibilityBusy] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const [inputMonitoringBusy, setInputMonitoringBusy] = useState(false);
  const kind = platformKind(platform ?? undefined);
  const copy = permissionCopy(kind);
  const isMacos = kind === "macos";
  const isLoadingPermissions =
    accessibilityStatus === "checking" ||
    micStatus === "checking" ||
    (isMacos && inputMonitoringStatus === "checking");
  const applyMicState = (state: number) => {
    setMicState(state);
    setMicStatus(state === 3 ? "granted" : "denied");
  };
  // Check permissions on mount
  useEffect(() => {
    void getNativeStatus()
      .then((status) => setPlatform(status.platform))
      .catch(() => setPlatform("Unknown desktop shell"));
    void checkAccessibilityPermission().then((trusted) => {
      setAccessibilityStatus(trusted ? "granted" : "denied");
    });
    void microphoneAuthorizationStatus()
      .then(applyMicState)
      .catch(() => setMicStatus("denied"));
    void checkInputMonitoringPermission()
      .then((granted) => setInputMonitoringStatus(granted ? "granted" : "denied"))
      .catch(() => setInputMonitoringStatus("denied"));
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
  // Poll microphone while denied — the user may answer the native prompt late
  // or grant via System Settings (the recovery path this page recommends).
  // Without this, the card stays "denied" after a grant until a full remount.
  useEffect(() => {
    if (micStatus !== "denied") return;
    const interval = setInterval(async () => {
      const state = await microphoneAuthorizationStatus();
      if (state === 3) {
        applyMicState(state);
        clearInterval(interval);
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [micStatus]);
  // Poll Input Monitoring while denied — after the prompt, macOS adds the app
  // to the list DISABLED and the user must flip the toggle in System Settings.
  useEffect(() => {
    if (inputMonitoringStatus !== "denied") return;
    const interval = setInterval(async () => {
      const granted = await checkInputMonitoringPermission();
      if (granted) {
        setInputMonitoringStatus("granted");
        clearInterval(interval);
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [inputMonitoringStatus]);
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
      if (isMacos && micState !== null && micState !== 0) {
        // Denied (2) or restricted (1): macOS suppresses the native prompt
        // forever after a refusal — deep-link into the Microphone privacy
        // pane instead of silently doing nothing. The poller above picks up
        // the grant as soon as the toggle flips.
        await openSystemSettings("microphone");
        return;
      }
      // Not yet determined (or non-macOS): trigger the native prompt.
      await requestMicrophonePermission();
      const state = await microphoneAuthorizationStatus();
      applyMicState(state);
      // If the native prompt is still open, the polling effect above picks up
      // the grant as soon as the user answers.
    } catch {
      setMicStatus("denied");
    } finally {
      setMicBusy(false);
    }
  };
  const handleGrantInputMonitoring = async () => {
    setInputMonitoringBusy(true);
    try {
      const granted = await requestInputMonitoringPermission();
      setInputMonitoringStatus(granted ? "granted" : "denied");
      // After the prompt, macOS lists the app disabled — the poller above
      // reflects the toggle flip when the user enables it in System Settings.
    } catch {
      setInputMonitoringStatus("denied");
    } finally {
      setInputMonitoringBusy(false);
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
          description={
            isMacos && micState === 2
              ? "Vox was denied earlier, so macOS won't prompt again. Enable it in System Settings → Privacy & Security → Microphone — this card updates automatically."
              : copy.microphoneDescription
          }
          status={micStatus}
          actionLabel={isMacos && micState === 2 ? "Open Settings" : "Allow"}
          onAction={handleGrantMic}
          busy={micBusy}
        />
        {isMacos && (
          <PermissionRow
            icon={<Keyboard className="h-4 w-4" />}
            title="Input Monitoring"
            description={copy.inputMonitoringDescription}
            status={inputMonitoringStatus}
            actionLabel="Open Settings"
            onAction={handleGrantInputMonitoring}
            busy={inputMonitoringBusy}
          />
        )}
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
  const [refreshing, setRefreshing] = useState(false);
  const [justRefreshed, setJustRefreshed] = useState(false);
  const [livePulse, setLivePulse] = useState(false);
  const refreshingRef = useRef(false);
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
  const refreshDiagnostics = useCallback(async (opts?: { silent?: boolean }) => {
    if (refreshingRef.current) return;
    if (!opts?.silent) {
      refreshingRef.current = true;
      setRefreshing(true);
      setJustRefreshed(false);
    }
    try {
      const next = await getHotkeyDiagnostics();
      setDiagnostics(next);
      if (opts?.silent) {
        // Auto-refresh: a brief pulse so the user sees the data update.
        setLivePulse(true);
        window.setTimeout(() => setLivePulse(false), 500);
      } else {
        setJustRefreshed(true);
        window.setTimeout(() => setJustRefreshed(false), 1400);
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!opts?.silent) {
        refreshingRef.current = false;
        setRefreshing(false);
      }
    }
  }, []);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshDiagnostics({ silent: true });
    }, 0);
    const interval = window.setInterval(() => {
      void refreshDiagnostics({ silent: true });
    }, 3000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [refreshDiagnostics]);
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
              : diagnostics.triggerMode === "handsFree"
                ? "Continuous dictation — text appears as you speak"
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
              Choose how the hotkey controls dictation.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {(["toggle", "pushToTalk", "handsFree"] as TriggerMode[]).map((mode) => (
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
                  {mode === "toggle"
                    ? "Toggle"
                    : mode === "pushToTalk"
                      ? "Push to talk"
                      : "Hands-free"}
                </span>
                <span className="mt-1 block leading-4 text-muted-foreground">
                  {mode === "toggle"
                    ? "Press once to start, press again to stop."
                    : mode === "pushToTalk"
                      ? "Hold to record, release to transcribe."
                      : "Press once to start; text is inserted as you speak."}
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
          <div className="flex min-w-0 items-center gap-2">
            <div>
              <p className="text-sm font-medium text-foreground">
                Hotkey diagnostics
              </p>
              <p className="text-xs text-muted-foreground">
                Shows why the global shortcut may not start listening.
              </p>
            </div>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-opacity",
                livePulse && "opacity-60"
              )}
              title="Diagnostics refresh automatically every 3 seconds"
            >
              <span
                className={cn(
                  "size-1.5 rounded-full bg-primary",
                  livePulse && "animate-pulse"
                )}
              />
              Live
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refreshDiagnostics()}
            disabled={refreshing}
            aria-live="polite"
            className="min-w-[104px] justify-center"
          >
            {refreshing ? (
              <Spinner className="size-3.5" />
            ) : justRefreshed ? (
              <Check className="size-3.5" />
            ) : (
              <ArrowCounterClockwise className="size-3.5" />
            )}
            {refreshing ? "Refreshing…" : justRefreshed ? "Updated" : "Refresh"}
          </Button>
        </div>
        {diagnostics ? (
          <div
            className={cn(
              "space-y-2 transition-opacity duration-300",
              livePulse && "opacity-60"
            )}
          >
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
