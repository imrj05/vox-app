import type { WhisperModelInfo } from "@/lib/native";

/**
 * Label for the model that will actually run for a transcription, honoring
 * the engine selection (spec §7). The pinned `selectedModel` names the model
 * of the selected engine family — including Parakeet, which is pinned the
 * same way as Whisper. Apple Speech uses the OS recognizer, so it has no model
 * file to name.
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
    // The pinned Parakeet model wins; without a usable pin the engine falls
    // back to its own pick order (v3 first, like the router).
    const pinned = models?.find((model) => model.name === selectedModel && model.downloaded);
    if (pinned) {
      return pinned.displayName;
    }
    if (!models) {
      return "Parakeet (auto-picked)";
    }
    const parakeet = models.filter((model) => model.name.startsWith("parakeet"));
    const active =
      parakeet.find((model) => model.name === "parakeet-ultra" && model.downloaded) ??
      parakeet.find((model) => model.name.includes("v3") && model.downloaded) ??
      parakeet.find((model) => model.downloaded);
    return active ? `${active.displayName} (auto-picked)` : "No Parakeet model downloaded";
  }

  // Whisper (explicit pin) — show the resolved display name when known.
  return models?.find((model) => model.name === selectedModel)?.displayName ?? selectedModel;
}
