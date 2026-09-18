# Deploying and publishing Mizan

A checklist from "works on my machine" to a public open-source release. Do it in order.

## 0. Decisions only the maintainer can make

| Decision | Recommendation | Where it is used |
|---|---|---|
| Public name | "Mizan LifeOS", or a new name after clearance (see [TRADEMARKS.md](../../TRADEMARKS.md)) | README, `productName`, store listings |
| Licence | AGPL-3.0-or-later plus a commercial licence (already in the repo) | `LICENSE`, `COMMERCIAL-LICENSE.md` |
| Contributions | CLA plus DCO sign-off (keeps dual licensing possible) | `CLA.md` |
| Contact addresses | security@, licensing@, privacy@, conduct@ on your own domain | Replace every `<your-domain>` (`grep -rn "<your-domain>"`) |
| Repository URL | `github.com/<you>/mizan` | `src-tauri/Cargo.toml` `repository`, README |
| App identifiers | Keep `com.salahudin.mizan` and `com.salahudin.mizan.companion`, or change them **now** | `tauri.conf.json`, `android/app/build.gradle.kts` |

## 1. Publish with a fresh history

Earlier commits were made while Mizan was a private tool, and they can contain personal notes and paths. The privacy hook only checks new commits. Publish a clean snapshot:

```sh
python3 scripts/check-private-data.py --all       # must pass
git checkout --orphan public && git add -A && git commit -s -m "Mizan 0.2.0: first public release"
git remote add public git@github.com:<you>/mizan.git && git push public public:main
```

Keep the old private repository archived offline.

## 2. GitHub repository settings

- Branch protection on `main`: require the **CI** workflow, require linear history, no force-push.
- Turn on: private vulnerability reporting (Security → Advisories), Dependabot alerts, secret scanning.
- Add topics, a description, and a social preview image (a frame from `recordings/` or the trailer).
- Optional: install the *CLA assistant* GitHub app, pointing at `CLA.md`.

## 3. Android signing key (once, keep it forever)

```sh
keytool -genkeypair -v -keystore mizan-release.jks -alias mizan -keyalg RSA -keysize 4096 -validity 10000
```

- Back the `.jks` file and its passwords up offline, in two places. **If you lose it, existing installs can never be updated.**
- Local builds: create `android/keystore.properties` (it is git-ignored):
  ```
  storeFile=../mizan-release.jks
  storePassword=…
  keyAlias=mizan
  keyPassword=…
  ```
  then run `BUILD=release pnpm android` and `FLAVOR=foss BUILD=release pnpm android`.
- CI: add the repository secrets `ANDROID_KEYSTORE_BASE64` (`base64 -w0 mizan-release.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. The release workflow refuses to publish without them.
- Google Play: enrol in *Play App Signing* and upload with this key as the **upload key**.

## 4. Cut a release

```sh
python3 scripts/bump-version.py 0.2.0     # or: minor / patch
$EDITOR CHANGELOG.md                      # move "Unreleased" under the version
git commit -sam "chore: release 0.2.0" && git tag -s v0.2.0 -m "Mizan 0.2.0" && git push --follow-tags
```

`.github/workflows/release.yml` then:
- builds the Linux `.deb`, `.rpm` and AppImage;
- builds the signed Android `play` and `foss` APKs with checksums;
- drafts a GitHub release.

Download the artifacts, smoke-test them (section 6), then publish the draft.

## 5. Distribution channels

| Channel | Effort | Notes |
|---|---|---|
| GitHub Releases | done by CI | Primary channel |
| AUR (`mizan-bin`) | low | Repackage the `.deb` or AppImage. The maintainer's own distro (Arch). |
| Flathub | medium | Needs a manifest. The focus blocker's `/etc/hosts` helper needs a host-side install, so document that it is optional. |
| F-Droid | medium | Use the `foss` flavour. Reproducible-build metadata in `fdroiddata`. |
| Google Play | medium | `play` flavour. Needs a privacy-policy URL (publish PRIVACY.md), the Data safety form ("no data collected"; data is shared only with the user's own devices), and a content rating. Target SDK must follow Google's yearly minimum. |
| Windows / macOS | high | Not supported yet: the focus blocker, Waybar module and desktop integration are Linux-specific. Needs a port plus code-signing certificates (an Apple Developer account, and a Windows Authenticode certificate). |

## 6. Release smoke test (manual, about 15 minutes)

1. Fresh install on a clean user account: the app opens, Today renders, and the routine picks the General preset.
2. Add a task, break it into steps, schedule it in the Planner, and run a 1-minute focus session.
3. Upgrade test: install over the previous version with existing data. Tasks, log and stats are intact, and a backup appears in `~/.local/state/mizan/backups/`.
4. Phone: install the APK, pair by QR, sync both ways, and use the full-screen timer. Test once over a hotspot or USB.
5. Team:
   - create a workspace, invite the phone and a second computer;
   - move an issue on each device and check that the others update within about 30 seconds;
   - remove a member and check that their device loses access.
6. Licence files are present in the installed package: `/usr/share/doc/mizan/` or the AppImage.

## 7. After release

- Watch issues and crash reports. Users can attach `~/.local/state/mizan/crash.log`.
- Patch releases for regressions within a week. Security fixes follow [SECURITY.md](../../SECURITY.md).
- Re-run `python3 scripts/third-party-notices.py` whenever dependencies change. CI enforces the licence allow-list.
