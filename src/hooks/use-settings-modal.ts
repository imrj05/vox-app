import { useState } from "react";

interface SettingsModalHook {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export function useSettingsModal(): SettingsModalHook {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}
