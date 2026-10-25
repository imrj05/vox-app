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
import { useAppStore, type EngineFallbackTarget } from "@/store/app-store";
import {
  getTranscriptionEngines,
  listWhisperModels,
  type TranscriptionEngineStatus,
  type WhisperModelInfo,
} from "@/lib/native";
import { activeModelLabel } from "@/lib/model-label";
import { cn } from "@/lib/utils";

const fallbackOptions: Array<{ value: EngineFallbackTarget; label: string }> = [
  { value: "apple", label: "Apple Speech" },
  { value: "whisper", label: "Whisper" },
  { value: "parakeet", label: "Parakeet" },
];

export function TranscriptionSection() {
  const {
    engine,
    selectedModel,
    engineFallbackEnabled,
    setEngineFallbackEnabled,
    preferredEngineFallback,
    setPreferredEngineFallback,
    language,
  } = useAppStore();
  const [engines, setEngines] = useState<TranscriptionEngineStatus[]>([]);
  const [models, setModels] = useState<WhisperModelInfo[]>([]);

  useEffect(() => {
    let ignore = false;
    void getTranscriptionEngines()
      .then((list) => {
        if (!ignore) setEngines(list);
      })
      .catch(() => {});
    void listWhisperModels()
      .then((list) => {
        if (!ignore) setModels(list);
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, []);

  const statusFor = (value: string) =>
    engines.find((e) => e.id === value);
  const activeStatus = statusFor(engine);
  const activeLabel = activeModelLabel(engine, selectedModel, models);
  const showParakeetWarning =
    engine === "parakeet" && (language === "hi" || language === "hinglish");

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Transcription"
        description="What Vox runs for dictation, and what happens when it cannot."
      />

      <SettingsCard className="space-y-4">
        <SettingRow
          icon={<Mic className="h-4 w-4" />}
          title="Active model"
          description={`Dictation runs on ${activeLabel}. Choose a different model — or Apple on-device — on the Models page.`}
          action={
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
                activeStatus?.available
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  activeStatus?.available ? "bg-primary" : "bg-muted-foreground/50"
                )}
                aria-hidden="true"
              />
              {activeStatus?.available ? "Ready" : "Unavailable"}
            </span>
          }
        />
        {activeStatus && !activeStatus.available && activeStatus.reason ? (
          <p className="text-xs leading-5 text-muted-foreground">
            {activeStatus.reason}
          </p>
        ) : null}
        {showParakeetWarning ? (
          <Notice
            icon={<TriangleAlertIcon className="h-4 w-4" />}
            title="Parakeet doesn’t support Hindi or Hinglish"
          >
            Parakeet models only understand English and some European
            languages. Choose a Whisper model on the Models page to dictate in
            Hindi or Hinglish.
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
