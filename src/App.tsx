import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Sidebar } from "@/components/sidebar";
import { Onboarding } from "@/components/onboarding";
import { TransformOverlay } from "@/components/transform-overlay";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  setGlobalShortcut,
  setEditableFocusContext,
  setCleanupLevel,
  setNativeDictionary,
  setNativeEnhanceIconEnabled,
  setNativeEnhancementModel,
  setNativeErrorReporting,
  setNativeWidgetEnabled,
  setTranscriptFormattingMode,
  setTriggerMode,
} from "@/lib/native";
import { useAppStore } from "@/store/app-store";
import { getUpdateNotes, renderReleaseNotes } from "@/components/release-notes";
import { configureErrorReporting } from "@/lib/error-reporting";

const HomePage = lazy(() => import("@/pages/home").then(({ HomePage }) => ({ default: HomePage })));
const TranscriptsPage = lazy(() => import("@/pages/transcripts").then(({ TranscriptsPage }) => ({ default: TranscriptsPage })));
const ModelsPage = lazy(() => import("@/pages/models").then(({ ModelsPage }) => ({ default: ModelsPage })));
const SettingsPage = lazy(() => import("@/pages/settings").then(({ SettingsPage }) => ({ default: SettingsPage })));
const AboutPage = lazy(() => import("@/pages/about").then(({ AboutPage }) => ({ default: AboutPage })));

function PageFallback() {
  return (
      <div className="flex min-h-full items-center justify-center bg-background px-6 py-10">
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
        <Spinner className="size-5" />
        <p className="text-sm font-medium text-foreground">Loading page</p>
      </div>
    </div>
  );
}

function App() {
  const {
    onboardingComplete,
    hotkey,
    triggerMode,
    dictionary,
    theme,
    widgetEnabled,
    enhanceIconEnabled,
    enhancementModel,
    transcriptFormattingMode,
    cleanupLevel,
    errorReportingEnabled,
    hydrate,
    updateInfo,
    updateStatus,
    updateProgress,
    updateMessage,
    showUpdateDialog,
    checkForUpdates,
    installUpdate,
    setShowUpdateDialog,
  } = useAppStore();
  const [activeNav, setActiveNav] = useState("home");
  const [transformOpen, setTransformOpen] = useState(false);
  const [transformText, setTransformText] = useState("");
  const [transformError, setTransformError] = useState<string | null>(null);
  const hasCheckedForUpdates = useRef(false);
  // Global model-download progress listener. Keeps progress + in-flight state in
  // the store so it survives navigation and prevents duplicate re-downloads.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ modelName: string; downloaded: number; total: number }>(
      "vox-download-progress",
      (event) => {
        const { modelName, downloaded, total } = event.payload;
        if (!modelName) return;
        const store = useAppStore.getState();
        store.beginModelDownload(modelName);
        store.setModelDownloadProgress(modelName, downloaded, total);
      }
    ).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, []);
  // Hydrate store from SQLite on mount
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("vox-open-settings", () => setActiveNav("settings")).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ text?: string; error?: string }>(
      "vox-show-transform",
      (event) => {
        setTransformOpen(true);
        setTransformText(event.payload.text ?? "");
        setTransformError(event.payload.error ?? null);
      }
    ).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, []);
  // Hydrate store from SQLite on mount
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  // Check for updates once after hydration completes
  useEffect(() => {
    if (onboardingComplete === null) return;
    if (hasCheckedForUpdates.current) return;
    hasCheckedForUpdates.current = true;
    void checkForUpdates();
  }, [onboardingComplete, checkForUpdates]);
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
    void setCleanupLevel(cleanupLevel).catch(() => {});
  }, [cleanupLevel]);
  useEffect(() => {
    void setNativeWidgetEnabled(widgetEnabled).catch(() => {});
  }, [widgetEnabled]);
  useEffect(() => {
    void setNativeEnhanceIconEnabled(enhanceIconEnabled).catch(() => {});
  }, [enhanceIconEnabled]);
  useEffect(() => {
    void setNativeEnhancementModel(enhancementModel).catch(() => {});
  }, [enhancementModel]);
  useEffect(() => {
    if (onboardingComplete === null) return;
    configureErrorReporting(errorReportingEnabled);
    void setNativeErrorReporting(errorReportingEnabled).catch(() => {});
  }, [errorReportingEnabled, onboardingComplete]);
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
  const progressPct =
    updateProgress.total && updateProgress.total > 0
      ? Math.min(100, Math.round((updateProgress.downloaded / updateProgress.total) * 100))
      : null;
  const updateBusy = updateStatus === "downloading" || updateStatus === "installing" || updateStatus === "restarting";

  if (onboardingComplete === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background px-6">
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
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
      case "transcripts":
        return <TranscriptsPage />;
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
      <TransformOverlay
        key={transformOpen ? "open" : "closed"}
        open={transformOpen}
        onClose={() => {
          setTransformOpen(false);
          setTransformText("");
          setTransformError(null);
        }}
        initialText={transformText}
        initialError={transformError}
      />
      <Dialog open={showUpdateDialog} onOpenChange={(open) => {
        if (!open && updateBusy) return;
        setShowUpdateDialog(open);
      }}>
        <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle>
              {updateBusy ? `Updating to ${updateInfo?.version}` : `Update ${updateInfo?.version} is ready`}
            </DialogTitle>
            <DialogDescription>
              {updateBusy ? updateMessage : "Review what changed before installing this version."}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto px-6 py-5">
            <div className="rounded-lg bg-muted p-4">
              {renderReleaseNotes(getUpdateNotes(updateInfo))}
            </div>
          </div>
          {updateBusy && (
            <div className="space-y-1.5 border-t border-border px-6 py-4">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${updateStatus === "downloading" ? progressPct ?? 8 : 100}%` }}
                />
              </div>
              <p className="text-right text-[11px] text-muted-foreground">
                {updateStatus === "downloading"
                  ? progressPct !== null ? `${progressPct}%` : "Preparing..."
                  : updateStatus === "installing" ? "Installing..." : "Restarting..."}
              </p>
            </div>
          )}
          <DialogFooter className="border-t border-border px-6 py-4">
            <Button variant="outline" onClick={() => setShowUpdateDialog(false)} disabled={updateBusy}>
              Later
            </Button>
            <Button
              onClick={() => void installUpdate()}
              disabled={!updateInfo || updateBusy}
            >
              {updateBusy && (
                <Spinner className="size-4" />
              )}
              {updateStatus === "downloading"
                ? "Downloading..."
                : updateStatus === "installing"
                  ? "Installing..."
                  : updateStatus === "restarting"
                    ? "Restarting..."
                    : "Download and install"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {!onboardingComplete ? (
        <Onboarding />
      ) : (
        <SidebarProvider className="h-full" defaultOpen>
          <Sidebar
            activeNav={activeNav}
            onNavChange={setActiveNav}
          />
          <SidebarInset className="overflow-hidden bg-[linear-gradient(180deg,var(--background),color-mix(in_oklab,var(--muted)_22%,var(--background)))]">
            <main id="main-content" className="flex-1 overflow-y-auto scrollbar-thin">
              <Suspense fallback={<PageFallback />}>
                {renderPage()}
              </Suspense>
            </main>
          </SidebarInset>
        </SidebarProvider>
      )}
    </TooltipProvider>
  );
}
export default App;
