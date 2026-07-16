#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_PATH="$ROOT_DIR/CSXS/manifest.xml"
DIST_DIR="$ROOT_DIR/dist"

extract_manifest_attr() {
  local attr="$1"
  perl -0ne "print \$1 if /${attr}=\"([^\"]+)\"/" "$MANIFEST_PATH"
}

VERSION="$(extract_manifest_attr ExtensionBundleVersion)"
DISPLAY_NAME="$(extract_manifest_attr ExtensionBundleName)"
PKG_PATH="${1:-$DIST_DIR/${DISPLAY_NAME:-Podclip}-Installer-${VERSION}.pkg}"
KEYCHAIN_PROFILE="${NOTARY_PROFILE:-}"

if [[ -z "$KEYCHAIN_PROFILE" ]]; then
  echo "NOTARY_PROFILE is required." >&2
  echo "Example: NOTARY_PROFILE=Podclip ./scripts/notarize-installer.sh" >&2
  exit 1
fi

if [[ ! -f "$PKG_PATH" ]]; then
  echo "Installer package not found: $PKG_PATH" >&2
  exit 1
fi

echo "Submitting for notarization: $PKG_PATH"
xcrun notarytool submit "$PKG_PATH" --keychain-profile "$KEYCHAIN_PROFILE" --wait

echo "Stapling notarization ticket..."
xcrun stapler staple "$PKG_PATH"

echo "Validating stapled package..."
xcrun stapler validate "$PKG_PATH"

echo "Notarized installer ready: $PKG_PATH"
