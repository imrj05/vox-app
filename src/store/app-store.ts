import { create } from "zustand";
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
}

export const useAppStore = create<AppState>((set) => ({
  onboardingComplete: null,
  hotkey: DEFAULT_HOTKEY,
  triggerMode: DEFAULT_TRIGGER_MODE,
  soundEnabled: true,
  selectedModel: DEFAULT_SELECTED_MODEL,
  dictionary: "",
  theme: DEFAULT_THEME,
  transcriptFormattingMode: DEFAULT_TRANSCRIPT_FORMATTING_MODE,

  hydrate: async () => {
    const [
      onboarding,
      hotkey,
      triggerMode,
      soundEnabled,
      selectedModel,
      dictionary,
      theme,
      transcriptFormattingMode,
    ] = await Promise.all([
      getSetting(ONBOARDING_KEY),
      getSetting(HOTKEY_KEY),
      getSetting(TRIGGER_MODE_KEY),
      getSetting(SOUND_ENABLED_KEY),
      getSetting(SELECTED_MODEL_KEY),
      getSetting(DICTIONARY_KEY),
      getSetting(THEME_KEY),
      getSetting(TRANSCRIPT_FORMATTING_MODE_KEY),
    ]);
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
      triggerMode: (triggerMode as TriggerMode) ?? DEFAULT_TRIGGER_MODE,
      soundEnabled: resolvedSoundEnabled,
      selectedModel: selectedModel ?? DEFAULT_SELECTED_MODEL,
      dictionary: dictionary ?? "",
      theme: resolvedTheme,
      transcriptFormattingMode: resolvedTranscriptFormattingMode,
    });
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
}));

function parseThemeSetting(value: string | null): AppTheme {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : DEFAULT_THEME;
}

function parseTranscriptFormattingModeSetting(
  value: string | null
): TranscriptFormattingMode {
  return value === "auto" || value === "plain" || value === "developer"
    ? value
    : DEFAULT_TRANSCRIPT_FORMATTING_MODE;
}
