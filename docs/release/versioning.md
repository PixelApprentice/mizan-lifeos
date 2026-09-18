# Versions and compatibility

Mizan follows [Semantic Versioning](https://semver.org/). Until 1.0, a **minor** release (0.x → 0.y) can change behaviour and **patch** releases only fix bugs. After 1.0, breaking changes need a major release.

## One app version everywhere

`scripts/bump-version.py <version|major|minor|patch>` writes the same version to:

| File | Field |
|---|---|
| `package.json` | `version` |
| `src-tauri/Cargo.toml`, `Cargo.lock` | package `mizan` |
| `src-tauri/tauri.conf.json` | `version` (installer and About) |
| `android/app/build.gradle.kts` | `versionName`, and `versionCode = MAJOR*10000 + MINOR*100 + PATCH` |

CI runs `scripts/bump-version.py --check` and fails if these disagree.

Release flow:
1. bump the version;
2. move "Unreleased" in `CHANGELOG.md` under the new version;
3. commit;
4. `git tag -s vX.Y.Z`, then push the tag. `.github/workflows/release.yml` builds and drafts the GitHub release.

## Separate version tracks (change these deliberately)

| Track | Where | Current | Rule |
|---|---|---|---|
| Personal database schema | `src-tauri/src/lib.rs` migrations | 3 | Only add new migrations; never edit a shipped one. Upgrades run automatically, and backups are taken first. |
| `tracker.csv` columns | `templates/tracker.csv` + routine items | n/a | Columns are only added (custom routine items), never renamed or removed, so old rows still read. |
| Team workspace file schema | `team/store.rs` `SCHEMA` | 1 | Bump when the SQLite layout changes and add an upgrade step in `open()`. |
| Team wire protocol | `team/store.rs` `PROTOCOL` | 1 | Bump on incompatible HTTP or op changes. Hosts must keep serving the previous protocol for at least one minor release, because teammates update at different times. |
| Phone ↔ desktop companion API | `/api/*` in `companion.rs` | app version | The phone page is bundled into the APK. Keep endpoints backwards compatible, or the old APK breaks against a new desktop. |
| Browser extension | `extension/manifest.json` | 1.2 | Has its own version (store requirement). Bump it when the extension changes. |

## What can still change before going public

Before the first public tag, these are all cheap to change. Afterwards, each one becomes expensive:

- **Licence**: the sole copyright holder can relicense at any time. Releases already published keep their licence, and the CLA keeps future relicensing possible.
- **Name and identifiers**: `com.salahudin.mizan` (desktop) and `com.salahudin.mizan.companion` (Android). App stores tie updates to these ids, so pick final ones before the first store upload. See `TRADEMARKS.md`.
- **Signing key**: the Android key used for the first public APK must be used forever, or users have to uninstall and reinstall. Generate it once and back it up offline (see `deploy.md`).
- **Data formats**: anything in the table above. Once users hold real data, only additive changes are safe.
- **Git history**: publish from a fresh repository (squashed) so earlier personal notes and paths never become public (see `deploy.md`).
