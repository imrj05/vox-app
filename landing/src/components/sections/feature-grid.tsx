import { Reveal } from "@/components/reveal";
import { FEATURES, type FeatureTone } from "@/data/content";
import { PAGE_CONTAINER } from "@/lib/layout";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<FeatureTone, string> = {
  sky: "feature-card--sky",
  sun: "feature-card--sun",
  coral: "feature-card--coral",
};

export function FeatureGrid() {
  return (
    <section id="engines" className="mt-20 w-full scroll-mt-24 py-16 sm:py-24">
      <div className={PAGE_CONTAINER}>
        <Reveal className="mb-12 flex flex-col gap-8 text-left lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-medium leading-[1.1] tracking-[-1px] text-balance sm:text-4xl sm:tracking-[-1.5px]">
              Hear every word. Send none of them.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-foreground/70 sm:text-lg">
              Vox turns speech into text in any macOS app. The recognizer, the
              cleanup, and the history all live on this machine.
            </p>
          </div>
          <div className="flex shrink-0 gap-8 sm:gap-14 lg:pt-1">
            <div>
              <p className="text-base font-medium tracking-wide text-foreground sm:text-lg">
                Engines
              </p>
              <p className="mt-3 text-4xl font-normal tabular-nums tracking-tight sm:text-5xl">
                3
              </p>
            </div>
            <div>
              <p className="text-base font-medium tracking-wide text-foreground sm:text-lg">
                Cloud calls
              </p>
              <p className="mt-3 text-4xl font-normal tabular-nums tracking-tight sm:text-5xl">
                0
              </p>
            </div>
          </div>
        </Reveal>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-8 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <Reveal key={feature.index} delay={index * 80}>
              <a
                href={feature.href}
                className="group relative block aspect-square w-full overflow-hidden bg-neutral-900 text-left shadow-lg"
              >
                <div
                  aria-hidden="true"
                  className={cn(
                    "feature-card absolute inset-0 scale-105 transition-transform duration-500 ease-out group-hover:scale-100",
                    TONE_CLASS[feature.tone]
                  )}
                />
                <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/40 to-transparent p-5">
                  <span className="absolute left-5 top-5 text-5xl font-normal tabular-nums text-white transition-colors group-hover:text-white/80">
                    {feature.index}
                  </span>
                  <h3 className="mb-3 text-sm text-white sm:text-2xl">
                    {feature.title}
                  </h3>
                  <p className="mt-1 text-xs font-normal leading-relaxed text-white sm:text-sm">
                    {feature.body}
                  </p>
                </div>
              </a>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
