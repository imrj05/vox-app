import { BookOpenText, CircleHelp, Keyboard, Settings, ShieldCheck } from "lucide-react";

export const settingsSections = [
  { id: "general", label: "General", icon: Settings },
  { id: "dictionary", label: "Dictionary", icon: BookOpenText },
  { id: "permissions", label: "Permissions", icon: ShieldCheck },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "about", label: "About", icon: CircleHelp },
] as const;

export type SettingsSection = (typeof settingsSections)[number]["id"];
