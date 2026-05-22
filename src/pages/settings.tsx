import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  settingsSections,
  type SettingsSection,
} from "@/components/settings-sections";
import {
  DictionarySection,
  DataSection,
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
      case "data":
        return <DataSection />;
      case "permissions":
        return <PermissionsSection />;
      case "shortcuts":
        return <ShortcutsSection />;
    }
  };

  return (
    <div className="h-full overflow-hidden bg-background">
      <ScrollArea className="h-full">
        <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-5 p-6 lg:p-8">
          <div className="flex flex-col gap-2">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">Settings</h2>
            <p className="text-sm text-muted-foreground">
              Manage how Vox records, transcribes, stores data, and integrates with your desktop workflow.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-2">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {settingsPageSections.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-3 text-left text-sm transition-colors",
                      activeSection === section.id
                        ? "border-primary/30 bg-primary/10 font-medium text-foreground"
                        : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{section.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <main className="min-w-0 pb-8">
            {renderContent()}
          </main>
        </div>
      </ScrollArea>
    </div>
  );
}
