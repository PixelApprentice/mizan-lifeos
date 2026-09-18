# Release readiness review — v0.2.0

This is the pre-release check of every functional and non-functional area of
Mizan, including the legal and business side. Each row records what was checked and
how. "Blocker" means the release must not ship until it is resolved.

## Verdict

| Release type | Status | Blockers |
| --- | --- | --- |
| **Personal use (you, now)** | ✅ Ready | — |
| **Public open-source (GitHub, AGPL)** | 🟡 Ready once 5 owner decisions are made | B1–B5 below |
| **Team use on a trusted LAN** | 🟡 Beta | B5, and plain HTTP (see L1) |
| **Selling commercial licences / team product** | 🔴 Not yet | B1–B7 |

### Blockers (only the owner can resolve these)

| # | Blocker | Why | Action |
| --- | --- | --- | --- |
| B1 | **Product name** | "Mizan – Balance Your Life" is already on Google Play (a planner in the same category), and a US trademark application for "MIZAN" (class 042, software) is pending from another company. | Rename, or get a trademark lawyer's clearance. See [TRADEMARKS.md](../../TRADEMARKS.md). |
| B2 | **Contact details and repo URL** | `<your-domain>` placeholders in SECURITY, CODE_OF_CONDUCT, COMMERCIAL-LICENSE and PRIVACY; `OWNER` in package.json and Cargo.toml. | Fill them in (search with `grep -rn "<your-domain>\|OWNER/" .`). |
| B3 | **Android release keystore** | Without `android/keystore.properties`, release APKs are signed with the debug key. You cannot change the signing key after publishing. | `keytool -genkey ...` as described in [deploy.md](deploy.md), and back the key up offline. |
| B4 | **Clean public git history** | The private repo has personal commits. | Publish from a fresh orphan branch ([deploy.md](deploy.md) §1), then run `scripts/check-private-data.py --all`. |
| B5 | **Test on a real phone** | The companion and the Team tab were only tested in desktop Chromium against the real Rust host. | Install both APKs, then pair over Wi-Fi, hotspot and USB, join a team and scan a QR code. |
| B6 | **Lawyer review** | The CLA, COMMERCIAL-LICENSE and the §7 Play-services exception are templates written in good faith, not legal advice. | Have a lawyer review them before anyone signs or pays. |
| B7 | **Legal entity, payment and support process** | Needed before you can sell licences or support. | Business decision. |

## Functional review

| Area | Evidence | Status |
| --- | --- | --- |
| Today / routine (configurable) | Browser tour: an edited routine shows up in Today and Stats; Save button and "Unsaved changes" hint | ✅ |
| Tasks, steps ("break into steps") | Unit tests and a manual tour | ✅ |
| Kanban drag reorder | Earlier fix, rank-based order | ✅ |
| Planner scheduling and scroll | Fixed overflow and the scroll-to-bottom bug | ✅ |
| Focus timer, wheel picker, blocking | Manual tour; the mini-window was removed as you asked | ✅ |
| Focus → team issue bridge | Select an issue, then "Log N min to KEY?" writes a worklog op | ✅ |
| Stats | Routine-aware scoring, verified in the browser | ✅ |
| Phone sync (LAN / hotspot / USB `adb reverse`) | Rust tests and a desktop-browser companion test | ✅ (B5 still open) |
| Backups and crash recovery | Daily snapshots of the personal DB and every hosted team DB; crash log | ✅ |
| Team: workspaces, invites, roles, issues, board, sprints, checklists, comments, worklogs, activity | 24 Rust tests, browser smoke test against the real host | ✅ beta |
| Phone Team tab | Join / status / assign / checklist / comment / worklog / create, all persisted on the host (Chromium test) | ✅ (B5) |
| Personal and team kept separate | Separate databases (`mizan.db` vs `team/<id>.db`), separate phone storage keys, separate navigation section | ✅ |

## Non-functional review

