# 1. Architecture

How one Mizan app holds a private Personal space and any number of Team workspaces
without the two ever mixing.

## Where we start

| Layer | Today |
|---|---|
| Frontend | React 19 + Vite. Views in `src/views/` (Today, Log, Planner, Projects, Tasks, Focus, Stats, Settings), shared bits in `src/components/` and `src/lib/`. Router paths `/`, `/planner`, `/projects`… |
| Data access | `src/lib/api.ts` opens `sqlite:mizan.db` through `tauri-plugin-sql` and runs SQL directly from TypeScript. In a browser it uses an in-memory demo store. |
| Backend | Rust (`src-tauri/src/`): migrations in `lib.rs`, focus timer, blocking helpers, backups, crash recovery and the phone companion server (`companion.rs`, `tiny_http` + `sqlx`). |
| Sync | Row-level: every task, project and event has a `sync_id`, an `updated_at` and tombstones. The newest row wins (migration v3). One user, one phone. |

That is a good base for one person. For teams it is missing four things: identity
(who changed what), permissions, shared hosting, and finer-grained merging than whole rows.

## Target shape

```text
┌────────────────────────────── Mizan desktop app ──────────────────────────────┐
│  Space switcher:  [● Personal]  [Acme Eng]  [Side project]                    │
│                                                                               │
│  ┌──────── Personal space ─────────┐   ┌──────── Team workspace ───────────┐  │
│  │ src/spaces/personal/*           │   │ src/spaces/team/*                 │  │
│  │ Today Log Planner Projects      │   │ Inbox  My issues  Projects        │  │
│  │ Tasks Focus Stats               │   │ Board  Backlog  Sprints  Timeline │  │
│  │                                 │   │ Reports  Members  Settings        │  │
│  │ data: personalApi (api.ts)      │   │ data: teamApi(workspaceId)        │  │
│  └──────────────┬──────────────────┘   └──────────────┬────────────────────┘  │
│                 │       one-way bridge (read-only)    │                       │
│                 │  ◄── "assigned to me" + time logs ──┘                       │
│  ┌──────────────▼──────────────┐   ┌─────────────────▼────────────────────┐   │
│  │ mizan.db (personal, as now) │   │ workspaces/<id>/workspace.db (replica)│   │
│  └──────────────┬──────────────┘   └─────────────────┬────────────────────┘   │
│        phone companion (LAN/USB)          sync engine (ops) ──► host          │
└───────────────────────────────────────────────────────────────────────────────┘
                                                        │
                        ┌───────────────────────────────┴───────────────┐
                        │ Host: teammate's Mizan (LAN)  or  mizan-server │
                        └───────────────────────────────────────────────┘
```

## Storage: separate files, not separate rows

- **Personal:** `~/.config/com.salahudin.mizan/mizan.db`. It does not change. No team
  tables are ever added to it.
- **Each workspace:** `~/.local/share/mizan/workspaces/<workspace-id>/workspace.db`,
  plus `attachments/` and `outbox/` beside it. The file is a replica of what the host has.
- **Index of joined workspaces:** `~/.local/share/mizan/workspaces.json`. Each entry has
  id, name, host URL, the member's device key path, last sync cursor and accent colour.

Why files and not a `workspace_id` column in `mizan.db`:

1. **No accidental joins.** A team query physically cannot read personal tables, because they are in another file.
2. **Leaving is clean.** Leaving or deleting a workspace deletes one folder. Nothing personal is touched.
3. **Different sync, different rules.** The personal file keeps its simple row sync with the phone. Workspace files use the op log ([doc 4](04-sync-and-hosting.md)).
4. **Backups stay simple.** The daily snapshot (`backup.rs`) covers the personal file as now. Workspace replicas can always be rebuilt from the host, so they are only snapshotted when this machine *is* the host.

## Backend: data access moves to Rust for team data

Personal data keeps its current path (TypeScript → `tauri-plugin-sql`), so nothing
regresses. Team data does **not** use raw SQL from the frontend, because every write
must become a signed, permission-checked op:

```text
UI ──invoke("team_*")──► src-tauri/src/team/commands.rs
                          ├─ validate input + local permission check (cached role)
                          ├─ apply to workspace.db in one transaction
                          ├─ append op to outbox
                          └─ emit "team:changed" {workspaceId, entities}
sync worker ──push outbox / pull ops──► host
```

New Rust modules (one folder, `src-tauri/src/team/`):

