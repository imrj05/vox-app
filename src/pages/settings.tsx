import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  settingsSections,
  type SettingsSection,
} from "@/components/settings-sections";
import {
  AccountSection,
  DataSection,
  GeneralSection,
  PermissionsSection,
  PrivacySection,
  ShortcutsSection,
  SnippetsSection,
} from "@/components/settings-panels";
import { VocabularyPacksSection } from "@/components/settings-vocabulary";
import { TranscriptionSection } from "@/components/settings-transcription";

type NavGroup = {
  label: string;
  sections: readonly SettingsSection[];
};

const navGroups: readonly NavGroup[] = [
  { label: "Recording", sections: ["general", "transcription", "shortcuts"] },
  { label: "Vocabulary", sections: ["vocabulary-packs", "snippets"] },
  { label: "System", sections: ["permissions", "privacy", "data", "account"] },
];

const sectionMeta = new Map(settingsSections.map((s) => [s.id, s]));

const sectionComponents: Record<SettingsSection, () => React.JSX.Element> = {
  general: GeneralSection,
  transcription: TranscriptionSection,
  account: AccountSection,
  "vocabulary-packs": VocabularyPacksSection,
  snippets: SnippetsSection,
  data: DataSection,
  privacy: PrivacySection,
  permissions: PermissionsSection,
  shortcuts: ShortcutsSection,
};

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const scrollRootRef = useRef<HTMLDivElement | null>(null);

  // Reset to the top of the content pane when switching sections, so a long
  // scroll position from one section never lands mid-way through the next.
  useEffect(() => {
    scrollRootRef.current
      ?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]')
      ?.scrollTo({ top: 0 });
  }, [activeSection]);

  const ActiveSection = sectionComponents[activeSection];

  return (
    <div className="h-full overflow-hidden bg-background">
      <ScrollArea ref={scrollRootRef} className="h-full">
        <div className="page-shell">
          <header className="page-header">
            <div>
              <h1 className="page-title">Settings</h1>
              <p className="page-description">
                Manage how Vox records, transcribes, stores data, and integrates
                with your desktop workflow.
              </p>
            </div>
          </header>

          <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
            <nav
              aria-label="Settings sections"
              className="flex shrink-0 gap-1 overflow-x-auto pb-1 lg:sticky lg:top-8 lg:w-56 lg:flex-col lg:gap-0.5 lg:self-start lg:overflow-visible lg:border-r lg:border-border lg:pb-0 lg:pr-6"
            >
              {navGroups.map((group) => (
                <div key={group.label} className="contents lg:block lg:pb-3 lg:last:pb-0">
                  <p className="hidden px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground lg:block">
                    {group.label}
                  </p>
                  {group.sections.map((id) => {
                    const section = sectionMeta.get(id);
                    if (!section) return null;
                    const Icon = section.icon;
                    const active = activeSection === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setActiveSection(id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "flex shrink-0 cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-full lg:shrink",
                          active
                            ? "bg-secondary font-medium text-foreground"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="whitespace-nowrap">
                          {section.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>

            <main className="min-w-0 flex-1 pb-8">
              <ActiveSection />
            </main>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}