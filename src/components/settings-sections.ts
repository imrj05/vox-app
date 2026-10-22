import { BookOpenText, Database, Keyboard, ListBullet, Mic, Pencil, Settings, ShieldAlert, ShieldCheck } from "@/components/icons";

export const settingsSections = [
  { id: "general", label: "General", icon: Settings },
  { id: "transcription", label: "Transcription", icon: Mic },
  { id: "vocabulary-packs", label: "Vocabulary Packs", icon: BookOpenText },
  { id: "writing", label: "Writing", icon: Pencil },
  { id: "snippets", label: "Snippets", icon: ListBullet },
  { id: "data", label: "Data", icon: Database },
  { id: "privacy", label: "Privacy", icon: ShieldCheck },
  { id: "permissions", label: "Permissions", icon: ShieldAlert },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
] as const;

export type SettingsSection = (typeof settingsSections)[number]["id"];