import { cn } from "@/lib/utils";
import { Home, Cpu, Settings } from "lucide-react";
interface SidebarProps {
  activeNav: string;
  onNavChange: (nav: string) => void;
  onOpenSettings: () => void;
}
const primaryNav = [
  { id: "home", label: "Dictation", icon: Home },
  { id: "models", label: "Models", icon: Cpu },
] as const;
const bottomNav = [
  { id: "settings", label: "Settings", icon: Settings },
] as const;
export function Sidebar({
  activeNav,
  onNavChange,
  onOpenSettings,
}: SidebarProps) {
  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col bg-sidebar border-r border-border select-none">
      {/* macOS traffic lights spacer */}
      <div className="h-10 shrink-0" data-tauri-drag-region />
      {/* Vox logo / brand */}
      <div className="px-3 pb-1">
        <span className="text-xs font-semibold text-muted-foreground tracking-wide uppercase px-2">
          Vox
        </span>
      </div>
      {/* Primary navigation */}
      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto scrollbar-thin">
        {primaryNav.map((item) => {
          const Icon = item.icon;
          const isActive = activeNav === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavChange(item.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors cursor-pointer",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      {/* Bottom navigation */}
      <nav className="px-2 pb-1 space-y-0.5">
        {bottomNav.map((item) => {
          const Icon = item.icon;
          const isActive =
            activeNav === item.id ||
            (item.id === "settings" && activeNav === "settings");
          return (
            <button
              key={item.id}
              onClick={() => {
                if (item.id === "settings") {
                  onOpenSettings();
                } else {
                  onNavChange(item.id);
                }
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors cursor-pointer",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="border-t border-border px-3 py-3">
        <p className="text-[11px] leading-4 text-muted-foreground">
          Local voice to text. Focused dictation only.
        </p>
      </div>
    </aside>
  );
}
