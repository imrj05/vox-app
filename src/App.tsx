import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Sidebar } from "@/components/sidebar";
import { Onboarding } from "@/components/onboarding";
import { HomePage } from "@/pages/home";
import { ModelsPage } from "@/pages/models";
import { SettingsPage } from "@/pages/settings";
import { AboutPage } from "@/pages/about";
import {
  setGlobalShortcut,
  setEditableFocusContext,
  setNativeDictionary,
  setTranscriptFormattingMode,
  setTriggerMode,
} from "@/lib/native";
import { useAppStore } from "@/store/app-store";
function App() {
  const {
    onboardingComplete,
    hotkey,
    triggerMode,
    dictionary,
    theme,
    transcriptFormattingMode,
    hydrate,
  } = useAppStore();
  const [activeNav, setActiveNav] = useState("home");
  // Hydrate store from SQLite on mount
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  // Re-register saved hotkey with Rust once hydrated
  useEffect(() => {
    if (!hotkey) return;
    void setGlobalShortcut(hotkey).catch(() => {});
  }, [hotkey]);
  // Sync trigger mode to Rust once hydrated
  useEffect(() => {
    if (!triggerMode) return;
    void setTriggerMode(triggerMode).catch(() => {});
  }, [triggerMode]);
  // Sync dictionary for background hotkey transcriptions handled in Rust
  useEffect(() => {
    void setNativeDictionary(dictionary).catch(() => {});
  }, [dictionary]);
  useEffect(() => {
    void setTranscriptFormattingMode(transcriptFormattingMode).catch(() => {});
  }, [transcriptFormattingMode]);
  useEffect(() => {
    const isEditableElement = (element: Element | null) => {
      if (!(element instanceof HTMLElement)) return false;
      return (
        element.isContentEditable ||
        element instanceof HTMLTextAreaElement ||
        (element instanceof HTMLInputElement && !element.readOnly && !element.disabled)
      );
    };

    const syncEditableFocus = () => {
      void setEditableFocusContext(isEditableElement(document.activeElement)).catch(() => {});
    };

    syncEditableFocus();
    document.addEventListener("focusin", syncEditableFocus);
    document.addEventListener("focusout", syncEditableFocus);

    return () => {
      document.removeEventListener("focusin", syncEditableFocus);
      document.removeEventListener("focusout", syncEditableFocus);
    };
  }, []);
  useEffect(() => {
    const applyTheme = () => {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "system" && prefersDark)
      );
    };
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);
  // Still loading from DB
  if (onboardingComplete === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background px-6">
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
          <Spinner className="size-5" />
          <div>
            <p className="text-sm font-medium text-foreground">Preparing Vox</p>
            <p className="text-xs text-muted-foreground">Loading your workspace and preferences.</p>
          </div>
        </div>
      </div>
    );
  }
  const renderPage = () => {
    switch (activeNav) {
      case "home":
        return <HomePage />;
      case "models":
        return <ModelsPage />;
      case "settings":
        return <SettingsPage />;
      case "about":
        return <AboutPage />;
      default:
        return <HomePage />;
    }
  };
  return (
    <TooltipProvider delayDuration={300}>
      {!onboardingComplete ? (
        <Onboarding />
      ) : (
        <SidebarProvider className="h-full" defaultOpen>
          <Sidebar
            activeNav={activeNav}
            onNavChange={setActiveNav}
          />
          <SidebarInset className="overflow-hidden">
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {renderPage()}
            </div>
          </SidebarInset>
        </SidebarProvider>
      )}
    </TooltipProvider>
  );
}
export default App;
