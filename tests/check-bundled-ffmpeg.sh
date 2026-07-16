#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARM_DIR="$ROOT_DIR/vendor/ffmpeg/darwin-arm64"
X64_DIR="$ROOT_DIR/vendor/ffmpeg/darwin-x64"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/podclip-ffmpeg-test.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

for tool in "$ARM_DIR/ffmpeg" "$ARM_DIR/ffprobe" "$X64_DIR/ffmpeg" "$X64_DIR/ffprobe"; do
  [[ -x "$tool" ]] || { echo "Missing executable: $tool" >&2; exit 1; }
  if otool -L "$tool" | grep -Eq '/(opt/homebrew|usr/local)/'; then
    echo "Non-portable dependency found in $tool" >&2
    exit 1
  fi
done

if "$ARM_DIR/ffmpeg" -version | head -n 4 | grep -Eq -- '--enable-(gpl|nonfree)'; then
  echo "arm64 FFmpeg has a disallowed license flag" >&2
  exit 1
fi
if arch -x86_64 "$X64_DIR/ffmpeg" -version | head -n 4 | grep -Eq -- '--enable-(gpl|nonfree)'; then
  echo "x64 FFmpeg has a disallowed license flag" >&2
  exit 1
fi

"$ARM_DIR/ffmpeg" -y -f lavfi -i "sine=frequency=1000:sample_rate=48000" \
  -t 1 -c:a aac "$TMP_DIR/test.m4a" >/dev/null 2>&1

check_runtime() {
  local name="$1"
  local ffmpeg="$2"
  local -a command=("$ffmpeg")
  if [[ "$name" == "x64" ]]; then
    command=(arch -x86_64 "$ffmpeg")
  fi

  "${command[@]}" -hide_banner -nostats -ss 0 -t 1 -i "$TMP_DIR/test.m4a" \
    -vn -af "aresample=48000,asetnsamples=n=2400:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-" \
    -f null - 2>"$TMP_DIR/$name.stderr" | grep -q 'lavfi.astats.Overall.RMS_level'
}

check_runtime arm64 "$ARM_DIR/ffmpeg"
check_runtime x64 "$X64_DIR/ffmpeg"

echo "Bundled FFmpeg checks passed"
