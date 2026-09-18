# 4. Sync and hosting

How several people share one workspace while each keeps a full offline copy.

## Why personal sync isn't enough

Personal sync (migration v3) sends whole rows, and the newest `updated_at` wins.
That is fine for one person with a phone. For a team it breaks:

| Problem | Example |
|---|---|
| Whole-row overwrite | Ana changes the status of ENG-42 while Ben edits its title offline. Ben syncs later, and his old status overwrites Ana's. |
| Clock skew | A laptop with a clock 5 minutes fast wins every conflict. |
| No identity | Rows don't record *who* changed them, so there is no history, permission check or notification. |
| No authority | Anyone with the pairing code can change anything. |

Team sync therefore uses an **operation log** with field-level merging, signed
by devices and ordered by a host.

## Hosting modes

A workspace has exactly one host. You pick it when creating the workspace, and you can migrate it later.

| | **LAN host** | **Server host** |
|---|---|---|
| What | One teammate's Mizan desktop serves the workspace | `mizan-server`, a single binary on any Linux box, VPS or NAS |
| Best for | 2–8 people in one office or home, no IT | Remote teams, always-on, more than 8 people |
| Reachability | Same LAN, hotspot or VPN (Tailscale/WireGuard) | Anywhere (HTTPS) |
| Availability | Only while that desktop runs. Others keep working offline and sync later. | Always |
| Setup | Settings → Workspaces → **Host on this computer** | `mizan-server init && mizan-server run` (or Docker), TLS via a reverse proxy or the built-in ACME |
| Storage | `workspace.db` on that desktop (plus daily snapshots) | SQLite by default; Postgres optional for large orgs |

Both speak the **same HTTP + WebSocket protocol**, so the client doesn't care.
Moving from a LAN host to a server is "export op log → import on server → re-point members"
(Settings → **Move host…**).

There is no Mizan-run cloud. A hosted offering could exist later as just another server host.

## The operation (op)

```json
{
  "op_id": "01J9Z6Q8M7Z1TQ4N5B0K8G2W3D",
  "ws": "01J9Z5...",
  "device": "dev_7f3a...",
  "member": "mem_2b91...",
  "hlc": "2025-10-06T09:14:03.112Z/0003/dev_7f3a",
  "entity": "issue",
  "id": "01J9Z6P...",
  "kind": "set",
  "field": "status_id",
  "value": "st_inprogress",
  "base": "st_todo",
  "sig": "ed25519:..."
}
```

| `kind` | Meaning | Merge rule |
|---|---|---|
| `create` | Whole new entity (value = all fields) | IDs are ULIDs, so creates never conflict |
| `set` | One scalar field | **Field-level last-writer-wins by HLC.** Different fields never conflict. |
| `add` / `remove` | Set membership (labels, watchers, components) | Add-wins observed-remove set: concurrent add and remove of the same label keeps it |
| `move` | `rank` and optionally `status_id`/`sprint_id` together | LWW on the pair, so a card can't end up half-moved |
| `delete` | Soft delete (`deleted_at`) | Delete wins over concurrent `set`. Restore is a new `set deleted_at = null`. |
| `text` | Description or comment body edits | MVP: LWW of the whole text, with the losing version kept as a revision. v2: a Yjs/Automerge document per description for true concurrent editing. |

**HLC (hybrid logical clock):** `physical time / counter / device`. Each device
advances its clock past any HLC it receives, so ordering stays causal even with skewed
clocks, and ties are broken by device ID. This fixes the clock-skew problem above.

`base` (the value the author saw) lets the client detect a real conflict
(someone else changed the same field in between) and show it in the issue history:
*"Ben's status change (To do → Done) was replaced by Ana's (→ In review)."*
Nothing is silently lost.

## Protocol

```text
Client                                         Host
  │  POST /v1/ws/:id/ops      [op, op, …] ───►  validate sig, member active, permission, schema
  │                                             assign seq, append op_log, apply, run automation
  │  ◄── 200 {accepted:[{op_id,seq,number?}], rejected:[{op_id,reason}]}
  │
  │  GET  /v1/ws/:id/ops?after=<seq>&limit=1000 ─► ops in seq order (cursor pagination)
  │
  │  WS   /v1/ws/:id/live ◄── {"seq": 18231} pings on every accepted op → client pulls
  │
  │  GET  /v1/ws/:id/snapshot ─► zstd SQLite file at seq N (fast first join, then pull after N)
  │  PUT/GET /v1/ws/:id/blobs/:sha256 ─► attachments, content-addressed
```

