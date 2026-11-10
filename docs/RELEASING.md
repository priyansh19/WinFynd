# Releasing WinFynd

The version the installer and the GitHub release use is the `version` field in `src-tauri/tauri.conf.json`. The release notes are `docs/releases/<version>.md` (the same version, no `v` prefix). `.github/workflows/release.yml` reads both. Nothing in this document tags, publishes, or bumps a version by itself.

Do the bump on a branch and open a pull request into `main`. Do not commit a version bump straight to `main`, and do not push a `v*` tag to publish.

## Steps

These steps assume [PR #21](https://github.com/priyansh19/WinFynd/pull/21) is already on `main`, so the workflow stops at a draft. If it is not, stop before the merge. See below.

1. **Bump.** From a clean branch off `main`:

   ```bash
   npm run bump -- 0.2.0 --dry-run
   npm run bump -- 0.2.0
   ```

   The dry run prints a line diff and writes nothing. The real run sets the same version in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, and `setup/Cargo.toml`, `setup/Cargo.lock`, and `setup/tauri.conf.json` when those setup files exist. It refuses a value that is not `MAJOR.MINOR.PATCH` (a prerelease such as `0.2.0-rc.1` is allowed) and refuses a version that is not higher than the current one. If those files disagree, it writes nothing.

2. **Notes.** Fill in `docs/releases/<version>.md`. The 0.2.0 file is a template: replace every TODO and do not leave a placeholder in the copy Priyansh will publish. Voice search is already listed there as a shipped feature (transcribed on this PC with Whisper; it needs the Speech model download).

3. **Pull request.** Open a PR into `main` with the bump and the notes. Do not merge it yourself.

4. **CI.** Wait until CI is green. A PR that touches `docs/releases/` or `src-tauri/tauri.conf.json` also runs the Release workflow, which builds the installer and does not publish from a pull request.

5. **Merge.** Priyansh approves and merges to `main`.

6. **Draft release.** After that merge, open the GitHub release the workflow created for `v<version>`. Check that it is still a draft, the title and notes match `docs/releases/<version>.md`, and both `WinFynd-Setup-<version>.exe` and `SHA256SUMS.txt` are attached. The checksum line must match the exe (see [docs/qa/release-checklist.md](qa/release-checklist.md)).

7. **Publish.** Priyansh publishes that draft. That click is the release. Do not publish it for him, and do not mark it latest some other way.

Run the [v0.2.0 checklist](qa/release-checklist.md) on a real Windows 10 22H2 PC and on Windows 11 23H2 or 24H2 (both, if you have them) before he publishes. Voice is a regression check: [docs/qa/voice-checklist.md](qa/voice-checklist.md).

## Publishing is manual once PR #21 lands

[PR #21](https://github.com/priyansh19/WinFynd/pull/21) changes the release workflow so a merge to `main` creates a **draft** GitHub release and does not publish it. Publishing stays a manual step Priyansh does in the GitHub release UI (open the draft, then publish it). That PR also names a GitHub Environment `release` on the installer job. The environment, and any required reviewer on it, is a repo setting only Priyansh can add. It is a second gate, not a substitute for him publishing the draft.

Until PR #21 is on `main`, the workflow on `main` still publishes a release by itself when a new version is pushed there. Do not merge a version bump before that PR has landed.

This branch does not bump the app version, tag, or publish.
