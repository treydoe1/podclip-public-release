# Security policy

## Supported versions

Security fixes are applied to the current default branch. Tagged beta builds may
not receive backports.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
security advisory feature for this repository and include:

- A description of the issue and its impact.
- Reproduction steps.
- Affected Premiere and macOS versions.
- Any relevant logs with personal paths, media names, and credentials removed.

You should receive an initial response within seven days. Please allow time for
a fix and coordinated disclosure before publishing details.

Podclip runs FFmpeg against user-selected local media and executes scripts inside
Premiere. Reports involving command execution, unsafe path handling, installer
privileges, or edits being applied to the wrong sequence are especially useful.
