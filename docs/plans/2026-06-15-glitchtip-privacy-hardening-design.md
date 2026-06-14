# GlitchTip Privacy Hardening

## Goal

Keep opt-in crash reporting useful without sending dictated text, recordings,
local paths, settings, identity, or other free-form user data.

## Design

Both the React and Rust Sentry clients validate the configured GlitchTip DSN
before initialization. Only HTTP and HTTPS DSNs with the required project
details are accepted.

Before transmission, each client removes user and request data, messages,
breadcrumbs, tags, contexts, extras, and transaction names. Exception values
are replaced with a fixed redaction marker. Stack structure remains available
for diagnosis, but absolute paths, source context, and local variables are
removed.

The existing persisted user preference remains the source of truth. Reporting
stays disabled until settings hydration completes and the user has enabled it.

## Verification

Unit tests cover native event redaction and DSN rejection. TypeScript checks,
ESLint, Rust formatting, and Cargo tests verify the integration builds cleanly.
