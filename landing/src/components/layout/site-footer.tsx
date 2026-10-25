import { Globe } from "lucide-react";
import wordmark from "@/assets/wordmark.png";
import { GitHubStar } from "@/components/github-star";
import { FOOTER_COLUMNS } from "@/data/content";
import { PAGE_CONTAINER } from "@/lib/layout";
import { SITE } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="w-full overflow-hidden border-t border-border pt-16 text-foreground">
      <div className={PAGE_CONTAINER}>
        <div className="mb-16 grid grid-cols-2 gap-6 md:gap-12 lg:grid-cols-5">
          <div className="col-span-2">
            <div className="flex items-center gap-2.5">
              <img src={wordmark} alt="Vox" className="h-5 w-auto dark:invert" />
              <span className="border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                macOS
              </span>
            </div>
            <p className="mt-4 max-w-xs text-base leading-relaxed text-muted-foreground">
              Private, local-first dictation for macOS. Speak once, and it is
              already typed.
            </p>
            <ul className="mt-6 flex items-center gap-3">
              <li>
                <GitHubStar
                  alwaysShowCount
                  className="h-8 px-2.5 text-[13px]"
                />
              </li>
              <li>
                <a
                  href={SITE.website}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Rajeshwar Kashyap's website"
                  title="Website"
                  className="flex size-8 items-center justify-center border border-border text-foreground transition-colors hover:bg-card"
                >
                  <Globe className="size-4" aria-hidden="true" />
                </a>
              </li>
            </ul>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title}>
              <h3 className="mb-4 text-base font-semibold text-foreground sm:mb-5">
                {column.title}
              </h3>
              <ul className="flex flex-col space-y-3 text-base text-foreground">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...(link.external
                        ? { target: "_blank", rel: "noreferrer" }
                        : {})}
                      className="text-[15px] text-foreground/80 transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-8 text-xs text-foreground/80">
          <span>© 2026 Vox, all rights reserved.</span>
          <span>Built for macOS · updates signed</span>
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none -mb-2 flex w-full select-none items-center justify-center overflow-hidden pt-10 sm:-mb-6 sm:pt-14"
        >
          <span className="footer-wordmark translate-y-[8%] bg-clip-text text-center text-[17vw] font-bold uppercase leading-[0.8] tracking-tighter text-transparent">
            Vox
          </span>
        </div>
      </div>
    </footer>
  );
}