Client loop (`team/sync.rs`, one task per workspace):

1. A local edit is applied to the replica immediately (optimistic) and appended to `outbox`.
2. Push the outbox in batches. Accepted ops leave the outbox and get their `seq`.
   **Rejected** ops are rolled back locally (re-derive the affected fields from `op_log`)
   and shown as a toast: *"You don't have permission to move issues in OPS."*
3. Pull everything after `last_seq` and apply it in order (idempotent by `op_id`).
4. Live: keep the WebSocket open. If it drops, back off (1 s → 60 s) and pull on reconnect.
   Offline is the normal state, not an error.

Issue numbers: a `create` op is accepted with `number` assigned by the host. Until
then the UI shows `ENG-?`. References typed offline use the ULID internally.

## Identity and joining

- **Device keys:** each device creates an Ed25519 key pair on first join. The private
  key is stored in the OS keyring (Secret Service on Linux, Android Keystore on phones).
  Every op is signed, so the host can verify who did what, and a stolen replica can't
  forge history.
- **Invite:** an admin creates an invite (role, optional email, expiry 7 days). It is
  shared as a **link or QR**: `mizan://join?host=https://pm.acme.dev&ws=…&invite=…&fp=<cert sha256>`.
  This is the same QR flow as the phone companion.
- **Join:** the device posts its public key plus the invite token. The host creates a
  `member` and `device` and returns a session token. The first sync downloads a snapshot.
- **More devices:** an existing device approves a new one ("Add this phone") with a
  short-lived QR, so there is no password.
- **Server accounts (optional):** email + passkey on `mizan-server` for teams that
  want web-style login and SSO (OIDC) later.
- **Revoke:** deactivating a member or device stops the host from accepting or serving its ops immediately.

## Transport security

- **Server host:** HTTPS is required. The QR carries the certificate fingerprint
  (`fp`), so self-signed certificates on a NAS work safely through pinning.
- **LAN host:** the desktop generates a self-signed certificate on first host start,
  and its fingerprint goes in the invite QR. Unlike the personal companion (plain HTTP,
  [evaluation](../evaluation.md)), team traffic is **always TLS**.
- Payloads are not end-to-end encrypted in v1: the host can read the workspace,
  just as a Jira admin can. An E2E mode, where the host only orders opaque ops, is
  listed as *Later* because it makes server-side automation and search impossible.

## Partial replicas (v2)

Small and medium workspaces (up to about 50k issues) replicate fully. For large ones
a member can subscribe per project. The host then filters pulls to subscribed and
permitted projects, and private projects are never sent to non-members (see doc 5).

## Failure cases

| Case | Behaviour |
|---|---|
| Host offline | Everyone keeps working. Ops wait in the outbox, and the UI shows "Offline · 12 changes waiting". |
| Two people edit the same field offline | Field LWW by HLC. The loser is visible in history. |
| One deletes, the other edits | The delete wins. The edit is shown in history and the issue can be restored. |
| Host disk dies | Any replica can **promote** itself: it exports its op log, and an admin re-hosts from it. Ops pushed by others after that replica's last pull are lost, so server hosts should run backups (`mizan-server backup`, daily). |
| Schema upgrade | The host announces `schema_version`. Older clients get read-only mode with an "Update Mizan" banner until they upgrade. |
| Replica corrupted | Delete the workspace folder, re-join and download a snapshot. |

## Personal phone sync later

Once the op engine exists, personal phone sync can move to it as well, which gives
field-level merging and fixes the "last-writer-wins" risk in [evaluation](../evaluation.md).
This is optional: the personal row sync keeps working, and the two never share a database.

## Decisions locked in

1. Signed, HLC-ordered, field-level ops. The host assigns `seq` and issue numbers.
2. One protocol for LAN host and server host. The client doesn't know which it uses.
3. Ed25519 device keys and QR/link invites. No passwords are required.
4. TLS always for team traffic, with fingerprint pinning from the QR.
5. Optimistic local apply, rollback on rejection, offline is normal.
