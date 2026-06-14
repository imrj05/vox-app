import * as Sentry from "@sentry/react";

const GLITCHTIP_DSN = import.meta.env.VITE_GLITCHTIP_DSN as string | undefined;
const REDACTED = "[redacted]";

let errorReportingEnabled = false;

export function configureErrorReporting(enabled: boolean) {
  if (!enabled || !isValidGlitchTipDsn(GLITCHTIP_DSN)) {
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
      return sanitizeErrorEvent(event);
    },
  });
  Sentry.setUser(null);
  errorReportingEnabled = true;
}

export const ErrorBoundary = Sentry.ErrorBoundary;

export function isValidGlitchTipDsn(dsn: string | undefined): dsn is string {
  if (!dsn) return false;

  try {
    const url = new URL(dsn);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      Boolean(url.username) &&
      url.pathname.split("/").some(Boolean)
    );
  } catch {
    return false;
  }
}

export function sanitizeErrorEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  delete event.user;
  delete event.request;
  delete event.message;
  delete event.logentry;
  delete event.transaction;
  delete event.extra;
  delete event.contexts;
  delete event.tags;
  event.breadcrumbs = [];
  event.exception?.values?.forEach((exception) => {
    exception.value = REDACTED;
    scrubStacktrace(exception.stacktrace);
  });
  event.threads?.values?.forEach((thread) => scrubStacktrace(thread.stacktrace));
  return event;
}

function scrubStacktrace(stacktrace: Sentry.Stacktrace | undefined) {
  stacktrace?.frames?.forEach((frame) => {
    delete frame.abs_path;
    delete frame.pre_context;
    delete frame.context_line;
    delete frame.post_context;
    delete frame.vars;
  });
}
