# Third-party notices

## FFmpeg

Podclip bundles `ffmpeg` and `ffprobe` executables to analyze audio. The bundled
FFmpeg 8.1.2 builds are licensed under LGPL version 2.1 or later and were built
without GPL, nonfree, or external libraries.

The exact corresponding source, upstream signature, build instructions, and
license texts are included under `third_party/ffmpeg/` and `vendor/ffmpeg/`.
FFmpeg is developed by the FFmpeg project and distributed under its own terms.
See <https://ffmpeg.org/legal.html>.

## Adobe products and APIs

Podclip interoperates with Adobe Premiere Pro through Adobe's CEP and
ExtendScript interfaces. Adobe, Premiere Pro, and related names are trademarks
of Adobe.

The small `client/lib/CSInterface.js` file in this repository is a project-local
wrapper around the CEP runtime object; it is not Adobe's full CEP SDK file.