| Quality | Finding |
| --- | --- |
| **Performance** | Release binary 12.1 MB. JS bundles: main 405 kB, Planner 277 kB (lazy-loaded), CSS 68 kB. The earlier crash and CPU problems were fixed (render loops, intervals, crash recovery). |
| **Reliability** | Desktop: SQLite (team databases in WAL mode) and daily rotating backups (personal and team). Phone: offline outbox, merge with hybrid logical clocks (HLC), retried every 30 s. |
| **Security** | Strict production CSP, checked with zero violations across all views. Team: per-member tokens stored hashed, single-use invite codes with an expiry, role checks on every op, reporter/author/member forced on the host, a 32-request in-flight cap, and a body-size limit. `pnpm audit --prod`: 0 vulnerabilities. See [SECURITY.md](../../SECURITY.md). |
| **Privacy** | No telemetry and no cloud. The only outbound calls are the prayer-times API and the blocklist download. `check-private-data.py` passes on every file. See [PRIVACY.md](../../PRIVACY.md). |
| **Accessibility** | Labelled controls, keyboard navigation, `prefers-reduced-motion` respected. **Not tested with a screen reader.** The EU Accessibility Act may apply to commercial sales. |
| **Compatibility** | Linux desktop only; macOS and Windows builds are untested. Android 8+ (minSdk 26). |
| **Internationalisation** | English only. Dates use the system locale. |
| **Scalability** | A team host comfortably serves about 2–30 people on a LAN. It is not designed for hundreds of members or internet exposure. |
| **Maintainability** | 38 TS tests and 24 Rust tests, clippy `-D warnings` clean, `tsc` strict clean, CI workflows for desktop, Android and releases. |
| **Portability** | JSON export/import. The SQLite files are plain and readable by any tool. |
| **Updates** | No auto-updater; users download new versions from GitHub Releases. |
| **Observability** | Local crash log and backup log only, by design (no telemetry). |

## Legal review

| Item | Status |
| --- | --- |
| Project licence | AGPL-3.0-or-later ([LICENSE](../../LICENSE)), with a commercial dual licence ([COMMERCIAL-LICENSE.md](../../COMMERCIAL-LICENSE.md)). |
| Contributor rights | [CLA.md](../../CLA.md) is needed so dual licensing stays possible. Needs lawyer review (B6). |
| Dependencies | 26 npm and 400 crates: all permissive (MIT, Apache, BSD, ISC, Zlib), plus MPL-2.0 and OFL fonts. 0 unapproved; checked in CI with `scripts/third-party-notices.py --check`. |
| Google Play services | Used only in the `play` flavour, covered by the AGPL §7 exception. The `foss` flavour has none (F-Droid friendly). |
| Trademark | **Conflict found**, see B1. |
| GDPR | Local-first: the team host is the data controller. PRIVACY.md explains this. No processor relationship with the authors. |
| Play Store | Needs a privacy-policy URL (host PRIVACY.md) and a Data safety form ("no data collected or shared"; LAN only). |

## Business review

**Positioning:** a local-first life OS that also works as a small-team project tool, with no cloud and no account. The phone acts as a remote and a second screen during focus sessions.

| Competitor | Their angle | Mizan's edge |
| --- | --- | --- |
| Jira / Asana / Linear | Cloud SaaS, per-seat pricing | Offline, free, owns its data, personal and team in one app |
| Plane, OpenProject, Taiga (self-hosted) | Server deployment needed | Zero-ops: one desktop app hosts the team |
| Todoist / Sunsama / Motion | Cloud personal planning | Routine scoring, focus blocking, phone second screen |
| Obsidian | Notes-first, paid sync | Planner-first, free LAN sync |

**Monetisation options** (they don't conflict with AGPL):
1. Commercial licences for companies that can't accept AGPL.
2. Paid support or onboarding contracts.
3. Later, an optional paid relay or hosted sync for remote teams (the only cloud piece).
4. GitHub Sponsors / Open Collective.

**Pricing hypothesis:** free for individuals and AGPL users; commercial licence about US$ 5–8 per seat per month or a flat yearly fee per organisation. Validate this with 5–10 small teams first.

**Go-to-market:** an open-source launch (Show HN, r/selfhosted, r/productivity) with the product trailer (`demo/`), then F-Droid (`foss` flavour) and Play (`play` flavour) once B1 and B3 are resolved.

**Risks:** the name conflict (B1); a single maintainer; LAN-only teams limit remote use; no TLS.

## Known limitations

| # | Limitation | Plan |
| --- | --- | --- |
| L1 | Team and phone traffic is plain HTTP on the LAN (tokens are bearer secrets) | Self-signed TLS with certificate pinning through the QR code (v0.3) |
| L2 | Linux only | macOS and Windows CI builds |
| L3 | No auto-updater | Tauri updater with signed manifests |
| L4 | English only | i18n extraction |
| L5 | No screen-reader audit | Orca / TalkBack pass |
| L6 | Remote teams need the same network | Optional relay (see Business) |

## What can still change after open-sourcing

See [versioning.md](versioning.md). In short: while the version is 0.x, the database
schema, team protocol and settings may still change (with migrations). The licence of
code already released under AGPL cannot be taken back, but you (and CLA-covered
contributions) can relicense future versions. The Android application ID and signing
key are permanent once published on Play. The product name can change until the
first public launch, and at much higher cost afterwards.
