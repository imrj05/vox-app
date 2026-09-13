interface LogoProps {
  className?: string;
  alt?: string;
}

/**
 * Vox logo mark, theme-aware. Renders the light tile on light surfaces and the
 * dark tile on dark surfaces via the `.dark` class the app toggles on `<html>`.
 */
export function Logo({ className = "h-8 w-8", alt = "Vox" }: LogoProps) {
  const base = `object-contain ${className}`;
  return (
    <>
      <img src="/logo-light.png" alt={alt} className={`${base} dark:hidden`} />
      <img
        src="/logo-dark.png"
        alt={alt}
        aria-hidden="true"
        className={`${base} hidden dark:block`}
      />
    </>
  );
}
