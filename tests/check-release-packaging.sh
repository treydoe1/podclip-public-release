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
  '/usr/bin/codesign --verify --strict'; do
  if ! grep -Fq "$required" scripts/build-installer-pkg.sh; then
    echo "Missing signed-installer safeguard: $required" >&2
    exit 1
  fi
done

if ! grep -Fq '"$ZXPSIGNCMD" -verify "$ZXP_PATH"' scripts/release-cep.sh; then
  echo "Signed CEP package is not verified after creation" >&2
  exit 1
fi

echo "Release packaging checks passed"
