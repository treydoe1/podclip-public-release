#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

bash -n installer/scripts/preinstall installer/scripts/postinstall scripts/*.sh
xmllint --noout CSXS/manifest.xml
node --check client/analyzer.js
node --check client/lib/CSInterface.js
node --check client/panel.js
node tests/check-host-syntax.js
node --test tests/cut-decisions.test.js
tests/check-bundled-ffmpeg.sh
tests/check-release-packaging.sh
tests/check-branding.sh

echo "All checks passed"
