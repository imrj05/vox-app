interface WordmarkProps {
  className?: string;
  alt?: string;
}

/**
 * Full Vox wordmark, theme-aware. Used where the brand has horizontal room
 * (sidebar, About). Small surfaces use the square mark from `Logo`.
 */
export function Wordmark({ className = "h-6 w-auto", alt = "Vox" }: WordmarkProps) {
  return (
    <>
      <img
        src="/logo-wordmark-light.png"
        alt={alt}
        className={`${className} dark:hidden`}
      />
      <img
        src="/logo-wordmark-dark.png"
        alt={alt}
        aria-hidden="true"
        className={`${className} hidden dark:block`}
      />
    </>
  );
}
