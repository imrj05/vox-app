import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  settingsSections,
  type SettingsSection,
} from "@/components/settings-sections";
import {
  DictionarySection,
  GeneralSection,
  PermissionsSection,
  ShortcutsSection,
} from "@/components/settings-modal";

const settingsPageSections = settingsSections.filter((section) => section.id !== "about");

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");

  const renderContent = () => {
    switch (activeSection) {
      case "general":
        return <GeneralSection />;
      case "dictionary":
        return <DictionarySection />;
      case "permissions":
        return <PermissionsSection />;
      case "shortcuts":
        return <ShortcutsSection />;
    }
  };

  return (
    <div className="h-full overflow-hidden bg-background">
      <ScrollArea className="h-full">
        <div className="mx-auto grid min-h-full max-w-5xl gap-6 p-6 lg:grid-cols-[220px_1fr] lg:p-8">
          <aside className="lg:sticky lg:top-0 lg:h-fit">
            <div className="rounded-2xl border border-border bg-card p-2 shadow-xs">
              <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Settings
              </p>
              <div className="grid gap-1 sm:grid-cols-4 lg:grid-cols-1">
                {settingsPageSections.map((section) => {
                  const Icon = section.icon;
                  return (
                    <button
                      key={section.id}
                      onClick={() => setActiveSection(section.id)}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                        activeSection === section.id
                          ? "bg-primary/10 font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{section.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>

          <main className="min-w-0 pb-8">
            {renderContent()}
          </main>
        </div>
      </ScrollArea>
    </div>
  );
}
