import { invoke } from "@tauri-apps/api/core";

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
  durationSeconds: number | null;
}

export interface TranscriptionResult {
  audioPath: string;
  text: string;
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

export async function transcribeRecording(audioPath: string, modelName?: string) {
  return invoke<TranscriptionResult>("transcribe_recording", { audioPath, modelName });
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

export async function getHotkeyDiagnostics() {
  return invoke<HotkeyDiagnostics>("hotkey_diagnostics");
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
