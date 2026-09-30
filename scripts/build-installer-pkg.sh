#!/usr/bin/env bash

set -euo pipefail
export COPYFILE_DISABLE=1

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_PATH="$ROOT_DIR/CSXS/manifest.xml"
DIST_DIR="$ROOT_DIR/dist"
PKG_STAGE_DIR="$DIST_DIR/pkgstage"
PKG_ROOT="$PKG_STAGE_DIR/root"
PKG_SCRIPTS_DIR="$ROOT_DIR/installer/scripts"
PKG_ASSET_DIR="$PKG_ROOT/Library/Application Support/Podclip/Installer"

extract_manifest_attr() {
  local attr="$1"
  perl -0ne "print \$1 if /${attr}=\"([^\"]+)\"/" "$MANIFEST_PATH"
}

BUNDLE_ID="$(extract_manifest_attr ExtensionBundleId)"
VERSION="$(extract_manifest_attr ExtensionBundleVersion)"
DISPLAY_NAME="$(extract_manifest_attr ExtensionBundleName)"
ZXP_PATH="$DIST_DIR/${BUNDLE_ID}-${VERSION}.zxp"
PKG_PATH="$DIST_DIR/${DISPLAY_NAME:-Podclip}-Installer-${VERSION}.pkg"
PKG_ID="${BUNDLE_ID}.installer"

if [[ "${SIGN_ZXP:-0}" != "1" ]]; then
  echo "Refusing to build a public installer with an unsigned CEP extension." >&2
  echo "Set SIGN_ZXP=1 and provide ZXPSIGNCMD, ZXP_CERT, and ZXP_CERT_PASSWORD." >&2
  exit 1
fi

if [[ -z "${APP_SIGN_IDENTITY:-}" ]]; then
  echo "APP_SIGN_IDENTITY is required so bundled executables are signed before the CEP package." >&2
  exit 1
fi

if [[ -z "${INSTALLER_SIGN_IDENTITY:-}" ]]; then
  echo "INSTALLER_SIGN_IDENTITY is required for a public installer." >&2
  exit 1
fi

AVAILABLE_ARCHES=()
BAD_RUNTIME_DEPS=()
BAD_LICENSE_FLAGS=()
for arch_dir in "$ROOT_DIR"/vendor/ffmpeg/*; do
  [[ -d "$arch_dir" ]] || continue
  arch_name="$(basename "$arch_dir")"
  if [[ -x "$arch_dir/ffmpeg" && -x "$arch_dir/ffprobe" ]]; then
    AVAILABLE_ARCHES+=("$arch_name")
    if "$arch_dir/ffmpeg" -version 2>/dev/null | head -n 4 | grep -Eq -- '--enable-(gpl|nonfree)'; then
      BAD_LICENSE_FLAGS+=("$arch_name")
    fi
    if command -v otool >/dev/null 2>&1; then
      while IFS= read -r dep; do
        BAD_RUNTIME_DEPS+=("$arch_name: $dep")
      done < <(
        /usr/bin/otool -L "$arch_dir/ffmpeg" "$arch_dir/ffprobe" |
          awk '/^[[:space:]]+\/(opt\/homebrew|usr\/local)\// { print $1 }' |
          sort -u
      )
    fi
  fi
done

if [[ ${#AVAILABLE_ARCHES[@]} -eq 0 ]]; then
  echo "No bundled ffmpeg runtimes found under $ROOT_DIR/vendor/ffmpeg" >&2
  exit 1
fi

if [[ ${#BAD_RUNTIME_DEPS[@]} -gt 0 ]]; then
  echo "Bundled ffmpeg must be portable, but these binaries depend on Homebrew libraries:" >&2
  printf '  %s\n' "${BAD_RUNTIME_DEPS[@]}" >&2
  echo "Replace them with static or self-contained ffmpeg/ffprobe builds before creating the installer." >&2
  exit 1
fi

if [[ ${#BAD_LICENSE_FLAGS[@]} -gt 0 ]]; then
  echo "Bundled FFmpeg must not use --enable-gpl or --enable-nonfree:" >&2
  printf '  %s\n' "${BAD_LICENSE_FLAGS[@]}" >&2
  exit 1
fi

"$ROOT_DIR/scripts/release-cep.sh"

rm -rf "$PKG_STAGE_DIR"
mkdir -p "$PKG_ASSET_DIR"
if [[ ! -f "$ZXP_PATH" ]]; then
  echo "Signed CEP package not found: $ZXP_PATH" >&2
  exit 1
fi

SIGNED_EXTENSION_DIR="$PKG_STAGE_DIR/signed-extension"
mkdir -p "$SIGNED_EXTENSION_DIR"
/usr/bin/unzip -q "$ZXP_PATH" -d "$SIGNED_EXTENSION_DIR"
"$ZXPSIGNCMD" -verify "$SIGNED_EXTENSION_DIR"

for tool_path in "$SIGNED_EXTENSION_DIR"/vendor/ffmpeg/*/ffmpeg "$SIGNED_EXTENSION_DIR"/vendor/ffmpeg/*/ffprobe; do
  /usr/bin/codesign --verify --strict "$tool_path"
done

cp "$ZXP_PATH" "$PKG_ASSET_DIR/Podclip.zxp"
/usr/bin/xattr -cr "$PKG_ROOT" 2>/dev/null || true
/usr/bin/find "$PKG_ROOT" \( -name ".DS_Store" -o -name "._*" \) -delete

rm -f "$PKG_PATH"

PKGBUILD_ARGS=(
  --root "$PKG_ROOT"
  --scripts "$PKG_SCRIPTS_DIR"
  --identifier "$PKG_ID"
  --version "$VERSION"
  --install-location "/"
)

PKGBUILD_ARGS+=(--sign "$INSTALLER_SIGN_IDENTITY")

PKGBUILD_ARGS+=("$PKG_PATH")

/usr/bin/pkgbuild "${PKGBUILD_ARGS[@]}"

echo "Created installer package: $PKG_PATH"
echo "Bundled ffmpeg runtimes: ${AVAILABLE_ARCHES[*]}"
