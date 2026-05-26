import * as Sentry from "@sentry/react";

const GLITCHTIP_DSN = import.meta.env.VITE_GLITCHTIP_DSN as string | undefined;

let errorReportingEnabled = false;

export function configureErrorReporting(enabled: boolean) {
  if (!enabled || !GLITCHTIP_DSN) {
    errorReportingEnabled = false;
    void Sentry.getClient()?.close(0);
    return;
  }

  if (errorReportingEnabled) return;

  Sentry.init({
    dsn: GLITCHTIP_DSN,
    release: `${__APP_PACKAGE_NAME__}@${__APP_VERSION__}`,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      return scrubEvent(event);
    },
  });
  Sentry.setUser(null);
  errorReportingEnabled = true;
}

export const ErrorBoundary = Sentry.ErrorBoundary;

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  delete event.user;
  delete event.request;
  event.extra = scrubValue(event.extra) as Sentry.ErrorEvent["extra"];
  event.contexts = scrubValue(event.contexts) as Sentry.ErrorEvent["contexts"];
  event.breadcrumbs = event.breadcrumbs?.map((breadcrumb) => ({
    ...breadcrumb,
    data: scrubValue(breadcrumb.data) as Record<string, unknown> | undefined,
  }));
  return event;
}

function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubValue);
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? scrubString(value) : value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      shouldRedactKey(key) ? "[redacted]" : scrubValue(nestedValue),
    ])
  );
}

function shouldRedactKey(key: string) {
  return /audio|path|recording|text|transcript|dictionary|hotkey|shortcut/i.test(key);
}

function scrubString(value: string) {
  if (/\.wav\b|\/Users\/|file:\/\//i.test(value)) return "[redacted]";
  return value;
}
