# 3. Features

What a team gets, compared with Jira and Asana. Each feature is tagged:

- **MVP**: needed before a real team can switch to Mizan (phases 1–3 of the [roadmap](07-roadmap.md)).
- **v2**: makes it competitive (phase 4).
- **Later**: nice to have, or only for big organisations.

## At a glance

| Area | Jira | Asana | Mizan teams |
|---|---|---|---|
| Work items | Issues, types, hierarchy | Tasks, subtasks, sections | Issues with types (epic/story/task/bug/subtask) and checklists. **MVP** |
| Boards | Scrum and Kanban | Board view | Kanban per project with swimlanes and WIP limits. **MVP** |
| Backlog and sprints | Yes | No (goals and portfolios instead) | Backlog, sprint planning, active sprint, close-out. **MVP** |
| List view | Issue navigator | List | Sortable, groupable table with inline edit. **MVP** |
| Timeline | Advanced Roadmaps | Timeline/Gantt | Epics and issues on a timeline with dependencies. **v2** |
| Calendar | Plugin | Calendar | Due dates and sprints on the shared calendar component. **v2** |
| Workload | Plugin/Advanced | Workload | Assigned estimate vs capacity per person per week. **v2** |
| Search | JQL | Advanced search | MQL (a small JQL-like language) plus a filter bar. **MVP** (filter bar), **v2** (MQL text) |
| Reports | Burndown, velocity, CFD… | Dashboards | Burndown, velocity, cumulative flow, cycle time. **v2** |
| Automation | Rules | Rules | Trigger → condition → action rules. **v2** |
| Forms / intake | Service desk | Forms | Public form → issue in a project. **Later** |
| Goals / OKRs | Atlas | Goals | Goals linked to epics with progress roll-up. **Later** |
| Time tracking | Worklogs | Paid add-on | Worklogs, filled from personal focus via the bridge. **MVP** |
| Offline | No | No | Full offline replica. **MVP** (the main differentiator) |
| Hosting | Atlassian Cloud / DC | Asana Cloud | Self-hosted or a teammate's desktop, no vendor account. **MVP** |

## Work items

**Issue detail** (side panel, or a full page at `/w/:ws/i/ENG-42`):

- Title, Markdown description with image paste, status, assignee, priority,
  estimate, sprint, labels, due date, parent and custom fields.
- Tabs: **Comments** (with @mentions and reactions), **History** (from `op_log`),
  **Worklog**, **Links**.
- Child issues and checklist. **Break into steps** reuses the personal
  `taskBreakdown.ts` and creates checklist items, or subtasks if you choose.
- Copy link, copy branch name (`eng-42-fix-login-redirect`), and watch or unwatch.

**Creating issues:**

- `C` anywhere, or quick capture (`Ctrl+Shift+K`) with a space picker.
- Inline "+ add issue" at the bottom of any board column or list group.
- Paste a list → one issue per line (the same parser as personal steps).
- Templates per issue type (bug template: steps to reproduce / expected / actual).

**Bulk edit:** multi-select rows (Shift/Ctrl-click, or `X` on keyboard focus), then
set status, assignee, sprint, labels or priority, or delete.

## Boards (MVP)

- Columns map to one or more statuses. The default is one column per status.
- **Drag to reorder** inside a column (changes `rank`) and **across** columns (changes
  status, after checking that the transition is allowed). The dnd-kit code from
  `views/Projects.tsx` becomes the shared `Board<T>`, including the column height cap
  and internal scroll.
- **Swimlanes:** none, assignee, epic, priority, or a custom select field.
- **WIP limits** per column: the header turns amber at the limit and red above it.
  It warns but doesn't block, as in Jira.
- **Card fields:** choose which to show (key, assignee avatar, estimate, labels, due
  date, checklist progress).
- **Quick filters:** "Only my issues", "Recently updated", label chips.

## Backlog and sprints (MVP for Scrum projects)

- The backlog is a ranked list. Sprints are collapsible groups above it, and you drag
  issues between them.
- **Plan a sprint:** name, goal and dates (default two weeks from the workspace
  setting). The header shows committed points and team capacity.
- **Start sprint:** stores `committed` and begins daily `sprint_snapshot` rows. The
  host writes them at local midnight, and a replica writes them if it is the LAN host.
- **Close sprint:** unfinished issues go to the next sprint or the backlog (you
  choose). Velocity is recorded.
