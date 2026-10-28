import { Mic, XSquare } from "@/components/icons";
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
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={isRecording ? "Stop dictation" : "Start dictation"}
      aria-pressed={isRecording}
      className={cn(
        "group relative flex size-20 shrink-0 items-center justify-center rounded-full",
        "transition-transform duration-200 ease-out active:scale-[0.94]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100"
      )}
    >
      {/* Rotating conic ring while recording (masked to a hairline) */}
      <span
        aria-hidden="true"
        className={cn(
          "record-state-ring absolute -inset-1.5 rounded-full opacity-0 transition-opacity duration-500",
          isRecording && "opacity-100"
        )}
      />
      {/* Core */}
      <span
        className={cn(
          "relative flex size-full items-center justify-center rounded-full transition-[filter,background-color] duration-300",
          isRecording
            ? "bg-destructive text-destructive-foreground"
            : "bg-primary text-primary-foreground",
          !disabled && "group-hover:brightness-[1.06]"
        )}
      >
        {isRecording ? (
          <XSquare className="size-7" />
        ) : (
          <Mic className="size-7" />
        )}
      </span>
    </button>
  );
}
