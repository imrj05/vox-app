import { BookOpenText, CircleHelp, Cpu, Database, Github, Keyboard, ListBullet, Settings, ShieldCheck } from "@/components/icons";

export const settingsSections = [
  { id: "general", label: "General", icon: Settings },
  { id: "account", label: "Account", icon: Github },
  { id: "models", label: "Models", icon: Cpu },
  { id: "dictionary", label: "Dictionary", icon: BookOpenText },
  { id: "snippets", label: "Snippets", icon: ListBullet },
  { id: "data", label: "Data", icon: Database },
  { id: "privacy", label: "Privacy", icon: ShieldCheck },
  { id: "permissions", label: "Permissions", icon: ShieldCheck },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "about", label: "About", icon: CircleHelp },
] as const;

export type SettingsSection = (typeof settingsSections)[number]["id"];
