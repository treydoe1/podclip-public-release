#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
CERT_DIR="$DIST_DIR/certs"

ZXPSIGNCMD="${ZXPSIGNCMD:-}"
CERT_COUNTRY="${CERT_COUNTRY:-US}"
CERT_STATE="${CERT_STATE:-NY}"
CERT_ORG="${CERT_ORG:-Podclip}"
CERT_NAME="${CERT_NAME:-Podclip Dev}"
CERT_PASSWORD="${CERT_PASSWORD:-}"
CERT_OUTPUT="${CERT_OUTPUT:-$CERT_DIR/podclip-dev-cert.p12}"

if [[ -z "$ZXPSIGNCMD" ]]; then
  cat >&2 <<EOF
ZXPSIGNCMD is required.

Example:
  ZXPSIGNCMD="/absolute/path/to/ZXPSignCmd" \\
  CERT_PASSWORD="choose-a-password" \\
  $0
EOF
  exit 1
fi

if [[ ! -x "$ZXPSIGNCMD" ]]; then
  echo "ZXPSignCmd is not executable: $ZXPSIGNCMD" >&2
  exit 1
fi

if [[ -z "$CERT_PASSWORD" ]]; then
  echo "CERT_PASSWORD is required." >&2
  exit 1
fi

mkdir -p "$CERT_DIR"

echo "Creating self-signed CEP test certificate:"
echo "  Output: $CERT_OUTPUT"
echo "  Subject: C=$CERT_COUNTRY, ST=$CERT_STATE, O=$CERT_ORG, CN=$CERT_NAME"

"$ZXPSIGNCMD" \
  -selfSignedCert \
  "$CERT_COUNTRY" \
  "$CERT_STATE" \
  "$CERT_ORG" \
  "$CERT_NAME" \
  "$CERT_PASSWORD" \
  "$CERT_OUTPUT"

echo "Created certificate: $CERT_OUTPUT"
echo
echo "Next step:"
echo "  SIGN_ZXP=1 ZXPSIGNCMD=\"$ZXPSIGNCMD\" ZXP_CERT=\"$CERT_OUTPUT\" ZXP_CERT_PASSWORD=\"$CERT_PASSWORD\" \"$ROOT_DIR/scripts/release-cep.sh\""
