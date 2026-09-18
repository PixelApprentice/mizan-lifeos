# 2. Data model

The schema of a **workspace database** (`workspace.db`). The personal `mizan.db` is
unchanged except for one nullable column (`events.ext_ref`, see the
[bridge](01-architecture.md#the-bridge)).

## Conventions

- **IDs** are ULIDs stored as `TEXT` (sortable, generated offline, globally unique).
  There are no autoincrement IDs, because replicas create rows offline and must never collide.
- **Human keys:** projects have a `key` (`ENG`). Issues get `number` per project, so
  the display key is `ENG-42`. Numbers are assigned by the **host** when it accepts the
  create op. Until then the client shows `ENG-?` with a temporary local label. This is
  how Linear and Jira avoid duplicate numbers.
- **Timestamps:** `TEXT` ISO-8601 UTC. Every mutable table has `created_at`,
  `created_by`, `updated_at` and `deleted_at` (soft delete. The op log, not tombstones, is the history).
- **Ordering:** `rank TEXT`, a fractional index string (for example `"a0V"`).
  Inserting between two items needs no renumbering, so two people reordering at once
  never rewrite each other's rows. The personal board's `position REAL` works the same way.
- **JSON columns** (`TEXT` containing JSON) are only used for open-ended data
  (custom field values, automation rules). Everything that is queried often is a real column.

## Entity map

```text
workspace ─┬─ member ── device
           ├─ team (group of members)
           ├─ issue_type          ┌─ status (per workflow)
           ├─ workflow ───────────┴─ transition
           ├─ field (custom field definitions)
           ├─ label
           └─ project ─┬─ component
                       ├─ version (release)
                       ├─ sprint
                       ├─ board (saved board config)
                       └─ issue ─┬─ issue (parent: epic → story → subtask)
                                 ├─ issue_link (blocks / relates / duplicates)
                                 ├─ comment ── reaction
                                 ├─ attachment
                                 ├─ watcher
                                 ├─ worklog
                                 └─ field_value
op_log · activity · notification · saved_filter · automation · invite
```

## Tables

### Workspace and people

```sql
CREATE TABLE workspace (            -- exactly one row
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL,
  host_url TEXT,                    -- null when this desktop is the LAN host
  settings TEXT NOT NULL DEFAULT '{}',  -- working days, default workflow, estimation unit
  created_at TEXT NOT NULL, created_by TEXT NOT NULL
);

CREATE TABLE member (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL, email TEXT, avatar TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member','guest','viewer')),
  status TEXT NOT NULL DEFAULT 'active',     -- active | invited | deactivated
  timezone TEXT, capacity_hours_week REAL,   -- for workload view
  joined_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE device (                -- a member may have several (desktop, phone)
  id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES member(id),
  public_key TEXT NOT NULL,          -- Ed25519, signs ops (doc 4)
  label TEXT, last_seen_at TEXT, revoked_at TEXT
);

CREATE TABLE team (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE team_member (team_id TEXT NOT NULL, member_id TEXT NOT NULL, PRIMARY KEY (team_id, member_id));

CREATE TABLE invite (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, role TEXT NOT NULL,
  email TEXT, expires_at TEXT NOT NULL, used_by TEXT, created_by TEXT NOT NULL
);
```

### Projects and configuration

```sql
CREATE TABLE project (
  id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE,      -- ENG
  name TEXT NOT NULL, description TEXT DEFAULT '',
  lead_id TEXT REFERENCES member(id),
  method TEXT NOT NULL DEFAULT 'kanban',               -- kanban | scrum
  workflow_id TEXT NOT NULL REFERENCES workflow(id),
  visibility TEXT NOT NULL DEFAULT 'workspace',        -- workspace | private (members listed in project_member)
  next_number INTEGER NOT NULL DEFAULT 1,              -- host-only counter
  color TEXT, icon TEXT, start_date TEXT, target_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',               -- active | paused | completed | archived
  created_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE project_member (project_id TEXT, member_id TEXT, role TEXT, PRIMARY KEY (project_id, member_id));

CREATE TABLE issue_type (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,            -- Epic, Story, Task, Bug, Subtask
  level INTEGER NOT NULL,                             -- 2 epic, 1 standard, 0 subtask: parent must be one level up
  icon TEXT, color TEXT, workflow_id TEXT REFERENCES workflow(id)  -- optional override
);

CREATE TABLE workflow (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE status (
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflow(id),
  name TEXT NOT NULL, category TEXT NOT NULL CHECK (category IN ('todo','doing','done','canceled')),
  rank TEXT NOT NULL, wip_limit INTEGER, color TEXT
);
CREATE TABLE transition (            -- empty table for a workflow = any status → any status
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL,
  from_status TEXT,                  -- null = from any
  to_status TEXT NOT NULL, name TEXT,
  rules TEXT NOT NULL DEFAULT '{}'   -- e.g. {"require":["assignee"],"roles":["member"]}
);

CREATE TABLE field (                 -- custom field definitions
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  type TEXT NOT NULL,                -- text | number | date | select | multiselect | member | url | checkbox
  options TEXT DEFAULT '[]',         -- for select types: [{id,label,color}]
  scope TEXT DEFAULT '{}',           -- {"projects":[...],"issueTypes":[...]}; empty = everywhere
  rank TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE label (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT);
CREATE TABLE component (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, lead_id TEXT);
CREATE TABLE version (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
  start_date TEXT, release_date TEXT, status TEXT NOT NULL DEFAULT 'unreleased'  -- unreleased | released | archived
);
```

### Issues

```sql
CREATE TABLE issue (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id),
  number INTEGER,                     -- null until the host assigns it
  type_id TEXT NOT NULL REFERENCES issue_type(id),
  parent_id TEXT REFERENCES issue(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',   -- Markdown
  status_id TEXT NOT NULL REFERENCES status(id),
  resolution TEXT,                    -- done | wont_do | duplicate (set when category becomes done/canceled)
  priority INTEGER NOT NULL DEFAULT 3,    -- 0 urgent, 1 high, 2 medium, 3 none, 4 low
  assignee_id TEXT REFERENCES member(id),
  reporter_id TEXT NOT NULL REFERENCES member(id),
  sprint_id TEXT REFERENCES sprint(id),
  estimate REAL,                      -- story points or hours, per workspace setting
  remaining REAL,
  start_date TEXT, due_date TEXT,
  rank TEXT NOT NULL,                 -- global backlog/board order
  completed_at TEXT,
  created_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  UNIQUE (project_id, number)
);
CREATE INDEX issue_board ON issue(project_id, status_id, rank) WHERE deleted_at IS NULL;
CREATE INDEX issue_assignee ON issue(assignee_id, status_id) WHERE deleted_at IS NULL;
CREATE INDEX issue_sprint ON issue(sprint_id) WHERE deleted_at IS NULL;
CREATE INDEX issue_parent ON issue(parent_id);

CREATE TABLE issue_label (issue_id TEXT, label_id TEXT, PRIMARY KEY (issue_id, label_id));
CREATE TABLE issue_component (issue_id TEXT, component_id TEXT, PRIMARY KEY (issue_id, component_id));
CREATE TABLE issue_version (issue_id TEXT, version_id TEXT, kind TEXT, PRIMARY KEY (issue_id, version_id, kind)); -- kind: fix | affects
CREATE TABLE field_value (issue_id TEXT, field_id TEXT, value TEXT, PRIMARY KEY (issue_id, field_id));          -- value is JSON

CREATE TABLE issue_link (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('blocks','relates','duplicates','clones')),
  created_at TEXT NOT NULL, created_by TEXT NOT NULL, deleted_at TEXT
);

CREATE TABLE checklist_item (         -- lightweight steps, like personal "Break into steps"
  id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
  rank TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
```

Subtasks are issues with a level-0 type and a parent. A checklist item is lighter
(no assignee or status). This matches how teams use Jira subtasks compared with Asana checklists.

### Planning

```sql
CREATE TABLE sprint (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, goal TEXT DEFAULT '',
  state TEXT NOT NULL DEFAULT 'planned',   -- planned | active | closed
  start_date TEXT, end_date TEXT, closed_at TEXT,
  committed REAL,                          -- points at start, for velocity
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE sprint_snapshot (             -- one row per day per active sprint, for burndown
  sprint_id TEXT, day TEXT, scope REAL, done REAL, PRIMARY KEY (sprint_id, day)
);

CREATE TABLE board (                       -- saved board/list configurations
  id TEXT PRIMARY KEY, project_id TEXT, name TEXT NOT NULL,
  kind TEXT NOT NULL,                      -- board | list | timeline | calendar
  filter TEXT NOT NULL DEFAULT '',         -- MQL (doc 3)
  config TEXT NOT NULL DEFAULT '{}',       -- columns→statuses, swimlanes, card fields, WIP
  owner_id TEXT, shared INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE saved_filter (id TEXT PRIMARY KEY, name TEXT NOT NULL, query TEXT NOT NULL, owner_id TEXT NOT NULL, shared INTEGER DEFAULT 0);
```

### Collaboration

```sql
CREATE TABLE comment (
  id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, author_id TEXT NOT NULL,
  body TEXT NOT NULL,                      -- Markdown with @mentions as <@memberId>
  created_at TEXT NOT NULL, edited_at TEXT, deleted_at TEXT
);
CREATE TABLE reaction (comment_id TEXT, member_id TEXT, emoji TEXT, PRIMARY KEY (comment_id, member_id, emoji));
CREATE TABLE attachment (
  id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT, size INTEGER,
  sha256 TEXT NOT NULL,                    -- content-addressed blob on the host; replicas fetch on demand
  uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE watcher (issue_id TEXT, member_id TEXT, PRIMARY KEY (issue_id, member_id));
CREATE TABLE worklog (
  id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, member_id TEXT NOT NULL,
  started_at TEXT NOT NULL, minutes INTEGER NOT NULL, note TEXT DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual'    -- manual | focus (from the personal bridge)
);
```

### History, notifications, automation

```sql
CREATE TABLE op_log (                      -- every accepted change, append-only (doc 4)
  seq INTEGER PRIMARY KEY,                 -- host-assigned order; null-free on replicas after pull
  op_id TEXT NOT NULL UNIQUE, device_id TEXT NOT NULL, member_id TEXT NOT NULL,
  hlc TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL,
  kind TEXT NOT NULL,                      -- create | set | add | remove | delete | move
  field TEXT, value TEXT,                  -- JSON
  sig TEXT NOT NULL
);
CREATE TABLE outbox (op_id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL, attempts INTEGER DEFAULT 0);
CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT);   -- last_seq, host_id, schema_version

CREATE VIEW activity AS                    -- the issue "History" tab is a view over op_log
  SELECT seq, member_id, entity, entity_id, kind, field, value, hlc FROM op_log;

CREATE TABLE notification (                -- local to each replica, per member, never synced to others
  id TEXT PRIMARY KEY, member_id TEXT NOT NULL, issue_id TEXT, reason TEXT NOT NULL,  -- assigned | mentioned | commented | status | due
  seq INTEGER, read_at TEXT, created_at TEXT NOT NULL
);

CREATE TABLE automation (
  id TEXT PRIMARY KEY, project_id TEXT, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  trigger TEXT NOT NULL,                   -- JSON: {"on":"status_changed","to":"done"}
  conditions TEXT NOT NULL DEFAULT '[]',   -- JSON, MQL fragments
  actions TEXT NOT NULL,                   -- JSON: [{"set":"assignee","to":"reporter"}]
  created_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
```

Notifications are derived locally from pulled ops ("an op assigned an issue to me"),
so the host doesn't need a per-user notification queue and no extra data is sent.

## Default seed for a new workspace

| Item | Default |
|---|---|
| Issue types | Epic (2), Story (1), Task (1), Bug (1), Subtask (0) |
| Workflow "Default" | Backlog (todo) → To do (todo) → In progress (doing) → In review (doing) → Done (done), plus Canceled (canceled). Any-to-any transitions. |
| Priorities | Urgent, High, Medium, None, Low |
| Estimation | Story points (workspace setting: points or hours) |
| First project | The key is derived from the name (`Acme Engineering` → `AE`), and it can be edited. |

## Mapping from the personal model

Importing a personal project into a workspace is an explicit, one-time **copy**
(**Share to workspace…**), never a live link:

| Personal (`mizan.db`) | Team (`workspace.db`) |
|---|---|
| `projects.name / goal / color / due` | `project.name / description / color / target_date` |
| `tasks.title / notes` | `issue.title / description` (type Task) |
| `tasks.status` open / doing / done | default workflow To do / In progress / Done |
| `tasks.priority` 1 / 2 / 3 | 1 High / 2 Medium / 4 Low |
| `tasks.est_min` | `issue.estimate` in hours (or 1 point per 60 min) |
| `tasks.parent_id` (steps) | `checklist_item` rows |
| `tasks.position` | `issue.rank` (re-encoded as fractional strings in the same order) |
| `tasks.kind` | a label (`code`, `study`, …) |

The personal originals stay. Only what you choose is copied.

## Decisions locked in

1. ULID text keys everywhere. The host assigns human issue numbers.
2. Fractional-index `rank` strings for every ordered list.
3. Soft deletes plus an append-only `op_log`. Activity history is a view, not a second store.
4. Statuses belong to workflows and carry a fixed `category`, so reports work across custom workflows.
5. Notifications are computed per replica from ops, never synced.
6. Personal → team import is a one-time copy, and you choose what to copy.
