import { CheckCircle2, ShieldAlert } from "@/components/icons";
import { cn } from "@/lib/utils";

interface AppToastProps {
  title: string;
  detail?: string;
  tone?: "success" | "warning";
  /** Optional inline action, e.g. "Undo". Makes the toast interactive. */
  action?: { label: string; onClick: () => void };
}

export function AppToast({
  title,
  detail,
  tone = "success",
  action,
}: AppToastProps) {
  const isWarning = tone === "warning";

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-[100] max-w-sm rounded-2xl border border-border bg-card/95 px-4 py-3 backdrop-blur-xl",
        action ? "pointer-events-auto" : "pointer-events-none"
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={isWarning ? "text-destructive" : "text-primary"}
        >
          {isWarning ? (
            <ShieldAlert className="h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {title}
          </p>
          {detail && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {detail}
            </p>
          )}
        </div>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="shrink-0 cursor-pointer rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
