import { Code2, ExternalLink, Globe, Mail, MonitorSmartphone, Sparkles } from "lucide-react"
import { type Update } from "@tauri-apps/plugin-updater"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import {
  ABOUT_EMAIL,
  ABOUT_REPOSITORY,
  ABOUT_VERSION,
  ABOUT_WEBSITE,
} from "@/lib/about"
import { useAppStore } from "@/store/app-store"

function formatBytes(bytes: number) {
  const gb = bytes / 1024 / 1024 / 1024
  if (gb >= 1) return `${gb.toFixed(2).replace(/\.?0+$/, "")} GB`
  return `${Math.round(bytes / 1024 / 1024)} MB`
}

export function getUpdateNotes(update: Update | null) {
  if (!update) return ""

  const updateWithNotes = update as Update & { body?: string; notes?: string }
  return updateWithNotes.body || updateWithNotes.notes || "No changelog was included for this update."
}

export function renderReleaseNotes(notes: string) {
  return notes.split("\n").map((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) return null

    if (trimmed.startsWith("## ")) {
      return (
        <p key={`${trimmed}-${index}`} className="mt-4 text-sm font-semibold text-foreground first:mt-0">
          {trimmed.replace(/^##\s+/, "")}
        </p>
      )
    }

    if (trimmed.startsWith("### ")) {
      return (
        <p key={`${trimmed}-${index}`} className="mt-3 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {trimmed.replace(/^###\s+/, "")}
        </p>
      )
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      return (
        <p key={`${trimmed}-${index}`} className="pl-3 text-sm leading-6 text-muted-foreground before:mr-2 before:content-['-']">
          {trimmed.replace(/^[-*]\s+/, "")}
        </p>
      )
    }

    return (
      <p key={`${trimmed}-${index}`} className="text-sm leading-6 text-muted-foreground">
        {trimmed}
      </p>
    )
  })
}

export function AboutPage() {
  const {
    updateInfo,
    updateStatus,
    updateProgress,
    updateMessage,
    showUpdateDialog,
    checkForUpdates,
    installUpdate,
    setShowUpdateDialog,
  } = useAppStore()

  const progressPct =
    updateProgress.total && updateProgress.total > 0
      ? Math.round((updateProgress.downloaded / updateProgress.total) * 100)
      : null

  return (
    <div className="h-full overflow-hidden bg-background">

      <ScrollArea className="h-full">
        <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-5 p-6 lg:p-8">
          <section className="overflow-hidden rounded-[2rem] border border-border bg-card shadow-xs">
            <div className="relative px-6 py-7 lg:px-8 lg:py-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.12),transparent_34%)]" />
              <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-2xl">
                  <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-background/80 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    About Vox
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-background shadow-sm">
                      <img src="/logo.png" alt="Vox" className="h-9 w-9 object-contain" />
                    </div>
                    <div>
                      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Vox</h1>
                      <p className="mt-1 text-sm text-muted-foreground">Private local dictation for a fast desktop workflow.</p>
                    </div>
                  </div>
                  <p className="mt-5 max-w-xl text-sm leading-7 text-muted-foreground">
                    Vox is designed for fast voice capture, local transcription, and a focused desktop experience without sending your audio to external services.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <span className="rounded-full border border-border bg-background/80 px-3 py-1.5 text-xs font-medium text-foreground">
                      Version {ABOUT_VERSION}
                    </span>
                    <span className="rounded-full border border-border bg-background/80 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                      Local-first
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 lg:max-w-[320px] lg:justify-end">
                  <AboutLinkButton icon={<Code2 className="h-4 w-4" />} href={ABOUT_REPOSITORY} label="GitHub" />
                  <AboutLinkButton icon={<Globe className="h-4 w-4" />} href={ABOUT_WEBSITE} label="Website" />
                  <AboutLinkButton icon={<Mail className="h-4 w-4" />} href={`mailto:${ABOUT_EMAIL}`} label="Email" />
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-[0.82fr_1.18fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <MonitorSmartphone className="h-4 w-4" />
                </div>
                <p className="mt-4 text-base font-semibold text-foreground">Build details</p>
                <div className="mt-4 space-y-3">
                  <AboutInfoRow label="Desktop shell" value="Tauri v2" />
                  <AboutInfoRow label="Platform" value="macOS desktop" />
                  <AboutInfoRow label="Minimum macOS" value="10.15" />
                  <AboutInfoRow label="Release channel" value="GitHub Releases" />
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-foreground">Updates</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Check for new GitHub release builds and install them directly from inside Vox.
                    </p>
                  </div>
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-primary">
                    Enabled
                  </span>
                </div>
                <div className="mt-4 rounded-xl border border-border bg-background px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {updateInfo
                          ? `Update ready: ${updateInfo.version}`
                          : updateStatus === "upToDate"
                            ? "You are up to date"
                            : `Current version: ${ABOUT_VERSION}`}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {updateMessage ?? "Use the updater to check for the latest published release."}
                      </p>
                    </div>
                    {(updateStatus === "checking" || updateStatus === "downloading" || updateStatus === "installing") && (
                      <Spinner className="size-4 shrink-0" />
                    )}
                  </div>
                  {updateStatus === "downloading" && (
                    <div className="mt-3 space-y-1.5">
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${progressPct ?? 12}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{formatBytes(updateProgress.downloaded)}</span>
                        <span>
                          {progressPct !== null
                            ? `${progressPct}%`
                            : updateProgress.total
                              ? formatBytes(updateProgress.total)
                              : "Preparing..."}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void checkForUpdates()}
                    disabled={updateStatus === "checking" || updateStatus === "downloading" || updateStatus === "installing"}
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {updateStatus === "checking" ? <Spinner className="size-4" /> : null}
                    Check for updates
                  </button>
                  <button
                    type="button"
                    onClick={() => void installUpdate()}
                    disabled={!updateInfo || updateStatus === "checking" || updateStatus === "downloading" || updateStatus === "installing"}
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-primary px-3 py-2 text-sm text-primary-foreground transition-colors hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {updateStatus === "downloading" || updateStatus === "installing" ? <Spinner className="size-4" /> : null}
                    Download and install
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowUpdateDialog(true)}
                    disabled={!updateInfo}
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    View changelog
                  </button>
                  <a
                    href={ABOUT_REPOSITORY + "/releases"}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                  >
                    View releases
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </div>
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}

function AboutLinkButton({ icon, href, label }: { icon: React.ReactNode; href: string; label: string }) {
  return (
    <a
      href={href}
      target={href.startsWith("mailto:") ? undefined : "_blank"}
      rel={href.startsWith("mailto:") ? undefined : "noreferrer"}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-background/85 px-3.5 py-2 text-sm font-medium text-foreground backdrop-blur transition-colors hover:bg-muted"
    >
      {icon}
      {label}
      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
    </a>
  )
}

function AboutInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  )
}
