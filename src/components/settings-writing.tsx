import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Globe, Pencil, Plus, Sparkles } from "@/components/icons";
import {
  SectionHeader,
  SettingGroupHeader,
  SettingsCard,
} from "@/components/settings-primitives";
import {
  NO_STYLE_ID,
  getWritingProfiles,
  setWritingProfiles,
  type WritingProfilesView,
} from "@/lib/writing";

type Config = Pick<
  WritingProfilesView,
  "customStyles" | "profiles" | "defaultStyleId"
>;

type StyleDraft = {
  id: string | null;
  name: string;
  instruction: string;
};

/**
 * Writing profiles (Phase 2.8/2.9): map apps to a writing style, create
 * custom styles, and pick a fallback style. Styles steer AI cleanup only;
 * developer contexts are never restyled.
 */
export function WritingSection() {
  const [view, setView] = useState<WritingProfilesView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileApp, setProfileApp] = useState("");
  const [profileStyle, setProfileStyle] = useState<string>(NO_STYLE_ID);
  const [styleDraft, setStyleDraft] = useState<StyleDraft | null>(null);

  useEffect(() => {
    let active = true;
    void getWritingProfiles()
      .then((next) => {
        if (!active) return;
        setView(next);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const persist = async (next: Config): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      setView(await setWritingProfiles(next));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const update = (patch: Partial<Config>) => {
    if (!view) return;
    void persist({
      customStyles: patch.customStyles ?? view.customStyles,
      profiles: patch.profiles ?? view.profiles,
      defaultStyleId:
        patch.defaultStyleId !== undefined
          ? patch.defaultStyleId
          : view.defaultStyleId,
    });
  };

  const styleLabel = (styleId: string): string => {
    if (styleId === NO_STYLE_ID) return "No style";
    const style = [...(view?.builtinStyles ?? []), ...(view?.customStyles ?? [])].find(
      (candidate) => candidate.id === styleId
    );
    return style?.name ?? "Unknown style";
  };

  const addProfile = async () => {
    if (!view || saving) return;
    const appName = profileApp.trim();
    if (!appName) return;
    const existing = view.profiles.find(
      (profile) => profile.appName.toLowerCase() === appName.toLowerCase()
    );
    const profiles = existing
      ? view.profiles.map((profile) =>
          profile.appName.toLowerCase() === appName.toLowerCase()
            ? { ...profile, styleId: profileStyle }
            : profile
        )
      : [...view.profiles, { appName, styleId: profileStyle }];
    const saved = await persist({
      customStyles: view.customStyles,
      profiles,
      defaultStyleId: view.defaultStyleId,
    });
    if (saved) setProfileApp("");
  };

  const removeProfile = (appName: string) => {
    if (!view) return;
    update({
      profiles: view.profiles.filter((profile) => profile.appName !== appName),
    });
  };

  const saveStyle = async () => {
    if (!view || !styleDraft || saving) return;
    const name = styleDraft.name.trim();
    const instruction = styleDraft.instruction.trim();
    if (!name || !instruction) return;
    const customStyles = styleDraft.id
      ? view.customStyles.map((style) =>
          style.id === styleDraft.id ? { ...style, name, instruction } : style
        )
      : [
          ...view.customStyles,
          { id: `custom-${Date.now()}`, name, instruction },
        ];
    const saved = await persist({
      customStyles,
      profiles: view.profiles,
      defaultStyleId: view.defaultStyleId,
    });
    if (saved) setStyleDraft(null);
  };

  const deleteStyle = (id: string) => {
    if (!view) return;
    update({
      customStyles: view.customStyles.filter((style) => style.id !== id),
      profiles: view.profiles.filter((profile) => profile.styleId !== id),
      defaultStyleId: view.defaultStyleId === id ? null : view.defaultStyleId,
    });
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <SectionHeader
          title="Writing"
          description="Teach Vox how to write in different apps and create your own styles."
        />
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-5 py-8 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Loading writing profiles…
        </div>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="space-y-5">
        <SectionHeader
          title="Writing"
          description="Teach Vox how to write in different apps and create your own styles."
        />
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error ?? "Writing profiles are unavailable."}
        </div>
      </div>
    );
  }

  const allStyles = [...view.builtinStyles, ...view.customStyles];

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Writing"
        description="Map apps to a writing style, or create your own. Styles steer AI cleanup at Medium and High; developer apps are never restyled."
      />

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <SettingsCard className="space-y-4">
        <SettingGroupHeader
          icon={<Sparkles className="h-4 w-4" />}
          title="Default style"
          description="Used for non-developer apps that do not match an app profile or built-in email/chat/document detection."
        />
        <NativeSelect
          aria-label="Default writing style"
          value={view.defaultStyleId ?? "auto"}
          disabled={saving}
          onChange={(event) =>
            update({
              defaultStyleId:
                event.target.value === "auto" ? null : event.target.value,
            })
          }
        >
          <NativeSelectOption value="auto">Auto (match the app)</NativeSelectOption>
          {allStyles.map((style) => (
            <NativeSelectOption key={style.id} value={style.id}>
              {style.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </SettingsCard>

      <SettingsCard className="space-y-4">
        <SettingGroupHeader
          icon={<Globe className="h-4 w-4" />}
          title="App profiles"
          description="Match an app or window name. Explicit profiles override built-in detection; choose “No style” to opt an app out."
        />
        {view.profiles.length > 0 ? (
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {view.profiles.map((profile) => (
              <div
                key={profile.appName}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {profile.appName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {styleLabel(profile.styleId)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${profile.appName} profile`}
                  disabled={saving}
                  onClick={() => removeProfile(profile.appName)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No app profiles yet. Built-in email, chat, and document detection is
            still active.
          </p>
        )}

        <div className="space-y-2 rounded-xl border border-border bg-background p-3">
          <label
            htmlFor="profile-app"
            className="text-xs font-medium text-foreground"
          >
            Add an app
          </label>
          <Input
            id="profile-app"
            value={profileApp}
            maxLength={120}
            autoComplete="off"
            placeholder="App or window name (e.g. Gmail, Slack, Notion)"
            onChange={(event) => setProfileApp(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void addProfile();
            }}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <NativeSelect
              aria-label="Writing style for this app"
              value={profileStyle}
              disabled={saving}
              onChange={(event) => setProfileStyle(event.target.value)}
            >
              <NativeSelectOption value={NO_STYLE_ID}>No style</NativeSelectOption>
              {allStyles.map((style) => (
                <NativeSelectOption key={style.id} value={style.id}>
                  {style.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button
              size="sm"
              disabled={saving || !profileApp.trim()}
              onClick={() => void addProfile()}
            >
              <Plus className="h-4 w-4" />
              Add profile
            </Button>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard className="space-y-4">
        <SettingGroupHeader
          icon={<Pencil className="h-4 w-4" />}
          title="Custom styles"
          description="Each style is a plain-language instruction sent to the on-device cleanup model."
        />

        {view.customStyles.length > 0 ? (
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {view.customStyles.map((style) => (
              <div
                key={style.id}
                className="flex items-start justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {style.name}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {style.instruction}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() =>
                      setStyleDraft({
                        id: style.id,
                        name: style.name,
                        instruction: style.instruction,
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${style.name} style`}
                    disabled={saving}
                    onClick={() => deleteStyle(style.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No custom styles yet. Create one for a tone, audience, or team
            convention.
          </p>
        )}

        {styleDraft ? (
          <div className="space-y-3 rounded-xl border border-border bg-background p-3">
            <div className="space-y-1.5">
              <label
                htmlFor="style-name"
                className="text-xs font-medium text-foreground"
              >
                Style name
              </label>
              <Input
                id="style-name"
                value={styleDraft.name}
                maxLength={80}
                autoComplete="off"
                placeholder="e.g. Formal, Support reply, Release notes"
                onChange={(event) =>
                  setStyleDraft((draft) =>
                    draft ? { ...draft, name: event.target.value } : draft
                  )
                }
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="style-instruction"
                className="text-xs font-medium text-foreground"
              >
                Instruction
              </label>
              <Textarea
                id="style-instruction"
                value={styleDraft.instruction}
                rows={4}
                maxLength={2000}
                placeholder="Write in a concise, friendly tone. Keep sentences short and avoid jargon."
                onChange={(event) =>
                  setStyleDraft((draft) =>
                    draft ? { ...draft, instruction: event.target.value } : draft
                  )
                }
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={
                  saving ||
                  !styleDraft.name.trim() ||
                  !styleDraft.instruction.trim()
                }
                onClick={() => void saveStyle()}
              >
                {saving ? <Spinner className="size-3" /> : null}
                Save style
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => setStyleDraft(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setStyleDraft({ id: null, name: "", instruction: "" })
            }
          >
            <Plus className="h-4 w-4" />
            New style
          </Button>
        )}

        <details className="rounded-xl border border-border bg-background px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-foreground">
            Built-in styles
          </summary>
          <div className="mt-2 space-y-2">
            {view.builtinStyles.map((style) => (
              <div key={style.id}>
                <p className="text-xs font-medium text-foreground">
                  {style.name}
                </p>
                <p className="text-[11px] leading-5 text-muted-foreground">
                  {style.instruction}
                </p>
              </div>
            ))}
          </div>
        </details>
      </SettingsCard>
    </div>
  );
}
