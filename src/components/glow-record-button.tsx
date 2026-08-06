import { Mic, Square } from "@/components/icons";
import { cn } from "@/lib/utils";

interface GlowRecordButtonProps {
  isRecording: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function GlowRecordButton({
  isRecording,
  disabled,
  onClick,
}: GlowRecordButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={isRecording ? "Stop recording" : "Start recording"}
      className={cn(
        "relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        isRecording
          ? "bg-destructive text-white focus-visible:ring-destructive"
          : "bg-primary text-primary-foreground focus-visible:ring-primary"
      )}
    >
      {/* Subtle contained pulse ring (does not scale beyond the button) */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 rounded-full",
          isRecording ? "animate-pulse bg-destructive/20" : "animate-pulse bg-primary/10"
        )}
      />
      {/* Icon */}
      <span className="relative z-10">
        {isRecording ? (
          <Square className="h-8 w-8 fill-current" />
        ) : (
          <Mic className="h-8 w-8" />
        )}
      </span>
    </button>
  );
}
