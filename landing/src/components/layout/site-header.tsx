import wordmark from "@/assets/wordmark.png";
import { GitHubStar } from "@/components/github-star";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { NAV_LINKS } from "@/data/content";
import { PAGE_CONTAINER } from "@/lib/layout";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  return (
    <header id="top" className="sticky top-0 z-50 w-full bg-background">
      <nav
        className={cn(
          PAGE_CONTAINER,
          "flex h-13 items-center justify-between gap-4"
        )}
      >
        <div className="flex flex-1 items-center gap-2.5">
          <a href="#top" className="flex items-center" aria-label="Vox home">
            <img src={wordmark} alt="Vox" className="h-5 w-auto dark:invert" />
          </a>
          <span className="hidden border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground sm:inline">
            macOS
          </span>
        </div>

        <div className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex flex-1 items-center justify-end gap-2">
          <GitHubStar />
          <ThemeToggle />
          <Button asChild>
            <a href={SITE.downloadUrl}>Download</a>
          </Button>
        </div>
      </nav>
    </header>
  );
}
