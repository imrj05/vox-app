import { useAppStore } from "@/store/app-store";
import type { AppTheme } from "@/store/app-store";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { SettingRow } from "@/components/settings-primitives";
import { Check, Monitor, Moon, Sparkles, Sun, Volume2 } from "@/components/icons";

interface Palette {
  bg: string;
  surface: string;
  ink: string;
  accent: string;
  border: string;
  text: string;
}

const palettes: Record<"light" | "dark", Palette> = {
  light: {
    bg: "#ffffff",
    surface: "#f0f1f2",
    ink: "#101214",
    accent: "#1868db",
    border: "rgba(16, 18, 20, 0.12)",
    text: "#42526e",
  },
  dark: {
    bg: "#101214",
    surface: "#1c1f24",
    ink: "#f0f1f2",
    accent: "#4a9bed",
    border: "rgba(240, 241, 242, 0.16)",
    text: "#9aa0a8",
  },
};

/** Miniature Vox window mockup used to preview a theme option. */
function MiniWindow({ mode }: { mode: "light" | "dark" }) {
  const c = palettes[mode];
  return (
    <div
      className="relative block h-full w-full overflow-hidden rounded-[6px] border"
      style={{ background: c.bg, borderColor: c.border }}
      aria-hidden="true"
    >
      {/* Title bar */}
      <div
        className="flex h-4 items-center gap-1 border-b px-1.5"
        style={{ borderColor: c.border }}
      >
        <span className="size-1 rounded-full" style={{ background: c.accent }} />
        <span className="size-1 rounded-full" style={{ background: c.text, opacity: 0.5 }} />
        <span className="size-1 rounded-full" style={{ background: c.text, opacity: 0.5 }} />
      </div>
      <div className="flex gap-1 p-1.5">
        {/* Sidebar */}
        <div className="w-3.5 shrink-0 space-y-1">
          <span className="block h-1 rounded-full" style={{ background: c.accent, opacity: 0.9 }} />
          <span className="block h-1 rounded-full" style={{ background: c.surface }} />
          <span className="block h-1 rounded-full" style={{ background: c.surface }} />
        </div>
        {/* Content */}
        <div className="flex-1 space-y-1">
          <span className="block h-2 rounded-[4px]" style={{ background: c.ink, opacity: 0.28 }} />
          <span className="block h-2 w-3/4 rounded-[4px]" style={{ background: c.surface }} />
          <span className="block h-2 w-5/6 rounded-[4px]" style={{ background: c.surface }} />
          <span
            className="mt-1 block h-3 w-6 rounded-md"
            style={{ background: c.accent, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.25)" }}
          />
        </div>
      </div>
    </div>
  );
}

const themeOptions: Array<{ value: AppTheme; label: string; icon: typeof Monitor }> = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/** Renders each theme option as a selectable card with a live mini preview. */
function ThemeOptionCard({
  value,
  label,
  icon: Icon,
  selected,
  onSelect,
}: {
  value: AppTheme;
  label: string;
  icon: typeof Monitor;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${label} theme`}
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col gap-2.5 rounded-xl border p-2 text-left outline-none transition-all",
        "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected
          ? "border-primary bg-primary/5"
          : "border-border bg-background hover:border-border/80 hover:bg-muted/40"
      )}
    >
      {/* Selection badge */}
      <span
        className={cn(
          "absolute top-3 right-3 z-10 flex size-5 items-center justify-center rounded-full transition-all",
          selected ? "bg-primary text-primary-foreground" : "opacity-0"
        )}
      >
        <Check className="size-3" strokeWidth={2.5} />
      </span>
      <div className="aspect-[16/10] w-full overflow-hidden rounded-[6px]">
        {value === "system" ? (
          <div className="flex h-full w-full">
            <div className="w-1/2"><MiniWindow mode="light" /></div>
            <div className="w-1/2"><MiniWindow mode="dark" /></div>
          </div>
        ) : (
          <MiniWindow mode={value} />
        )}
      </div>
      <span className="flex items-center gap-1.5 px-1 pb-0.5 text-sm font-medium text-foreground">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        {label}
      </span>
    </button>
  );
}

export function AppearanceBlock() {
  const {
    theme,
    setTheme,
    soundEnabled,
    setSoundEnabled,
    widgetEnabled,
    setWidgetEnabled,
    enhanceIconEnabled,
    setEnhanceIconEnabled,
  } = useAppStore();

  return (
    <div className="space-y-4">
      {/* Heading */}
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Monitor className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground">Appearance</p>
            <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
              Theme
            </Badge>
          </div>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            Choose how Vox and the floating widget should look.
          </p>
        </div>
      </div>

      {/* Theme picker */}
      <div role="radiogroup" aria-label="Appearance theme" className="grid gap-2.5 sm:grid-cols-3">
        {themeOptions.map((option) => (
          <ThemeOptionCard
            key={option.value}
            value={option.value}
            label={option.label}
            icon={option.icon}
            selected={theme === option.value}
            onSelect={() => void setTheme(option.value)}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        System follows your macOS appearance. Use Light or Dark to pin Vox to one look.
      </p>

      <div className="h-px bg-border" />

      <SettingRow
        icon={<Volume2 className="h-4 w-4" />}
        title="Sound cues"
        description="Play a short cue when recording starts or stops."
        action={
          <Switch
            id="sound-cues"
            aria-label="Sound cues"
            checked={soundEnabled}
            onCheckedChange={(checked) => void setSoundEnabled(checked)}
          />
        }
      />

      <div className="h-px bg-border" />

      <SettingRow
        icon={<Monitor className="h-4 w-4" />}
        title="Floating widget"
        description="Show the small recording status window while Vox listens and transcribes."
        action={
          <Switch
            id="floating-widget"
            aria-label="Floating widget"
            checked={widgetEnabled}
            onCheckedChange={(checked) => void setWidgetEnabled(checked)}
          />
        }
      />

      <div className="h-px bg-border" />

      <SettingRow
        icon={<Sparkles className="h-4 w-4" />}
        title="Enhance icon"
        description="Show the Enhance action in the dictation widget after you dictate, so you can rewrite the text you just typed."
        action={
          <Switch
            id="enhance-icon"
            aria-label="Enhance icon"
            checked={enhanceIconEnabled}
            onCheckedChange={(checked) => void setEnhanceIconEnabled(checked)}
          />
        }
      />
    </div>
  );
}
