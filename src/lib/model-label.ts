import type { WhisperModelInfo } from "@/lib/native";

/**
 * Label for the model that will actually run for a transcription, honoring
 * the engine selection (spec §7). The pinned `selectedModel` only applies
 * when the Whisper engine is chosen — Apple Speech uses the OS recognizer
 * (no model file) and Parakeet auto-picks its downloaded GGUF.
 *
 * `models` is the downloaded-models list from `listWhisperModels()`; omit it
 * in contexts that have not loaded the list (labels degrade gracefully).
 */
export function activeModelLabel(
  engine: string | null | undefined,
  selectedModel: string,
  models?: WhisperModelInfo[],
): string {
  if (engine === "apple") {
    return "Apple Speech (built-in)";
  }

  if (engine === "parakeet") {
    if (!models) {
      return "Parakeet (auto-picked)";
    }
    const parakeet = models.filter((model) => model.name.startsWith("parakeet"));
    // Prefer v3 first, matching the backend pick order (newest TDT first).
    const active =
      parakeet.find((model) => model.name.includes("v3") && model.downloaded) ??
      parakeet.find((model) => model.downloaded);
    return active ? active.displayName : "No Parakeet model downloaded";
  }

  if (engine === "auto") {
    return "Auto-selected";
  }

  // Whisper (explicit pin) — show the resolved display name when known.
  return models?.find((model) => model.name === selectedModel)?.displayName ?? selectedModel;
}