# 7. Roadmap

A phased plan that moves the code from the current personal app to team workspaces.
Each phase ships something usable, keeps the personal app working, and has
acceptance criteria. Estimates assume one developer working with an AI assistant.

| Phase | Name | Ships | Rough size |
|---|---|---|---|
| 0 | Groundwork | Same app, restructured, with more tests | 1 week |
| 1 | Local workspaces | Team workspaces on one machine (solo, offline) | 2–3 weeks |
| 2 | LAN sharing | Teammates sync through a desktop host | 3 weeks |
| 3 | Team MVP | Sprints, inbox, comments, worklogs, bridge | 3 weeks |
| 4 | Competitive | `mizan-server`, timeline, reports, MQL, automation | 4–6 weeks |
| 5 | Later | Phone team tab, imports, Git, forms, goals, E2E | ongoing |

## Phase 0: Groundwork (no visible change)

Goal: make room for a second space without touching behaviour.

| Task | Files |
|---|---|
| Move personal views to `src/spaces/personal/` and personal data access to `src/spaces/personal/api.ts`. Re-export from the old paths for one release. | `src/views/*`, `src/lib/api.ts`, `src/App.tsx` |
| Extract the generic `Board<T>` (columns, dnd-kit sorting, move buttons, column scroll cap) from the Projects view, and use it there. | `src/views/Projects.tsx` → `src/shared/board/` |
| Extract the calendar wrapper (event content, slot height, scrollTime) from the Planner. | `src/views/Planner.tsx` → `src/shared/calendar/` |
| Move generic components to `src/shared/` (Modal, Pixel, DurationWheel, Palette, QuickCapture). | `src/components/*` |
| Add ESLint with a `no-restricted-imports` boundary rule (`spaces/personal` ↔ `spaces/team`). | `eslint.config.js`, `package.json` |
| Add component tests (Vitest + Testing Library) for Board, Tasks and Planner: drag reorder, breakdown, scroll reset. This is suggested next work item 6 in [evaluation](../evaluation.md). | `src/**/*.test.tsx` |
| Turn `src-tauri` into a Cargo workspace: `src-tauri` (app) plus an empty `crates/mizan-team-core`. | `Cargo.toml`, `src-tauri/Cargo.toml` |

**Done when:** `pnpm test`, the component tests, `cargo test` and the personal demo
video run unchanged. No user-visible difference.

## Phase 1: Local workspaces (solo)

Goal: create a workspace and use boards and issues on your own machine. It works
offline from day one and is already useful as a separate "work" area.

