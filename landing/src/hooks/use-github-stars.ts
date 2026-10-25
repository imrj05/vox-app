import { useEffect, useState } from "react";
import { fetchGitHubStars, getCachedStars } from "@/lib/github";

export type GitHubStarsStatus = "loading" | "ready" | "error";

/**
 * Shared GitHub star count. The session cache and in-flight promise mean the
 * header and footer trigger at most one request between them.
 */
export function useGitHubStars() {
  const [count, setCount] = useState<number | null>(getCachedStars);
  const [status, setStatus] = useState<GitHubStarsStatus>(
    count === null ? "loading" : "ready"
  );

  useEffect(() => {
    if (count !== null) return;

    let active = true;

    fetchGitHubStars()
      .then((value) => {
        if (!active) return;
        setCount(value);
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });

    return () => {
      active = false;
    };
  }, [count]);

  return { count, status } as const;
}
