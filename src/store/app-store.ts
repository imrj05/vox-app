import { create } from "zustand";
import { getSetting, setSetting } from "@/lib/db";

export const HOTKEY_KEY = "hotkey";
export const ONBOARDING_KEY = "onboarding_complete";
export const TRIGGER_MODE_KEY = "trigger_mode";
export const SOUND_ENABLED_KEY = "sound_enabled";
export const SELECTED_MODEL_KEY = "selected_model";
export const DEFAULT_SELECTED_MODEL = "base.en";
export const DEFAULT_HOTKEY = "Meta+Shift+Space";
export type TriggerMode = "toggle" | "pushToTalk";
export const DEFAULT_TRIGGER_MODE: TriggerMode = "toggle";

interface AppState {
  /** null = not yet loaded from DB */
  onboardingComplete: boolean | null;
  hotkey: string;
  triggerMode: TriggerMode;
  soundEnabled: boolean;
  selectedModel: string;

  /** Load all persisted settings from SQLite. Call once on app mount. */
  hydrate: () => Promise<void>;

  setOnboardingComplete: (value: boolean) => Promise<void>;
  setHotkey: (value: string) => Promise<void>;
  setTriggerMode: (value: TriggerMode) => Promise<void>;
  setSoundEnabled: (value: boolean) => Promise<void>;
  setSelectedModel: (value: string) => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  onboardingComplete: null,
  hotkey: DEFAULT_HOTKEY,
  triggerMode: DEFAULT_TRIGGER_MODE,
  soundEnabled: true,
  selectedModel: DEFAULT_SELECTED_MODEL,

  hydrate: async () => {
    const [onboarding, hotkey, triggerMode, soundEnabled, selectedModel] = await Promise.all([
      getSetting(ONBOARDING_KEY),
      getSetting(HOTKEY_KEY),
      getSetting(TRIGGER_MODE_KEY),
      getSetting(SOUND_ENABLED_KEY),
      getSetting(SELECTED_MODEL_KEY),
    ]);
    const resolvedSoundEnabled = soundEnabled === null ? true : soundEnabled === "true";
    // Sync to localStorage so the widget window can read it without IPC
    localStorage.setItem(SOUND_ENABLED_KEY, String(resolvedSoundEnabled));
    set({
      onboardingComplete: onboarding === "true",
      hotkey: hotkey ?? DEFAULT_HOTKEY,
      triggerMode: (triggerMode as TriggerMode) ?? DEFAULT_TRIGGER_MODE,
      soundEnabled: resolvedSoundEnabled,
      selectedModel: selectedModel ?? DEFAULT_SELECTED_MODEL,
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
}));
