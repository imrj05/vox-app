import { Home, Cpu, Settings } from "lucide-react";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";

interface SidebarProps {
  activeNav: string;
  onNavChange: (nav: string) => void;
}

const primaryNav = [
  { id: "home", label: "Dictation", icon: Home },
  { id: "models", label: "Models", icon: Cpu },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar({ activeNav, onNavChange }: SidebarProps) {
  return (
    <ShadcnSidebar collapsible="none" className="border-r border-border select-none">
      {/* macOS traffic lights spacer — draggable */}
      <SidebarHeader className="h-14 shrink-0 justify-end px-3 pb-2" data-tauri-drag-region>
        <div className="flex items-center gap-2.5 px-1">
          <img src="/logo.png" alt="Vox" className="h-5 w-5 object-contain" />
          <span className="text-sm font-semibold text-foreground tracking-tight">
            Vox
          </span>
        </div>
      </SidebarHeader>

      {/* Scrollable nav area */}
      <SidebarContent>
        <SidebarMenu className="px-2 py-1">
          {primaryNav.map((item) => {
            const Icon = item.icon;
            return (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  isActive={activeNav === item.id}
                  onClick={() => onNavChange(item.id)}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      {/* Fixed bottom area */}
      <SidebarFooter className="p-0">
        <div className="border-t border-border px-5 py-3">
          <p className="text-[11px] leading-4 text-muted-foreground">
            Local voice to text. Focused dictation only.
          </p>
        </div>
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
