import { BookOpenText, CircleHelp, Cpu, Database, Keyboard, Settings, ShieldCheck } from "@/components/icons";

export const settingsSections = [
  { id: "general", label: "General", icon: Settings },
  { id: "models", label: "Models", icon: Cpu },
  { id: "dictionary", label: "Dictionary", icon: BookOpenText },
  { id: "data", label: "Data", icon: Database },
  { id: "permissions", label: "Permissions", icon: ShieldCheck },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "about", label: "About", icon: CircleHelp },
] as const;

export type SettingsSection = (typeof settingsSections)[number]["id"];
