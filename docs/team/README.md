# Mizan for teams: extension plan

Mizan today is a **personal LifeOS**: one person, one machine, one SQLite file, an
optional phone. This folder describes how to extend it into a **project-management
tool for teams**, in the class of Jira, Asana or Linear, without weakening what makes
the personal side good: it is private, local-first and fast.

These started as design documents. **Phase 1 (the LAN-hosted MVP) is now implemented in 0.2.0.** The table below shows what shipped and where the build deliberately differs from the design. Each document ends with the decisions it locks in.

## Implementation status (0.2.0)

| Area | Status | Code |
|---|---|---|
| Separate storage, one SQLite file per workspace | ✅ | `src-tauri/src/team/store.rs` |
| LAN host plus replicas, op log, per-field last-writer-wins with HLC, offline outbox | ✅ | `team/store.rs`, `team/server.rs`, `team/mod.rs` |
| Invites (link and QR, single use, 7 days), roles owner/admin/member/viewer, host-side permission checks | ✅ | `store.rs` `allowed()`, `src/team/model.ts` `can()` |
| Projects, issues (task, story, bug, epic), priorities, estimates, due dates, labels, checklists, comments, @mentions, worklog | ✅ | `src/team/views/*` |
| Board with drag-to-reorder, backlog and sprints, list, My issues, inbox, activity | ✅ | `Board.tsx`, `Backlog.tsx`, `IssueList.tsx`, `Inbox.tsx` |
| Reports: burndown, velocity, throughput, cycle time, workload | ✅ | `src/team/reports.ts`, `Reports.tsx` |
| Bridge: "Assigned to you" on Today, focus time to a team issue, copy a personal project in | ✅ | `Today.tsx`, `Focus.tsx`, `WsSettings.tsx` |
| Phone: join, my issues, status, assign, checklist, comment, log time, new issue | ✅ | `companion/index.html` (Team tab) |
| Hosted-workspace backups, JSON export | ✅ | `team::backup_hosted`, workspace Settings |
| Custom workflows and fields, automation, timeline/roadmap, subtasks as issues, guest role | ⏳ Phase 2+ | [roadmap](07-roadmap.md) |
| `mizan-server` (headless host), TLS, WebSocket push | ⏳ Phase 3 | [sync and hosting](04-sync-and-hosting.md) |

Where the build differs from the design, and why:
- **Auth**: bearer tokens, stored as SHA-256 hashes on the host, instead of Ed25519 device keys. This is simpler, and enough for a trusted LAN.
- **Transport**: plain HTTP with polling every few seconds instead of WebSocket push. This keeps the phone page dependency-free. TLS is the top Phase 3 item.
- **Workflow**: fixed (Backlog → To do → In progress → In review → Done or Canceled).
- **Arrays**: labels and checklists merge as whole arrays (last writer wins) rather than per item.

## The one rule: two spaces, never mixed

Mizan gets two kinds of space with a hard wall between them:

| | **Personal space** (exists today) | **Team workspaces** (new) |
|---|---|---|
| Who | Only you | Members you invite |
| What | Life tasks, routines, logs, focus, check-ins, stats, prayer times | Projects, issues, sprints, boards, roadmaps, reports |
| Stored in | `mizan.db` (unchanged) | One database file **per workspace** |
| Syncs with | Your own phone only | The workspace's host (a teammate's desktop or a self-hosted server) |
| Visible to others | Never | Only to members with permission |

Your journal, focus history, check-ins and personal tasks never leave the personal
database, and no team code can query it. The only link between the two spaces is a
small, one-way **bridge**: team work assigned to you can show up in your personal
planner, and you can choose to log focus time to a team issue. Both are explicit and
covered in [architecture](01-architecture.md#the-bridge).

## Documents

| # | Document | Answers |
|---|---|---|
| 1 | [Architecture](01-architecture.md) | How the two spaces live in one app: storage, code layout, routing, the bridge. |
| 2 | [Data model](02-data-model.md) | Every team table: workspaces, members, projects, issues, workflows, sprints, fields, comments, activity. |
| 3 | [Features](03-features.md) | What teams get (boards, backlog, sprints, timeline, reports, automation), compared with Jira and Asana, with MVP scope marked. |
| 4 | [Sync and hosting](04-sync-and-hosting.md) | How teammates share a workspace: LAN peer host, self-hosted server, the operation log, conflicts, offline. |
| 5 | [Permissions and privacy](05-permissions-and-privacy.md) | Roles, the permission matrix, and the rules that keep personal data private. |
| 6 | [UI and UX](06-ui-and-ux.md) | Space switcher, navigation, how team views look and behave, shortcuts. |
| 7 | [Roadmap](07-roadmap.md) | Phased plan mapped to files in this repo, with acceptance criteria per phase. |

## Glossary

- **Space:** either your Personal space or one Team workspace. The app shows one at a time.
- **Workspace:** a team's shared container (for example "Acme Engineering"). It holds members, projects and settings.
- **Project:** a body of work inside a workspace with a short **key** (`ENG`). Issues are numbered per project (`ENG-42`).
- **Issue:** the team work item. It has a type (epic, story, task, bug, subtask), and its own workflow, assignee, estimate and fields. Asana calls it a "task" and Jira an "issue"; Mizan uses *issue* in team spaces so it is never confused with a personal *task*.
- **Workflow:** the statuses an issue moves through (To do → In progress → In review → Done) and the allowed transitions.
- **Sprint:** a time-boxed set of issues (Scrum). Kanban projects have no sprints.
- **Host:** the machine that keeps the authoritative copy of a workspace and orders changes. It is a teammate's Mizan desktop (LAN mode) or `mizan-server` (server mode).
- **Replica:** each member's local copy of a workspace. It works offline and syncs with the host.
- **Op (operation):** one recorded change ("set ENG-42.status = done"). Sync exchanges ops, not whole rows.

## Design principles

1. **Personal stays personal.** Separation is enforced by storage (separate files) and code (separate modules), not just by UI filters.
2. **Local-first for teams too.** Every member has a full replica: boards open instantly and work offline. The host orders changes and enforces permissions, but it is not needed for reading.
3. **No vendor cloud.** Teams host themselves: a desktop on the office LAN, or a small server binary they run. A hosted service could come later, but nothing depends on one.
4. **Opinionated defaults, few knobs.** Defaults are close to Linear (fast, keyboard-first). Jira-level configurability (custom fields, workflow editor, permission schemes) is available, but nobody has to set it up to get started.
5. **Reuse what exists.** The kanban board, calendar, steps, command palette, quick capture and sync bookkeeping are generalized, not rewritten.
