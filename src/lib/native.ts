import { invoke } from "@tauri-apps/api/core";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";

export interface NativeStatus {
  platform: string;
  engine: string;
  recordingSupported: boolean;
  transcriptionSupported: boolean;
}

export interface TranscriptPreview {
  title: string;
  text: string;
  durationSeconds: number;
}

export interface RecordingStatus {
  isRecording: boolean;
  path: string | null;
  appName: string | null;
  windowTitle: string | null;
  durationSeconds: number | null;
}

export interface TranscriptionResult {
  audioPath: string;
  text: string;
  appName: string | null;
  durationSeconds: number | null;
}

export interface WhisperModelInfo {
  name: string;
  displayName: string;
  size: number;
  url: string;
  downloaded: boolean;
  recommended: boolean;
}

export interface HotkeyDiagnostics {
  currentShortcut: string;
  triggerMode: "toggle" | "pushToTalk";
  accessibilityTrusted: boolean;
  eventTapActive: boolean;
  eventTapError: string | null;
  hasDownloadedModel: boolean;
  isRecording: boolean;
}

export async function getNativeStatus() {
  return invoke<NativeStatus>("native_status");
}

export async function requestMicrophonePermission() {
  return invoke<void>("request_microphone_permission");
}

export async function transcribeSample() {
  return invoke<TranscriptPreview>("transcribe_sample");
}

export async function getRecordingStatus() {
  return invoke<RecordingStatus>("recording_status");
}

export async function startRecording() {
  return invoke<RecordingStatus>("start_recording");
}

export async function stopRecording() {
  return invoke<RecordingStatus>("stop_recording");
}

export async function transcribeRecording(
  audioPath: string,
  modelName?: string,
  dictionary?: string,
  contextAppName?: string | null,
  contextWindowTitle?: string | null
) {
  return invoke<TranscriptionResult>("transcribe_recording", {
    audioPath,
    modelName,
    dictionary,
    contextAppName,
    contextWindowTitle,
  });
}

export async function listWhisperModels() {
  return invoke<WhisperModelInfo[]>("whisper_models");
}

export async function downloadWhisperModel(modelName: string) {
  return invoke<WhisperModelInfo>("download_whisper_model", { modelName });
}

export async function deleteWhisperModel(modelName: string) {
  return invoke<void>("delete_whisper_model", { modelName });
}

export async function getCurrentShortcut() {
  return invoke<string>("get_current_shortcut");
}

export async function setGlobalShortcut(shortcutStr: string) {
  return invoke<void>("set_global_shortcut", { shortcutStr });
}

export async function checkAccessibilityPermission() {
  return invoke<boolean>("check_accessibility_permission");
}

export async function requestAccessibilityPermission() {
  return invoke<boolean>("request_accessibility_permission");
}

export async function getTriggerMode() {
  return invoke<"toggle" | "pushToTalk">("get_trigger_mode");
}

export async function setTriggerMode(mode: "toggle" | "pushToTalk") {
  return invoke<void>("set_trigger_mode", { mode });
}

export async function setNativeDictionary(dictionary: string) {
  return invoke<void>("set_dictionary", { dictionary });
}

export async function setTranscriptFormattingMode(
  mode: "auto" | "plain" | "developer"
) {
  return invoke<void>("set_transcript_formatting_mode", { mode });
}

export async function setEditableFocusContext(isEditableFocused: boolean) {
  return invoke<void>("set_editable_focus_context", { isEditableFocused });
}

export async function getHotkeyDiagnostics() {
  return invoke<HotkeyDiagnostics>("hotkey_diagnostics");
}

export async function resolveAppIcon(appName: string) {
  return invoke<string | null>("resolve_app_icon", { appName });
}

export async function getStartAtLogin() {
  return isAutostartEnabled();
}

export async function setStartAtLogin(enabled: boolean) {
  if (enabled) {
    await enableAutostart();
    return;
  }

  await disableAutostart();
}

const EVENT_TAP_ONLY_SHORTCUTS = new Set([
  "AltLeft",
  "AltRight",
  "Globe",
  "Fn",
  "Lang1",
]);

export function isEventTapOnlyShortcut(shortcut: string): boolean {
  return EVENT_TAP_ONLY_SHORTCUTS.has(shortcut);
}

export const DEFAULT_HOTKEY = "Meta+Shift+Space";

/** Human-readable label for a shortcut string like "Meta+Shift+Space" */
export function formatShortcut(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => {
      switch (part) {
        case "Meta":
          return "⌘";
        case "Shift":
          return "⇧";
        case "Ctrl":
        case "Control":
          return "⌃";
        case "Alt":
        case "Option":
        case "AltLeft":
          return "⌥L";
        case "AltRight":
          return "⌥R";
        case "Globe":
        case "Fn":
        case "Lang1":
          return "🌐";
        case "Space":
          return "Space";
        default:
          // Strip "Key" prefix: KeyD → D
          return part.replace(/^Key/, "");
      }
    })
    .join("");
}
