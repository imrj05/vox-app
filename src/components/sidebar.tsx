import { BookOpenText, CircleHelp, CommandIcon, Cpu, FileText, Home, Pencil, Settings, Sparkles } from "@/components/icons";
import { Wordmark } from "@/components/wordmark";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

interface SidebarProps {
  activeNav: string;
  onNavChange: (nav: string) => void;
  onOpenPalette?: () => void;
}

const primaryNav = [
  { id: "home", label: "Dictation", icon: Home },
  { id: "transcripts", label: "Transcripts", icon: FileText },
  { id: "vocabulary", label: "Vocabulary", icon: BookOpenText },
  { id: "notes", label: "Notes", icon: Pencil },
  { id: "models", label: "Models", icon: Cpu },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar({ activeNav, onNavChange, onOpenPalette }: SidebarProps) {
  return (
    <ShadcnSidebar
      collapsible="none"
      className="select-none border-r border-sidebar-border bg-sidebar"
    >
      <SidebarHeader
        className="shrink-0 px-4 pb-4 pt-[52px]"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-3 px-2">
          <div className="min-w-0">
            <Wordmark className="h-5 w-auto" />
            <p className="mt-1.5 text-[11px] text-muted-foreground">Private local dictation</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-3">
        <div className="space-y-1">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Workspace
          </p>
          {primaryNav.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavChange(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex w-full cursor-pointer touch-manipulation items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                )}
              >
                <span
                  className={cn(
                    "absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary transition-opacity",
                    active ? "opacity-100" : "opacity-0"
                  )}
                />
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
                    active
                      ? "text-primary"
                      : "text-muted-foreground group-hover:text-sidebar-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </SidebarContent>

      <SidebarFooter className="p-3">
        {onOpenPalette && (
          <button
            type="button"
            onClick={onOpenPalette}
            className="group mb-3 flex w-full cursor-pointer items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/50 px-2.5 py-2 text-[11px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <CommandIcon className="h-3.5 w-3.5" />
            <span className="font-medium">Search &amp; commands</span>
            <kbd className="ml-auto rounded border border-sidebar-border px-1.5 py-0.5 font-mono text-[10px]">
              ⌘K
            </kbd>
          </button>
        )}
        <div className="border-t border-sidebar-border px-2 pt-3">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-sidebar-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Private by default
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            Audio and transcription stay on this device.
          </p>
          <button
            type="button"
            onClick={() => onNavChange("about")}
            aria-current={activeNav === "about" ? "page" : undefined}
            className={cn(
              "group mt-3 flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] transition-colors",
              activeNav === "about"
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            )}
          >
            <CircleHelp className="h-3.5 w-3.5" />
            About Vox
          </button>
        </div>
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
