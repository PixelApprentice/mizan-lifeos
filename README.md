# Mizan LifeOS

Mizan is a local-first planner. It runs on your Linux desktop and has two separate spaces:

- **Personal**: your tasks, projects, calendar, focus timer, daily routine and notes, private to you.
- **Team** (optional): Jira- or Asana-style workspaces with boards, backlog, sprints, issues, comments and reports. Workspaces are hosted on a teammate's computer over the local network, so there is no cloud account. Team data never mixes with personal data.

There are no accounts and no cloud. An optional Android app turns your phone into a full-screen focus timer, keeps a copy of your tasks, and lets you work on team issues.

Built with Tauri, React and SQLite. Free software under the [AGPL-3.0](LICENSE); commercial licences are available ([details](COMMERCIAL-LICENSE.md)).

**Contents:** [Install](#install-the-desktop-app) · [Phone app](#phone-app-android) ·
[Using Mizan](#using-mizan) · [Team workspaces](#team-workspaces) · [Your data](#your-data) ·
[Troubleshooting](#troubleshooting) · [Optional extras](#optional-extras) · [Development](#development) ·
[Licence](#licence)

---

## Install the desktop app

You need [Node.js](https://nodejs.org) 22+, [pnpm](https://pnpm.io), [Rust](https://rustup.rs)
and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your system
(on Arch Linux: `webkit2gtk-4.1`).

```sh
pnpm install --frozen-lockfile
pnpm tauri build --no-bundle      # about 10 minutes the first time
bash scripts/install-desktop.sh   # adds Mizan to your app launcher
```

Open **Mizan** from your launcher, or run `mizan` in a terminal. After pulling
new changes, run the last two commands again.

To try it without installing, run `pnpm tauri dev`.

---

## Phone app (Android)

The phone app is optional. With it you can:

- use the phone as a **full-screen focus timer** next to your computer;
- **start a focus session** from the phone;
- **see and edit your tasks** away from your desk. Changes sync the next time the
  phone and the computer can reach each other.
- **work on team issues** (Team tab): join a workspace by scanning its invite QR code, then see
  your issues, change status, comment, tick checklists, log time and create issues.

### 1. Get the APK

The ready-made file is **`releases/Mizan-companion.apk`** in this folder.
If it is not there, build it:

```sh
pnpm android        # builds and copies the APK to releases/Mizan-companion.apk
```

`pnpm android` needs JDK 17 and the Android SDK; see [android/README.md](android/README.md).
Without an SDK, use GitHub instead: **Actions → Android companion APK → Run workflow**,
then download `mizan-companion-apk` from the run.

### 2. Install it on the phone

Choose one:

- **Copy the file:** send `Mizan-companion.apk` to the phone (USB file transfer,
  KDE Connect, a messenger, etc.) and open it. Android asks you to allow installs
  from that app once. Allow it.
- **USB debugging:** connect the phone and run `pnpm android --install`.

### 3. Pair the phone with the computer

1. On the computer, open Mizan → **Settings → Phone companion** → **Turn on**.
   A QR code appears.
2. On the phone, open Mizan → **Pair** → **Scan QR code**.
3. Done. The phone shows **Paired**, and its Focus, Tasks and Agenda tabs are ready.

You only pair once. **New pairing code** in Settings disconnects every phone.

### 4. Connecting without Wi-Fi

The phone and the computer only need *some* link between them. The phone remembers
the computer and finds it again on any of these:

| Your situation | What to do |
|---|---|
| Both on the same Wi-Fi | Nothing. |
| No Wi-Fi: computer uses the **phone's hotspot** | Connect the computer to the hotspot. The phone finds it within a few seconds. |
| **USB cable** (recommended without Wi-Fi) | Plug in, then on the phone turn on **Settings → Hotspot & tethering → USB tethering**. The computer also gets the phone's internet. |
| USB cable, but tethering is not possible | Turn on **USB debugging** on the phone, plug in, and click **Link phone over USB debugging** in Mizan's Settings. Click it again after re-plugging. Needs `adb` (`sudo pacman -S android-tools`). |

If the phone ever says it cannot reach the computer, tap **Find desktop again** on
the Pair screen.

**Security:** the link is plain HTTP on your local network, protected by the
pairing code in the QR. Your own hotspot and a USB cable are private. On shared
Wi-Fi, keep the companion turned off. If the phone cannot connect, your firewall
may be blocking port 47615. For example:
`sudo ufw allow from 192.168.0.0/16 to any port 47615 proto tcp`
(hotspots also use `10.x` and `172.16–31.x` addresses).

Without the APK you can open the same page in the phone's browser (scan the QR
with the camera app). It works, but a browser cannot go truly full screen or keep
the screen on.

---

## Using Mizan

| View | What it is for |
|---|---|
| **Today** | Upcoming events, the tasks that matter most (tick them off or press **Focus** right there), team issues assigned to you, and the daily routine check-in. The day counter starts from the Day 1 you choose. |
| **Planner** | Calendar. Drag to create or move blocks. **auto-plan open tasks** fills your work windows with open tasks. |
| **Projects** | Kanban board per project. Drag a card by its ⠿ handle to reorder it or move it between columns. The ⋯ menu on each card has the same moves, plus priority, focus, schedule and delete. |
| **Tasks** | All tasks with search, filters and saved views. **Break into steps** turns a task into a checklist (paste any list). **Focus** starts a session with the task as its goal. |
| **Log** | One Markdown note per day, with templates. Autosaves. |
| **Focus** | Focus timer. Pick the length with Clock-style wheels. Optional site and app blocking. You can tie a session to a team issue and log the time to it afterwards. |
| **Stats** | Focus time, sessions, finished tasks, streaks and phone checks, from your own data. |
| **Team** | Your team workspaces (see below). Shown with a blue accent so you always know which space you are in. |
| **Settings** | **Appearance** (Light, Dark or Automatic), Day 1, data folder, work windows, **daily routine** (pick the General or Faith preset, or build your own habits and targets), phone companion and integrations. |

Shortcuts:

- `Ctrl+K`: command palette (also "Switch light / dark").
- `Ctrl+Shift+K`: quick capture from anywhere.
- `Alt+1`…`Alt+8`: switch views.
- `Ctrl+S`: save the log.

**Exit** in the sidebar saves your work and stops any running timer and blocking.

`pnpm dev` opens a browser preview with **demo data only**. It never touches your
real database.

---

## Team workspaces

A workspace lives on one computer, the **host**. Teammates join with an invite link or QR code, from their own Mizan desktop or the phone app.

1. **Team → New workspace**, then **People → Invite** (choose member, admin or viewer). Send the link or show the QR code.
2. On the host, keep **Hosting** on (workspace Settings). Teammates must be able to reach the host: same Wi-Fi, a phone hotspot, a VPN such as Tailscale or WireGuard, or USB for a phone.
3. Teammates work offline as well. Their edits wait in an outbox and sync when the host is reachable.

| Tab | What it is for |
|---|---|
| **Board** | Columns by status (Backlog → To do → In progress → In review → Done). Drag to move or reorder. |
| **Backlog** | Plan sprints: drag issues into a sprint, then start and complete it. |
| **List / My issues** | Filter by project, assignee, type, priority or label. Press `c` anywhere to create an issue. |
| **Inbox** | Assignments, @mentions, comments and status changes on your issues. |
| **Reports** | Burndown, velocity, throughput, cycle time and workload per person. |
| **People** | Invites, roles and removing access. |
| **Settings** | Projects, copying a personal project in, hosting, JSON export, and leaving or deleting the workspace. |

Roles:
- **Owner** and **admin**: everything, including people and projects.
- **Member**: works on issues, and deletes only their own.
- **Viewer**: reads and comments.

The host checks every change, so a modified client can't bypass roles.

Limits for now:
- traffic is plain HTTP, so use trusted networks (see [SECURITY.md](SECURITY.md));
- the workflow is fixed;
- Linux only.

Design notes are in [docs/team/](docs/team/README.md).

---

## Your data

Everything stays on your computer:

| What | Where (Linux) |
|---|---|
| Tasks, projects, events, settings | `~/.config/com.salahudin.mizan/mizan.db` |
| Daily database backups (last 14 days) | `~/.local/state/mizan/backups/` |
| Focus sessions and timer state | `~/.local/state/mizan/` |
| Daily logs, Day 1, check-in tracker | The data folder chosen in Settings (default `~/Documents/lifeos`) |
| Phone pairing settings | `~/.local/state/mizan/companion.json` |
| Team workspaces (one file each, separate from personal data) | `~/.config/com.salahudin.mizan/team/<id>.db`. Hosted ones are backed up daily too. |
| Phone's copy of your tasks | Inside the phone app |

**Restoring a backup:** quit Mizan, then copy
`~/.local/state/mizan/backups/mizan-YYYY-MM-DD.db` over `mizan.db`. Also keep your
own copy of the data folder and backups on another disk.

Mizan only goes online for:

- prayer times, if you enter a city (sent to AlAdhan);
- downloading a public blocklist, if you import one;
- team workspaces and the phone companion, which only talk to devices on your own network.

Full details: [PRIVACY.md](PRIVACY.md).

Task breakdown uses local templates. No task text goes to an AI service.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Window goes blank or the app closes | Mizan reloads itself after a renderer crash. Details are in `~/.local/state/mizan/crash.log`. Run `mizan` from a terminal to see more. |
| Blank window or flicker on Wayland | Mizan already sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Keep it; `MIZAN_ENABLE_DMABUF=1` turns the faster but less stable renderer back on. |
| Phone cannot connect | Use the same network, hotspot or USB as described in [step 4](#4-connecting-without-wi-fi), and check the firewall rule above. Tap **Find desktop again**. |
| The APK is missing | Run `pnpm android`. It is written to `releases/Mizan-companion.apk`. `FLAVOR=foss pnpm android` builds a version without Google Play services, which has no QR scanner, so you paste links instead. |
| Teammate cannot join | The invite is single-use and expires after 7 days. Both computers must reach each other on port 47616 (allow it in the firewall). Hosting must be on. |
| Changes don't show up after `git pull` | Rebuild: `pnpm tauri build --no-bundle && bash scripts/install-desktop.sh`. |

Known limits and the roadmap are in [docs/evaluation.md](docs/evaluation.md).

---

## Optional extras

These need extra setup and are off unless you install them.

**Site and app blocking during focus.** Read the scripts in [helper/](helper/) first. They run as root through polkit:

```sh
sudo install -o root -g root -m 755 helper/mizan-hosts helper/mizan-hosts-perm /usr/local/bin/
sudo install -o root -g root -m 644 helper/com.salahudin.mizan.hostsblock.policy /usr/share/polkit-1/actions/
```

The permanent shield needs a polkit authentication agent. Hyprland app blocking
closes matching windows (it warns first), so save your work. Blocking adds friction;
it is not a security boundary.

**Firefox add-on** (YouTube intention gate). Run `bash extension/native-host/install.sh`,
then in Firefox open `about:debugging` → **This Firefox** → load
[extension/manifest.json](extension/manifest.json). It shows your current task on
YouTube pages, so only enable it if that is acceptable. Temporary add-ons need
reloading after a browser restart.

**Waybar.** [waybar/mizan-waybar.sh](waybar/mizan-waybar.sh) shows the running focus
session in your bar.

---

## Development

```sh
pnpm dev                 # browser preview with demo data
pnpm tauri dev           # desktop app in dev mode
pnpm build               # type-check and build the frontend
pnpm test                # frontend tests (Node.js 22.18+)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust tests
pnpm test:privacy        # privacy guard tests
pnpm android             # build the phone APK → releases/Mizan-companion.apk
```

Demo videos (need `ffmpeg` and `pnpm exec playwright-core install chromium`; output
goes to `recordings/`, which is not committed):

```sh
pnpm demo:video          # captioned product tour → recordings/mizan-demo.mp4
pnpm demo:footage        # record clean footage for the trailer
pnpm demo:trailer        # 70 s intro trailer → recordings/mizan-trailer.mp4
pnpm demo:footage:light  # record light-theme footage for the launch film
pnpm demo:film           # 84 s bright launch film → recordings/mizan-film.mp4
pnpm demo:footage:cinema # record sharper (2x) footage with input events for the cinema cut
pnpm demo:cinema         # 78 s 3D cinema cut → recordings/mizan-cinema.mp4 (uses the GPU)
pnpm demo:models         # save the film's MacBook Pro and iPhone models → assets/models/*.glb
```

Add `--stills auto` to any of them (`pnpm demo:cinema --stills auto`) for a quick contact
sheet instead of a full render. `--workers N` sets how many browsers render in parallel.

| Folder | Contents |
|---|---|
| [src/](src/) | React frontend (views, components, scheduling and stats logic) |
| [src-tauri/](src-tauri/) | Rust backend: database, focus timer, blocking, phone sync server, crash recovery |
| [companion/](companion/) | The phone page (served by the desktop and bundled in the APK) |
| [android/](android/) | Android wrapper app |
| [docs/](docs/) | Evaluation, roadmap and design docs, including the [team workspaces plan](docs/team/README.md) |
| [scripts/](scripts/) | Install, APK build, privacy check, licence notices, version bump and demo video tools |
| [docs/release/](docs/release/) | [Readiness review](docs/release/readiness.md), [deployment](docs/release/deploy.md), [versioning](docs/release/versioning.md) |
| [templates/](templates/) | Blank starter files (must stay blank) |

### Committing safely

This repository holds code and blank templates only. Never commit your data folder,
database or logs. Before committing:

```sh
git config core.hooksPath .githooks          # once after cloning: enables the guard
python3 scripts/check-private-data.py --all  # scan the whole tree
git diff --cached --stat                     # review what you are about to commit
```

The guard rejects databases, filled-in templates, home-directory paths and
common secret formats, but it cannot recognise every bit of personal text, so
read your diff. Use Conventional Commits (`fix(planner): …`). See [CONTRIBUTING.md](CONTRIBUTING.md).

### Credits

Calendar by FullCalendar, drag and drop by dnd-kit, icons by Pixelarticons, fonts by
Fontsource. Their licenses apply. Some workflows are original re-implementations of
ideas from Obsidian community plugins, with no code copied:
[QuickAdd](https://github.com/chhoumann/quickadd) (quick capture),
[Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) (filters and saved views)
and [Templater](https://github.com/SilentVoid13/Templater) (log templates with
`{{DATE}}`, `{{TIME}}`, `{{DAY}}`, `{{WEEK}}`, `{{DOW}}`, `{{TITLE}}`, `{{VALUE}}`).
Mizan never runs template JavaScript or shell commands. The app identifier
`com.salahudin.mizan` is kept for compatibility; it is not an account.

---

## Licence

Mizan is free software: you can redistribute it and/or modify it under the terms of the
[GNU Affero General Public License](LICENSE), version 3 or (at your option) any later version.
It comes with no warranty.

- **Using it, at home or at work, or hosting team workspaces**: free. Nothing to sign.
- **Shipping a closed-source product built on Mizan**: you need a [commercial licence](COMMERCIAL-LICENSE.md).
- **Contributing**: see [CONTRIBUTING.md](CONTRIBUTING.md) (CLA plus `git commit -s`).
- **Name and logo**: [TRADEMARKS.md](TRADEMARKS.md).
- **Bundled components**: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Changes**: [CHANGELOG.md](CHANGELOG.md).
