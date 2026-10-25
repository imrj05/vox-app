import { Download } from "lucide-react";
import { HeroDemo } from "@/components/demos/hero-demo";
import { EngineTicker } from "@/components/sections/engine-ticker";
import { Button } from "@/components/ui/button";
import { PAGE_CONTAINER } from "@/lib/layout";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <div
        className={cn(
          PAGE_CONTAINER,
          "flex flex-col items-start py-8 sm:mt-10 sm:py-20"
        )}
      >
        <a
          href={SITE.releasesUrl}
          target="_blank"
          rel="noreferrer"
          className="group mb-6 mt-10 inline-flex max-w-full items-center gap-2 bg-mint px-3 py-1 text-[10px] leading-snug text-mint-foreground transition-colors hover:bg-mint/80 sm:mb-8 sm:text-sm md:mt-0"
        >
          <span aria-hidden="true" className="relative flex size-2 shrink-0">
            <span className="absolute inline-flex size-full animate-ping bg-mint-foreground opacity-60" />
            <span className="relative inline-flex size-2 bg-mint-foreground" />
          </span>
          <span>
            v{SITE.version} — dictation that never leaves your Mac
          </span>
        </a>

        <h1 className="text-left text-[32px] font-medium leading-[1.05] tracking-[-1.5px] text-balance sm:text-6xl sm:tracking-[-2.3px] lg:text-[53px]">
          Speak. It lands at the cursor.
        </h1>

        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-foreground/70 sm:text-lg">
          Press a hotkey, speak, and the words land at the cursor in any macOS
          app. Apple Speech, Parakeet, and Whisper, all running on this machine.
        </p>

        <div className="mt-8 flex w-full max-w-xl flex-col border border-border bg-card sm:flex-row sm:items-stretch">
          <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
            <span aria-hidden="true" className="size-2 shrink-0 bg-primary" />
            <span className="truncate font-mono text-xs text-foreground sm:text-[13px]">
              Vox-v{SITE.version}.dmg
            </span>
            <span className="ml-auto hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground sm:inline">
              universal
            </span>
          </div>
          <Button
            asChild
            size="lg"
            className="h-auto shrink-0 justify-center px-6 py-3.5"
          >
            <a href={SITE.downloadUrl}>
              Download
              <Download className="size-4" />
            </a>
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          macOS 10.15 or newer · Apple Silicon &amp; Intel · Free, no account
        </p>

        <div className="mt-14 w-full">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Transcription engines
          </p>
          <EngineTicker />
          <p className="mt-6 text-[10px] text-muted-foreground md:text-xs">
            Whisper models download once. Audio never leaves the machine.{" "}
            <a
              href="#privacy"
              className="font-medium text-foreground underline underline-offset-4"
            >
              How privacy works
            </a>
          </p>
        </div>

        <div className="mt-8 w-full sm:mt-10">
          <HeroDemo />
        </div>
      </div>
    </section>
  );
}
