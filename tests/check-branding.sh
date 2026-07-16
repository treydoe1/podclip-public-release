#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for label in 'Voice lanes' 'Video angles' 'Scan Timeline' 'Build Speaker Cut'; do
  if ! grep -Fq "$label" client/index.html; then
    echo "Missing Podclip interface label: $label" >&2
    exit 1
  fi
done

manifest_version="$(sed -n 's/.*ExtensionBundleVersion="\([^"]*\)".*/\1/p' CSXS/manifest.xml | head -n 1)"
if ! grep -Fq "v${manifest_version}" client/index.html; then
  echo "Panel version does not match the manifest" >&2
  exit 1
fi

if ! grep -Fq "CONTROLLER_BUILD = \"${manifest_version}\"" client/panel.js; then
  echo "Controller version does not match the manifest" >&2
  exit 1
fi

echo "Branding checks passed"
