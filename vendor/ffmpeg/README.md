# Bundled FFmpeg

Podclip bundles FFmpeg 8.1.2 executables for Apple silicon and Intel Macs. These
builds are configured as **LGPL version 2.1 or later** and do not use
`--enable-gpl`, `--enable-nonfree`, or external libraries.

The build intentionally keeps FFmpeg's native demuxers and decoders so Podclip
can analyze common Premiere source media without requiring a separate install.
Network support and FFplay are disabled.

## Rebuild

From the repository root:

```bash
./scripts/build-bundled-ffmpeg.sh
```

The script verifies the source archive checksum and builds both architectures.
The Intel build disables standalone x86 assembly so it can be cross-compiled
with Apple's Clang on an Apple-silicon Mac.

## Binary checksums

```text
darwin-arm64/ffmpeg   5e4fb16a17a96ee5813c897f9d225ab63eda055b6119211cade51e14b75a09bd
darwin-arm64/ffprobe  89cf4f93b4bf05e20171270c011ab8ab0d92e50094c6b45d72bcc8e7d72d8f94
darwin-x64/ffmpeg     e38fe47753544587cb5904ed864b6b12bb4f7a78da6d161ff42309ef3372c6ae
darwin-x64/ffprobe    23f7d2623a2e44a8d3e6cdcc6836dec4170c4be466a39ed976503631eb79446b
```

The corresponding unmodified source archive and signature are stored under
`third_party/ffmpeg/source/`. FFmpeg license texts are stored in `licenses/`.
