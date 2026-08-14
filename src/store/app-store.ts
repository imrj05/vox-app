import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { withTimeout } from "@/lib/async";
import { getSetting, setSetting, getSnippets, saveSnippet, updateSnippet, deleteSnippet, type Snippet } from "@/lib/db";
import { downloadWhisperModel, pauseWhisperDownload, resumeWhisperDownload, cancelWhisperDownload, setNativeSnippets } from "@/lib/native";
export const HOTKEY_KEY = "hotkey";
export const ONBOARDING_KEY = "onboarding_complete";
export const TRIGGER_MODE_KEY = "trigger_mode";
export const SOUND_ENABLED_KEY = "sound_enabled";
export const SELECTED_MODEL_KEY = "selected_model";
export const DICTIONARY_KEY = "dictionary";
export const THEME_KEY = "theme";
export const WIDGET_ENABLED_KEY = "widget_enabled";
export const TRANSCRIPT_FORMATTING_MODE_KEY = "transcript_formatting_mode";
export const ERROR_REPORTING_ENABLED_KEY = "error_reporting_enabled";
export const ENHANCE_ICON_ENABLED_KEY = "enhance_icon_enabled";
export const ENHANCEMENT_MODEL_KEY = "enhancement_model";
export const CLEANUP_LEVEL_KEY = "cleanup_level";
export const TRANSCRIPT_RETENTION_KEY = "transcript_retention";
export const PRIVACY_MODE_KEY = "privacy_mode";
export const LANGUAGE_KEY = "language";
export const VOICE_COMMANDS_KEY = "voice_commands_enabled";
export const WHISPER_MODE_KEY = "whisper_mode";
export const DEFAULT_SELECTED_MODEL = "base.en";
export const DEFAULT_ENHANCEMENT_MODEL = "qwen2.5-1.5b-instruct-q4-k-m";
export const DEFAULT_HOTKEY = "Meta+Shift+Space";

export interface ModelDownloadProgress {
  downloaded: number;
  total: number;
}

export type TriggerMode = "toggle" | "pushToTalk" | "handsFree";
export type AppTheme = "system" | "light" | "dark";
export type TranscriptFormattingMode = "auto" | "plain" | "developer";
export type CleanupLevel = "none" | "light" | "medium" | "high";
export type TranscriptRetention = "forever" | "7" | "30" | "90";
export type DictationLanguage = "auto" | "en" | "hi" | "hinglish";
export const DEFAULT_TRIGGER_MODE: TriggerMode = "toggle";
export const DEFAULT_THEME: AppTheme = "system";
export const DEFAULT_TRANSCRIPT_FORMATTING_MODE: TranscriptFormattingMode = "auto";
export const DEFAULT_CLEANUP_LEVEL: CleanupLevel = "none";
export const DEFAULT_TRANSCRIPT_RETENTION: TranscriptRetention = "forever";
export const DEFAULT_LANGUAGE: DictationLanguage = "auto";
const SETTINGS_HYDRATE_TIMEOUT_MS = 5000;
export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "restarting"
  | "upToDate"
  | "error";
