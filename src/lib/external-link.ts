import { invoke } from "@tauri-apps/api/core";

export function openExternalLink(href: string) {
  void invoke("open_external_link", { href }).catch(() => {
    if (href.startsWith("mailto:")) {
      window.location.href = href;
      return;
    }

    window.open(href, "_blank", "noopener,noreferrer");
  });
}
