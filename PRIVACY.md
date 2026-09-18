# Privacy

**Short version:**
- Mizan has no accounts, no cloud and no analytics.
- Your data stays on your devices.
- It only goes elsewhere when you turn on a feature that needs it, and each such feature is listed below.

## What is stored, and where

| Data | Location |
|---|---|
| Tasks, projects, calendar, notes, settings | `~/.config/com.salahudin.mizan/mizan.db` (SQLite) |
| Daily log, routine check-ins (`tracker.csv`), focus history | The folder you chose in Settings (Markdown, CSV and JSON files you can read and edit) |
| Backups, focus state | `~/.local/state/mizan/` (daily snapshots of the database and of hosted team workspaces, newest 14 kept) |
| Team workspaces | `~/.config/com.salahudin.mizan/team/<id>.db`, one file per workspace, **separate** from personal data |
| Phone app | Its own storage on the phone: a copy of your tasks and calendar, and the team workspaces you joined |

## When data leaves your computer

| Feature (off by default unless noted) | What is sent | To whom |
|---|---|---|
| Phone companion | Tasks, projects, events, focus state | Your paired phone, over your LAN or USB |
| Team workspace (you host) | Everything in that workspace | Teammates you invited, over your LAN |
| Team workspace (you joined) | Your edits, comments, name and time logs in that workspace | That workspace's host |
| Prayer times (Faith preset, if enabled) | City and country | api.aladhan.com |
| Block list download (Settings, if you press it) | An ordinary download request | raw.githubusercontent.com (StevenBlack hosts) |

**Personal data is never shared with teams.** Copying a personal project into a team workspace is an explicit, one-time action on a project you pick. Its tasks become issues, and nothing stays linked afterwards.

## Teams and the GDPR

When you host a team workspace for an organisation, that organisation is the data controller for its members' data: names, optional email, comments and time logs. Mizan gives the controller what it needs:
- **Export** a workspace (Settings → Export JSON) to answer access requests.
- **Remove** a member, or **delete** the workspace, for erasure. Daily snapshots in `~/.local/state/mizan/backups/team-<id>/` expire after 14 days, or delete them yourself.
- Data stays on the organisation's own machines; there is no processor in between.

Time logs and the reports built on them (workload, velocity) relate to individual people. Before using them to evaluate employees, check your local employment rules; in some countries this needs a works-council agreement.

## Children

Mizan is general-purpose software. It does not knowingly collect anything from anyone, because it does not collect anything.

## Contact

Questions: privacy@<your-domain> (maintainer: set before publishing).
