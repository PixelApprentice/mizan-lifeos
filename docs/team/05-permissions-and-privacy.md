# 5. Permissions and privacy

Two separate concerns:

1. **Inside a workspace:** who can see and change what.
2. **Between spaces:** what may move between your personal data and a team. The short answer is almost nothing.

## Workspace roles

| Role | Typical person | Summary |
|---|---|---|
| **Owner** | Whoever created the workspace (it can be transferred) | Everything, including deleting the workspace, moving the host and billing (if it ever exists). |
| **Admin** | Team lead, IT | Manage members, roles, workflows, fields, automations and all projects. |
| **Member** | Teammates | Create and edit issues in projects they can access, comment, run sprints if they are the project lead. |
| **Guest** | Client, contractor | Only the projects they are explicitly added to. They can comment and edit issues assigned to them, and cannot see the member list beyond those projects. |
| **Viewer** | Stakeholder | Read-only on accessible projects, and can comment if the project allows it. |

**Project-level roles** (`project_member.role`, optional) can raise a person inside one
project: `lead` (manages sprints, board config and project settings) or `member`.
They never lower the workspace role, which keeps the model easy to reason about.

**Private projects** (`visibility = 'private'`) are visible only to project members
and admins. The host never sends their ops to other replicas (filtered pull), so
privacy doesn't depend on client UI.

## Permission matrix

✓ = allowed · ◐ = only own or assigned items · – = not allowed

| Action | Owner | Admin | Member | Guest | Viewer |
|---|---|---|---|---|---|
| View accessible projects | ✓ | ✓ | ✓ | ✓ (invited projects) | ✓ |
| Create issues | ✓ | ✓ | ✓ | ✓ | – |
| Edit issue fields | ✓ | ✓ | ✓ | ◐ | – |
| Transition status | ✓ | ✓ | ✓ (per workflow rules) | ◐ | – |
| Delete issues | ✓ | ✓ | ◐ (created by me) | – | – |
| Comment | ✓ | ✓ | ✓ | ✓ | per project setting |
| Edit or delete others' comments | ✓ | ✓ | – | – | – |
| Log work | ✓ | ✓ | ✓ | ◐ | – |
| Manage sprints | ✓ | ✓ | project lead | – | – |
| Board and list configuration (shared) | ✓ | ✓ | project lead | – | – |
| Personal saved views | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create projects | ✓ | ✓ | workspace setting | – | – |
| Workflows, fields, issue types | ✓ | ✓ | – | – | – |
| Automations | ✓ | ✓ | project lead (project scope) | – | – |
| Invite people | ✓ | ✓ | workspace setting (as member/guest) | – | – |
| Change roles, deactivate members | ✓ | ✓ (not owners) | – | – | – |
| Export workspace | ✓ | ✓ | – | – | – |
| Move host, delete workspace | ✓ | – | – | – | – |

**Enforcement:** the host checks every incoming op against this matrix (in
`mizan-team-core`, so the logic is identical everywhere). The client runs the same
check first to disable buttons and avoid a round-trip, but the host is the
authority. A modified client can't bypass it.

## Audit

- Every change is an op signed by a device and attributed to a member. The issue **History** tab shows it.
- Admin changes (roles, invites, workflows, automations, exports) are shown in **Settings → Audit log**, which is a filter over `op_log`.
- Ops are never rewritten. A GDPR-style member removal **anonymises** the member (name → "Former member", email cleared) while keeping the history consistent.

## The personal/team boundary

These rules are hard requirements. Each has a test in the roadmap.

| # | Rule | How it's enforced |
|---|---|---|
| P1 | No team code reads `mizan.db`. | Separate files. `team/*` Rust modules get a workspace pool only, and the personal pool type is not exported to them. The ESLint import boundary covers the frontend. |
| P2 | Nothing personal is sent to a team host automatically. | The sync worker only reads the workspace `outbox`. A test asserts that ops can only be produced by `team/commands.rs`. |
| P3 | Time logs from focus need confirmation. | The bridge creates worklogs only through a user-confirmed command. The confirmation shows exactly what is sent (issue key, minutes, start time). |
| P4 | Free/busy is opt-in per workspace and never includes titles. | It is off by default. When on, only `{start, end}` intervals within working hours are published. |
| P5 | Personal calendar blocks for team issues stay personal. | Scheduling an issue writes to `mizan.db` (`events.ext_ref`). No op is created. |
| P6 | The personal phone companion never carries team data. | The companion server routes are personal only. The phone joins workspaces with its own device key. |
| P7 | Leaving a workspace removes all its local data. | Delete the workspace folder and keyring entry. Personal events with an `ext_ref` keep their own title and lose the link. |
| P8 | Team data never appears in personal stats or exports. | Personal stats and exports query `mizan.db` only. Team reports are a separate view. |
| P9 | Screen sharing is safe. | Switching spaces fully swaps the navigation and content, and the active space's name and colour are always visible (see [UI](06-ui-and-ux.md)), so you know which space is on screen. |

What a teammate can learn about you: your profile (name, avatar, timezone),
what you do in the workspace (issues, comments, worklogs you chose to log), and
free/busy blocks only if you turned that on. Nothing else.

## Data ownership and export

- An owner or admin can export the whole workspace at any time: JSON (entities plus
  op log) and attachments, or a SQLite file. There is no lock-in.
- Each member can export their own contributions (comments, worklogs, created issues).
- Deleting a workspace (owner only) deletes it on the host. Replicas delete their copy on next contact.

## Threat model (v1)

| Threat | Mitigation |
|---|---|
| Someone sniffing traffic on office Wi-Fi | TLS with pinned fingerprint |
| Lost laptop | Revoke its device. Its key can no longer sign accepted ops. The replica on disk is protected by OS disk encryption (recommend full-disk encryption). |
| Malicious member forges history | Ops are signed per device. The host rejects unsigned or invalid ops. |
| Malicious client bypasses UI rules | The host enforces permissions |
| Compromised host | It can read the workspace (no E2E in v1). Mitigations: self-host on trusted hardware, keep backups. E2E mode is *Later*. |
| Guest discovers private projects | Filtered pull. Private project ops are never sent. |

## Decisions locked in

1. Five workspace roles plus an optional project lead. No per-field permission schemes.
2. The host enforces permissions with the same core library the client uses.
3. Private projects are filtered on the host, not hidden by the client.
4. The nine boundary rules P1–P9 above are requirements, each with a test.
5. Full export is always available to owners and admins.