| Module | Job |
|---|---|
| `mod.rs` | Opens and caches one `SqlitePool` per workspace and runs workspace migrations. |
| `schema.rs` | Workspace migrations (see [data model](02-data-model.md)). Separate from the personal `migrations()`. |
| `ops.rs` | Op type, hybrid logical clock (HLC), apply/merge rules, op signing. |
| `commands.rs` | `#[tauri::command]` handlers: `team_list_issues`, `team_create_issue`, `team_move_issue`, etc. |
| `sync.rs` | Background worker per workspace: push outbox, pull ops, WebSocket for live updates, backoff. |
| `host.rs` | LAN host mode: serves the sync API from this desktop (reuses the companion server's patterns). |
| `query.rs` | Issue search/filter compiler (MQL → SQL, see [features](03-features.md#search-and-filters)). |
| `bridge.rs` | Read-only "assigned to me" feed for the personal space, plus explicit worklog writes. |

`mizan-server` (server mode) is a separate binary in a Cargo workspace that **shares**
`team/schema.rs`, `team/ops.rs` and `team/query.rs` as a library crate (`mizan-team-core`),
so client and server apply ops identically.

## Frontend: code split by space

```text
src/
  shared/              # design system + generic widgets used by both spaces
    ui/                # Modal, Pixel, buttons, inputs (moved from components/)
    board/             # generic Board<T> extracted from views/Projects.tsx (dnd-kit)
    calendar/          # FullCalendar wrapper extracted from views/Planner.tsx
    DurationWheel.tsx, Palette.tsx, QuickCapture.tsx
  spaces/
    personal/          # today's views moved here unchanged: Today, Log, Planner, …
      api.ts           # today's src/lib/api.ts (personal only)
    team/
      api.ts           # typed wrappers around invoke("team_*") + event subscriptions
      views/           # Inbox, MyIssues, ProjectBoard, Backlog, Sprint, Timeline, Reports, Members, WorkspaceSettings
      components/      # IssueDetail, IssueRow, StatusPill, AssigneePicker, SprintHeader, FilterBar
  lib/                 # pure logic + tests (plan.ts, stats.ts, taskBreakdown.ts …)
```

Rules, enforced by an ESLint `no-restricted-imports` rule:

- `spaces/team/**` must not import `spaces/personal/**`, and the other way round.
- Both may import `shared/**` and `lib/**`.
- The bridge is the only crossing, and it goes through the Rust `bridge.rs` command, not an import.

### Routing

| Path | Space |
|---|---|
| `/`, `/log`, `/planner`, `/projects`, `/tasks`, `/focus`, `/stats`, `/settings` | Personal (unchanged, so existing shortcuts and bookmarks keep working) |
| `/w/:ws/inbox`, `/w/:ws/my`, `/w/:ws/p/:key/board`, `/w/:ws/p/:key/backlog`, `/w/:ws/p/:key/timeline`, `/w/:ws/i/:issueKey`, `/w/:ws/reports`, `/w/:ws/settings` | Team workspace `:ws` |

The sidebar renders the navigation of the active space only (see [UI](06-ui-and-ux.md)).

## The bridge

People live one day, not two. The bridge lets the personal planner see team
commitments without leaking anything back.

**Team → personal (read-only, automatic):**

- Personal **Today** and **Planner** can show a "Team" lane: open issues assigned to
  me in each joined workspace, with key, title, due date, sprint end and status.
  `bridge.rs` exposes `bridge_assigned_to_me()`, which reads the workspace replicas,
  never the network.
- You can **schedule** a team issue into your personal calendar. This creates a
  normal personal event with `ext_ref = "team:<workspaceId>:<issueId>"` (a new
  nullable column on personal `events`). The block itself is personal: teammates
  never see when you plan to work on it.
- Auto-plan may include team issues assigned to you (a setting, on by default).

**Personal → team (explicit, one action each):**

- After a focus session started on a team issue, Mizan asks: *"Log 1h 25m to
  ENG-42?"* Only if you confirm is a `worklog` op written to the workspace. Nothing
  else from the session crosses: not the blocked sites, not phone checks, not your
  notes.
- **Free/busy sharing** (off by default, per workspace): publishes only busy
  intervals for working hours (no titles) so a team calendar can show availability.

Nothing else crosses: no journal, check-ins, prayer times, personal tasks, stats
or focus history.

## Phone

- The personal phone companion stays as it is, and personal only.
- Team workspaces on the phone come later, as a "team" tab in the Android app that
  talks to the **host** directly with its own device key. The desktop never relays
  team data to the phone, so the personal companion never carries team traffic.

## Decisions locked in

1. Separate SQLite file per workspace. `mizan.db` gets no team tables (only `events.ext_ref`).
2. Team reads and writes go through Rust commands, never raw SQL from TypeScript.
3. A shared Rust crate (`mizan-team-core`) for schema, ops and queries, used by the desktop and the server.
4. The frontend is split into `shared/`, `spaces/personal/` and `spaces/team/`, with lint-enforced boundaries.
5. Personal routes keep their current paths. Team routes live under `/w/:ws/…`.
6. The bridge is read-only from team to personal. Time logs and free/busy go back only by explicit opt-in.