function parseBooleanSetting(value: string | null, fallback: boolean) {
  return value === null ? fallback : value === "true";
}
interface AppState {
  /** null = not yet loaded from DB */
  onboardingComplete: boolean | null;
  hotkey: string;
  triggerMode: TriggerMode;
  soundEnabled: boolean;
  selectedModel: string;
  dictionary: string;
  theme: AppTheme;
  widgetEnabled: boolean;
  enhanceIconEnabled: boolean;
  enhancementModel: string;
  transcriptFormattingMode: TranscriptFormattingMode;
  cleanupLevel: CleanupLevel;
  errorReportingEnabled: boolean;
  transcriptRetention: TranscriptRetention;
  privacyMode: boolean;
  language: DictationLanguage;
  voiceCommandsEnabled: boolean;
  whisperMode: boolean;
  snippets: Snippet[];
  /** Load all persisted settings from SQLite. Call once on app mount. */
  hydrate: () => Promise<void>;
  setOnboardingComplete: (value: boolean) => Promise<void>;
  setHotkey: (value: string) => Promise<void>;
  setTriggerMode: (value: TriggerMode) => Promise<void>;
  setSoundEnabled: (value: boolean) => Promise<void>;
  setSelectedModel: (value: string) => Promise<void>;
  setDictionary: (value: string) => Promise<void>;
  setTheme: (value: AppTheme) => Promise<void>;
  setWidgetEnabled: (value: boolean) => Promise<void>;
  setEnhanceIconEnabled: (value: boolean) => Promise<void>;
  setEnhancementModel: (value: string) => Promise<void>;
  setTranscriptFormattingMode: (value: TranscriptFormattingMode) => Promise<void>;
  setCleanupLevel: (value: CleanupLevel) => Promise<void>;
  setErrorReportingEnabled: (value: boolean) => Promise<void>;
  setTranscriptRetention: (value: TranscriptRetention) => Promise<void>;
  setPrivacyMode: (value: boolean) => Promise<void>;
  setLanguage: (value: DictationLanguage) => Promise<void>;
  setVoiceCommandsEnabled: (value: boolean) => Promise<void>;
  setWhisperMode: (value: boolean) => Promise<void>;
  loadSnippets: () => Promise<void>;
  addSnippet: (trigger: string, expansion: string) => Promise<void>;
  updateSnippet: (id: number, trigger: string, expansion: string) => Promise<void>;
  removeSnippet: (id: number) => Promise<void>;
  resetAppState: () => void;
  // Model downloads (global, so status survives screen changes)
  downloadingModels: string[];
  pausedModels: string[];
  modelDownloadProgress: Record<string, ModelDownloadProgress>;
  beginModelDownload: (name: string) => void;
  setModelDownloadProgress: (name: string, downloaded: number, total: number) => void;
  finishModelDownload: (name: string) => void;
  /** Download a model if not already downloading; ignores re-downloads while in flight. */
  downloadModel: (name: string) => Promise<void>;
  pauseModel: (name: string) => Promise<void>;
  resumeModel: (name: string) => Promise<void>;
  cancelModel: (name: string) => Promise<void>;
  // Update
  updateInfo: Update | null;
  updateStatus: UpdateStatus;
  updateProgress: { downloaded: number; total: number | null };
  updateMessage: string | null;
  showUpdateDialog: boolean;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;
  setShowUpdateDialog: (show: boolean) => void;
}
const defaultAppState = {
  onboardingComplete: null,
  hotkey: DEFAULT_HOTKEY,
  triggerMode: DEFAULT_TRIGGER_MODE,
  soundEnabled: true,
  selectedModel: DEFAULT_SELECTED_MODEL,
  dictionary: "",
  theme: DEFAULT_THEME,
  widgetEnabled: true,
  enhanceIconEnabled: true,
  enhancementModel: DEFAULT_ENHANCEMENT_MODEL,
  transcriptFormattingMode: DEFAULT_TRANSCRIPT_FORMATTING_MODE,
  cleanupLevel: DEFAULT_CLEANUP_LEVEL,
  errorReportingEnabled: false,
  transcriptRetention: DEFAULT_TRANSCRIPT_RETENTION,
  privacyMode: false,
  language: DEFAULT_LANGUAGE,
  voiceCommandsEnabled: true,
  whisperMode: false,
  snippets: [],
  // Model downloads
  downloadingModels: [],
  pausedModels: [],
  modelDownloadProgress: {},
  // Update
  updateInfo: null,
  updateStatus: "idle" as UpdateStatus,
  updateProgress: { downloaded: 0, total: null },
  updateMessage: null,
  showUpdateDialog: false,
};

let updateProgressTimer: number | null = null;
let updateProgressTarget = 0;

function stopUpdateProgressSmoothing() {
  if (updateProgressTimer !== null) {
    window.clearInterval(updateProgressTimer);
    updateProgressTimer = null;
  }
}

function resetUpdateProgressSmoothing() {
  stopUpdateProgressSmoothing();
  updateProgressTarget = 0;
}

function setUpdateProgressTarget(target: number) {
  updateProgressTarget = Math.max(updateProgressTarget, target);

  if (updateProgressTimer !== null) return;

  updateProgressTimer = window.setInterval(() => {
    useAppStore.setState((state) => {
      const { downloaded, total } = state.updateProgress;
      if (downloaded >= updateProgressTarget) {
        stopUpdateProgressSmoothing();
        return state;
      }

      const remaining = updateProgressTarget - downloaded;
      const nextDownloaded = downloaded + Math.max(1, Math.ceil(remaining * 0.18));

      return {
        updateProgress: {
          downloaded: Math.min(nextDownloaded, updateProgressTarget),
          total,
        },
      };
    });
  }, 80);
}

