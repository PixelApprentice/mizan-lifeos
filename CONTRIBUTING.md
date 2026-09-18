# Contributing to Mizan

Thanks for helping! Bug reports, fixes, translations, docs and design feedback are all welcome.

## Before you start

- **Bugs**: open an issue with steps to reproduce, your OS and the Mizan version (shown in Settings).
- **Features**: open an issue first so we can agree on the shape. Mizan keeps personal life management and team project management deliberately separate (see `docs/team/`). Proposals that blur the two need a strong reason.
- **Security problems**: follow [SECURITY.md](SECURITY.md). Do not open a public issue.

## Legal bits (one time)

- By contributing you agree to the [CLA](CLA.md). Paste the agreement line from it into your first pull request.
- Sign off each commit with `git commit -s` (Developer Certificate of Origin).
- Only submit code you wrote or that comes under an MIT, Apache-2.0, BSD, ISC or similarly permissive licence, and say where it came from. `scripts/third-party-notices.py --check` must pass when dependencies change.

## Set up

Requirements:
- Node 20+ and pnpm;
- Rust stable;
- Tauri's Linux dependencies (`webkit2gtk-4.1`, `libayatana-appindicator`, …);
- for the phone app, JDK 17 and the Android SDK (see the README).

```sh
pnpm install
git config core.hooksPath .githooks   # blocks commits that contain personal data or secrets
pnpm tauri dev                        # desktop app with hot reload
pnpm dev                              # browser preview with demo data (no Tauri needed)
```

## Checks (CI runs the same)

```sh
pnpm test                                   # TypeScript unit tests (node --test)
pnpm build                                  # type check + production bundle
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
python3 scripts/check-private-data.py --all
python3 scripts/third-party-notices.py --check
python3 scripts/bump-version.py --check
pnpm android                                # phone app, if you touched android/ or companion/
```

## Style

- Small, focused pull requests with a clear description and screenshots for UI changes.
- Commit messages follow Conventional Commits: `feat(team): …`, `fix(focus): …`, `docs: …`.
- Match the code around you. Comment only what is not obvious.
- UI: keyboard reachable, visible focus, labelled controls, works at 390 px wide, and respects `prefers-reduced-motion`.
- Never break existing data. Database changes are new migrations only, and team protocol changes follow [docs/release/versioning.md](docs/release/versioning.md).
- Add an entry under "Unreleased" in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
