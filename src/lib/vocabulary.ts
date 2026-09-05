/**
 * Vocabulary Packs frontend API (spec §6, §7, §19).
 *
 * Thin typed wrappers over the Rust `vocabulary_*` Tauri commands. All
 * vocabulary data stays on-device: these calls only ever talk to the local
 * process (spec §24 — no network, no telemetry).
 */
import { invoke } from "@tauri-apps/api/core";

export type VocabularyPackCategory =
  | "developer"
  | "technology"
  | "business"
  | "finance"
  | "medical"
  | "legal"
  | "marketing"
  | "gaming"
  | "personal"
  | "custom";

export type VocabularyEntryCategory =
  | "programming-language"
  | "framework"
  | "library"
  | "tool"
  | "product"
  | "company"
  | "person"
  | "place"
  | "acronym"
  | "technical"
  | "general";

export type VocabularyPriority = "low" | "normal" | "high" | "critical";

export interface VocabularyEntry {
  id: string;
  canonical: string;
  aliases: string[];
  pronunciationVariants: string[];
  category: VocabularyEntryCategory;
  priority: number;
  enabled: boolean;
  caseSensitive: boolean;
  confidenceBoost?: number | null;
  useCount: number;
  lastUsedAt?: number | null;
  /** True when the user added the entry themselves (editable on built-in packs). */
  userAdded?: boolean;
}

export interface ApplicationIdentifier {
  id: string;
  displayName?: string | null;
}

export interface VocabularyPack {
  id: string;
  name: string;
  description: string;
  category: VocabularyPackCategory;
  isBuiltIn: boolean;
  enabled: boolean;
  entries: VocabularyEntry[];
  targetApplications: ApplicationIdentifier[];
  priority: number;
}

export interface VocabularySettings {
  learningEnabled: boolean;
  autoCorrectThreshold: number;
  cautiousCorrectThreshold: number;
}

export const PRIORITY_WEIGHTS: Record<VocabularyPriority, number> = {
  low: 25,
  normal: 50,
  high: 75,
  critical: 100,
};

export function priorityFromWeight(weight: number): VocabularyPriority {
  if (weight <= 37) return "low";
  if (weight <= 62) return "normal";
  if (weight <= 87) return "high";
  return "critical";
}

export const ENTRY_CATEGORIES: VocabularyEntryCategory[] = [
  "general",
  "technical",
  "programming-language",
  "framework",
  "library",
  "tool",
  "product",
  "company",
  "person",
  "place",
  "acronym",
];

export function entryCategoryLabel(category: VocabularyEntryCategory): string {
  const labels: Record<VocabularyEntryCategory, string> = {
    "programming-language": "Language",
    framework: "Framework",
    library: "Library",
    tool: "Tool",
    product: "Product",
    company: "Company",
    person: "Person",
    place: "Place",
    acronym: "Acronym",
    technical: "Technical",
    general: "General",
  };
  return labels[category] ?? "General";
}

export function packCategoryLabel(category: VocabularyPackCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** Number of enabled terms in a pack (mirrors the Rust `enabled_entry_count`). */
export function enabledEntryCount(pack: VocabularyPack): number {
  return pack.entries.filter((entry) => entry.enabled).length;
}

export async function listVocabularyPacks(): Promise<VocabularyPack[]> {
  return invoke<VocabularyPack[]>("vocabulary_packs");
}

export async function createVocabularyPack(
  name: string,
  description: string,
  category: VocabularyPackCategory,
): Promise<VocabularyPack> {
  return invoke<VocabularyPack>("vocabulary_create_pack", {
    name,
    description,
    category,
  });
}

export async function updateVocabularyPack(
  packId: string,
  name: string,
  description: string,
): Promise<void> {
  await invoke("vocabulary_update_pack", { packId, name, description });
}

export async function duplicateVocabularyPack(packId: string): Promise<VocabularyPack> {
  return invoke<VocabularyPack>("vocabulary_duplicate_pack", { packId });
}

export async function deleteVocabularyPack(packId: string): Promise<void> {
  await invoke("vocabulary_delete_pack", { packId });
}

export async function setVocabularyPackEnabled(packId: string, enabled: boolean): Promise<void> {
  await invoke("vocabulary_set_pack_enabled", { packId, enabled });
}

export async function upsertVocabularyEntry(
  packId: string,
  entry: VocabularyEntry,
): Promise<VocabularyEntry> {
  return invoke<VocabularyEntry>("vocabulary_upsert_entry", { packId, entry });
}

export async function deleteVocabularyEntry(packId: string, entryId: string): Promise<void> {
  await invoke("vocabulary_delete_entry", { packId, entryId });
}

export async function setVocabularyEntryEnabled(
  packId: string,
  entryId: string,
  enabled: boolean,
): Promise<void> {
  await invoke("vocabulary_set_entry_enabled", { packId, entryId, enabled });
}

export async function setVocabularyAppMapping(
  app: ApplicationIdentifier,
  packIds: string[],
): Promise<void> {
  await invoke("vocabulary_set_app_mapping", { app, packIds });
}

export async function importVocabularyPack(json: string): Promise<VocabularyPack> {
  return invoke<VocabularyPack>("vocabulary_import", { json });
}

export async function exportVocabularyPack(packId: string): Promise<string> {
  return invoke<string>("vocabulary_export", { packId });
}

export async function setVocabularySettings(settings: VocabularySettings): Promise<void> {
  await invoke("vocabulary_set_settings", { settings });
}

export async function recordVocabularyCorrection(source: string, canonical: string): Promise<void> {
  await invoke("vocabulary_record_correction", { source, canonical });
}

/** One-time migration of the legacy free-text dictionary into the Personal pack. */
export async function migrateLegacyDictionary(dictionary: string): Promise<number> {
  return invoke<number>("vocabulary_migrate_dictionary", { dictionary });
}