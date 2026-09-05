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
  /** Raw transcription before AI cleanup, when cleanup was applied. */
  rawText?: string | null;
  /** Language actually used for transcription (auto-detected or pinned). */
  language?: string | null;
  /** Engine that produced the raw transcript ("whisper" | "parakeet" | …). */
  engine?: string | null;
  /** Vocabulary corrections applied to the final text ("shad can" → "shadcn"). */
  corrections?: { source: string; canonical: string }[];
}

/** Hardware awareness (spec §25): what this Mac can comfortably run. */
export interface HardwareInfo {
  platform: string;
  arch: string;
  appleSilicon: boolean;
  totalMemoryBytes: number;
  cpuCores: number;
  tier: "fast" | "balanced" | "accurate";
  maxRecommendedModelBytes: number;
}

/** Availability info for one registered transcription engine (spec §3). */
export interface TranscriptionEngineStatus {
  id: string;
  displayName: string;
  available: boolean;
  reason?: string | null;
}

export type CleanupLevel = "none" | "light" | "medium" | "high";

export interface WhisperModelInfo {
  name: string;
  displayName: string;
  size: number;
  url: string;
  downloaded: boolean;
  recommended: boolean;
}

export interface TextEnhancementModelInfo {
  name: string;
  displayName: string;
  size: number;
  url: string;
  downloaded: boolean;
  recommended: boolean;
}

export interface EnhanceResult {
  originalLength: number;
  enhancedLength: number;
  appName: string | null;
  replacementMethod: "accessibilityValue" | "typingFallback";
}

export interface HotkeyDiagnostics {
  platform: string;
  currentShortcut: string;
  triggerMode: "toggle" | "pushToTalk" | "handsFree";
  accessibilityTrusted: boolean;
  eventTapActive: boolean;
  eventTapError: string | null;
  hasDownloadedModel: boolean;
  isRecording: boolean;
  appDataDir: string | null;
  modelsDir: string | null;
  recordingsDir: string | null;
  textInsertion: {
    directTypingSupported: boolean;
    x11Available: boolean;
    waylandAvailable: boolean;
    xdotoolAvailable: boolean;
    wtypeAvailable: boolean;
    dotoolAvailable: boolean;
    guidance: string | null;
  };
}

export async function getNativeStatus() {
  return invoke<NativeStatus>("native_status");
}

/** Hardware capabilities + recommendation tier for this machine. */
export async function getHardwareInfo() {
  return invoke<HardwareInfo>("get_hardware_info");
}

/** Availability info for one registered transcription engine (spec §3). */
export async function getTranscriptionEngines() {
  return invoke<TranscriptionEngineStatus[]>("get_transcription_engines");
}

export async function requestMicrophonePermission() {
  return invoke<void>("request_microphone_permission");
}

export async function checkMicrophonePermission() {
  return invoke<boolean>("check_microphone_permission");
}

/** Raw macOS mic authorization: 0 not-determined, 1 restricted, 2 denied, 3 authorized. */
export async function microphoneAuthorizationStatus() {
  return invoke<number>("microphone_authorization_status");
}

/** Deep-link into a macOS System Settings privacy pane. */
export function openSystemSettings(pane: "microphone" | "accessibility" | "input_monitoring") {
  return invoke<void>("open_system_settings", { pane });
}

export async function transcribeSample() {
  return invoke<TranscriptPreview>("transcribe_sample");
}

export async function getRecordingStatus() {
  return invoke<RecordingStatus>("recording_status");
}

export async function startRecording(handsFree?: boolean) {
  return invoke<RecordingStatus>("start_recording", { handsFree });
}

export async function stopRecording() {
  return invoke<RecordingStatus>("stop_recording");
}

