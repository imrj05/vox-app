import { Mic, Square } from "lucide-react";
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
        "relative flex h-20 w-20 items-center justify-center rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40",
        isRecording
          ? "bg-destructive focus-visible:ring-destructive"
          : "bg-primary focus-visible:ring-primary"
      )}
    >
      {/* Outer glow ring */}
      <span
        className={cn(
          "absolute inset-0 rounded-full",
          isRecording
            ? "animate-ping bg-destructive/40"
            : "animate-pulse bg-primary/30"
        )}
      />
      {/* Second ring for depth */}
      <span
        className={cn(
          "absolute -inset-2 rounded-full opacity-20 blur-md",
          isRecording
            ? "bg-destructive"
            : "bg-primary"
        )}
      />
      {/* Icon */}
      <span className="relative z-10 text-white">
        {isRecording ? (
          <Square className="h-8 w-8 fill-white" />
        ) : (
          <Mic className="h-8 w-8" />
        )}
      </span>
    </button>
  );
}
