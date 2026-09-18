# Mizan evaluation and roadmap

A review of the app after the stability and companion work. It covers what was
fixed and why, what is still risky, and what is worth doing next.

## What was fixed

| Problem | Cause | Fix |
| --- | --- | --- |
| Sudden crashes, high CPU/GPU | WebKitGTK's DMA-BUF renderer aborts on Wayland compositors (Hyprland). A second always-on-top timer window also ran its own WebView and re-rendered every tick, and a CSS cursor blink kept the compositor busy. | `WEBKIT_DISABLE_DMABUF_RENDERER=1` is set by default (`MIZAN_ENABLE_DMABUF=1` turns it back on). The overlay window and the blink animation were removed, and drag handlers only update state when something changes. Panics are written to `~/.local/state/mizan/crash.log`, and release builds unwind instead of aborting so a panic in a helper thread no longer kills the window. |
| Data safety | Phone sync writes into the same database. | Daily snapshot with `VACUUM INTO` to `~/.local/state/mizan/backups/`, keeping 14 days. To restore, quit Mizan and copy a snapshot over `mizan.db`. |
| Pixel companion | — | Removed. Only the logo and progress bars remain. |
| Kanban could not reorder | Drops only changed the column, never the position. | Drag-to-sort within a column and between columns, with a drop marker. |
| Stats empty | Stats only read `tracker.csv`, which most days is empty. | Stats now come from real data: focus sessions (7/28-day chart, streak, broken sessions with reasons), tasks (done per day, open, overdue, by category) and tracker check-ins. Each source fails on its own without blanking the page. |
| Small timer window | Hard to build and maintain, and it caused crashes. | Removed. The phone companion can act as the second screen instead. |
| Time selection | Only text fields. | iOS-Clock-style hour/minute wheels on Focus (and on the phone). Your choice of wheels or fields is remembered. |
| "Break into steps" broken | Suggestions repeated the task title, adding steps replaced the existing ones, and steps were hard to see. | Real step extraction from notes and pasted lists ("1 … 2 …", bullets, "a, b and c"). Steps are appended without duplicates. Each task shows a visible steps list where you can tick, rename, set minutes, delete, or clear all. |

## Phone companion (new)

- **Desktop:** an opt-in LAN server (Settings → Phone companion), off by default.
  It pairs with a QR code containing a random 128-bit token. You can rotate the code at any time.
- **Phone:** `companion/index.html`, either served by the desktop or bundled in the
  Android app (`android/`). The Android app runs full screen, keeps the screen awake
  and can scan the QR code.
- **Second screen:** a big timer with wheels to start a session, pause/resume and stop with a reason.
- **Sync:** git-like. The phone keeps a full offline copy of projects, tasks and
  events. Each side pushes the changes made since the last sync and pulls the rest,
  using per-row `sync_id` and `updated_at` plus tombstones for deletions (migration v3).
  The newest edit of a row wins.
- **No Wi-Fi:** pair once, then use the phone's hotspot, USB tethering, or a plain
  USB cable with `adb reverse` (Settings → **Link phone over USB debugging**). The phone
  recognises the desktop by a stable ID, not by its address. When the desktop stops
  answering, the phone tries its known addresses, then `127.0.0.1`, then scans its own
  local networks.
- **Focus extension:** while a session runs, the phone counts every time you leave the
  timer screen ("phone checks"). The count shows on the desktop Focus view, in the
  session log and in Stats.

## Known risks and limits

1. **Plain HTTP on the LAN.** The token is checked on every request, but anyone who can
   watch your Wi‑Fi traffic could read it and your task titles. Only enable the
   companion on trusted networks. Rotate the code if a phone is lost.
2. **Last-writer-wins.** If the same task is edited on both devices before a sync, the
   newer edit replaces the older one as a whole. There is no field-level merge or
   conflict log. Clock skew between devices can pick the "wrong" winner.
3. **Not run end to end on a phone.** The sync logic is covered by Rust tests and the
   page was tested in a desktop browser against a mock server. The Android WebView
   reaching a LAN HTTP server from a `file://` page is expected to work (CORS and
   private-network headers are sent) but has not been checked on a device.
4. **QR scanning needs Google Play services** (the `play` build). The `foss` build
   (`FLAVOR=foss pnpm android`) has no proprietary code and no scanner. Paste or share the link instead.
5. **Discovery scans one /24 per link.** Hotspots and tethering use /24 subnets, but a
   desktop on a larger office network must be reached through its paired address or a
   fresh QR code. `/api/ping` answers without the pairing code (it only says "mizan"
   and the desktop ID) so the phone never sends its code to strangers while searching.
6. **Only one phone at a time is tested.** Several phones work in principle, since sync
   is per-row, but this hasn't been exercised.
7. **Backups are on the same disk.** Mizan snapshots the database once a day to
   `~/.local/state/mizan/backups/` and keeps 14 days. That undoes a bad sync or a
   mistaken delete, but not a dead disk, so copy that folder elsewhere now and then.
8. **Views have no automated UI tests.** The logic modules (`src/lib/*.ts`) and Rust have
   unit tests; the React views are only covered by manual browser checks.

## Suggested next work

Ordered by value for effort:

1. **Conflict log.** When a pushed row loses to a newer local row, store the losing
   version and show it in Settings so nothing is silently dropped.
2. **mDNS discovery.** Advertise `_mizan._tcp` so the phone finds the desktop on large
   networks (bigger than /24), where the current subnet scan does not reach.
3. **Encrypted transport.** A self-signed certificate whose fingerprint is in the QR
   code (certificate pinning) removes the plain-HTTP risk.
4. **Recurring tasks** (daily/weekly rules), the most common request for planners like this.
5. **Phone notifications** when a focus block ends, using an Android foreground
   service so it works with the screen off.
6. **Component tests** for Tasks, Projects and Stats (Vitest and Testing Library) to
   catch regressions like the old breakdown bug.
7. **Tauri mobile instead of the wrapper.** If the phone app grows, Tauri 2 Android could
   share the React UI. The current wrapper is intentionally tiny so it is easy to build.

## Troubleshooting crashes

- Check `~/.local/state/mizan/crash.log` for Rust panics.
- Run `mizan` from a terminal. Wayland protocol errors or `WebKitWebProcess` crashes
  point to the GPU path. Try `WEBKIT_DISABLE_COMPOSITING_MODE=1 mizan` as well.
- `MIZAN_ENABLE_DMABUF=1` restores the faster renderer if your GPU driver handles it.

## Team workspaces

Team workspaces (Jira/Asana style, kept strictly separate from the personal LifeOS)
shipped in 0.2.0. Status and design are in [team/README.md](team/README.md). The phone's Team tab
was tested end to end in Chromium against the real Rust host (join, status, assign,
checklist, comment, log time, create issue). It has not yet been run on a physical phone.

## Release readiness

The full functional, non-functional, legal and business review for the first public
release is in [release/readiness.md](release/readiness.md).
