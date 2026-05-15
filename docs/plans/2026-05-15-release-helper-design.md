# Release Helper Design

## Summary

Add a single Node-based release helper that prepares Vox updater metadata from real Tauri build outputs. The helper should support both local file-based signing and CI-friendly environment-variable signing, with `darwin-aarch64` as the default updater target.

## Goals

- Reduce manual release mistakes when preparing updater assets.
- Reuse the existing Tauri build and signer tooling.
- Support both local and CI release preparation without separate flows.
- Generate a real `release/latest.json` from actual archive/signature inputs.

## Non-Goals

- Uploading assets to GitHub Releases.
- Supporting Intel or universal macOS updater manifests in this pass.
- Replacing Tauri build output conventions.

## Approach Options

### Option 1: Keep the manual split flow

Use `pnpm desktop:build`, sign manually, then run the existing manifest script with environment variables.

Trade-offs:
- Minimal code changes.
- Still error-prone because paths, signatures, and URLs must be copied manually.

### Option 2: Shell wrapper scripts

Create shell scripts that invoke the Tauri build, signer, and manifest generation commands.

Trade-offs:
- Simple for local macOS usage.
- More brittle for parsing outputs and harder to reuse in CI.

### Option 3: Node orchestrator

Add a Node script that reads config, discovers the built updater archive, signs it, and generates the updater manifest.

Trade-offs:
- Slightly more implementation effort.
- Stronger validation, clearer errors, and easier reuse for both local and CI flows.

Recommended: Option 3.

## Design

### New Script

Add `scripts/prepare-release.mjs` as the main release helper.

Responsibilities:
- Read the app version from `src-tauri/tauri.conf.json`.
- Determine the release tag, defaulting to `v<version>`.
- Locate the built macOS updater archive in Tauri output.
- Resolve signing input from either:
  - a private key file path plus password, or
  - raw private key environment variable plus password.
- Invoke `pnpm tauri signer sign` on the located archive.
- Capture the generated signature.
- Generate `release/latest.json` for `darwin-aarch64` with a real GitHub release download URL.

### Existing Manifest Script

Keep `scripts/generate-updater-manifest.mjs`, but make it a lower-level helper that:
- accepts explicit per-platform inputs
- writes the final `release/latest.json`
- stays reusable if release preparation is ever split again

### Configuration Inputs

The release helper will accept inputs from environment variables so it works locally and in CI.

Primary inputs:
- `RELEASE_ARCHIVE_PATH` optional override for the updater archive path
- `RELEASE_TAG` optional override, default `v<version>`
- `RELEASE_REPO` optional override, default `imrj05/vox-app`
- `RELEASE_NOTES` optional updater notes text
- `TAURI_SIGNING_PRIVATE_KEY_PATH` optional local private key file path
- `TAURI_SIGNING_PRIVATE_KEY` optional raw private key content
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` required when signing key is encrypted

Rules:
- Prefer `TAURI_SIGNING_PRIVATE_KEY` when provided.
- Otherwise read from `TAURI_SIGNING_PRIVATE_KEY_PATH`.
- Error clearly if neither key source is provided.

### Package Scripts

Add a top-level script such as `release:prepare` that runs the Node helper.

The helper assumes the Tauri build already exists. This keeps build and release-prep separable while still automating the fragile parts.

### Documentation

Update `release/README.md` to show:
- local file-path signing flow
- CI/env signing flow
- expected generated output
- required upload target for `latest.json` and the updater archive

## Error Handling

- Fail if the Tauri version cannot be read.
- Fail if no updater archive is found.
- Fail if signing credentials are missing.
- Fail if signer output does not contain a signature.
- Print the resolved archive path and generated manifest path for easier verification.

## Verification

- Run the helper with `--help`-equivalent documented environment usage by executing it against the current repo setup.
- Validate that the manifest script still writes `release/latest.json`.
- Avoid full end-to-end updater install verification until real GitHub release assets are uploaded.