export async function transcribeRecording(
  audioPath: string,
  modelName?: string,
  contextAppName?: string | null,
  contextWindowTitle?: string | null
) {
  return invoke<TranscriptionResult>("transcribe_recording", {
    audioPath,
    modelName,
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

export async function pauseWhisperDownload(modelName: string) {
  return invoke<void>("pause_whisper_download", { modelName });
}

export async function resumeWhisperDownload(modelName: string) {
  return invoke<void>("resume_whisper_download", { modelName });
}

export async function cancelWhisperDownload(modelName: string) {
  return invoke<void>("cancel_whisper_download", { modelName });
}

export async function deleteWhisperModel(modelName: string) {
  return invoke<void>("delete_whisper_model", { modelName });
}

export async function listTextEnhancementModels() {
  return invoke<TextEnhancementModelInfo[]>("text_enhancement_models");
}

export async function downloadTextEnhancementModel(modelName: string) {
  return invoke<TextEnhancementModelInfo>("download_text_enhancement_model", { modelName });
}

export async function deleteTextEnhancementModel(modelName: string) {
  return invoke<void>("delete_text_enhancement_model", { modelName });
}

export async function setNativeEnhanceIconEnabled(enabled: boolean) {
  return invoke<void>("set_enhance_icon_enabled", { enabled });
}

export async function setNativeEnhancementModel(modelName: string) {
  return invoke<void>("set_enhancement_model", { modelName });
}

export async function enhanceFocusedInput(snapshotId: string) {
  return invoke<EnhanceResult>("enhance_focused_input", { snapshotId });
}

export async function enhanceFocusedInputNow() {
  return invoke<EnhanceResult>("enhance_focused_input_now");
}

export async function hideWidget() {
  return invoke<void>("hide_widget");
}

export async function deleteRecordingFile(audioPath: string) {
  return invoke<void>("delete_recording_file", { audioPath });
}

export async function cleanupRecordings() {
  return invoke<number>("cleanup_recordings");
}

export async function wipeLocalAppFiles() {
  return invoke<void>("wipe_local_app_files");
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

export async function checkInputMonitoringPermission() {
  return invoke<boolean>("check_input_monitoring_permission");
}

export async function requestInputMonitoringPermission() {
  return invoke<boolean>("request_input_monitoring_permission");
}

export async function getTriggerMode() {
  return invoke<"toggle" | "pushToTalk" | "handsFree">("get_trigger_mode");
}

export async function setTriggerMode(mode: "toggle" | "pushToTalk" | "handsFree") {
  return invoke<void>("set_trigger_mode", { mode });
}


export async function setNativeLanguage(language: string) {
  return invoke<void>("set_language", { language });
}

export async function setTranscriptionEngine(engine: string) {
  return invoke<void>("set_transcription_engine", { engine });
}

export async function setEngineFallback(enabled: boolean) {
  return invoke<void>("set_engine_fallback", { enabled });
}

export async function setPreferredEngineFallback(engine: string) {
  return invoke<void>("set_engine_fallback_target", { engine });
}

export async function setNativeVoiceCommandsEnabled(enabled: boolean) {
  return invoke<void>("set_voice_commands_enabled", { enabled });
}

export async function setNativeWhisperMode(enabled: boolean) {
  return invoke<void>("set_whisper_mode", { enabled });
}

export interface NativeSnippet {
  trigger: string;
  expansion: string;
}

export async function setNativeSnippets(snippets: NativeSnippet[]) {
  return invoke<void>("set_snippets", { snippets });
}

export type CustomModelKind = "stt" | "enhance";

export interface CustomModel {
  name: string;
  url: string;
  kind: CustomModelKind;
  size: number;
  downloaded: boolean;
}

export async function listCustomModels() {
  return invoke<CustomModel[]>("list_custom_models");
}

export async function addCustomModel(url: string, kind?: CustomModelKind) {
  return invoke<CustomModel>("add_custom_model", { url, kind });
}

export async function deleteCustomModel(name: string) {
  return invoke<void>("delete_custom_model", { name });
}

export async function setTranscriptFormattingMode(
  mode: "auto" | "plain" | "developer"
) {
  return invoke<void>("set_transcript_formatting_mode", { mode });
}

export async function setCleanupLevel(level: CleanupLevel) {
  return invoke<void>("set_cleanup_level", { level });
}

export async function getCleanupLevel() {
  return invoke<CleanupLevel>("get_cleanup_level");
}

export async function setNativeWidgetEnabled(enabled: boolean) {
  return invoke<void>("set_widget_enabled", { enabled });
}

export async function setNativeErrorReporting(enabled: boolean) {
  const dsn = import.meta.env.VITE_GLITCHTIP_DSN as string | undefined;
  return invoke<void>("set_error_reporting_enabled", {
    enabled,
    dsn: enabled && dsn ? dsn : null,
  });
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
export const TRANSFORM_HOTKEY = "Meta+Shift+V";

export type TransformPreset =
  | "polish"
  | "concise"
  | "professional"
  | "casual"
  | "summarize"
  | "fixGrammar"
  | "promptEngine";

export async function applyTransform(
  text: string,
  preset?: TransformPreset,
  customInstruction?: string
) {
  return invoke<void>("apply_transform", { text, preset, customInstruction });
}

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
