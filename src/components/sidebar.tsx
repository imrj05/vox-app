import { CircleHelp, Cpu, Home, Settings, Sparkles } from "lucide-react";
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
  { id: "models", label: "Models", icon: Cpu },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "about", label: "About", icon: CircleHelp },
] as const;

export function Sidebar({ activeNav, onNavChange }: SidebarProps) {
  return (
    <ShadcnSidebar
      collapsible="none"
      className="select-none border-r border-sidebar-border bg-sidebar/95"
    >
      <SidebarHeader
        className="shrink-0 px-4 pb-4 pt-[52px]"
        data-tauri-drag-region
      >
        <div className="rounded-2xl border border-sidebar-border bg-background/65 p-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center">
              <img src="/logo.png" alt="Vox" className="h-8 w-8 object-contain" />
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-sidebar-primary ring-2 ring-background" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-tight text-sidebar-foreground">
                Vox
              </p>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Local Dictation
              </p>
            </div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-3">
        <div className="space-y-1">
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Workspace
          </p>
          {primaryNav.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavChange(item.id)}
                className={cn(
                  "group relative flex w-full cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-all duration-150",
                  active
                    ? "bg-background text-sidebar-foreground shadow-xs ring-1 ring-sidebar-border"
                    : "text-muted-foreground hover:bg-background/55 hover:text-sidebar-foreground"
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/70 text-muted-foreground group-hover:text-sidebar-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="font-medium">{item.label}</span>
                {active && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </div>
      </SidebarContent>

      <SidebarFooter className="p-3">
        <div className="rounded-2xl border border-sidebar-border bg-background/65 p-3 shadow-xs">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-sidebar-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Private by default
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            Local models, local audio, focused voice-to-text.
          </p>
        </div>
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
