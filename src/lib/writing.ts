import { invoke } from "@tauri-apps/api/core";

/**
 * Writing styles and app-aware profiles (Phase 2.8/2.9).
 *
 * Everything is local: these commands only talk to the Vox process, which
 * persists the configuration as JSON under the app data directory.
 */

export interface WritingStyle {
  id: string;
  name: string;
  instruction: string;
}

export interface AppWritingProfile {
  appName: string;
  styleId: string;
}

export interface WritingProfilesView {
  builtinStyles: WritingStyle[];
  customStyles: WritingStyle[];
  profiles: AppWritingProfile[];
  defaultStyleId: string | null;
}

/** Opt an app out of every writing style. */
export const NO_STYLE_ID = "none";

export async function getWritingProfiles(): Promise<WritingProfilesView> {
  return invoke<WritingProfilesView>("get_writing_profiles");
}

export async function setWritingProfiles(input: {
  customStyles: WritingStyle[];
  profiles: AppWritingProfile[];
  defaultStyleId: string | null;
}): Promise<WritingProfilesView> {
  return invoke<WritingProfilesView>("set_writing_profiles", input);
}
