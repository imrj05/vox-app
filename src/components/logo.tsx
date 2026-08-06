interface LogoProps {
  className?: string
  alt?: string
}

/**
 * Vox logo that adapts to the active theme.
 * - `logo-dark.png` is a dark mark for light backgrounds.
 * - `logo-light.png` is a light mark for dark backgrounds.
 * The `dark:` variant (`.dark` on <html>) picks the right one.
 */
export function Logo({ className = "h-8 w-8", alt = "Vox" }: LogoProps) {
  return (
    <>
      <img
        src="/logo-dark.png"
        alt={alt}
        className={`object-contain dark:hidden ${className}`}
      />
      <img
        src="/logo-light.png"
        alt={alt}
        className={`hidden object-contain dark:block ${className}`}
      />
    </>
  )
}
