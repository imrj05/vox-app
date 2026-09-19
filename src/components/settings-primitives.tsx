import { cn } from "@/lib/utils";
import { Check } from "@/components/icons";

export function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

export function SettingsCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-5",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Icon chip + title + description used at the top of every settings card. */
export function SettingGroupHeader({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

export function SettingRow({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <SettingGroupHeader icon={icon} title={title} description={description} />
      <div className="shrink-0">{action}</div>
    </div>
  );
}

/** A radio group of OptionTiles. */
export function OptionGrid({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("grid gap-2", className)}
    >
      {children}
    </div>
  );
}

/**
 * Selectable option tile: quiet border when idle, primary tint + check
 * indicator when selected, tactile scale on press.
 */
export function OptionTile({
  selected,
  onSelect,
  title,
  description,
  status,
  disabled,
  disabledReason,
  dense,
  className,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
  status?: { label: string; ok: boolean };
  disabled?: boolean;
  disabledReason?: string;
  dense?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onClick={onSelect}
      className={cn(
        "group/option relative flex flex-col rounded-xl border text-left outline-none",
        "transition-[background-color,border-color,transform,opacity] duration-150 ease-out",
        "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        selected
          ? "border-primary/50 bg-primary/5"
          : "border-border bg-background hover:bg-muted/50",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "cursor-pointer active:scale-[0.96]",
        dense ? "p-2.5" : "p-3.5",
        className
      )}
    >
      <span
        className={cn(
          "flex items-center gap-2 pr-6 text-sm font-medium text-foreground",
          dense && "pr-5"
        )}
      >
        <span className="min-w-0 truncate">{title}</span>
        {status ? (
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 text-[11px] font-normal",
              status.ok ? "text-primary" : "text-muted-foreground"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                status.ok ? "bg-primary" : "bg-muted-foreground/40"
              )}
            />
            {status.label}
          </span>
        ) : null}
      </span>
      {description ? (
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {description}
        </span>
      ) : null}
      <span
        aria-hidden
        className={cn(
          "absolute top-3 right-3 flex size-4 items-center justify-center rounded-full border transition-[opacity,transform,background-color,border-color] duration-150 ease-out",
          selected
            ? "scale-100 border-primary bg-primary text-primary-foreground opacity-100"
            : "scale-75 border-muted-foreground/40 text-transparent opacity-0 group-hover/option:opacity-60",
          dense && "top-2.5 right-2.5"
        )}
      >
        <Check className="size-2.5" strokeWidth={3} />
      </span>
    </button>
  );
}

/** Inline warning callout for state that needs the user's attention. */
export function Notice({
  icon,
  title,
  children,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5",
        className
      )}
    >
      <div className="mt-0.5 shrink-0 text-amber-500">{icon}</div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
          {children}
        </div>
      </div>
    </div>
  );
}
