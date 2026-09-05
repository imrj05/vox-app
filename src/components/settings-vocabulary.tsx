import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SectionHeader, SettingsCard } from "@/components/settings-primitives";
import {
  BookOpenText,
  ChevronLeftIcon,
  Check,
  ChevronRightIcon,
  Copy,
  Download,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import {
  enabledEntryCount,
  ENTRY_CATEGORIES,
  PRIORITY_WEIGHTS,
  entryCategoryLabel,
  listVocabularyPacks,
  priorityFromWeight,
  setVocabularyEntryEnabled,
  setVocabularyPackEnabled,
  setVocabularySettings,
  createVocabularyPack,
  deleteVocabularyEntry,
  deleteVocabularyPack,
  duplicateVocabularyPack,
  exportVocabularyPack,
  importVocabularyPack,
  packCategoryLabel,
  updateVocabularyPack,
  upsertVocabularyEntry,
  type VocabularyEntry,
  type VocabularyEntryCategory,
  type VocabularyPack,
  type VocabularyPriority,
} from "@/lib/vocabulary";

type IconComponent = React.ComponentType<React.SVGProps<SVGSVGElement>>;

const PACK_CATEGORY_ICONS: Record<string, IconComponent> = {
  developer: BookOpenText,
  technology: Sparkles,
};

function emptyEntry(): VocabularyEntry {
  return {
    id: "",
    canonical: "",
    aliases: [],
    pronunciationVariants: [],
    category: "general",
    priority: PRIORITY_WEIGHTS.normal,
    enabled: true,
    caseSensitive: false,
    useCount: 0,
    lastUsedAt: null,
  };
}

/**
 * Vocabulary Packs settings (spec §7): packs list → pack detail → entry
 * editor, plus import/export and the learning toggle.
 */
export function VocabularyPacksSection() {
  const [packs, setPacks] = useState<VocabularyPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [openPackId, setOpenPackId] = useState<string | null>(null);
  const [learningEnabled, setLearningEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async (): Promise<VocabularyPack[]> => {
    const next = await listVocabularyPacks();
    setPacks(next);
    setLoading(false);
    return next;
  }, []);

  useEffect(() => {
    let ignore = false;
    listVocabularyPacks()
      .then((next) => {
        if (!ignore) {
          setPacks(next);
          setLoading(false);
        }
      })
      .catch((loadError) => {
        if (!ignore) {
          setError(String(loadError));
          setLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      try {
        setError(null);
        await action();
        await refresh();
      } catch (actionError) {
        setError(String(actionError).replace(/^"|"$/g, ""));
      }
    },
    [refresh],
  );

  const openPack = packs.find((pack) => pack.id === openPackId) ?? null;

  const filteredPacks = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return packs;
    return packs.filter(
      (pack) =>
        pack.name.toLowerCase().includes(query) ||
        pack.description.toLowerCase().includes(query) ||
        pack.entries.some((entry) => entry.canonical.toLowerCase().includes(query)),
    );
  }, [packs, search]);

  const handleImport = async (file: File) => {
    const json = await file.text();
    await run(async () => {
      await importVocabularyPack(json);
    });
  };

  const handleExport = async (pack: VocabularyPack) => {
    try {
      const json = await exportVocabularyPack(pack.id);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${pack.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.vocabulary.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(String(exportError));
    }
  };

  if (openPack) {
    return (
      <PackDetail
        pack={openPack}
        onBack={() => setOpenPackId(null)}
        onDuplicate={() =>
          run(async () => {
            await duplicateVocabularyPack(openPack.id);
            setOpenPackId(null);
          })
        }
        onDeleteEntry={(entryId) =>
          run(async () => {
            await deleteVocabularyEntry(openPack.id, entryId);
          })
        }
        onToggleEntry={(entryId, enabled) =>
          run(async () => {
            await setVocabularyEntryEnabled(openPack.id, entryId, enabled);
          })
        }
        onRename={(name, description) =>
          run(async () => {
            await updateVocabularyPack(openPack.id, name, description);
          })
        }
        onDelete={() =>
          run(async () => {
            await deleteVocabularyPack(openPack.id);
            setOpenPackId(null);
          })
        }
        onExport={() => handleExport(openPack)}
        onSaveEntry={async (entry) => {
          await upsertVocabularyEntry(openPack.id, entry);
          await refresh();
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Vocabulary Packs"
        description="Collections of terms that improve recognition of names, jargon, and product terminology across every transcription engine. Vocabulary stays on this device."
      />

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search vocabulary…"
            className="h-11 rounded-xl bg-background pl-9"
          />
        </div>
        <Button
          variant="outline"
          className="h-11 rounded-xl"
          onClick={() => fileInputRef.current?.click()}
        >
          Import
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleImport(file);
            event.target.value = "";
          }}
        />
        <Button
          className="h-11 rounded-xl px-4"
          onClick={() =>
            run(async () => {
              const pack = await createVocabularyPack(
                "My Vocabulary",
                "Custom terms.",
                "custom",
              );
              setOpenPackId(pack.id);
            })
          }
        >
          <Plus className="h-4 w-4" />
          New Pack
        </Button>
      </div>

      {error && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <SettingsCard className="flex items-center justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Learn from corrections</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Automatically improve ranking of terms you correct after dictation. Learned terms stay
            on this device.
          </p>
        </div>
        <Switch
          checked={learningEnabled}
          onCheckedChange={(value) => {
            setLearningEnabled(value);
            void setVocabularySettings({
              learningEnabled: value,
              autoCorrectThreshold: 0.92,
              cautiousCorrectThreshold: 0.8,
            });
          }}
        />
      </SettingsCard>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading packs…</p>
      ) : (
        <div className="space-y-2">
          {filteredPacks.map((pack) => {
            const Icon = PACK_CATEGORY_ICONS[pack.category] ?? BookOpenText;
            return (
              <SettingsCard
                key={pack.id}
                className="group cursor-pointer p-4 transition-colors hover:border-foreground/20"
                >
                <div
                  className="flex items-center gap-4"
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenPackId(pack.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") setOpenPackId(pack.id);
                  }}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-foreground">{pack.name}</p>
                      {pack.isBuiltIn && (
                        <Badge variant="secondary" className="h-5 text-[10px]">
                          Built-in
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {pack.description || packCategoryLabel(pack.category)} ·{" "}
                      {enabledEntryCount(pack)} terms
                    </p>
                  </div>
                  <div
                    className="flex shrink-0 items-center gap-2"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Switch
                      checked={pack.enabled}
                      onCheckedChange={(value) =>
                        run(async () => {
                          await setVocabularyPackEnabled(pack.id, value);
                        })
                      }
                    />
                    <ChevronRightIcon className="h-4 w-4 text-muted-foreground/60" />
                  </div>
                </div>
              </SettingsCard>
            );
          })}
        </div>
      )}

    </div>
  );
}

// ── Pack detail ──────────────────────────────────────────────────────────────

function PackDetail({
  pack,
  onBack,
  onDuplicate,
  onDeleteEntry,
  onToggleEntry,
  onRename,
  onDelete,
  onExport,
  onSaveEntry,
}: {
  pack: VocabularyPack;
  onBack: () => void;
  onDuplicate: () => void;
  onDeleteEntry: (entryId: string) => void;
  onToggleEntry: (entryId: string, enabled: boolean) => void;
  onRename: (name: string, description: string) => void;
  onDelete: () => void;
  onExport: () => void;
  onSaveEntry: (entry: VocabularyEntry) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(pack.name);
  // The entry editor lives here so the dialog mounts inside the pack detail
  // view (it used to live in the parent's list branch and never appeared).
  const [editingEntry, setEditingEntry] = useState<VocabularyEntry | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const entries = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = [...pack.entries].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return b.priority - a.priority || a.canonical.localeCompare(b.canonical);
    });
    if (!query) return sorted;
    return sorted.filter(
      (entry) =>
        entry.canonical.toLowerCase().includes(query) ||
        entry.aliases.some((alias) => alias.toLowerCase().includes(query)),
    );
  }, [pack.entries, search]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onBack} title="Back to packs">
          <ChevronLeftIcon className="h-4 w-4" />
        </Button>
        {renaming ? (
          <div className="flex flex-1 items-center gap-2">
            <Input
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              className="h-9 rounded-lg"
              autoFocus
            />
            <Button
              size="sm"
              className="h-9 rounded-lg"
              onClick={() => {
                onRename(nameDraft.trim() || pack.name, pack.description);
                setRenaming(false);
              }}
            >
              <Check className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">
                {pack.name}
              </h2>
              {pack.isBuiltIn && (
                <Badge variant="secondary" className="h-5 text-[10px]">
                  Built-in
                </Badge>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {pack.description || packCategoryLabel(pack.category)} · {enabledEntryCount(pack)}{" "}
              terms
            </p>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" size="icon" className="h-9 w-9" title="Export pack" onClick={onExport}>
            <Download className="h-4 w-4" />
          </Button>
          {!pack.isBuiltIn && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              title="Rename pack"
              onClick={() => {
                setNameDraft(pack.name);
                setRenaming(true);
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            title="Duplicate pack"
            onClick={onDuplicate}
          >
            <Copy className="h-4 w-4" />
          </Button>
          {!pack.isBuiltIn && pack.id !== "builtin-personal" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-destructive"
              title="Delete pack"
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search terms…"
            className="h-11 rounded-xl bg-background pl-9"
          />
        </div>
        <Button
          className="h-11 rounded-xl px-4"
          onClick={() => {
            setSaveError(null);
            setEditingEntry(emptyEntry());
          }}
        >
          <Plus className="h-4 w-4" />
          Add Term
        </Button>
      </div>

      {pack.isBuiltIn && pack.id !== "builtin-personal" && (
        <p className="rounded-xl border border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          Built-in terms are read-only — terms you add are saved to this pack. Duplicate the pack
          to edit the built-in terms themselves.
        </p>
      )}

      <SettingsCard className="min-h-48 p-3">
        {entries.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center text-center">
            <BookOpenText className="h-10 w-10 text-muted-foreground/45" />
            <p className="mt-4 text-sm font-medium text-muted-foreground">No terms yet.</p>
            <p className="mt-1 text-sm text-muted-foreground/80">
              Add your first term, or correct a transcript and it will be learned here.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/50",
                  !entry.enabled && "opacity-50",
                )}
              >
                <Switch
                  checked={entry.enabled}
                  onCheckedChange={(value) => onToggleEntry(entry.id, value)}
                  disabled={pack.isBuiltIn && !entry.userAdded}
                />
                <div
                  className="min-w-0 flex-1"
                  role="button"
                  onClick={() => {
                    if (!pack.isBuiltIn || entry.userAdded) {
                      setSaveError(null);
                      setEditingEntry(entry);
                    }
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{entry.canonical}</p>
                    <Badge variant="secondary" className="h-5 text-[10px]">
                      {entryCategoryLabel(entry.category)}
                    </Badge>
                    {priorityFromWeight(entry.priority) !== "normal" && (
                      <Badge variant="outline" className="h-5 text-[10px] capitalize">
                        {priorityFromWeight(entry.priority)}
                      </Badge>
                    )}
                  </div>
                  {entry.aliases.length > 0 && (
                    <p className="truncate text-xs text-muted-foreground">
                      heard as: {entry.aliases.slice(0, 3).join(", ")}
                      {entry.aliases.length > 3 ? "…" : ""}
                    </p>
                  )}
                </div>
                {(!pack.isBuiltIn || entry.userAdded) && (
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setSaveError(null);
                        setEditingEntry(entry);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => onDeleteEntry(entry.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SettingsCard>

      {saveError && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {saveError}
        </p>
      )}

      {editingEntry && (
        <EntryEditorDialog
          packId={pack.id}
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onSave={async (entry) => {
            setSaveError(null);
            try {
              await onSaveEntry(entry);
              setEditingEntry(null);
            } catch (saveError) {
              // Surface save failures (e.g. duplicate terms) inside the dialog
              // instead of failing silently.
              setSaveError(String(saveError).replace(/^"|"$/g, ""));
            }
          }}
        />
      )}
    </div>
  );
}

// ── Entry editor (spec §7) ───────────────────────────────────────────────────

function EntryEditorDialog({
  packId,
  entry,
  onClose,
  onSave,
}: {
  packId: string;
  entry: VocabularyEntry;
  onClose: () => void;
  onSave: (entry: VocabularyEntry) => void;
}) {
  const [canonical, setCanonical] = useState(entry.canonical);
  const [aliases, setAliases] = useState(entry.aliases.join("\n"));
  const [pronunciation, setPronunciation] = useState(entry.pronunciationVariants.join("\n"));
  const [category, setCategory] = useState<VocabularyEntryCategory>(entry.category);
  const [priority, setPriority] = useState<VocabularyPriority>(priorityFromWeight(entry.priority));
  const [enabled, setEnabled] = useState(entry.enabled);

  const lines = (value: string) =>
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  const valid = canonical.trim().length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{entry.id ? "Edit Term" : "Add Term"}</DialogTitle>
          <DialogDescription>
            The canonical form is what gets typed. Aliases are how it might be heard.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Canonical form</label>
            <Input
              value={canonical}
              onChange={(event) => setCanonical(event.target.value)}
              placeholder="shadcn"
              className="h-10 rounded-xl bg-background"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Recognition aliases (one per line)
            </label>
            <Textarea
              value={aliases}
              onChange={(event) => setAliases(event.target.value)}
              placeholder={"shad cn\nshad can"}
              rows={3}
              className="rounded-xl bg-background"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Pronunciation variants (one per line)
            </label>
            <Textarea
              value={pronunciation}
              onChange={(event) => setPronunciation(event.target.value)}
              placeholder={"shad see en"}
              rows={2}
              className="rounded-xl bg-background"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Category</label>
              <Select value={category} onValueChange={(value) => setCategory(value as VocabularyEntryCategory)}>
                <SelectTrigger className="h-10 w-full rounded-xl bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTRY_CATEGORIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {entryCategoryLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Priority</label>
              <Select
                value={priority}
                onValueChange={(value) => setPriority(value as VocabularyPriority)}
              >
                <SelectTrigger className="h-10 w-full rounded-xl bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["low", "normal", "high", "critical"] as VocabularyPriority[]).map((value) => (
                    <SelectItem key={value} value={value} className="capitalize">
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
            <span className="text-sm text-foreground">Enabled</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="rounded-xl"
            disabled={!valid}
            onClick={() =>
              onSave({
                ...entry,
                canonical: canonical.trim(),
                aliases: lines(aliases),
                pronunciationVariants: lines(pronunciation),
                category,
                priority: PRIORITY_WEIGHTS[priority],
                enabled,
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
        <span className="hidden">{packId}</span>
      </DialogContent>
    </Dialog>
  );
}