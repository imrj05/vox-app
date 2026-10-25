import { Star } from "lucide-react";
import { GitHubIcon } from "@/components/icons";
import { useGitHubStars } from "@/hooks/use-github-stars";
import { formatStarCount } from "@/lib/github";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

interface GitHubStarProps {
  className?: string;
  /** Keep the count visible on very narrow screens (used in the footer). */
  alwaysShowCount?: boolean;
}

export function GitHubStar({
  className,
  alwaysShowCount = false,
}: GitHubStarProps) {
  const { count, status } = useGitHubStars();
  const formatted = count === null ? null : formatStarCount(count);
  const label =
    count === null
      ? "Vox on GitHub"
      : `Vox on GitHub — ${count.toLocaleString("en-US")} ${
          count === 1 ? "star" : "stars"
        }`;

  return (
    <a
      href={SITE.repository}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 border border-border bg-background px-2 text-sm font-medium text-foreground transition-colors hover:bg-card sm:gap-2 sm:px-3",
        className
      )}
    >
      <GitHubIcon className="size-4 shrink-0" />
      <span className="hidden sm:inline">Star</span>

      {status !== "error" && (
        <span
          className={cn(
            "items-center gap-1 text-muted-foreground",
            alwaysShowCount ? "flex" : "hidden min-[360px]:flex"
          )}
        >
          <Star
            className="size-3.5 shrink-0 fill-current"
            aria-hidden="true"
          />
          {formatted !== null ? (
            <span className="text-xs tabular-nums sm:text-sm">{formatted}</span>
          ) : (
            <span
              aria-hidden="true"
              className="inline-block h-3 w-6 animate-pulse bg-muted"
            />
          )}
        </span>
      )}
    </a>
  );
}
