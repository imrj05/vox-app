interface LogoProps {
  className?: string
  alt?: string
}

/**
 * Vox logo mark (`public/logo.png`, 512×512 with transparency). A single
 * asset is used for both light and dark themes — the mark's glow and white
 * accents keep it legible on either background.
 */
export function Logo({ className = "h-8 w-8", alt = "Vox" }: LogoProps) {
  return (
    <img
      src="/logo.png"
      alt={alt}
      className={`object-contain ${className}`}
    />
  )
}