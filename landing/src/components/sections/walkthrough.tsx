import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { FormatDemo } from "@/components/demos/format-demo";
import { HistoryDemo } from "@/components/demos/history-demo";
import { LandDemo } from "@/components/demos/land-demo";
import { PressDemo } from "@/components/demos/press-demo";
import { RouteDemo } from "@/components/demos/route-demo";
import { SpeakDemo } from "@/components/demos/speak-demo";
import { WALKTHROUGH_STEPS, type DemoId } from "@/data/content";
import { useScrollSpy } from "@/hooks/use-scroll-spy";
import { PAGE_CONTAINER } from "@/lib/layout";
import { cn } from "@/lib/utils";

const DEMOS: Record<DemoId, ReactNode> = {
  press: <PressDemo />,
  speak: <SpeakDemo />,
  land: <LandDemo />,
  route: <RouteDemo />,
  format: <FormatDemo />,
  history: <HistoryDemo />,
};

const STEP_IDS = WALKTHROUGH_STEPS.map((step) => step.id);

export function Walkthrough() {
  const [activeId, setActiveId] = useScrollSpy(STEP_IDS, STEP_IDS[0]);

  return (
    <section id="how" className="scroll-mt-20 py-16 sm:py-24">
      <div className={PAGE_CONTAINER}>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.88fr)_minmax(420px,1.12fr)] lg:gap-16">
          <div className="flex min-w-0 items-start gap-5 sm:gap-10 lg:sticky lg:top-20 lg:self-start">
            <div className="w-full min-w-0">
              <h2 className="mt-3 text-4xl font-medium leading-[0.95] tracking-[-1.5px] text-balance sm:text-5xl">
                Dictate with Vox
              </h2>
              <p className="mt-5 max-w-2xl text-sm leading-6 text-foreground/70 sm:text-lg">
                From a hotkey press to formatted text at the cursor.
              </p>

              <nav
                aria-label="How Vox works"
                className="mt-9 border-l border-foreground/15"
              >
                {WALKTHROUGH_STEPS.map((step) => {
                  const isActive = activeId === step.id;

                  return (
                    <a
                      key={step.id}
                      href={`#${step.id}`}
                      onClick={() => setActiveId(step.id)}
                      aria-current={isActive ? "true" : undefined}
                      className={cn(
                        "-ml-px block w-full border-l px-5 py-3 text-left transition-colors sm:px-6 sm:py-3.5",
                        isActive
                          ? "border-foreground text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <span className="block font-mono text-xs tracking-tight text-foreground/50">
                        {step.label}
                      </span>
                      <span className="mt-1.5 block text-base font-medium tracking-[-0.02em]">
                        {step.title}
                      </span>
                      {isActive && (
                        <span className="mt-2 block max-w-md text-sm leading-6 text-muted-foreground">
                          {step.body}
                        </span>
                      )}
                    </a>
                  );
                })}
              </nav>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-10">
            {WALKTHROUGH_STEPS.map((step) => {
              const external = step.explore.href.startsWith("http");

              return (
                <article key={step.id} id={step.id} className="scroll-mt-24">
                  <div className="demo-panel relative overflow-hidden px-4 py-8 sm:px-10 sm:py-14">
                    <div className="mx-auto w-full max-w-[520px]">
                      {DEMOS[step.id]}
                    </div>
                  </div>
                  <a
                    href={step.explore.href}
                    {...(external
                      ? { target: "_blank", rel: "noreferrer" }
                      : {})}
                    className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-foreground transition-opacity hover:opacity-60"
                  >
                    Explore {step.explore.label}
                    <ArrowUpRight className="size-4" aria-hidden="true" />
                  </a>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
