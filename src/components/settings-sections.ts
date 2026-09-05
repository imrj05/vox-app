import { BookOpenText, Database, Github, Keyboard, ListBullet, Mic, Settings, ShieldCheck } from "@/components/icons";

export const settingsSections = [
  { id: "general", label: "General", icon: Settings },
  { id: "transcription", label: "Transcription", icon: Mic },
  { id: "account", label: "Account", icon: Github },
  { id: "vocabulary-packs", label: "Vocabulary Packs", icon: BookOpenText },
  { id: "snippets", label: "Snippets", icon: ListBullet },
  { id: "data", label: "Data", icon: Database },
  { id: "privacy", label: "Privacy", icon: ShieldCheck },
  { id: "permissions", label: "Permissions", icon: ShieldCheck },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
] as const;

export type SettingsSection = (typeof settingsSections)[number]["id"];