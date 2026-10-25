# Updater Release Flow

`release:prepare` automates the fragile parts of updater release preparation:

- locating the built updater archive
- signing the real archive
- naming and staging the uploadable assets per architecture
- generating a single-platform `release/latest.json` (`darwin-aarch64` or `darwin-x86_64`)

The Tauri bundler must create updater artifacts. This is enabled with `bundle.createUpdaterArtifacts` in `src-tauri/tauri.conf.json`, which makes `pnpm desktop:build` produce the `.app.tar.gz` archive consumed by `release:prepare`.

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
- `RELEASE_ASSETS_DIR` to stage uploadable assets somewhere other than `release/`
- `RELEASE_PLATFORM` to override the `lipo`-detected updater platform key
- `RELEASE_REPO` to override the default `imrj05/vox-app`
- `RELEASE_TAG` to override the default `v<tauri-version>`
- `RELEASE_NOTES` to populate updater notes
- `RELEASE_DATE` to override the manifest `pub_date`

## Manual manifest generation

If you already have a signature and URL, you can still generate the manifest directly:

`RELEASE_VERSION=0.1.1 RELEASE_PLATFORM=darwin-aarch64 RELEASE_SIGNATURE=<signature> RELEASE_URL=<download-url> pnpm release:manifest`

For multi-platform use, pass `RELEASE_PLATFORMS_JSON` as a JSON object keyed by platform name.

## Upload targets

Each architecture is built on its own runner and uploads its own pair of files, so
the updater archive carries the architecture in its name:

- signed updater archives: `Vox_<version>_aarch64.app.tar.gz` and `Vox_<version>_x64.app.tar.gz`
- installer images: `Vox_<version>_aarch64.dmg` and `Vox_<version>_x64.dmg`
- `latest.json`

Architecture mapping comes from the built binary (`lipo -archs` on the app
executable), never from a hardcoded string: `arm64` → `darwin-aarch64` / `aarch64`,
`x86_64` → `darwin-x86_64` / `x64`.

## Multi-architecture releases

`release.yml` builds both architectures natively — `macos-15` for Apple Silicon
(`aarch64`) and `macos-15-intel` for Intel (`x64`) — because the sidecar builds
(text enhancement, Parakeet, Apple Speech) stage binaries for the host triple.
No cross-compilation is involved.

Each build job runs `release:prepare`, which writes a single-platform
`latest.json`, and uploads it as a CI artifact. The `publish` job then merges those
manifests so the updater sees every architecture at once:

```bash
pnpm release:merge-manifests artifacts
```

The merge fails if two inputs claim the same platform, so a `darwin-aarch64` entry
can never be silently overwritten by a second build.

The `.app.tar.gz` archive is required by Tauri's auto-updater. The `.dmg` is the user-facing installer asset people can download and install manually from GitHub Releases.

## Custom DMG with signing + notarization

`pnpm make:dmg` builds the latest changes (sidecars + frontend + Rust app) and
produces a polished, signed and notarized DMG from the freshly built `.app`
(background layout, app-drop link, volume icon):

```bash
pnpm make:dmg
```

To skip the rebuild and wrap an existing `.app`, run the script directly:

```bash
bash scripts/make-dmg.sh
```

Optional arguments: `pnpm make:dmg -- <version> <path-to-Vox.app>`

Environment:

- `APPLE_SIGNING_IDENTITY` — Developer ID Application identity. If omitted, the
  identity is taken from the app bundle's existing signature, which keeps the
  DMG signature aligned with the app. Without one, the DMG is built unsigned
  (fine for local installs).
- `NOTARY_PROFILE` (default `vox-notary`) — `notarytool` keychain profile. Falls
  back to `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` from `.env`.
- `DMG_OUT_DIR` (default `release/`), `DMG_BACKGROUND`, `DMG_VOLUME_ICON`.

Requires `create-dmg` for the polished layout: `brew install create-dmg`
(plain `hdiutil` is used as a fallback when missing). The script prints the
sha256 of the finished DMG for release notes.

## Signing secrets (GitHub Actions)

`src-tauri/tauri.conf.json` deliberately has no `signingIdentity`, so the identity
never lives in the repo. Instead, `release.yml` reads these repository secrets and
lets the Tauri CLI import the certificate into a temporary keychain:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of the Developer ID Application `.p12`: `openssl base64 -A -in cert.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | password used when exporting that `.p12` |
| `APPLE_SIGNING_IDENTITY` | optional; defaults to the identity inside the certificate |
| `APPLE_ID` | Apple ID email used for notarization |
| `APPLE_PASSWORD` | app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | team ID of the Developer ID certificate |

Locally the same values come from `.env` (git-ignored), which `pnpm desktop:build`
sources automatically.

## macOS — Gatekeeper warning

If macOS blocks the app, run once in Terminal after installing:

```bash
xattr -cr /Applications/Vox.app
```

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

- build `CHANGELOG.md` and `release/release-notes.md`
- build the macOS app
- run `pnpm release:prepare`
- create or update the GitHub Release
- upload the updater archive, `.dmg` installer, and `latest.json`

`release:prepare` also writes `release/release-metadata.json`, which the workflow uses to upload the exact generated assets.

The release workflow sets `GGML_NATIVE=OFF`, `GGML_CPU_ARM_ARCH=armv8.2-a`, and undefines `__ARM_FEATURE_MATMUL_INT8` for `whisper-rs` builds. This avoids GitHub's Apple Silicon runners entering an unsupported `i8mm` CPU compile path while still allowing Metal acceleration.

To generate changelog notes locally, run `pnpm changelog:build`. It reads the version from `src-tauri/tauri.conf.json`, groups commits by Conventional Commit type, updates `CHANGELOG.md`, and writes release notes to `release/release-notes.md`.

## Normal CI workflow

The repository also includes `.github/workflows/ci.yml` for regular validation on pushes and pull requests.

It currently runs:

- `pnpm typecheck`
- `pnpm build`

It intentionally does not run `pnpm lint` yet because the repo still has pre-existing unrelated lint failures that should be fixed separately.
