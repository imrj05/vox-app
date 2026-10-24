import { useState } from "react";
import { Github, ShieldCheck, Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { useAppStore } from "@/store/app-store";

/**
 * First-run gate: shown when the user is not signed in. Kicks off the
 * PocketBase GitHub OAuth flow, which opens the default browser and returns
 * the result to the app over PocketBase's realtime connection.
 */
export function GithubLogin() {
  const { signInWithGithub, skipAuth } = useAppStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGithub();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const lower = message.toLowerCase();
      if (lower.includes("cancelled")) {
        setError("Sign-in was cancelled.");
      } else if (lower.includes("timed out")) {
        setError(message);
      } else {
        setError(
          "Couldn't reach the Vox server. Check your connection and try again."
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSkip = async () => {
    setBusy(true);
    setError(null);
    try {
      await skipAuth();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full overflow-hidden bg-background px-6 pb-5 pt-11">
      <div className="mx-auto flex h-full w-full max-w-md flex-col items-center justify-center">
        <div className="w-full rounded-2xl border border-border bg-card p-8 shadow-sm">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-background">
              <Logo className="h-8 w-8" />
            </div>
            <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">
              Welcome to Vox
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Sign in with GitHub to sync your voice notes, transcripts, and
              settings across devices.
            </p>
          </div>

          <div className="mt-7">
            <Button
              size="lg"
              className="w-full gap-2.5 bg-[#24292f] text-white hover:bg-[#24292f]/90 dark:bg-[#f7ede8] dark:text-[#0d0a0a] dark:hover:bg-[#f7ede8]/90"
              onClick={() => void handleSignIn()}
              disabled={busy}
            >
              {busy ? (
                <Sparkles className="size-4 animate-pulse" />
              ) : (
                <Github className="size-4" />
              )}
              {busy ? "Opening your browser…" : "Continue with GitHub"}
            </Button>

            {!busy && !error && (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                You'll be taken to GitHub in your default browser, then returned
                to Vox after you authorize.
              </p>
            )}

            {error && (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-xs text-destructive"
              >
                {error}
              </p>
            )}

            <div className="mt-4 flex items-center justify-center">
              <button
                type="button"
                onClick={() => void handleSkip()}
                disabled={busy}
                className="cursor-pointer text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
              >
                Skip for now
              </button>
            </div>
          </div>

          <div className="mt-7 flex items-center justify-center gap-2 border-t border-border pt-5 text-[11px] text-muted-foreground">
            <ShieldCheck className="size-3.5 shrink-0" />
            <span>
              We don't store any data in the cloud — everything stays on this
              device. Your account is used only for analytics.
            </span>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By continuing you agree to the Vox terms of service and privacy policy.
        </p>
      </div>
    </div>
  );
}
