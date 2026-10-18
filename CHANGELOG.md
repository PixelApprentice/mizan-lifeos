# Changelog

All notable changes to Mizan. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions: [SemVer](https://semver.org/) (see [docs/release/versioning.md](docs/release/versioning.md)).

## [Unreleased]

## [0.3.0] – light theme and everyday polish

### Added
- **Light theme.** Settings → Appearance: Light, Dark or Automatic (follows the system). Also in the command palette. The phone app follows the phone's light or dark mode.
- **Focus on a task in one click**: a Focus button on Today and Tasks, and "Focus on this" in each board card's menu. Focus opens with the goal and length filled in.
- Tick tasks off directly from Today.
- Board cards have a ⋯ menu: move up or down, move to another column, set priority, focus, schedule and delete.
- Launch film: `pnpm demo:footage:light` records light-theme footage and `pnpm demo:film` renders a bright, calm product film (the trailer renderer now has a "keynote" style).
- Cinema cut: `pnpm demo:cinema` renders a 3D film (three.js laptop and phone, one continuous camera, arranged score with interface sounds). Videos now render in parallel and are tagged BT.709.
- The cinema cut films a 14" MacBook Pro and an iPhone 18 Pro (procedural models, also saved as `.glb` in `assets/models/` via `pnpm demo:models`), with one brand accent instead of gradient text.

### Changed
- Board cards are compact: a ⠿ drag handle, the title and one line of details. Actions appear when you point at or tab into a card.
- Today's header reads like a date ("Tuesday, October 6 · Week 1").
- Settings shows the default work windows and presets as placeholders.
- Consistent sentence-case page titles.

### Fixed
- On narrow windows the Tasks list squeezed titles into one letter per line.
- The duration wheels could reset a newly chosen length to the previous value.

## [0.2.0] – first public release candidate

### Added
- **Team workspaces** (separate from personal data): a Jira- or Asana-style project space hosted on one teammate's computer over the local network, with no cloud account.
  - Projects with keys (WEB-12), issues (task, story, bug, epic), priorities, estimates, due dates, labels, checklists and comments with @mentions.
  - Board with drag-to-reorder, backlog and sprints, list views, "My issues", inbox and activity.
  - Reports: burndown, velocity, throughput, cycle time and workload.
  - Roles: owner, admin, member, viewer. Invite links and QR codes. Offline edits sync later. Export to JSON.
- Today shows "Assigned to you" from every team workspace. Focus sessions can log their time to a team issue.
- Phone app: **Team** tab to join a workspace (scan the QR code or paste the invite), see your issues, change status, assign, tick checklists, comment, log time and create issues. Works offline with an outbox.
- **Configurable daily routine** (Settings → Daily routine): General and Faith presets or your own items and targets. Today, Stats and the score follow it.
- Duration wheels (iOS-style) for focus length, on desktop and phone.
- Phone companion sync over Wi-Fi, a phone hotspot, USB tethering or a USB-debugging cable. Full-screen focus display. QR pairing.
- Automatic backups and crash recovery.
- Android `play` and `foss` build flavours. Release signing via `android/keystore.properties`.
- Licensing: AGPL-3.0-or-later, commercial licence, CLA, trademark policy, third-party notices and a licence check.
- Release tooling: `scripts/bump-version.py`, CI and a release workflow, readiness review and deployment guide.

### Changed
- The routine is no longer hard-coded. Existing tracker data keeps the classic 9-point score (Faith preset).

### Removed
- Pixel companion.
- Floating mini-timer window.

### Fixed
- Crashes and high CPU use, from render loops and timers.
- Kanban drag-to-reorder.
- Stats page.
- "Break into steps" on tasks.
- Planner collapsing into a corner after scheduling from Tasks.
- Projects opening scrolled to the bottom.
- Mobile header "Capture" button clipped.

## [0.1.0] – private

- Initial local-first LifeOS: Today, log, planner, projects, tasks, deep-focus mode with site and app blocking, stats, browser extension and Waybar module.
