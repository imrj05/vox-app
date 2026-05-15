import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { withTimeout } from "@/lib/async";
import { getSetting, setSetting } from "@/lib/db";

export const HOTKEY_KEY = "hotkey";
export const ONBOARDING_KEY = "onboarding_complete";
export const TRIGGER_MODE_KEY = "trigger_mode";
export const SOUND_ENABLED_KEY = "sound_enabled";
export const SELECTED_MODEL_KEY = "selected_model";
export const DICTIONARY_KEY = "dictionary";
export const THEME_KEY = "theme";
export const TRANSCRIPT_FORMATTING_MODE_KEY = "transcript_formatting_mode";
export const DEFAULT_SELECTED_MODEL = "base.en";
export const DEFAULT_HOTKEY = "Meta+Shift+Space";
export type TriggerMode = "toggle" | "pushToTalk";
export type AppTheme = "system" | "light" | "dark";
export type TranscriptFormattingMode = "auto" | "plain" | "developer";
export const DEFAULT_TRIGGER_MODE: TriggerMode = "toggle";
export const DEFAULT_THEME: AppTheme = "system";
export const DEFAULT_TRANSCRIPT_FORMATTING_MODE: TranscriptFormattingMode = "auto";
const SETTINGS_HYDRATE_TIMEOUT_MS = 5000;

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
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
  transcriptFormattingMode: TranscriptFormattingMode;

  /** Load all persisted settings from SQLite. Call once on app mount. */
  hydrate: () => Promise<void>;

  setOnboardingComplete: (value: boolean) => Promise<void>;
  setHotkey: (value: string) => Promise<void>;
  setTriggerMode: (value: TriggerMode) => Promise<void>;
  setSoundEnabled: (value: boolean) => Promise<void>;
  setSelectedModel: (value: string) => Promise<void>;
  setDictionary: (value: string) => Promise<void>;
  setTheme: (value: AppTheme) => Promise<void>;
  setTranscriptFormattingMode: (value: TranscriptFormattingMode) => Promise<void>;
  resetAppState: () => void;

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
  transcriptFormattingMode: DEFAULT_TRANSCRIPT_FORMATTING_MODE,
  // Update
  updateInfo: null,
  updateStatus: "idle" as UpdateStatus,
  updateProgress: { downloaded: 0, total: null },
  updateMessage: null,
  showUpdateDialog: false,
};

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
        transcriptFormattingMode,
      ] = await withTimeout(
        Promise.all([
          getSetting(ONBOARDING_KEY),
          getSetting(HOTKEY_KEY),
          getSetting(TRIGGER_MODE_KEY),
          getSetting(SOUND_ENABLED_KEY),
          getSetting(SELECTED_MODEL_KEY),
          getSetting(DICTIONARY_KEY),
          getSetting(THEME_KEY),
          getSetting(TRANSCRIPT_FORMATTING_MODE_KEY),
        ]),
        SETTINGS_HYDRATE_TIMEOUT_MS,
        "Timed out loading app settings"
      );
      const resolvedSoundEnabled = parseBooleanSetting(soundEnabled, true);
      const resolvedTheme = parseThemeSetting(theme);
      const resolvedTranscriptFormattingMode = parseTranscriptFormattingModeSetting(
        transcriptFormattingMode
      );
      // Sync to localStorage so the widget window can read it without IPC
      localStorage.setItem(SOUND_ENABLED_KEY, String(resolvedSoundEnabled));
      localStorage.setItem(THEME_KEY, resolvedTheme);
      set({
        onboardingComplete: onboarding === "true",
        hotkey: hotkey ?? DEFAULT_HOTKEY,
        triggerMode: parseTriggerModeSetting(triggerMode),
        soundEnabled: resolvedSoundEnabled,
        selectedModel: selectedModel ?? DEFAULT_SELECTED_MODEL,
        dictionary: dictionary ?? "",
        theme: resolvedTheme,
        transcriptFormattingMode: resolvedTranscriptFormattingMode,
      });
    } catch (error) {
      console.error("Failed to hydrate app settings", error);
      localStorage.setItem(SOUND_ENABLED_KEY, String(true));
      localStorage.setItem(THEME_KEY, DEFAULT_THEME);
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

  setTranscriptFormattingMode: async (value) => {
    await setSetting(TRANSCRIPT_FORMATTING_MODE_KEY, value);
    set({ transcriptFormattingMode: value });
  },

  resetAppState: () => {
    localStorage.setItem(SOUND_ENABLED_KEY, String(defaultAppState.soundEnabled));
    localStorage.setItem(THEME_KEY, defaultAppState.theme);
    set({ ...defaultAppState, onboardingComplete: false });
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
    set({ updateStatus: "downloading", updateProgress: { downloaded: 0, total: null }, updateMessage: `Downloading version ${updateInfo.version}...` });
    try {
      await updateInfo.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            set({ updateProgress: { downloaded: 0, total: event.data.contentLength ?? null } });
            break;
          case "Progress":
            useAppStore.setState((s) => ({
              updateProgress: {
                downloaded: s.updateProgress.downloaded + event.data.chunkLength,
                total: s.updateProgress.total,
              },
            }));
            break;
          case "Finished":
            set({ updateStatus: "installing", updateMessage: "Installing update..." });
            break;
        }
      });
      set({ updateMessage: "Update installed. Relaunching Vox..." });
      await relaunch();
    } catch (error) {
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
  return value === "toggle" || value === "pushToTalk"
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
