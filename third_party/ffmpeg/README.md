# FFmpeg corresponding source

Podclip's bundled `ffmpeg` and `ffprobe` executables were built from the
unmodified official FFmpeg 8.1.2 source archive:

- Source: `source/ffmpeg-8.1.2.tar.xz`
- Upstream URL: <https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz>
- Upstream signature: `source/ffmpeg-8.1.2.tar.xz.asc`
- SHA-256: `464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c`

No source modifications were made. The complete reproducible configuration is
implemented in `scripts/build-bundled-ffmpeg.sh`.
