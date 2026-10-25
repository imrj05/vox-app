import { useEffect, useState } from "react";

/**
 * Tracks which section is currently in the reading band below the sticky
 * header. Used by the walkthrough's left-hand list.
 */
export function useScrollSpy(sectionIds: readonly string[], initialId: string) {
  const [activeId, setActiveId] = useState(initialId);

  useEffect(() => {
    const sections = sectionIds
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);

    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: "-25% 0px -55% 0px", threshold: 0 }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [sectionIds]);

  return [activeId, setActiveId] as const;
}
