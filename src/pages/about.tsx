import { useEffect, useState } from "react"
import { Code2, Cpu, Database, ExternalLink, Globe, Mail, MonitorSmartphone } from "@/components/icons"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import {
  ABOUT_EMAIL,
  ABOUT_REPOSITORY,
  ABOUT_VERSION,
  ABOUT_WEBSITE,
} from "@/lib/about"
import { openExternalLink } from "@/lib/external-link"
import { Logo } from "@/components/logo"
import {
  getHotkeyDiagnostics,
  getNativeStatus,
  type HotkeyDiagnostics,
  type NativeStatus,
} from "@/lib/native"
import { useAppStore } from "@/store/app-store"

function formatBytes(bytes: number) {
  const gb = bytes / 1024 / 1024 / 1024
  if (gb >= 1) return `${gb.toFixed(2).replace(/\.?0+$/, "")} GB`
  return `${Math.round(bytes / 1024 / 1024)} MB`
}

export function AboutPage() {
  const {
    selectedModel,
    updateInfo,
    updateStatus,
    updateProgress,
    updateMessage,
    checkForUpdates,
    installUpdate,
    setShowUpdateDialog,
  } = useAppStore()
  const [nativeStatus, setNativeStatus] = useState<NativeStatus | null>(null)
  const [diagnostics, setDiagnostics] = useState<HotkeyDiagnostics | null>(null)

  useEffect(() => {
    void getNativeStatus().then(setNativeStatus).catch(() => {})
    void getHotkeyDiagnostics().then(setDiagnostics).catch(() => {})
  }, [])

  const isParakeet = selectedModel.startsWith("parakeet")
  const engineLabel = isParakeet
    ? "transcribe.cpp (Parakeet)"
    : "whisper.cpp (Whisper)"
  const platform = nativeStatus?.platform || "Desktop"

  const progressPct =
    updateProgress.total && updateProgress.total > 0
      ? Math.min(100, Math.round((updateProgress.downloaded / updateProgress.total) * 100))
      : null
  const updateBusy = updateStatus === "checking" || updateStatus === "downloading" || updateStatus === "installing" || updateStatus === "restarting"

  return (
    <div className="h-full overflow-hidden bg-background">

      <ScrollArea className="h-full">
        <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-5 p-6 lg:p-8">
          <section className="rounded-2xl border border-border bg-card">
            <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-center lg:justify-between lg:p-8">
              <div className="min-w-0 max-w-2xl">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-background">
                    <Logo className="h-7 w-7" alt="Vox logo" />
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Vox</h1>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Private local dictation for a fast desktop workflow.
                    </p>
                  </div>
                </div>
                <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
                  Vox is designed for fast voice capture, local transcription, and a focused desktop experience without sending your audio to external services.
                </p>
                <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-muted-foreground">
                  <span>v{ABOUT_VERSION}</span>
                  <span>local-first</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:max-w-[340px] lg:justify-end">
                <AboutLinkButton icon={<Code2 className="h-4 w-4" />} href={ABOUT_REPOSITORY} label="GitHub" />
                <AboutLinkButton icon={<Globe className="h-4 w-4" />} href={ABOUT_WEBSITE} label="Website" />
                <AboutLinkButton icon={<Mail className="h-4 w-4" />} href={`mailto:${ABOUT_EMAIL}`} label="Email" />
              </div>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-[0.82fr_1.18fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <MonitorSmartphone className="h-4 w-4" />
                </div>
                <p className="mt-4 text-base font-semibold text-foreground">Build details</p>
                <div className="mt-4 space-y-3">
                  <AboutInfoRow label="Desktop shell" value="Tauri v2" />
                  <AboutInfoRow label="Platform" value={platform} />
                  <AboutInfoRow label="Minimum macOS" value="10.15" />
                  <AboutInfoRow label="Release channel" value="GitHub Releases" />
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Cpu className="h-4 w-4" />
                </div>
                <p className="mt-4 text-base font-semibold text-foreground">Transcription engine</p>
                <div className="mt-4 space-y-3">
                  <AboutInfoRow label="Active model" value={selectedModel} />
                  <AboutInfoRow label="Runtime" value={engineLabel} />
                  <AboutInfoRow label="Engine status" value={nativeStatus?.engine ?? "Checking"} />
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Database className="h-4 w-4" />
                </div>
                <p className="mt-4 text-base font-semibold text-foreground">Storage</p>
                <div className="mt-4 space-y-3">
                  <AboutInfoRow label="App data" value={shortenPath(diagnostics?.appDataDir)} />
                  <AboutInfoRow label="Models" value={shortenPath(diagnostics?.modelsDir)} />
                  <AboutInfoRow label="Recordings" value={shortenPath(diagnostics?.recordingsDir)} />
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-5">
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
                    {updateBusy && (
                      <Spinner className="size-4 shrink-0" />
                    )}
                  </div>
                  {(updateStatus === "downloading" || updateStatus === "installing" || updateStatus === "restarting") && (
                    <div className="mt-3 space-y-1.5">
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{ width: `${updateStatus === "downloading" ? progressPct ?? 12 : 100}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{formatBytes(updateProgress.downloaded)}</span>
                        <span>
                          {updateStatus === "downloading"
                            ? progressPct !== null
                              ? `${progressPct}%`
                              : updateProgress.total
                                ? formatBytes(updateProgress.total)
                                : "Preparing..."
                            : updateStatus === "installing"
                              ? "Installing..."
                              : "Restarting..."}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void checkForUpdates()}
                    disabled={updateBusy}
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {updateStatus === "checking" ? <Spinner className="size-4" /> : null}
                    Check for updates
                  </button>
                  <button
                    type="button"
                    onClick={() => void installUpdate()}
                    disabled={!updateInfo || updateBusy}
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-primary px-3 py-2 text-sm text-primary-foreground transition-colors hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {updateStatus === "downloading" || updateStatus === "installing" || updateStatus === "restarting" ? <Spinner className="size-4" /> : null}
                    {updateStatus === "downloading"
                      ? "Downloading..."
                      : updateStatus === "installing"
                        ? "Installing..."
                        : updateStatus === "restarting"
                          ? "Restarting..."
                          : "Download and install"}
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
                    onClick={(event) => {
                      event.preventDefault()
                      openExternalLink(ABOUT_REPOSITORY + "/releases")
                    }}
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

function shortenPath(path: string | null | undefined): string {
  if (!path) return "Checking"
  return path.length > 44 ? `…${path.slice(-40)}` : path
}

function AboutLinkButton({ icon, href, label }: { icon: React.ReactNode; href: string; label: string }) {
  return (
    <a
      href={href}
      target={href.startsWith("mailto:") ? undefined : "_blank"}
      rel={href.startsWith("mailto:") ? undefined : "noreferrer"}
      onClick={(event) => {
        event.preventDefault()
        openExternalLink(href)
      }}
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
    >
      {icon}
      {label}
      {href.startsWith("mailto:") ? null : (
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
      )}
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
