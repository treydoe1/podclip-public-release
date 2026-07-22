#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if grep -q "PlayerDebugMode" installer/scripts/postinstall; then
  echo "Production installer must not enable Adobe CEP development mode" >&2
  exit 1
fi

for required in \
  'Refusing to build a public installer with an unsigned CEP extension' \
  '"$ZXPSIGNCMD" -verify "$SIGNED_EXTENSION_DIR"' \
  '/usr/bin/codesign --verify --strict' \
  'cp "$ZXP_PATH" "$PKG_ASSET_DIR/Podclip.zxp"'; do
  if ! grep -Fq "$required" scripts/build-installer-pkg.sh; then
    echo "Missing signed-installer safeguard: $required" >&2
    exit 1
  fi
done


if grep -Fq 'CEP/extensions/$BUNDLE_ID' scripts/build-installer-pkg.sh; then
  echo "Public installer must not bypass Adobe's extension installer" >&2
  exit 1
fi

for required in \
  'UnifiedPluginInstallerAgent' \
  '"$UPIA" --install "$ZXP"'; do
  if ! grep -Fq "$required" installer/scripts/postinstall; then
    echo "Installer does not hand the signed ZXP to Adobe UPIA: $required" >&2
    exit 1
  fi
done

for required in \
  'NFSHomeDirectory' \
  '"$USER_EXTENSION_DIR/com.podclip.panel"' \
  '"$USER_EXTENSION_DIR/Podclip"'; do
  if ! grep -Fq "$required" installer/scripts/preinstall; then
    echo "Installer does not remove a conflicting per-user Podclip copy: $required" >&2
    exit 1
  fi
done

if ! grep -Fq '"$ZXPSIGNCMD" -verify "$ZXP_PATH"' scripts/release-cep.sh; then
  echo "Signed CEP package is not verified after creation" >&2
  exit 1
fi

echo "Release packaging checks passed"
