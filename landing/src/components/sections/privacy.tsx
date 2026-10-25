import { PRIVACY_ROWS } from "@/data/content";
import { PAGE_CONTAINER } from "@/lib/layout";
import { cn } from "@/lib/utils";

export function Privacy() {
  return (
    <section id="privacy" className="scroll-mt-20 py-16 sm:py-24">
      <div
        className={cn(
          PAGE_CONTAINER,
          "grid gap-10 lg:grid-cols-12 lg:gap-16"
        )}
      >
        <div className="lg:col-span-6">
          <h2 className="max-w-[16ch] text-4xl font-medium leading-[1.02] tracking-[-1.5px] text-balance sm:text-5xl">
            Your voice doesn't need a server.
          </h2>
          <p className="mt-5 max-w-[46ch] text-base leading-relaxed text-foreground/70 sm:text-lg">
            Recording, transcription, and cleanup happen on this Mac. There is
            no upload path to switch off, because there isn't one.
          </p>
          <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Network requests · none
          </p>
        </div>

        <div className="lg:col-span-6">
          <div className="border border-code-edge bg-code font-mono text-code-text">
            <div className="flex items-center justify-between gap-4 border-b border-code-edge px-4 py-3 sm:px-5">
              <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-code-muted">
                <span aria-hidden="true" className="size-1.5 bg-mint" />
                on-device
              </span>
              <span className="text-[10px] uppercase tracking-[0.14em] text-code-muted">
                0 requests
              </span>
            </div>

            <dl className="px-4 sm:px-5">
              {PRIVACY_ROWS.map((row) => (
                <div
                  key={row.label}
                  className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-code-edge py-3.5 last:border-b-0"
                >
                  <dt className="text-[10px] uppercase tracking-[0.14em] text-code-muted">
                    {row.label}
                  </dt>
                  <dd className="text-xs text-code-text sm:text-right sm:text-[13px]">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>

            <p className="border-t border-code-edge px-4 py-3 text-[10px] leading-5 text-code-muted sm:px-5">
              mic <span className="text-code-muted/50">→</span> metal{" "}
              <span className="text-code-muted/50">→</span> cursor · nothing in
              between
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
