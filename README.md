# Podclip

Podclip is open-source podcast multicamera editing for Adobe Premiere Pro, with
no monthly subscription. It creates a rough speaker cut by detecting which
microphone is active and routing each voice to a selected camera angle. Podclip
duplicates the selected sequence before applying any cuts, so the source
sequence remains unchanged.

Podclip is currently beta software. Test it on duplicate project files before
using it in production.

## Current scope

- One microphone per speaker.
- One or more video tracks tagged with the speakers they show.
- Standard output mode: razor parallel video tracks and enable the selected
  camera for each segment.
- Per-microphone dB thresholds, cut delay, minimum speech duration, and lead-in
  controls.

Podclip does not currently provide transcript-aware edits, a preview-before-write
screen, saved presets, or Premiere multicam-source output.

## Compatibility

| Component | Status |
| --- | --- |
| Adobe Premiere Pro | Manifest supports 2022 and newer; tested with Premiere Pro 2026 |
| macOS | Tested on macOS 26.4 on Apple silicon |
| Intel Macs | Bundled Intel runtime verified under Rosetta; native Premiere test pending |
| Windows | Not supported |

Podclip uses Adobe's legacy CEP extension platform and Premiere's QE DOM for
razor operations. Adobe may change or remove these interfaces in future Premiere
versions.

## Requirements

- Adobe Premiere Pro 2022 or newer.
- macOS.
- No separate FFmpeg installation. Podclip includes LGPL-compatible Apple
  silicon and Intel runtimes.

## Install from source

Clone the repository and enter it:

```bash
git clone https://github.com/treydoe1/podclip-public-release.git
cd podclip-public-release
```

Allow Premiere to load an unsigned development extension. The exact CSXS version
used varies by Premiere release, so enabling versions 11 through 14 covers the
currently supported range:

```bash
for version in 11 12 13 14; do
  defaults write "com.adobe.CSXS.${version}" PlayerDebugMode 1
done
```

Link the checkout into the per-user CEP extensions folder:

```bash
mkdir -p "$HOME/Library/Application Support/Adobe/CEP/extensions"
ln -s "$(pwd)" "$HOME/Library/Application Support/Adobe/CEP/extensions/com.podclip.panel"
```

Restart Premiere, then open **Window → Extensions → Podclip**.

## One-click installer

Download the signed `.pkg` from the latest GitHub release, open it, and follow
the macOS installer prompts. The installer includes Podclip, FFmpeg, and FFprobe;
no Homebrew setup is required.

## Use

1. Arrange one speaker microphone per audio lane and the matching cameras on
   separate video lanes.
2. Open Podclip and set the voice-lane and video-angle counts.
3. Route each video angle to the voices visible in that shot.
4. Adjust thresholds and timing if needed.
5. Select **Scan Timeline** and confirm the expected tracks are found.
6. Select **Build Speaker Cut**.

Podclip analyzes the source media with FFmpeg, duplicates the checked sequence,
opens that duplicate, and applies the edit to the duplicate only.

## Uninstall

Quit Premiere and remove the development symlink:

```bash
rm "$HOME/Library/Application Support/Adobe/CEP/extensions/com.podclip.panel"
```

If Podclip was installed for all users with a package, remove that copy instead:

```bash
sudo rm -rf "/Library/Application Support/Adobe/CEP/extensions/com.podclip.panel"
```

If you no longer use any unsigned CEP extensions, you may also remove the
`PlayerDebugMode` values you enabled during development. Those preferences are
shared with other CEP panels, so do not remove them if another unsigned panel
still needs them.

## Development checks

Run the complete local check suite:

```bash
./scripts/check.sh
```

The suite validates shell scripts, the CEP manifest, browser JavaScript,
ExtendScript syntax compatibility, and deterministic cut-decision behavior.

## Build a signed installer

```bash
SIGN_ZXP=1 \
ZXPSIGNCMD=/absolute/path/to/ZXPSignCmd \
ZXP_CERT=/absolute/path/to/certificate.p12 \
ZXP_CERT_PASSWORD='certificate-password' \
APP_SIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)' \
INSTALLER_SIGN_IDENTITY='Developer ID Installer: Your Name (TEAMID)' \
./scripts/build-installer-pkg.sh
```

Build output is written to `dist/`. The package includes the Podclip extension
and both bundled FFmpeg architectures. The build refuses to create an installer
unless the CEP extension and its bundled executables are signed. External
releases should also be notarized before distribution.

## Project layout

```text
CSXS/                 CEP manifest
client/               Panel UI, analyzer, and cut-decision logic
host/                 Premiere ExtendScript bridge
installer/scripts/    macOS package lifecycle scripts
scripts/              Build, signing, and validation scripts
tests/                Deterministic Node-based checks
```

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes. Report security
issues privately using the process in [SECURITY.md](SECURITY.md).

Third-party software and trademark information is documented in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The project's independent-development statement is documented in
[PROVENANCE.md](PROVENANCE.md).

## License

Podclip is available under the [MIT License](LICENSE). Bundled FFmpeg binaries
remain under the FFmpeg project's LGPL terms described in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
