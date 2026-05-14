import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/sidebar";
import { SettingsModal } from "@/components/settings-modal";
import { Onboarding } from "@/components/onboarding";
import { HomePage } from "@/pages/home";
import { ModelsPage } from "@/pages/models";
import { setGlobalShortcut, setTriggerMode } from "@/lib/native";
import { useAppStore } from "@/store/app-store";

const pageTitles: Record<string, string> = {
  home: "Home",
  models: "Models",
};

function App() {
  const { onboardingComplete, hotkey, triggerMode, hydrate } = useAppStore();
  const [activeNav, setActiveNav] = useState("home");
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  // Still loading from DB
  if (onboardingComplete === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">
          Loading…
        </span>
      </div>
    );
  }

  const renderPage = () => {
    switch (activeNav) {
      case "home":
        return <HomePage />;
      case "models":
        return <ModelsPage />;
      default:
        return <HomePage />;
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      {!onboardingComplete ? (
        <Onboarding />
      ) : (
        <div className="flex h-full w-full overflow-hidden">
          <Sidebar
            activeNav={activeNav}
            onNavChange={setActiveNav}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          <main className="flex flex-col h-full flex-1 overflow-hidden bg-background">
            <div
              className="h-10 shrink-0 flex items-center px-6 border-b border-border"
              data-tauri-drag-region
            >
              <h1 className="text-sm font-semibold text-foreground">
                {pageTitles[activeNav]}
              </h1>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {renderPage()}
            </div>
          </main>
        </div>
      )}
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </TooltipProvider>
  );
}

export default App;
