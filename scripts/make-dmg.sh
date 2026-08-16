#!/usr/bin/env bash
# Build, sign, notarize and staple the release DMG for Vox.
#
# Usage: ./scripts/make-dmg.sh [version] [path-to-Vox.app]
# Example: ./scripts/make-dmg.sh 0.0.8 src-tauri/target/release/bundle/macos/Vox.app
#
# Both arguments default to the current build:
#   version -> read from src-tauri/tauri.conf.json
#   app     -> src-tauri/target/release/bundle/macos/<ProductName>.app
#
# Prints the sha256 of the finished DMG for release notes / checksums.
#
# Environment:
#   APPLE_SIGNING_IDENTITY   Code-signing identity. Defaults to the first
#                            "Developer ID Application" identity in the keychain.
#                            Without one the DMG is built unsigned (fine for
#                            local installs, not for distribution).
#   NOTARY_PROFILE           notarytool keychain profile (default: vox-notary).
#                            Falls back to APPLE_ID / APPLE_ID_PASSWORD /
#                            APPLE_TEAM_ID from the environment (e.g. .env).
#   DMG_OUT_DIR              Output directory (default: <repo>/release).
#   DMG_BACKGROUND           Optional background image for the DMG window.
#   DMG_VOLUME_ICON          Optional .icns volume icon.
#
# Dependencies:
#   - create-dmg (brew install create-dmg) for the polished layout with an
#     app-drop link. Falls back to a plain hdiutil DMG when missing.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Apple notarization credentials live in .env (never committed).
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$REPO_ROOT/.env"
  set +a
fi

read_tauri_field() {
  node -e "console.log(JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'))[process.argv[2]])" "$REPO_ROOT/src-tauri/tauri.conf.json" "$1"
}

PRODUCT_NAME="$(read_tauri_field 'productName')"
VERSION="${1:-$(read_tauri_field 'version')}"
APP="${2:-$REPO_ROOT/src-tauri/target/release/bundle/macos/${PRODUCT_NAME}.app}"

[ -d "$APP" ] || {
  echo "App not found at: $APP" >&2
  echo "Run \`pnpm desktop:build:macos\` first (it produces bundle/macos/${PRODUCT_NAME}.app)." >&2
  exit 1
}

# A DMG named vX around a vY app is a silent release trap — refuse the mismatch.
APP_VERSION="$(defaults read "$APP/Contents/Info" CFBundleShortVersionString)"
if [ "$APP_VERSION" != "$VERSION" ]; then
  echo "Version mismatch: app is $APP_VERSION but building ${PRODUCT_NAME}-v${VERSION}.dmg" >&2
  echo "Bump the version in src-tauri/tauri.conf.json and package.json, then rebuild." >&2
  exit 1
fi

OUT_DIR="${DMG_OUT_DIR:-$REPO_ROOT/release}"
DMG="$OUT_DIR/${PRODUCT_NAME}-v${VERSION}.dmg"
STAGING="$(mktemp -d)/staging"
NOTARY_PROFILE="${NOTARY_PROFILE:-vox-notary}"

# Resolve a code-signing identity. Apple Development identities are rejected by
# notarization, so we look for a Developer ID Application certificate.
IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
if [ -z "$IDENTITY" ]; then
  IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | awk '/Developer ID Application/ {print $2; exit}')" || true
fi

if [ -n "$IDENTITY" ]; then
  echo "==> Verifying the app is properly signed"
  codesign --verify --deep --strict "$APP"
else
  echo "!! No 'Developer ID Application' identity found — building an UNSIGNED DMG."
  echo "   Set APPLE_SIGNING_IDENTITY to sign (required for notarization)."
fi

echo "==> Staging"
mkdir -p "$STAGING"
cp -R "$APP" "$STAGING/"

echo "==> Creating $DMG"
mkdir -p "$OUT_DIR"
rm -f "$DMG"

if command -v create-dmg >/dev/null 2>&1; then
  # Polished layout: app icon left, Applications drop-link right.
  # The window is 600x368, matching a 1200x736 @2x background if provided.
  CREATE_DMG_ARGS=(
    --volname "$PRODUCT_NAME"
    --window-pos 200 120
    --window-size 600 368
    --icon-size 100
    --text-size 16
    --icon "${PRODUCT_NAME}.app" 175 192
    --app-drop-link 425 192
  )
  [ -n "${DMG_BACKGROUND:-}" ] && [ -f "$DMG_BACKGROUND" ] && CREATE_DMG_ARGS+=(--background "$DMG_BACKGROUND")
  [ -n "${DMG_VOLUME_ICON:-}" ] && [ -f "$DMG_VOLUME_ICON" ] && CREATE_DMG_ARGS+=(--volicon "$DMG_VOLUME_ICON")
  create-dmg "${CREATE_DMG_ARGS[@]}" "$DMG" "$STAGING"
else
  echo "!! create-dmg not found — using a plain hdiutil DMG. Install with: brew install create-dmg"
  TMP_DMG="$(mktemp -d)/${PRODUCT_NAME}-${VERSION}-rw.dmg"
  ln -s /Applications "$STAGING/Applications"
  hdiutil create -volname "$PRODUCT_NAME" -srcfolder "$STAGING" -ov -format UDRW "$TMP_DMG" >/dev/null
  hdiutil convert "$TMP_DMG" -format UDZO -imagekey zlib-level=9 -o "$DMG" >/dev/null
fi

if [ -n "$IDENTITY" ]; then
  echo "==> Signing the DMG (before notarizing)"
  codesign --force --timestamp --sign "$IDENTITY" "$DMG"

  echo "==> Notarizing"
  if xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
    xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
  elif [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_ID_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
    xcrun notarytool submit "$DMG" \
      --apple-id "$APPLE_ID" \
      --apple-password "$APPLE_ID_PASSWORD" \
      --team-id "$APPLE_TEAM_ID" \
      --wait
  else
    echo "!! Notarization skipped: set NOTARY_PROFILE or APPLE_ID/APPLE_ID_PASSWORD/APPLE_TEAM_ID." >&2
  fi

  echo "==> Stapling"
  xcrun stapler staple "$DMG" || true
  spctl -a -t open --context context:primary-signature -vv "$DMG" ||
    echo "!! Gatekeeper check failed — expected when notarization was skipped."
fi

echo
echo "==> Release checksum"
echo "sha256: $(shasum -a 256 "$DMG" | awk '{print $1}')"
echo "dmg:    $DMG"
