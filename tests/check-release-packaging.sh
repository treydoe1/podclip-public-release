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
  'INSTALLER_SIGN_IDENTITY is required for a public installer' \
  'PKGBUILD_ARGS+=(--sign "$INSTALLER_SIGN_IDENTITY")' \
  'cp -R "$SIGNED_EXTENSION_DIR" "$PKG_EXTENSIONS_DIR/$BUNDLE_ID"'; do
  if ! grep -Fq "$required" scripts/build-installer-pkg.sh; then
    echo "Missing signed-installer safeguard: $required" >&2
    exit 1
  fi
done

# Creative Cloud's plugin installer can fail silently or hang, and its
# --remove matches by display name, which also removes the Podclip UXP plugin.
if grep -Fq 'UnifiedPluginInstallerAgent' installer/scripts/preinstall installer/scripts/postinstall; then
  echo "Installer must not depend on Adobe UPIA" >&2
  exit 1
fi

if ! grep -Fq 'META-INF/signatures.xml' installer/scripts/postinstall; then
  echo "Installer does not confirm the signed extension was installed" >&2
  exit 1
fi

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
