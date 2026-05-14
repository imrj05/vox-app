import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  settingsSections,
  type SettingsSection,
  RecordingSection,
  TranscriptionSection,
  PermissionsSection,
  SystemSection,
} from "@/components/settings-modal";

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("recording");

  const renderContent = () => {
    switch (activeSection) {
      case "recording":
        return <RecordingSection />;
      case "transcription":
        return <TranscriptionSection />;
      case "permissions":
        return <PermissionsSection />;
      case "system":
        return <SystemSection />;
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Section nav */}
      <nav className="w-50 shrink-0 overflow-hidden border-r border-border bg-sidebar px-2 py-4">
        <p className="px-3 pb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Settings
        </p>
        <div className="space-y-0.5">
          {settingsSections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  activeSection === section.id
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{section.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Content area */}
      <ScrollArea className="flex-1">
        <div className="max-w-2xl p-8">{renderContent()}</div>
      </ScrollArea>
    </div>
  );
}
