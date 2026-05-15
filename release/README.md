# Updater Release Flow

`release:prepare` automates the fragile parts of updater release preparation:

- locating the built updater archive
- signing the real archive
- generating `release/latest.json` for `darwin-aarch64`

## Local flow with a private key file

1. Build the desktop app: `pnpm desktop:build`
2. Run release preparation:

   `TAURI_SIGNING_PRIVATE_KEY_PATH=/absolute/path/to/private.key TAURI_SIGNING_PRIVATE_KEY_PASSWORD=your-password pnpm release:prepare`

## CI-friendly flow with env key material

1. Build the desktop app: `pnpm desktop:build`
2. Run release preparation:

   `TAURI_SIGNING_PRIVATE_KEY="$TAURI_SIGNING_PRIVATE_KEY" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" pnpm release:prepare`

## Optional overrides

- `RELEASE_ARCHIVE_PATH` to point to a specific updater archive
- `RELEASE_REPO` to override the default `imrj05/vox-app`
- `RELEASE_TAG` to override the default `v<tauri-version>`
- `RELEASE_NOTES` to populate updater notes
- `RELEASE_DATE` to override the manifest `pub_date`

## Manual manifest generation

If you already have a signature and URL, you can still generate the manifest directly:

`RELEASE_VERSION=0.1.1 RELEASE_PLATFORM=darwin-aarch64 RELEASE_SIGNATURE=<signature> RELEASE_URL=<download-url> pnpm release:manifest`

For multi-platform use, pass `RELEASE_PLATFORMS_JSON` as a JSON object keyed by platform name.

## Upload targets

Upload both files to the GitHub release matching the tag used above:

- the signed updater archive, for example `Vox.app.tar.gz`
- `latest.json`

The updater endpoint is already configured to read:

`https://github.com/imrj05/vox-app/releases/latest/download/latest.json`

The public key is already embedded in `src-tauri/tauri.conf.json`.

## GitHub Actions release workflow

The repository can publish releases through GitHub Actions using `.github/workflows/release.yml`.

Triggers:

- pushing a tag like `v0.1.1`
- pushing a release branch like `release/v0.1.1`
- manual `workflow_dispatch`

Required repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Manual workflow runs must provide a `release_tag`, for example `v0.1.1`.

When a `release/v*` branch is pushed, the workflow reads `src-tauri/tauri.conf.json`, creates the matching `v*` tag if it does not already exist, and publishes that release.

The workflow will:

- build the macOS app
- run `pnpm release:prepare`
- create or update the GitHub Release
- upload the updater archive and `latest.json`

`release:prepare` also writes `release/release-metadata.json`, which the workflow uses to upload the exact generated assets.

## Normal CI workflow

The repository also includes `.github/workflows/ci.yml` for regular validation on pushes and pull requests.

It currently runs:

- `pnpm typecheck`
- `pnpm build`

It intentionally does not run `pnpm lint` yet because the repo still has pre-existing unrelated lint failures that should be fixed separately.
