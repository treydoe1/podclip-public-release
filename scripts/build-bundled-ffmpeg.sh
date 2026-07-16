#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="8.1.2"
SOURCE_ARCHIVE="$ROOT_DIR/third_party/ffmpeg/source/ffmpeg-${VERSION}.tar.xz"
EXPECTED_SHA256="464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c"
TARGET="${1:-all}"

if [[ ! -f "$SOURCE_ARCHIVE" ]]; then
  echo "Missing FFmpeg source archive: $SOURCE_ARCHIVE" >&2
  exit 1
fi

ACTUAL_SHA256="$(shasum -a 256 "$SOURCE_ARCHIVE" | awk '{print $1}')"
if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
  echo "FFmpeg source checksum mismatch." >&2
  exit 1
fi

case "$TARGET" in
  arm64) TARGETS=(arm64) ;;
  x64) TARGETS=(x64) ;;
  all) TARGETS=(arm64 x64) ;;
  *) echo "Usage: $0 [arm64|x64|all]" >&2; exit 1 ;;
esac

BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/podclip-ffmpeg.XXXXXX")"
trap 'rm -rf "$BUILD_ROOT"' EXIT
tar -xf "$SOURCE_ARCHIVE" -C "$BUILD_ROOT"

for target in "${TARGETS[@]}"; do
  if [[ "$target" == "arm64" ]]; then
    ARCH="arm64"
    EXTRA_ARGS=()
  else
    ARCH="x86_64"
    EXTRA_ARGS=(--disable-x86asm)
  fi

  BUILD_DIR="$BUILD_ROOT/build-$target"
  INSTALL_DIR="$BUILD_ROOT/install-$target"
  mkdir -p "$BUILD_DIR" "$INSTALL_DIR"
  (
    cd "$BUILD_DIR"
    "$BUILD_ROOT/ffmpeg-$VERSION/configure" \
      --prefix="$INSTALL_DIR" \
      --arch="$ARCH" \
      --target-os=darwin \
      --cc=clang \
      --extra-cflags="-arch $ARCH -mmacosx-version-min=12.0" \
      --extra-ldflags="-arch $ARCH -mmacosx-version-min=12.0" \
      --disable-autodetect \
      --disable-doc \
      --disable-debug \
      --disable-shared \
      --enable-static \
      --disable-network \
      --disable-ffplay \
      --disable-htmlpages \
      --disable-manpages \
      --disable-podpages \
      --disable-txtpages \
      "${EXTRA_ARGS[@]}"
    make -j"$(sysctl -n hw.ncpu)"
    make install
  )

  DEST="$ROOT_DIR/vendor/ffmpeg/darwin-$target"
  mkdir -p "$DEST"
  install -m 755 "$INSTALL_DIR/bin/ffmpeg" "$DEST/ffmpeg"
  install -m 755 "$INSTALL_DIR/bin/ffprobe" "$DEST/ffprobe"
done

echo "Bundled FFmpeg $VERSION built for: ${TARGETS[*]}"
