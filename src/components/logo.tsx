interface LogoProps {
  className?: string
  alt?: string
}

/**
 * Vox logo that adapts to the active theme.
 * - `logo-light.png` is the light-mode mark.
 * - `logo-dark.png` is the dark-mode mark.
 * The `dark:` variant (`.dark` on <html>) picks the right one.
 */
export function Logo({ className = "h-8 w-8", alt = "Vox" }: LogoProps) {
  return (
    <>
      <img
        src="/logo-light.png"
        alt={alt}
        className={`object-contain dark:hidden ${className}`}
      />
      <img
        src="/logo-dark.png"
        alt={alt}
        className={`hidden object-contain dark:block ${className}`}
      />
    </>
  )
}