- The active sprint view is the board filtered to the sprint, with days left and a
  mini burndown.

## List view (MVP)

- A virtualized table (thousands of rows stay smooth): key, title, status, assignee,
  priority, estimate, sprint, due, updated, and custom fields as columns.
- Group by status, assignee, epic, sprint or label. Sort by any column. Edit any cell inline.
- Saved as a `board` row with `kind = 'list'`, so lists can be shared like boards.

## Timeline (v2)

- Epics as bars from start to target date. Expand an epic to see its issues, and
  drag bar ends to change dates.
- Dependencies come from `issue_link` rows of kind `blocks` and are drawn as arrows.
  A warning appears when a blocked item starts before its blocker ends.
- Versions/releases show as vertical markers.
- Built on the same FullCalendar resource-timeline approach the personal Planner uses,
  or a small custom SVG renderer if FullCalendar's license for resource views doesn't fit.

## Personal views inside a workspace

- **Inbox** (MVP): notifications (assigned, mentioned, commented, status changes on
  watched issues). `E` marks read and `Enter` opens.
- **My issues** (MVP): everything assigned to me across projects, grouped by status,
  with due-soon highlighting.
- **Workload** (v2): per member and week, assigned estimate vs `capacity_hours_week`,
  with drag to reassign.

## Search and filters

**Filter bar (MVP):** chips for project, status category, assignee, label, priority,
sprint, type and due date, combined with AND. It is the same UX as the personal Tasks
filters (`workflows.ts`), extended.

**MQL (v2):** a small text language for power users and saved filters, compiled to SQL in Rust (`team/query.rs`):

```text
project = ENG AND status != Done AND assignee = me() ORDER BY priority, rank
type = Bug AND created >= -7d AND label IN (backend, api)
sprint = open() AND estimate IS EMPTY
parent = ENG-12 OR "Customer" = "Acme"
```

Functions: `me()`, `open()` (active sprint), `today()`, and relative dates (`-7d`, `+2w`).
Text search uses SQLite FTS5 over title, description and comments.

## Reports (v2)

| Report | Built from |
|---|---|
| Sprint burndown | `sprint_snapshot` (scope vs done per day) |
| Velocity | Committed vs completed points for the last N sprints |
| Cumulative flow | Daily count per status category (op_log replay, cached daily) |
| Cycle / lead time | Time from first `doing` to `done`, and from create to `done`. Shown as a scatter with percentiles |
| Throughput | Issues done per week by type |
| Created vs resolved | Two lines per week |

All reports are computed locally from the replica. They are pure functions with tests,
next to the personal `stats.ts`.

## Automation (v2)

Rules run **on the host** (so they fire once, not on every replica) after an op is accepted:

| Trigger | Condition (optional, MQL) | Action |
|---|---|---|
| Issue created | `type = Bug` | Set priority High, add label `triage` |
| Status → Done | `parent IS NOT EMPTY` | If all siblings are done, move the parent to Done |
| Assignee changed | — | Add assignee as a watcher |
| Due date passed | `status != Done` | Notify assignee and lead |
| Sprint started | — | Post a comment on each issue: "Added to Sprint 12" |
| Scheduled (cron) | `status = "In review" AND updated <= -3d` | Notify reviewer |

Each rule run creates ops signed by the host's system member (`automation`), so they
show up in history like any other change.

## Integrations (Later)

- **Git:** a branch or commit message containing `ENG-42` links to the issue, and
  `fixes ENG-42` moves it to Done on merge. This uses a webhook endpoint on `mizan-server`.
- **Import:** Jira CSV, Asana CSV, GitHub Issues and Trello JSON into a workspace.
- **Export:** a workspace to JSON plus attachments (always available, see doc 5).
- **Webhooks out:** POST on issue events for chat tools (Slack, Matrix, Discord).

## What we deliberately leave out

- No service-desk portal, no SLA engine, no marketplace or plugins in v1.
- No per-field permission schemes (Jira's most complex area). Roles plus private projects cover small and medium teams.
- No AI summaries that send text to third parties. If added later, they must be local and opt-in, the same rule as personal task breakdown.

## Decisions locked in

1. MVP = issues, kanban board, backlog and sprints, list, filter bar, inbox, my issues, comments, worklogs, offline replica, self-hosting.
2. Board, calendar and step-breakdown code is shared with the personal space, not forked.
3. Reports are local pure functions over the replica.
4. Automation runs only on the host.