| Task | Files |
|---|---|
| Workspace schema and migrations ([data model](02-data-model.md): workspace, member, project, issue_type, workflow, status, transition, issue, label, checklist_item, board, saved_filter, op_log, outbox, sync_state). | `crates/mizan-team-core/src/schema.rs` |
| Op type, HLC, apply/merge (set, add/remove, move, create, delete) with property tests: any delivery order converges to the same state. | `crates/mizan-team-core/src/ops.rs` |
| Fractional rank strings (generate between, rebalance). | `crates/mizan-team-core/src/rank.rs` |
| Workspace registry (`workspaces.json`), pool cache, create/open/delete workspace. | `src-tauri/src/team/mod.rs` |
| Commands: workspaces, projects, issues, statuses, labels, checklist, board config. Every write = op + apply + emit `team:changed`. | `src-tauri/src/team/commands.rs`, `lib.rs` handler list |
| Frontend `teamApi`, space switcher, team routes `/w/:ws/…`, the per-space accent colour. | `src/spaces/team/api.ts`, `src/App.tsx`, `src/index.css` |
| Views: project list, board (`Board<T>`), list view (virtualized), issue panel, filter bar. | `src/spaces/team/views/*`, `components/*` |
| Browser demo mode: an in-memory team store, like the personal demo, so `pnpm dev` and demo videos work. | `src/spaces/team/demo.ts` |
| "Share to workspace…" one-time copy from a personal project ([mapping](02-data-model.md#mapping-from-the-personal-model)). | `src/spaces/personal/Projects`, `team/commands.rs` |

**Done when:**

- A workspace can be created with the default seed. Issues can be created, edited,
  dragged on the board (rank and status), filtered and given checklists, and the
  data survives a restart.
- Rule P1 test: team commands open only the workspace database (a Rust test with a
  fake personal pool that panics if used).
- Deleting a workspace removes its folder. `mizan.db` is byte-identical before and after
  creating and deleting a workspace (test).

## Phase 2: LAN sharing

Goal: two or more desktops share a workspace on the same network.

| Task | Files |
|---|---|
| Device key (Ed25519) in the OS keyring, op signing and verification. | `crates/mizan-team-core/src/identity.rs`, `src-tauri/src/team/keys.rs` |
| Host mode: TLS (self-signed certificate plus fingerprint), `/v1/ws/:id/ops` push and pull, `/live` WebSocket, `/snapshot`, `/blobs`, permission checks, seq assignment, issue numbering. Uses axum + rustls, replacing tiny_http for team traffic only. | `src-tauri/src/team/host.rs` |
| Sync worker: outbox push, pull, live, backoff, rollback on rejection, "offline · N waiting" status. | `src-tauri/src/team/sync.rs` |
| Invites (QR/link with fingerprint), join flow, member list, roles, deactivate and revoke. | `team/commands.rs`, `src/spaces/team/views/Members.tsx` |
| Permission matrix in core, used by both host and client ([doc 5](05-permissions-and-privacy.md)). | `crates/mizan-team-core/src/perm.rs` |
| Conflict display in History (the `base` mismatch). | `IssueHistory.tsx` |
| Discovery on LAN (mDNS `_mizan-team._tcp`), reusing evaluation item 2. | `team/host.rs` |

**Done when:**

- An integration test runs two clients and one host in-process: concurrent offline
  edits to different fields both survive, edits to the same field resolve by HLC,
  and delete beats edit. Replicas converge byte-for-byte on the entity tables.
- A guest cannot receive ops from a private project (a host filter test).
- A manual test with two machines on a phone hotspot (the setup the personal companion already supports).

## Phase 3: Team MVP

Goal: a small team can run its real work in Mizan.

| Task | Files |
|---|---|
| Issue types and hierarchy (epic → story → subtask), links (blocks/relates). | core plus views |
| Backlog and sprints: plan, start, complete, carry over, daily snapshots, sprint header. | `team/commands.rs`, `views/Backlog.tsx`, `views/Sprint.tsx` |
| Comments with mentions and reactions, watchers, attachments (blobs). | `components/Comments.tsx` |
| Notifications derived from ops, Inbox, My issues. | `team/notify.rs`, `views/Inbox.tsx`, `views/MyIssues.tsx` |
| Worklogs, and the **bridge**: `bridge_assigned_to_me`, personal Today "Team" card, Planner toggle, Focus "log time?" confirmation, `events.ext_ref` (personal migration v4). | `src-tauri/src/team/bridge.rs`, personal Today/Planner/Focus |
| Keyboard shortcuts, bulk edit, issue templates, paste-list create. | `src/spaces/team/keys.ts` |
| Workspace export (JSON plus attachments). | `team/commands.rs` |
| Desktop notifications for mentions and assignments (`tauri-plugin-notification` is already a dependency). | `team/notify.rs` |

**Done when:**

- Tests exist for rules P1–P9. Each of them is written as a test.
- A team of 3 can run a two-week sprint with the host desktop offline for a day, and nothing is lost.
- The demo trailer can be re-recorded with a team segment (`pnpm demo:footage`).

## Phase 4: Competitive

| Task | Notes |
|---|---|
| `mizan-server` binary (axum, SQLite/Postgres, ACME TLS, Docker image, `backup` command). Same protocol as the LAN host. | New crate `crates/mizan-server` |
| "Move host" from a desktop to a server. | Op-log export/import |
| Timeline (epics, dependencies, versions). | `views/Timeline.tsx` |
| Reports: burndown, velocity, cumulative flow, cycle time, throughput, created vs resolved. | Pure functions plus tests next to `stats.ts` |
| MQL text queries plus FTS5 search, saved filters. | `crates/mizan-team-core/src/query.rs` |
| Automation rules on the host. | `crates/mizan-team-core/src/automation.rs` |
| Custom fields, workflow editor, WIP limits, swimlanes. | Settings views |
| Workload view. | `views/Workload.tsx` |
| Collaborative description editing (Yjs). | Replaces LWW text |

## Phase 5: Later

- **Phone:** a team tab in the Android app with its own device key (approve it from
  the desktop by QR). Shows My issues, Inbox and quick status changes.
- **Import:** from Jira CSV, Asana CSV, GitHub Issues and Trello. **Integrations:** Git
  references and `fixes` keywords, outgoing webhooks, OIDC SSO on the server.
- **Requests and goals:** intake forms, goals/OKRs, portfolios across projects.
- **E2E-encrypted workspaces** (the host only orders opaque ops).
- Moving personal phone sync onto the op engine for field-level merges.

## Risks

| Risk | Mitigation |
|---|---|
| The phase 0 restructure breaks the personal app | Move files with re-exports first, component tests before moving, and demo video as a smoke test. |
| Sync bugs lose team data | Property tests for convergence, an append-only op log (anything can be replayed), daily host snapshots, replica promotion. |
| Scope creep toward "all of Jira" | MVP as defined in [features](03-features.md). Phase 4 items need a real team asking for them. |
| Two data paths (personal TS-SQL vs team Rust) confuse contributors | Documented here. Phase 5 may move personal writes to Rust as well. |
| WebKitGTK performance with large boards | Virtualized lists, column caps (already done for personal), and measure with 5k issues in the demo store. |

## Open decisions

To settle before phase 1 starts:

1. **Estimation default:** story points or hours? This plan says points with an hours option.
2. **Server stack for phase 4:** axum + SQLite first (simplest) or Postgres from the start?
3. **Timeline renderer:** FullCalendar resource timeline (check its license for premium
   views) or a custom SVG?
4. **Product name** for team spaces: "Mizan Teams", or just workspaces inside Mizan?
5. **Licence** for `mizan-server`, if the project is ever published (AGPL is common for
   self-hosted servers. The current repo is private).