export const useAppStore = create<AppState>((set) => ({
  ...defaultAppState,
  hydrate: async () => {
    try {
      const [
        onboarding,
        hotkey,
        triggerMode,
        soundEnabled,
        selectedModel,
        dictionary,
        theme,
        widgetEnabled,
        enhanceIconEnabled,
        enhancementModel,
        transcriptFormattingMode,
        cleanupLevel,
        errorReportingEnabled,
        transcriptRetention,
        privacyMode,
        language,
        voiceCommandsEnabled,
        whisperMode,
      ] = await withTimeout(
        Promise.all([
          getSetting(ONBOARDING_KEY),
          getSetting(HOTKEY_KEY),
          getSetting(TRIGGER_MODE_KEY),
          getSetting(SOUND_ENABLED_KEY),
          getSetting(SELECTED_MODEL_KEY),
          getSetting(DICTIONARY_KEY),
          getSetting(THEME_KEY),
          getSetting(WIDGET_ENABLED_KEY),
          getSetting(ENHANCE_ICON_ENABLED_KEY),
          getSetting(ENHANCEMENT_MODEL_KEY),
          getSetting(TRANSCRIPT_FORMATTING_MODE_KEY),
          getSetting(CLEANUP_LEVEL_KEY),
          getSetting(ERROR_REPORTING_ENABLED_KEY),
          getSetting(TRANSCRIPT_RETENTION_KEY),
          getSetting(PRIVACY_MODE_KEY),
          getSetting(LANGUAGE_KEY),
          getSetting(VOICE_COMMANDS_KEY),
          getSetting(WHISPER_MODE_KEY),
        ]),
        SETTINGS_HYDRATE_TIMEOUT_MS,
        "Timed out loading app settings"
      );
      const resolvedSoundEnabled = parseBooleanSetting(soundEnabled, true);
      const resolvedTheme = parseThemeSetting(theme);
      const resolvedTranscriptFormattingMode = parseTranscriptFormattingModeSetting(
        transcriptFormattingMode
      );
      const resolvedWidgetEnabled = parseBooleanSetting(widgetEnabled, true);
      const resolvedEnhanceIconEnabled = parseBooleanSetting(enhanceIconEnabled, true);
      // Sync to localStorage so the widget window can read it without IPC
      localStorage.setItem(SOUND_ENABLED_KEY, String(resolvedSoundEnabled));
      localStorage.setItem(THEME_KEY, resolvedTheme);
      localStorage.setItem(WIDGET_ENABLED_KEY, String(resolvedWidgetEnabled));
      set({
        onboardingComplete: onboarding === "true",
        hotkey: hotkey ?? DEFAULT_HOTKEY,
        triggerMode: parseTriggerModeSetting(triggerMode),
        soundEnabled: resolvedSoundEnabled,
        selectedModel: selectedModel ?? DEFAULT_SELECTED_MODEL,
        dictionary: dictionary ?? "",
        theme: resolvedTheme,
        widgetEnabled: resolvedWidgetEnabled,
        enhanceIconEnabled: resolvedEnhanceIconEnabled,
        enhancementModel: enhancementModel ?? DEFAULT_ENHANCEMENT_MODEL,
        transcriptFormattingMode: resolvedTranscriptFormattingMode,
        cleanupLevel: parseCleanupLevelSetting(cleanupLevel),
        errorReportingEnabled: parseBooleanSetting(errorReportingEnabled, false),
        transcriptRetention: parseTranscriptRetentionSetting(transcriptRetention),
        privacyMode: parseBooleanSetting(privacyMode, false),
        language: parseLanguageSetting(language),
        voiceCommandsEnabled: parseBooleanSetting(voiceCommandsEnabled, true),
        whisperMode: parseBooleanSetting(whisperMode, false),
      });
    } catch (error) {
      console.error("Failed to hydrate app settings", error);
      localStorage.setItem(SOUND_ENABLED_KEY, String(true));
      localStorage.setItem(THEME_KEY, DEFAULT_THEME);
      localStorage.setItem(WIDGET_ENABLED_KEY, String(defaultAppState.widgetEnabled));
      set({ onboardingComplete: false });
    }
  },
  setOnboardingComplete: async (value) => {
    await setSetting(ONBOARDING_KEY, String(value));
    set({ onboardingComplete: value });
  },
  setHotkey: async (value) => {
    await setSetting(HOTKEY_KEY, value);
    set({ hotkey: value });
  },
  setTriggerMode: async (value) => {
    await setSetting(TRIGGER_MODE_KEY, value);
    set({ triggerMode: value });
  },
  setSoundEnabled: async (value) => {
    await setSetting(SOUND_ENABLED_KEY, String(value));
    // Sync to localStorage so the widget window picks it up immediately
    localStorage.setItem(SOUND_ENABLED_KEY, String(value));
    set({ soundEnabled: value });
  },
  setSelectedModel: async (value) => {
    await setSetting(SELECTED_MODEL_KEY, value);
    set({ selectedModel: value });
  },
  setDictionary: async (value) => {
    await setSetting(DICTIONARY_KEY, value);
    set({ dictionary: value });
  },
  setTheme: async (value) => {
    await setSetting(THEME_KEY, value);
    localStorage.setItem(THEME_KEY, value);
    set({ theme: value });
  },
  setWidgetEnabled: async (value) => {
    await setSetting(WIDGET_ENABLED_KEY, String(value));
    localStorage.setItem(WIDGET_ENABLED_KEY, String(value));
    set({ widgetEnabled: value });
  },
  setEnhanceIconEnabled: async (value) => {
    await setSetting(ENHANCE_ICON_ENABLED_KEY, String(value));
    set({ enhanceIconEnabled: value });
  },
  setEnhancementModel: async (value) => {
    await setSetting(ENHANCEMENT_MODEL_KEY, value);
    set({ enhancementModel: value });
  },
  setTranscriptFormattingMode: async (value) => {
    await setSetting(TRANSCRIPT_FORMATTING_MODE_KEY, value);
    set({ transcriptFormattingMode: value });
  },
  setCleanupLevel: async (value) => {
    await setSetting(CLEANUP_LEVEL_KEY, value);
    set({ cleanupLevel: value });
  },
  setErrorReportingEnabled: async (value) => {
    await setSetting(ERROR_REPORTING_ENABLED_KEY, String(value));
    set({ errorReportingEnabled: value });
  },
  setTranscriptRetention: async (value) => {
    await setSetting(TRANSCRIPT_RETENTION_KEY, value);
    set({ transcriptRetention: value });
  },
  setPrivacyMode: async (value) => {
    await setSetting(PRIVACY_MODE_KEY, String(value));
    // Privacy mode implies no error reporting and a short retention window.
    if (value) {
      await setSetting(ERROR_REPORTING_ENABLED_KEY, String(false));
      await setSetting(TRANSCRIPT_RETENTION_KEY, "7");
      set({ errorReportingEnabled: false, transcriptRetention: "7" });
    }
    set({ privacyMode: value });
  },
  setLanguage: async (value) => {
    await setSetting(LANGUAGE_KEY, value);
    set({ language: value });
  },
  setVoiceCommandsEnabled: async (value) => {
    await setSetting(VOICE_COMMANDS_KEY, String(value));
    set({ voiceCommandsEnabled: value });
  },
  setWhisperMode: async (value) => {
    await setSetting(WHISPER_MODE_KEY, String(value));
    set({ whisperMode: value });
  },
  loadSnippets: async () => {
    await syncSnippetsToNative();
  },
  addSnippet: async (trigger, expansion) => {
    await saveSnippet(trigger, expansion);
    await syncSnippetsToNative();
  },
  updateSnippet: async (id, trigger, expansion) => {
    await updateSnippet(id, trigger, expansion);
    await syncSnippetsToNative();
  },
  removeSnippet: async (id) => {
    await deleteSnippet(id);
    await syncSnippetsToNative();
  },
  resetAppState: () => {
    localStorage.setItem(SOUND_ENABLED_KEY, String(defaultAppState.soundEnabled));
    localStorage.setItem(THEME_KEY, defaultAppState.theme);
    localStorage.setItem(WIDGET_ENABLED_KEY, String(defaultAppState.widgetEnabled));
    set({ ...defaultAppState, onboardingComplete: false });
  },
  beginModelDownload: (name) =>
    set((state) =>
      state.downloadingModels.includes(name)
        ? state
        : { downloadingModels: [...state.downloadingModels, name] }
    ),
  setModelDownloadProgress: (name, downloaded, total) =>
    set((state) => ({
      modelDownloadProgress: {
        ...state.modelDownloadProgress,
        [name]: { downloaded, total },
      },
    })),
  finishModelDownload: (name) =>
    set((state) => {
      const modelDownloadProgress = { ...state.modelDownloadProgress };
      delete modelDownloadProgress[name];
      return {
        downloadingModels: state.downloadingModels.filter((n) => n !== name),
        pausedModels: state.pausedModels.filter((n) => n !== name),
        modelDownloadProgress,
      };
    }),
  downloadModel: async (name) => {
    const state = useAppStore.getState();
    if (state.downloadingModels.includes(name)) return;
    state.beginModelDownload(name);
    try {
      await downloadWhisperModel(name);
    } finally {
      state.finishModelDownload(name);
    }
  },
  pauseModel: async (name) => {
    await pauseWhisperDownload(name);
    set((state) =>
      state.pausedModels.includes(name)
        ? state
        : { pausedModels: [...state.pausedModels, name] }
    );
  },
  resumeModel: async (name) => {
    await resumeWhisperDownload(name);
    set((state) => ({ pausedModels: state.pausedModels.filter((n) => n !== name) }));
  },
  cancelModel: async (name) => {
    await cancelWhisperDownload(name);
    set((state) => ({ pausedModels: state.pausedModels.filter((n) => n !== name) }));
  },
  checkForUpdates: async () => {
    set({ updateStatus: "checking", updateMessage: null });
    try {
      const update = await check();
      if (update) {
        set({
          updateInfo: update,
          updateStatus: "available",
          updateMessage: `Version ${update.version} is available.`,
          showUpdateDialog: true,
        });
      } else {
        set({ updateInfo: null, updateStatus: "upToDate", updateMessage: "You already have the latest version." });
      }
    } catch (error) {
      set({
        updateInfo: null,
        updateStatus: "error",
        updateMessage: error instanceof Error ? error.message : String(error),
      });
    }
  },
  installUpdate: async () => {
    const { updateInfo } = useAppStore.getState();
    if (!updateInfo) return;
    resetUpdateProgressSmoothing();
    set({ updateStatus: "downloading", updateProgress: { downloaded: 0, total: null }, updateMessage: `Downloading version ${updateInfo.version}...` });
    try {
      let downloaded = 0;
      let total: number | null = null;

      await updateInfo.download((event) => {
        switch (event.event) {
          case "Started":
            downloaded = 0;
            total = event.data.contentLength ?? null;
            set({ updateProgress: { downloaded: 0, total } });
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setUpdateProgressTarget(total ? Math.min(downloaded, total) : downloaded);
            break;
          case "Finished":
            stopUpdateProgressSmoothing();
            if (total) {
              set({ updateProgress: { downloaded: total, total } });
            }
            set({ updateStatus: "installing", updateMessage: "Installing update..." });
            break;
        }
      });

      set({ updateStatus: "installing", updateMessage: "Installing update..." });
      await updateInfo.install();
      set({ updateStatus: "restarting", updateMessage: "Update installed. Restarting Vox..." });
      await relaunch();
    } catch (error) {
      resetUpdateProgressSmoothing();
      set({ updateStatus: "error", updateMessage: error instanceof Error ? error.message : String(error) });
    }
  },
  setShowUpdateDialog: (show) => set({ showUpdateDialog: show }),
}));
function parseThemeSetting(value: string | null): AppTheme {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : DEFAULT_THEME;
}
function parseTriggerModeSetting(value: string | null): TriggerMode {
  return value === "toggle" || value === "pushToTalk" || value === "handsFree"
    ? value
    : DEFAULT_TRIGGER_MODE;
}
function parseTranscriptFormattingModeSetting(
  value: string | null
): TranscriptFormattingMode {
  return value === "auto" || value === "plain" || value === "developer"
    ? value
    : DEFAULT_TRANSCRIPT_FORMATTING_MODE;
}
function parseCleanupLevelSetting(value: string | null): CleanupLevel {
  return value === "none" || value === "light" || value === "medium" || value === "high"
    ? value
    : DEFAULT_CLEANUP_LEVEL;
}
function parseTranscriptRetentionSetting(value: string | null): TranscriptRetention {
  return value === "7" || value === "30" || value === "90" || value === "forever"
    ? value
    : DEFAULT_TRANSCRIPT_RETENTION;
}
function parseLanguageSetting(value: string | null): DictationLanguage {
  return value === "en" || value === "hi" || value === "hinglish" || value === "auto"
    ? value
    : DEFAULT_LANGUAGE;
}

/** Reload snippets from SQLite into the store and push them to the Rust side
 * so background hotkey transcriptions can expand them. */
async function syncSnippetsToNative() {
  const rows = await getSnippets();
  useAppStore.setState({ snippets: rows });
  await setNativeSnippets(
    rows.map(({ trigger, expansion }) => ({ trigger, expansion }))
  );
}
