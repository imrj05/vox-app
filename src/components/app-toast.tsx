import { CheckCircle2, ShieldAlert } from "lucide-react";

interface AppToastProps {
  title: string;
  detail?: string;
  tone?: "success" | "warning";
}

export function AppToast({
  title,
  detail,
  tone = "success",
}: AppToastProps) {
  const isWarning = tone === "warning";

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[100] max-w-sm rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-2xl shadow-black/40 backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <div
          className={isWarning ? "text-destructive" : "text-primary"}
        >
          {isWarning ? (
            <ShieldAlert className="mt-0.5 h-4 w-4" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {title}
          </p>
          {detail && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {detail}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
