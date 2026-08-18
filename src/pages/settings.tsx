import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  settingsSections,
  type SettingsSection,
} from "@/components/settings-sections";
import {
  AccountSection,
  DictionarySection,
  DataSection,
  GeneralSection,
  ModelsSection,
  PermissionsSection,
  PrivacySection,
  ShortcutsSection,
  SnippetsSection,
} from "@/components/settings-modal";

const settingsPageSections = settingsSections.filter((section) => section.id !== "about");

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");

  const renderContent = () => {
    switch (activeSection) {
      case "general":
        return <GeneralSection />;
      case "account":
        return <AccountSection />;
      case "models":
        return <ModelsSection />;
      case "dictionary":
        return <DictionarySection />;
      case "snippets":
        return <SnippetsSection />;
      case "data":
        return <DataSection />;
      case "privacy":
        return <PrivacySection />;
      case "permissions":
        return <PermissionsSection />;
      case "shortcuts":
        return <ShortcutsSection />;
    }
  };

  return (
    <div className="h-full overflow-hidden bg-background">
      <ScrollArea className="h-full">
        <div className="page-shell max-w-5xl">
          <header className="page-header">
            <div>
            <h1 className="page-title">Settings</h1>
            <p className="page-description">
              Manage how Vox records, transcribes, stores data, and integrates with your desktop workflow.
            </p>
            </div>
          </header>

          <nav aria-label="Settings sections" className="panel p-1.5">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
              {settingsPageSections.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    aria-pressed={activeSection === section.id}
                    className={cn(
                      "flex cursor-pointer touch-manipulation items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                      activeSection === section.id
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{section.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>

          <main className="min-w-0 pb-8">
            {renderContent()}
          </main>
        </div>
      </ScrollArea>
    </div>
  );
}
