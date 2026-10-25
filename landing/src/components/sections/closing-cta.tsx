import { Download } from "lucide-react";
import { Reveal } from "@/components/reveal";
import { Button } from "@/components/ui/button";
import { PAGE_CONTAINER } from "@/lib/layout";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

export function ClosingCta() {
  return (
    <section className="py-24 text-foreground sm:py-32">
      <div className={cn(PAGE_CONTAINER, "flex flex-col items-center text-center")}>
        <Reveal className="flex flex-col items-center">
          <h2 className="max-w-7xl text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">
            Say it once. Move on.
          </h2>
          <p className="mt-3 max-w-2xl text-lg leading-8 text-muted-foreground">
            Vox for macOS. No account, no server, no cloud round trip.
          </p>
          <div className="mt-5 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <a href={SITE.downloadUrl}>
                Download for macOS
                <Download className="size-4" />
              </a>
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
