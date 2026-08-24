# Mizan LifeOS

A local-first desktop workspace for tasks, projects, calendar planning, focus
sessions, and daily notes. Built with Tauri, React, TypeScript, and SQLite, with
optional Linux/Hyprland and Firefox integrations.

This repository contains **application source and blank reusable templates**.
Your tasks, settings, notes, activity history, and start date stay on your device.
The app has no cloud account or built-in data synchronization.

## Everyday workflow

- **Today:** upcoming calendar events, important tasks, and an expandable routine
  check-in. The day counter continues indefinitely; it never wraps at day 100.
- **Planner:** schedule events and tasks, edit calendar blocks, and use configurable
  work windows for auto-planning.
- **Projects and Tasks:** a lightweight project board, task estimates, priorities,
  deadlines, and shared calendar scheduling.
- **Log:** dated local Markdown with autosave and an explicit Save action.
- **Focus:** timed sessions with optional site/app blocking and a small timer window.
- **Stats:** local activity history and calendar-aware streaks.
- **Settings:** choose Day 1, local storage, planning windows, and optional integrations.

Learning sprints can be represented as projects with deadlines and calendar
blocks. They do not limit or reset the overall LifeOS timeline.

## Interface

Quiet dark surfaces, readable monospace text, pixel icons, and a collapsible pixel
companion. Compact windows use a navigation menu instead of a permanent sidebar.

- `Ctrl+K`: command palette.
- `Alt+1` through `Alt+8`: switch views, except while editing or using a dialog.
- `Ctrl+S` in Log: save the current note.
- **Exit:** saves pending log edits, stops the app and its deep-mode timer/blocking.
  A separately installed permanent site shield remains until removed in Settings.

The browser development preview uses isolated demo data. It is not the desktop
database and is not a backup of your real records.

## Development

Install Node.js, pnpm, Rust, and the Tauri prerequisites for your operating system.
On Arch Linux, the native WebKit dependency is `webkit2gtk-4.1`.

```sh
pnpm install --frozen-lockfile
pnpm dev             # browser preview
pnpm tauri dev       # desktop app
pnpm build           # TypeScript and frontend production build
pnpm test            # scheduling and scoring regression tests (Node.js 22.18+)
pnpm test:privacy    # publication guard tests
cargo test --manifest-path src-tauri/Cargo.toml
```

Build and install the Linux launcher:

```sh
pnpm tauri build --no-bundle
bash scripts/install-desktop.sh
```

### Optional OS-level blocking

Read the helper scripts and policy before installing privileged components:

```sh
sudo install -o root -g root -m 755 helper/mizan-hosts helper/mizan-hosts-perm /usr/local/bin/
sudo install -o root -g root -m 644 helper/com.salahudin.mizan.hostsblock.policy /usr/share/polkit-1/actions/
```

The deep-mode helper runs through polkit. The permanent shield requires an
authentication agent. Hyprland app blocking warns before closing matching windows;
save your work and configure the blocklist carefully. These tools provide
self-imposed friction, not a tamper-proof security boundary.

### Optional Firefox integration

```sh
bash extension/native-host/install.sh
```

In Firefox, open `about:debugging`, select **This Firefox**, and load
[extension/manifest.json](extension/manifest.json) as a temporary add-on.
Temporary add-ons must be loaded again after browser restart; use Mozilla's
signing workflow for a persistent installation.

The native bridge reads local tasks and the current plan for the YouTube intention
gate. Those details are rendered inside the YouTube page: enable this extension
only if that browser-page exposure is acceptable. It is optional and separate from
the desktop app. Use an established ad blocker separately if desired.

## Data and privacy boundary

| Data | Local location on Linux |
|---|---|
| Tasks, projects, events, settings | `~/.config/com.salahudin.mizan/mizan.db` |
| Focus state and session history | `~/.local/state/mizan/` |
| Day 1, Markdown logs, tracker | The folder selected in Settings |
| Browser-preview data and recovery drafts | Local browser/WebView storage |

New installations default to `~/Documents/lifeos`. Existing installations retain
their configured data folder. Day 1 is stored in that folder's `lifeos.json`;
changing it does not delete historical records. Back up the data folder and the
SQLite database separately from this repository.

The legacy application identifier is retained for installation, database, polkit,
and extension compatibility. It is not an account or synchronization service.

Optional network features:

- Prayer times send the configured city and country to AlAdhan. Leave both fields
  blank to disable this lookup.
- Importing a permanent blocklist downloads the selected public list.
- Task decomposition uses local templates and does not send task text to an AI provider.

Do not put your live data folder inside this repository. Ignore rules exclude
databases, journals, local configuration, environment secrets, exports, and backups.
Ignore rules are defense in depth, not a substitute for reviewing staged content.

## Safe commits

Use Conventional Commits, for example `feat(planner): add agenda view` or
`fix(log): preserve edits during navigation`.

Before committing or publishing:

```sh
python3 scripts/check-private-data.py --all
git diff --cached --stat
python3 scripts/check-private-data.py
```

Enable the included local pre-commit guard after cloning:

```sh
git config core.hooksPath .githooks
```

The check rejects common runtime-data paths, populated tracker templates, absolute
home-directory paths, and recognizable secret formats. It cannot recognize every
piece of personal prose: review the actual staged diff as well. Never force-add
ignored personal files.

Keep the remote private, and verify that setting before each initial publication.
Only [templates/](templates/) should contain starter records, and those must remain
blank. Personal start dates belong in the local configuration, not source defaults.

## Open-source components

FullCalendar supplies the calendar; dnd-kit supplies drag-and-drop interactions.
The project board is a small native implementation, not a bundled Kanboard or
Planka server. Pixelarticons supplies icons, and bundled Fontsource fonts preserve
the offline pixel accents. Their respective upstream licenses apply.
