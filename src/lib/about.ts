export const ABOUT_VERSION = "0.1.0"
export const ABOUT_REPOSITORY = "https://github.com/imrj05/vox-app"
export const ABOUT_WEBSITE = "https://rajeshwarkashyap.in"
export const ABOUT_EMAIL = "info@rajeshwarkashyap.in"

export const ABOUT_LINKS = [
  {
    label: "Version",
    value: ABOUT_VERSION,
    href: null,
    action: null,
  },
  {
    label: "GitHub repository",
    value: ABOUT_REPOSITORY,
    href: ABOUT_REPOSITORY,
    action: "Open",
  },
  {
    label: "Website",
    value: ABOUT_WEBSITE,
    href: ABOUT_WEBSITE,
    action: "Visit",
  },
  {
    label: "Contact",
    value: ABOUT_EMAIL,
    href: `mailto:${ABOUT_EMAIL}`,
    action: "Email",
  },
] as const
