import { BookOpenText, CircleHelp, Database, Keyboard, Settings, ShieldCheck } from "lucide-react";

export const settingsSections = [
  { id: "general", label: "General", icon: Settings },
  { id: "dictionary", label: "Dictionary", icon: BookOpenText },
  { id: "data", label: "Data", icon: Database },
  { id: "permissions", label: "Permissions", icon: ShieldCheck },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "about", label: "About", icon: CircleHelp },
] as const;

export type SettingsSection = (typeof settingsSections)[number]["id"];
