import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { Sidebar } from "@/components/sidebar";
import { Onboarding } from "@/components/onboarding";
import { HomePage } from "@/pages/home";
import { ModelsPage } from "@/pages/models";
import { SettingsPage } from "@/pages/settings";
import { setGlobalShortcut, setTriggerMode } from "@/lib/native";
import { useAppStore } from "@/store/app-store";
const pageTitles: Record<string, string> = {
  home: "Home",
  models: "Models",
  settings: "Settings",
};
function App() {
  const { onboardingComplete, hotkey, triggerMode, hydrate } = useAppStore();
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
      case "settings":
        return <SettingsPage />;
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
          </SidebarInset>
        </SidebarProvider>
      )}
    </TooltipProvider>
  );
}
export default App;
