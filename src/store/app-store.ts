import { create } from "zustand";
import { getSetting, setSetting } from "@/lib/db";

export const HOTKEY_KEY = "hotkey";
export const ONBOARDING_KEY = "onboarding_complete";
export const TRIGGER_MODE_KEY = "trigger_mode";
export const DEFAULT_HOTKEY = "Meta+Shift+Space";
export type TriggerMode = "toggle" | "pushToTalk";
export const DEFAULT_TRIGGER_MODE: TriggerMode = "toggle";

interface AppState {
  /** null = not yet loaded from DB */
  onboardingComplete: boolean | null;
  hotkey: string;
  triggerMode: TriggerMode;

  /** Load all persisted settings from SQLite. Call once on app mount. */
  hydrate: () => Promise<void>;

  setOnboardingComplete: (value: boolean) => Promise<void>;
  setHotkey: (value: string) => Promise<void>;
  setTriggerMode: (value: TriggerMode) => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  onboardingComplete: null,
  hotkey: DEFAULT_HOTKEY,
  triggerMode: DEFAULT_TRIGGER_MODE,

  hydrate: async () => {
    const [onboarding, hotkey, triggerMode] = await Promise.all([
      getSetting(ONBOARDING_KEY),
      getSetting(HOTKEY_KEY),
      getSetting(TRIGGER_MODE_KEY),
    ]);
    set({
      onboardingComplete: onboarding === "true",
      hotkey: hotkey ?? DEFAULT_HOTKEY,
      triggerMode: (triggerMode as TriggerMode) ?? DEFAULT_TRIGGER_MODE,
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
}));
