import { SITE } from "@/lib/site";

const REPOSITORY_API = SITE.repository.replace(
  "https://github.com/",
  "https://api.github.com/repos/"
);

const CACHE_KEY = "vox-github-stars";
const CACHE_TTL_MS = 10 * 60 * 1000;

interface StarsCache {
  count: number;
  fetchedAt: number;
}

function readCache(): number | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StarsCache>;
    if (
      typeof parsed.count !== "number" ||
      typeof parsed.fetchedAt !== "number"
    ) {
      return null;
    }

    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed.count;
  } catch {
    return null;
  }
}

function writeCache(count: number) {
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ count, fetchedAt: Date.now() } satisfies StarsCache)
    );
  } catch {
    // Caching is an optimization; the page still works without it.
  }
}

let inFlight: Promise<number> | null = null;

export function getCachedStars(): number | null {
  return readCache();
}

export function fetchGitHubStars(): Promise<number> {
  if (inFlight) return inFlight;

  inFlight = fetch(REPOSITORY_API, {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`GitHub API responded ${response.status}`);
      }
      return response.json() as Promise<{ stargazers_count?: unknown }>;
    })
    .then((data) => {
      if (typeof data.stargazers_count !== "number") {
        throw new Error("GitHub API returned no star count");
      }
      writeCache(data.stargazers_count);
      return data.stargazers_count;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export function formatStarCount(count: number): string {
  if (count < 1000) return count.toLocaleString("en-US");

  if (count < 1_000_000) {
    const thousands = count / 1000;
    const digits = thousands < 10 ? 1 : 0;
    return `${thousands.toFixed(digits).replace(/\.0$/, "")}k`;
  }

  return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}
