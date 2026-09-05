import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Mic, ShieldCheck, Cpu } from "@/components/icons";
import {
  SectionHeader,
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
import { cn } from "@/lib/utils";

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
    description:
      "Fast English transcription on Apple Silicon. English only.",
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

  const statusFor = (value: string) => engines.find((e) => e.id === value);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Transcription"
        description="Choose which speech-to-text engine Vox uses and what happens when it cannot."
      />
      <SettingsCard className="space-y-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Mic className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Engine</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              All engines run locally on your device. Automatic picks the
              fastest engine that supports your language.
            </p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {engineOptions.map((option) => {
            const status = statusFor(option.value);
            const unavailable = option.value !== "auto" && status && !status.available;
            return (
              <button
                key={option.value}
                onClick={() => void setEngine(option.value)}
                disabled={unavailable}
                title={unavailable ? (status?.reason ?? undefined) : undefined}
                className={cn(
                  "rounded-xl border px-3 py-3 text-left transition-colors",
                  engine === option.value
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  unavailable && "cursor-not-allowed opacity-50"
                )}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-medium">
                  {option.label}
                  {status ? (
                    <span
                      className={cn(
                        "text-[10px] font-normal",
                        status.available ? "text-primary" : "text-muted-foreground"
                      )}
                    >
                      {status.available ? "Ready" : "Unavailable"}
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {unavailable
                    ? status?.reason ?? option.description
                    : option.description}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsCard>
      <SettingsCard className="space-y-3">
        <SettingRow
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Fallback"
          description="If the selected engine cannot transcribe (missing model, runtime error), automatically try another engine and tell you about the switch."
          action={
            <Switch
              id="engine-fallback"
              aria-label="Engine fallback"
              checked={engineFallbackEnabled}
              onCheckedChange={(checked) => void setEngineFallbackEnabled(checked)}
            />
          }
        />
        {engineFallbackEnabled ? (
          <>
            <div className="h-px bg-border" />
            <div className="space-y-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <Cpu className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Preferred fallback
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    The engine to try first when the selected one fails.
                  </p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {fallbackOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => void setPreferredEngineFallback(option.value)}

                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors",
                      preferredEngineFallback === option.value
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </SettingsCard>
      <p className="text-xs text-muted-foreground">
        Download, switch, or remove speech models on the{" "}
        <span className="font-medium text-foreground">Models</span> page in the
        sidebar.
      </p>
    </div>
  );
}