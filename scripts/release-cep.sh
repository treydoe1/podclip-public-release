#!/usr/bin/env bash

set -euo pipefail
export COPYFILE_DISABLE=1

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_PATH="$ROOT_DIR/CSXS/manifest.xml"
DIST_DIR="$ROOT_DIR/dist"

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "Manifest not found at $MANIFEST_PATH" >&2
  exit 1
fi

extract_manifest_attr() {
  local attr="$1"
  perl -0ne "print \$1 if /${attr}=\"([^\"]+)\"/" "$MANIFEST_PATH"
}

BUNDLE_ID="$(extract_manifest_attr ExtensionBundleId)"
VERSION="$(extract_manifest_attr ExtensionBundleVersion)"
DISPLAY_NAME="$(extract_manifest_attr ExtensionBundleName)"

if [[ -z "$BUNDLE_ID" || -z "$VERSION" ]]; then
  echo "Could not read ExtensionBundleId or ExtensionBundleVersion from manifest." >&2
  exit 1
fi

STAGE_ROOT="$DIST_DIR/${BUNDLE_ID}-${VERSION}"
EXTENSION_DIR="$STAGE_ROOT/$BUNDLE_ID"
ARCHIVE_BASE="${BUNDLE_ID}-${VERSION}"
ZIP_PATH="$DIST_DIR/${ARCHIVE_BASE}.zip"
ZXP_PATH="$DIST_DIR/${ARCHIVE_BASE}.zxp"

echo "Preparing CEP release for ${DISPLAY_NAME:-$BUNDLE_ID} $VERSION"
echo "Output directory: $DIST_DIR"

rm -rf "$STAGE_ROOT"
mkdir -p "$EXTENSION_DIR"

cp -R "$ROOT_DIR/CSXS" "$EXTENSION_DIR/"
cp -R "$ROOT_DIR/client" "$EXTENSION_DIR/"
cp -R "$ROOT_DIR/host" "$EXTENSION_DIR/"
cp -R "$ROOT_DIR/vendor" "$EXTENSION_DIR/"

/usr/bin/xattr -cr "$EXTENSION_DIR" 2>/dev/null || true
/usr/bin/find "$EXTENSION_DIR" \( -name ".DS_Store" -o -name "._*" \) -delete

if [[ -n "${APP_SIGN_IDENTITY:-}" ]]; then
  while IFS= read -r tool_path; do
    /usr/bin/codesign \
      --force \
      --options runtime \
      --timestamp \
      --sign "$APP_SIGN_IDENTITY" \
      "$tool_path"
  done < <(/usr/bin/find "$EXTENSION_DIR/vendor/ffmpeg" -type f \( -name "ffmpeg" -o -name "ffprobe" \))
fi

rm -f "$ZIP_PATH" "$ZXP_PATH"
(
  cd "$STAGE_ROOT"
  /usr/bin/zip -rq "$ZIP_PATH" "$BUNDLE_ID"
)

echo "Created unsigned ZIP: $ZIP_PATH"
echo "Staged extension folder: $EXTENSION_DIR"

if [[ "${SIGN_ZXP:-0}" != "1" ]]; then
  cat <<EOF
Skipping ZXP signing.

To create a signed ZXP, run:
  SIGN_ZXP=1 \\
  ZXPSIGNCMD=/absolute/path/to/ZXPSignCmd \\
  ZXP_CERT=/absolute/path/to/certificate.p12 \\
  ZXP_CERT_PASSWORD='your-password' \\
  $0

Optional:
  ZXP_TIMESTAMP_URL=https://timestamp.digicert.com
EOF
  exit 0
fi

if [[ -z "${ZXPSIGNCMD:-}" || -z "${ZXP_CERT:-}" || -z "${ZXP_CERT_PASSWORD:-}" ]]; then
  echo "Signing requested, but ZXPSIGNCMD, ZXP_CERT, or ZXP_CERT_PASSWORD is missing." >&2
  exit 1
fi

if [[ ! -x "$ZXPSIGNCMD" ]]; then
  echo "ZXPSignCmd is not executable: $ZXPSIGNCMD" >&2
  exit 1
fi

if [[ ! -f "$ZXP_CERT" ]]; then
  echo "Certificate not found: $ZXP_CERT" >&2
  exit 1
fi

SIGN_ARGS=(
  "$ZXPSIGNCMD"
  -sign
  "$EXTENSION_DIR"
  "$ZXP_PATH"
  "$ZXP_CERT"
  "$ZXP_CERT_PASSWORD"
)

if [[ -n "${ZXP_TIMESTAMP_URL:-}" ]]; then
  SIGN_ARGS+=(-tsa "$ZXP_TIMESTAMP_URL")
fi

"${SIGN_ARGS[@]}"

"$ZXPSIGNCMD" -verify "$ZXP_PATH"

echo "Created signed ZXP: $ZXP_PATH"
