import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import {
  Mic,
  ShieldCheck,
  Cpu,
  TriangleAlertIcon,
  FileText,
} from "@/components/icons";
import {
  Notice,
  OptionGrid,
  OptionTile,
  SectionHeader,
  SettingGroupHeader,
  SettingRow,
  SettingsCard,
} from "@/components/settings-primitives";
import {
  useAppStore,
  type EngineFallbackTarget,
  type TranscriptionEngine,
} from "@/store/app-store";
import {
  getTranscriptionEngines,
  type TranscriptionEngineStatus,
} from "@/lib/native";

const engineOptions: Array<{
  value: TranscriptionEngine;
  label: string;
  description: string;
}> = [
  {
    value: "auto",
    label: "Automatic",
    description:
      "Vox picks the best installed engine for the current language and your hardware.",
  },
  {
    value: "whisper",
    label: "Whisper",
    description:
      "Multilingual, GPU-accelerated on Apple Silicon. Best for Hindi and Hinglish.",
  },
  {
    value: "parakeet",
    label: "Parakeet",
    description: "Fast English transcription on Apple Silicon. English only.",
  },
  {
    value: "apple",
    label: "Apple Speech",
    description:
      "Built into macOS — nothing to download. On-device with OS-provided recognizers.",
  },
];

const fallbackOptions: Array<{ value: EngineFallbackTarget; label: string }> = [
  { value: "apple", label: "Apple Speech" },
  { value: "whisper", label: "Whisper" },
  { value: "parakeet", label: "Parakeet" },
];

export function TranscriptionSection() {
  const {
    engine,
    setEngine,
    engineFallbackEnabled,
    setEngineFallbackEnabled,
    preferredEngineFallback,
    setPreferredEngineFallback,
    language,
  } = useAppStore();
  const [engines, setEngines] = useState<TranscriptionEngineStatus[]>([]);

  useEffect(() => {
    let ignore = false;
    void getTranscriptionEngines()
      .then((list) => {
        if (!ignore) setEngines(list);
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, []);

  const statusFor = (value: string) =>
    engines.find((e) => e.id === value);
  const showParakeetWarning =
    engine === "parakeet" && (language === "hi" || language === "hinglish");

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Transcription"
        description="Choose which speech-to-text engine Vox uses and what happens when it cannot."
      />

      <SettingsCard className="space-y-4">
        <SettingGroupHeader
          icon={<Mic className="h-4 w-4" />}
          title="Engine"
          description="All engines run locally on your device. Automatic picks the fastest engine that supports your language."
        />
        <OptionGrid label="Transcription engine" className="sm:grid-cols-2">
          {engineOptions.map((option) => {
            const status = statusFor(option.value);
            const unavailable =
              option.value !== "auto" && status && !status.available;
            return (
              <OptionTile
                key={option.value}
                selected={engine === option.value}
                onSelect={() => void setEngine(option.value)}
                title={option.label}
                description={
                  unavailable
                    ? status?.reason ?? option.description
                    : option.description
                }
                disabled={unavailable}
                disabledReason={status?.reason ?? undefined}
                status={
                  status
                    ? {
                        label: status.available ? "Ready" : "Unavailable",
                        ok: status.available,
                      }
                    : undefined
                }
              />
            );
          })}
        </OptionGrid>
        {showParakeetWarning ? (
          <Notice
            icon={<TriangleAlertIcon className="h-4 w-4" />}
            title="Parakeet doesn’t support Hindi or Hinglish"
          >
            Parakeet models only understand English and some European
            languages. Vox will automatically transcribe your Hindi dictation
            with Whisper instead — or switch the engine to Whisper or
            Automatic for the best results.
          </Notice>
        ) : null}
      </SettingsCard>

      <SettingsCard className="space-y-4">
        <SettingRow
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Fallback"
          description="If the selected engine cannot transcribe (missing model, runtime error), automatically try another engine and tell you about the switch."
          action={
            <Switch
              id="engine-fallback"
              aria-label="Engine fallback"
              checked={engineFallbackEnabled}
              onCheckedChange={(checked) =>
                void setEngineFallbackEnabled(checked)
              }
            />
          }
        />
        {engineFallbackEnabled ? (
          <>
            <div className="h-px bg-border" />
            <SettingGroupHeader
              icon={<Cpu className="h-4 w-4" />}
              title="Preferred fallback"
              description="The engine to try first when the selected one fails."
            />
            <OptionGrid
              label="Preferred fallback engine"
              className="sm:grid-cols-3"
            >
              {fallbackOptions.map((option) => (
                <OptionTile
                  key={option.value}
                  dense
                  selected={preferredEngineFallback === option.value}
                  onSelect={() =>
                    void setPreferredEngineFallback(option.value)
                  }
                  title={option.label}
                />
              ))}
            </OptionGrid>
          </>
        ) : null}
      </SettingsCard>

      <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <FileText className="h-3.5 w-3.5 shrink-0" />
        Download, switch, or remove speech models on the{" "}
        <span className="font-medium text-foreground">Models</span> page in the
        sidebar.
      </p>
    </div>
  );
}
