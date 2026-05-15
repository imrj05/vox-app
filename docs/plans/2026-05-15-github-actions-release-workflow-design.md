# GitHub Actions Release Workflow Design

## Summary

Add a single GitHub Actions workflow that builds the macOS Vox app, prepares signed updater assets, creates or updates a GitHub Release, and uploads the updater archive plus `latest.json`.

## Goals

- Support both tag-driven and manual release publishing.
- Keep GitHub Releases and updater assets in sync.
- Reuse the local `release:prepare` script in CI instead of maintaining a separate release flow.
- Publish the files required by the in-app updater at the configured GitHub Releases endpoint.

## Non-Goals

- Multi-platform release publishing.
- Notarization changes.
- Replacing the existing local release flow.

## Approach Options

### Option 1: Separate build and publish workflows

Trade-offs:
- More modular.
- Requires artifact passing and more coordination.

### Option 2: Tauri release action with extra manifest handling

Trade-offs:
- Less custom YAML.
- Harder to fit the repo's custom updater manifest generation flow.

### Option 3: Single custom release workflow

Trade-offs:
- One workflow owns the entire release flow.
- Easier to reason about and directly reuses `pnpm release:prepare`.

Recommended: Option 3.

## Design

### Workflow File

Add `.github/workflows/release.yml`.

Triggers:
- `push` on tags matching `v*`
- `workflow_dispatch` with a required `release_tag` input

Permissions:
- `contents: write`

Runner:
- `macos-latest`

### Workflow Steps

1. Check out the repository.
2. Install pnpm and Node.
3. Install stable Rust.
4. Install dependencies with `pnpm install --frozen-lockfile`.
5. Build the desktop app with `pnpm desktop:build`.
6. Prepare updater assets with `pnpm release:prepare` using CI secrets.
7. Read generated release metadata from a JSON file written by `release:prepare`.
8. Create the GitHub Release if it does not exist, otherwise update it.
9. Upload the updater archive and `release/latest.json` with overwrite enabled.

### Release Inputs

CI will use:
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Workflow variables:
- `RELEASE_TAG` from the pushed tag or manual input
- `RELEASE_REPO` from `github.repository`

### Script Adjustment

Extend `scripts/prepare-release.mjs` so it also writes release metadata to a JSON file. This allows the workflow to upload the exact generated archive and manifest without re-implementing archive discovery logic in YAML.

Suggested metadata contents:
- `version`
- `releaseTag`
- `archivePath`
- `assetName`
- `manifestPath`
- `manifestName`
- `downloadUrl`

### Documentation

Update `release/README.md` with:
- required GitHub secrets
- workflow triggers
- manual dispatch usage
- upload behavior

## Error Handling

- Fail early when signing secrets are missing.
- Fail if build output or release metadata is missing.
- Use `gh release upload --clobber` so reruns replace assets cleanly.
- Create releases with the requested tag if they do not already exist.

## Verification

- Validate workflow YAML structure.
- Verify the release metadata file is produced by `release:prepare`.
- Avoid attempting a real release from the local workspace.
