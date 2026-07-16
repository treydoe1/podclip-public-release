# Contributing to Podclip

Podclip is an early-stage Premiere extension. Small, focused changes with a
clear reproduction case are easiest to review.

## Before opening a pull request

1. Open an issue for behavior changes or significant new features.
2. Keep the change limited to the reported problem.
3. Add or update a deterministic test when changing the cut algorithm.
4. Run `./scripts/check.sh`.
5. Test Premiere-facing changes against a disposable project and confirm the
   source sequence remains unchanged.

## Pull request notes

Include:

- What changed and why.
- Premiere and macOS versions used for manual testing.
- The sequence layout used for testing.
- Automated checks run.
- Known gaps or checks that could not be completed.

Do not commit media, project files, generated packages, signing certificates,
credentials, FFmpeg binaries, or other third-party executables.

By contributing, you agree that your contribution is provided under the
project's license.
