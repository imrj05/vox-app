import { CircleHelp, Cpu, FileText, Home, Settings, Sparkles } from "@/components/icons";
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
}

const primaryNav = [
  { id: "home", label: "Dictation", icon: Home },
  { id: "transcripts", label: "Transcripts", icon: FileText },
  { id: "models", label: "Models", icon: Cpu },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "about", label: "About", icon: CircleHelp },
] as const;

export function Sidebar({ activeNav, onNavChange }: SidebarProps) {
  return (
    <ShadcnSidebar
      collapsible="none"
      className="select-none border-r border-sidebar-border bg-sidebar"
    >
      <SidebarHeader
        className="shrink-0 px-4 pb-5 pt-[52px]"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-3 px-2">
          <img src="/logo.svg" alt="" width="32" height="32" className="h-8 w-8 object-contain" />
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight text-sidebar-foreground">Vox</p>
            <p className="text-[11px] text-muted-foreground">Private local dictation</p>
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
        <div className="border-t border-sidebar-border px-2 pt-3">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-sidebar-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Private by default
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            Audio and transcription stay on this device.
          </p>
        </div>
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
