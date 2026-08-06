import { useCallback, useState } from "react";
import { Check, Copy } from "@/components/icons";
import { Button } from "@/components/ui/button";

interface ErrorFallbackProps {
  error?: Error | null;
  componentStack?: string | null;
  onReset?: (() => void) | null;
}

function serializeError(error?: Error | null, stack?: string | null): string {
  const lines = [
    "Vox encountered an unexpected error.",
    "",
    `Error: ${error?.message ?? "Unknown error"}`,
    "",
  ];
  if (error?.stack) {
    lines.push(error.stack);
  } else if (stack) {
    lines.push(stack);
  } else {
    lines.push("No stack trace available.");
  }
  return lines.join("\n");
}

export function ErrorFallback({ error, componentStack, onReset }: ErrorFallbackProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const text = serializeError(error, componentStack);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [error, componentStack]);

  const handleReload = useCallback(() => {
    window.location.reload();
  }, []);

  const message = error?.message || componentStack || "Unknown error";

  return (
    <div className="flex h-full w-full items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-lg">
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Unexpected error
          </p>
          <h1 className="mt-1 text-xl font-bold text-foreground">Something went wrong</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Vox hit an unexpected error. Copy the details below, then restart the app.
          </p>

          <pre className="mt-4 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs leading-5 text-foreground">
            {message}
          </pre>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void handleCopy()}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy error"}
            </Button>
            {onReset ? (
              <Button size="sm" variant="outline" onClick={onReset}>
                Try again
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={handleReload}>
              Reload app
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
