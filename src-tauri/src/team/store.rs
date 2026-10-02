// Team workspace storage and merge rules. One SQLite file per workspace, never the personal
// `mizan.db`: nothing in this module can reach personal data.
//
// The host keeps the authoritative op log and the merged rows. Every op carries a hybrid
// logical clock (HLC); fields merge independently, last writer wins by HLC, so two people
// editing different fields of the same issue offline both keep their change. Replicas keep a
// copy of the host's rows plus an outbox of their own unsent ops, which they show on top
// until the host accepts them.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions};
use sqlx::Row;
use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

/// Wire protocol between replicas and hosts. Bump on incompatible changes.
pub const PROTOCOL: u32 = 1;
/// Version of the workspace file layout, stored in `meta.schema`.
pub const SCHEMA: i64 = 1;

pub const ROLES: [&str; 4] = ["owner", "admin", "member", "viewer"];
pub const STATUSES: [&str; 6] = ["backlog", "todo", "in_progress", "in_review", "done", "canceled"];
pub const ISSUE_TYPES: [&str; 4] = ["epic", "story", "task", "bug"];

const SQL: &str = r#"
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rows (
    entity TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (entity, id));
CREATE INDEX IF NOT EXISTS rows_seq ON rows (seq);
CREATE TABLE IF NOT EXISTS clocks (
    entity TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL, hlc TEXT NOT NULL,
    PRIMARY KEY (entity, id, field));
CREATE TABLE IF NOT EXISTS ops (
    seq INTEGER PRIMARY KEY, op_id TEXT NOT NULL UNIQUE, member TEXT NOT NULL, hlc TEXT NOT NULL,
    entity TEXT NOT NULL, eid TEXT NOT NULL, kind TEXT NOT NULL, fields TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ops_eid ON ops (eid);
CREATE TABLE IF NOT EXISTS outbox (n INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT NOT NULL UNIQUE, op TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auth (
    member TEXT PRIMARY KEY, token_hash TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS invites (
    code_hash TEXT PRIMARY KEY, role TEXT NOT NULL, created_by TEXT NOT NULL, expires TEXT NOT NULL, used_by TEXT);
CREATE TABLE IF NOT EXISTS counters (project TEXT PRIMARY KEY, next INTEGER NOT NULL);
"#;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Op {
    pub op_id: String,
    pub hlc: String,
    pub entity: String,
    pub id: String,
    /// `create`, `set` or `delete`.
    pub kind: String,
    #[serde(default)]
    pub fields: Map<String, Value>,
    /// Set by the host from the authenticated member, never trusted from the client.
    #[serde(default)]
    pub member: String,
    #[serde(default)]
    pub seq: i64,
    #[serde(default)]
    pub at: String,
}

// ---------------- ids, clocks, secrets ----------------

pub fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    if getrandom::getrandom(&mut buf).is_err() {
        let seed = chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default() as u128 ^ (std::process::id() as u128) << 64;
        for (i, b) in buf.iter_mut().enumerate() {
            *b = (seed >> ((i % 16) * 8)) as u8;
        }
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Time-sortable random id (48-bit ms + 80 random bits), 32 hex chars.
pub fn new_id() -> String {
    format!("{:012x}{}", now_ms() as u64 & 0xffff_ffff_ffff, random_hex(10))
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

pub fn hash_secret(secret: &str) -> String {
    Sha256::digest(secret.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// `0001759740000000-0003-devicehex`. Fixed widths make string order equal clock order.
pub fn format_hlc(ms: i64, counter: u32, device: &str) -> String {
    format!("{:016}-{:04}-{}", ms.max(0), counter.min(9999), device)
}

pub fn parse_hlc(hlc: &str) -> Option<(i64, u32, &str)> {
    let mut parts = hlc.splitn(3, '-');
    let ms = parts.next().filter(|p| p.len() == 16)?.parse().ok()?;
    let counter = parts.next().filter(|p| p.len() == 4)?.parse().ok()?;
    let device = parts.next().filter(|d| !d.is_empty() && d.len() <= 40 && d.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))?;
    Some((ms, counter, device))
}

/// Next clock value after `last`, never behind wall time.
pub fn next_hlc(last: &str, device: &str) -> String {
    let now = now_ms();
    match parse_hlc(last) {
        Some((ms, counter, _)) if ms >= now => format_hlc(ms, counter + 1, device),
        _ => format_hlc(now, 0, device),
    }
}

// ---------------- opening ----------------

pub async fn open(path: &Path) -> Result<SqlitePool, String> {
    let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))
        .map_err(|e| e.to_string())?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(10));
    let pool = SqlitePoolOptions::new().max_connections(4).connect_with(options).await.map_err(|e| e.to_string())?;
    migrate(&pool).await?;
    Ok(pool)
}

#[cfg(test)]
pub async fn open_memory() -> Result<SqlitePool, String> {
    let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.map_err(|e| e.to_string())?;
    migrate(&pool).await?;
    Ok(pool)
}

async fn migrate(pool: &SqlitePool) -> Result<(), String> {
    sqlx::raw_sql(SQL).execute(pool).await.map_err(|e| e.to_string())?;
    let schema: i64 = get_meta(pool, "schema").await.parse().unwrap_or(0);
    if schema > SCHEMA {
        return Err(format!("This workspace was saved by a newer Mizan (layout {schema}). Update Mizan to open it."));
    }
    set_meta(pool, "schema", &SCHEMA.to_string()).await
}

pub async fn get_meta(pool: &SqlitePool, key: &str) -> String {
    sqlx::query_scalar::<_, String>("SELECT value FROM meta WHERE key = ?1")
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_default()
}

pub async fn set_meta(pool: &SqlitePool, key: &str, value: &str) -> Result<(), String> {
    sqlx::query("INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2")
        .bind(key)
        .bind(value)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ---------------- schema of entities ----------------

#[derive(Clone, Copy)]
enum Kind {
    Str(usize),
    OptStr(usize),
    Int(i64, i64),
    OptNum,
    Bool,
    Arr,
    OneOf(&'static [&'static str]),
}

fn fields_of(entity: &str) -> Option<&'static [(&'static str, Kind)]> {
    use Kind::*;
    const MEDIUMS: &[&str] = &["points", "hours"];
    const PROJECT_STATUS: &[&str] = &["active", "archived"];
    const SPRINT_STATE: &[&str] = &["planned", "active", "closed"];
    Some(match entity {
        "workspace" => &[("name", Str(80)), ("description", Str(2000)), ("members_create_projects", Bool), ("estimate_unit", OneOf(MEDIUMS))],
        "member" => &[("name", Str(80)), ("email", Str(200)), ("role", OneOf(&ROLES)), ("active", Bool), ("color", Str(16)), ("joined_at", Str(40)), ("device", Str(80))],
        "project" => &[
            ("key", Str(8)), ("name", Str(120)), ("description", Str(10_000)), ("color", Str(16)), ("lead", OptStr(40)),
            ("status", OneOf(PROJECT_STATUS)), ("target", OptStr(40)), ("created_at", Str(40)), ("created_by", Str(40)), ("deleted", Bool),
        ],
        "issue" => &[
            ("project_id", Str(40)), ("number", Int(1, i64::MAX)), ("type", OneOf(&ISSUE_TYPES)), ("title", Str(300)),
            ("description", Str(50_000)), ("status", OneOf(&STATUSES)), ("priority", Int(0, 4)), ("assignee", OptStr(40)),
            ("reporter", Str(40)), ("estimate", OptNum), ("due", OptStr(40)), ("labels", Arr), ("checklist", Arr),
            ("parent_id", OptStr(40)), ("sprint_id", OptStr(40)), ("rank", Str(64)), ("resolved_at", OptStr(40)),
            ("created_at", Str(40)), ("deleted", Bool),
        ],
        "sprint" => &[
            ("project_id", Str(40)), ("name", Str(120)), ("goal", Str(2000)), ("start", OptStr(40)), ("end", OptStr(40)),
            ("state", OneOf(SPRINT_STATE)), ("closed_at", OptStr(40)), ("created_at", Str(40)), ("deleted", Bool),
        ],
        "comment" => &[("issue_id", Str(40)), ("body", Str(20_000)), ("author", Str(40)), ("created_at", Str(40)), ("edited_at", OptStr(40)), ("deleted", Bool)],
        "worklog" => &[("issue_id", Str(40)), ("member", Str(40)), ("minutes", Int(1, 24 * 60)), ("date", Str(10)), ("note", Str(500)), ("created_at", Str(40)), ("deleted", Bool)],
        _ => return None,
    })
}

fn check_value(name: &str, kind: Kind, value: &Value) -> Result<(), String> {
    let ok = match kind {
        Kind::Str(max) => value.as_str().is_some_and(|s| s.chars().count() <= max),
        Kind::OptStr(max) => value.is_null() || value.as_str().is_some_and(|s| s.chars().count() <= max),
        Kind::Int(lo, hi) => value.as_i64().is_some_and(|n| n >= lo && n <= hi),
        Kind::OptNum => value.is_null() || value.as_f64().is_some_and(|n| n.is_finite() && (0.0..=10_000.0).contains(&n)),
        Kind::Bool => value.is_boolean(),
        Kind::Arr => value.as_array().is_some_and(|a| a.len() <= 200 && value.to_string().len() <= 50_000),
        Kind::OneOf(options) => value.as_str().is_some_and(|s| options.contains(&s)),
    };
    if ok {
        Ok(())
    } else {
        Err(format!("Invalid value for {name}."))
    }
}

/// Shape check: known entity, known fields, sane values, well-formed ids and clock.
pub fn validate(op: &Op) -> Result<(), String> {
    let fields = fields_of(&op.entity).ok_or_else(|| format!("Unknown kind of record: {}.", op.entity))?;
    let id_ok = |s: &str| !s.is_empty() && s.len() <= 40 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if !id_ok(&op.op_id) || !id_ok(&op.id) {
        return Err("Invalid id.".into());
    }
    if parse_hlc(&op.hlc).is_none() {
        return Err("Invalid clock.".into());
    }
    if !["create", "set", "delete"].contains(&op.kind.as_str()) {
        return Err("Invalid change kind.".into());
    }
    if op.kind != "delete" && op.fields.is_empty() {
        return Err("Empty change.".into());
    }
    for (name, value) in &op.fields {
        let kind = fields.iter().find(|(f, _)| f == name).map(|(_, k)| *k).ok_or_else(|| format!("Unknown field {name}."))?;
        check_value(name, kind, value)?;
    }
    if op.entity == "issue" && op.kind == "create" {
        for required in ["project_id", "title"] {
            if !op.fields.contains_key(required) {
                return Err(format!("A new issue needs {required}."));
            }
        }
        if op.fields.get("title").and_then(Value::as_str).is_some_and(|t| t.trim().is_empty()) {
            return Err("Give the issue a title.".into());
        }
    }
    if op.entity == "project" && op.kind == "create" {
        let key = op.fields.get("key").and_then(Value::as_str).unwrap_or_default();
        if key.len() < 2 || !key.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) || !key.starts_with(|c: char| c.is_ascii_uppercase()) {
            return Err("A project key is 2-8 capital letters or digits, starting with a letter (for example WEB).".into());
        }
    }
    Ok(())
}

// ---------------- permissions ----------------

pub fn rank_of(role: &str) -> u8 {
    match role {
        "owner" => 4,
        "admin" => 3,
        "member" => 2,
        "viewer" => 1,
        _ => 0,
    }
}

pub struct Ctx<'a> {
    pub member: &'a str,
    pub role: &'a str,
    pub row: Option<&'a Value>,
    /// Lead of the project the record belongs to, when it has one.
    pub lead: Option<&'a str>,
    pub members_create_projects: bool,
}

fn s<'a>(row: Option<&'a Value>, key: &str) -> Option<&'a str> {
    row.and_then(|r| r.get(key)).and_then(Value::as_str)
}

/// The permission matrix from docs/team/05-permissions-and-privacy.md (owner, admin,
/// member, viewer). The host is the authority; clients use the same rules to hide buttons.
pub fn allowed(op: &Op, c: &Ctx) -> Result<(), String> {
    let r = rank_of(c.role);
    let admin = r >= 3;
    let lead = c.lead == Some(c.member);
    let deny = |why: &str| Err(why.to_string());
    if r == 0 {
        return deny("You are not a member of this workspace.");
    }
    match op.entity.as_str() {
        "workspace" => if admin { Ok(()) } else { deny("Only owners and admins change workspace settings.") },
        "member" => {
            let own_profile = op.id == c.member && op.fields.keys().all(|k| ["name", "color", "email"].contains(&k.as_str()));
            if op.kind != "set" {
                return deny("Members join with an invite.");
            }
            if own_profile {
                return Ok(());
            }
            if !admin {
                return deny("Only owners and admins manage members.");
            }
            let target_owner = s(c.row, "role") == Some("owner");
            let makes_owner = op.fields.get("role").and_then(Value::as_str) == Some("owner");
            if (target_owner || makes_owner) && c.role != "owner" {
                return deny("Only an owner can change an owner.");
            }
            if op.id == c.member && op.fields.contains_key("role") {
                return deny("Ask another owner or admin to change your own role.");
            }
            Ok(())
        }
        "project" => match op.kind.as_str() {
            "create" if admin || (r >= 2 && c.members_create_projects) => Ok(()),
            "create" => deny("Only owners and admins create projects here."),
            _ if admin || lead => Ok(()),
            _ => deny("Only the project lead, owners and admins change a project."),
        },
        "sprint" => if admin || lead { Ok(()) } else { deny("Only the project lead, owners and admins manage sprints.") },
        "issue" => {
            if r < 2 {
                return deny("Viewers can comment but not edit issues.");
            }
            if op.kind == "delete" && !admin && s(c.row, "reporter") != Some(c.member) {
                return deny("You can delete issues you created. Ask an admin for others.");
            }
            Ok(())
        }
        "comment" => {
            if op.kind == "create" || admin || s(c.row, "author") == Some(c.member) {
                Ok(())
            } else {
                deny("You can only edit your own comments.")
            }
        }
        "worklog" => {
            if r < 2 {
                return deny("Viewers cannot log work.");
            }
            let owner = if op.kind == "create" { op.fields.get("member").and_then(Value::as_str) } else { s(c.row, "member") };
            if admin || owner == Some(c.member) {
                Ok(())
            } else {
                deny("You can only log your own work.")
            }
        }
        _ => deny("Unknown kind of record."),
    }
}

// ---------------- rows ----------------

pub async fn row(pool: &SqlitePool, entity: &str, id: &str) -> Option<Value> {
    let text: Option<String> = sqlx::query_scalar("SELECT data FROM rows WHERE entity = ?1 AND id = ?2")
        .bind(entity)
        .bind(id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
    text.and_then(|t| serde_json::from_str(&t).ok())
}

/// Field-level last-writer-wins. Returns true if anything changed.
async fn merge(tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>, op: &Op, seq: i64) -> Result<bool, sqlx::Error> {
    let current: Option<String> = sqlx::query_scalar("SELECT data FROM rows WHERE entity = ?1 AND id = ?2")
        .bind(&op.entity)
        .bind(&op.id)
        .fetch_optional(&mut **tx)
        .await?;
    let mut data: Map<String, Value> = current.and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let mut fields = op.fields.clone();
    if op.kind == "delete" {
        fields.insert("deleted".into(), json!(true));
    }
    let mut changed = false;
    for (field, value) in fields {
        let seen: Option<String> = sqlx::query_scalar("SELECT hlc FROM clocks WHERE entity = ?1 AND id = ?2 AND field = ?3")
            .bind(&op.entity)
            .bind(&op.id)
            .bind(&field)
            .fetch_optional(&mut **tx)
            .await?;
        if seen.as_deref().is_some_and(|seen| seen >= op.hlc.as_str()) {
            continue;
        }
        sqlx::query("INSERT INTO clocks (entity, id, field, hlc) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(entity, id, field) DO UPDATE SET hlc = ?4")
            .bind(&op.entity)
            .bind(&op.id)
            .bind(&field)
            .bind(&op.hlc)
            .execute(&mut **tx)
            .await?;
        data.insert(field, value);
        changed = true;
    }
    if changed {
        sqlx::query("INSERT INTO rows (entity, id, data, seq) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(entity, id) DO UPDATE SET data = ?3, seq = ?4")
            .bind(&op.entity)
            .bind(&op.id)
            .bind(Value::Object(data).to_string())
            .bind(seq)
            .execute(&mut **tx)
            .await?;
    }
    Ok(changed)
}

// ---------------- host ----------------

#[derive(Serialize, Debug, Default)]
pub struct PushResult {
    pub accepted: Vec<Value>,
    pub rejected: Vec<Value>,
}

pub struct Auth {
    pub member: String,
    pub role: String,
}

pub async fn authenticate(pool: &SqlitePool, token: &str) -> Option<Auth> {
    let row = sqlx::query("SELECT member, role FROM auth WHERE token_hash = ?1 AND active = 1")
        .bind(hash_secret(token))
        .fetch_optional(pool)
        .await
        .ok()??;
    Some(Auth { member: row.get("member"), role: row.get("role") })
}

/// Create a fresh hosted workspace with its owner. Returns the owner's member id.
pub async fn init_host(pool: &SqlitePool, ws_id: &str, name: &str, owner_name: &str, device: &str) -> Result<String, String> {
    let member = new_id();
    set_meta(pool, "ws_id", ws_id).await?;
    set_meta(pool, "mode", "host").await?;
    set_meta(pool, "member_id", &member).await?;
    set_meta(pool, "device", device).await?;
    sqlx::query("INSERT INTO auth (member, token_hash, role, active) VALUES (?1, ?2, 'owner', 1)")
        .bind(&member)
        .bind(hash_secret(&random_hex(32)))
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut ops = vec![
        local_op(pool, "workspace", "ws", "create", json!({ "name": name, "description": "", "members_create_projects": true, "estimate_unit": "points" })).await,
        local_op(pool, "member", &member, "create", json!({ "name": owner_name, "role": "owner", "active": true, "color": "#6ee7b7", "joined_at": now_iso(), "device": device })).await,
    ];
    for op in &mut ops {
        op.member = member.clone();
    }
    host_apply(pool, &member, "owner", ops, true).await?;
    Ok(member)
}

/// An op stamped with this device's clock.
pub async fn local_op(pool: &SqlitePool, entity: &str, id: &str, kind: &str, fields: Value) -> Op {
    let device = get_meta(pool, "device").await;
    let hlc = next_hlc(&get_meta(pool, "hlc").await, &device);
    let _ = set_meta(pool, "hlc", &hlc).await;
    Op {
        op_id: new_id(),
        hlc,
        entity: entity.into(),
        id: id.into(),
        kind: kind.into(),
        fields: fields.as_object().cloned().unwrap_or_default(),
        member: String::new(),
        seq: 0,
        at: String::new(),
    }
}

async fn workspace_flag(pool: &SqlitePool) -> bool {
    row(pool, "workspace", "ws").await.and_then(|w| w.get("members_create_projects").and_then(Value::as_bool)).unwrap_or(true)
}

async fn lead_of(pool: &SqlitePool, op: &Op, current: Option<&Value>) -> Option<String> {
    let project = match op.entity.as_str() {
        "project" => return current.and_then(|r| r.get("lead")).and_then(Value::as_str).map(String::from),
        "sprint" | "issue" => op.fields.get("project_id").and_then(Value::as_str).or_else(|| s(current, "project_id")).map(String::from),
        _ => None,
    }?;
    row(pool, "project", &project).await.and_then(|p| p.get("lead").and_then(Value::as_str).map(String::from))
}

/// Accept ops from a member: validate, check permissions, order, merge.
/// `trusted` skips permission checks for the host's own bootstrap ops.
pub async fn host_apply(pool: &SqlitePool, member: &str, role: &str, ops: Vec<Op>, trusted: bool) -> Result<PushResult, String> {
    let mut result = PushResult::default();
    let max_future = now_ms() + 60_000;
    let members_create_projects = workspace_flag(pool).await;
    for mut op in ops {
        let op_id = op.op_id.clone();
        if let Some(seq) = sqlx::query_scalar::<_, i64>("SELECT seq FROM ops WHERE op_id = ?1").bind(&op_id).fetch_optional(pool).await.map_err(|e| e.to_string())? {
            result.accepted.push(json!({ "op_id": op_id, "seq": seq }));
            continue;
        }
        let reject = |result: &mut PushResult, reason: String| result.rejected.push(json!({ "op_id": op_id, "reason": reason }));
        if let Err(reason) = validate(&op) {
            reject(&mut result, reason);
            continue;
        }
        // A device with a clock far in the future would win every merge; pull it back.
        if let Some((ms, counter, device)) = parse_hlc(&op.hlc) {
            if ms > max_future {
                op.hlc = format_hlc(max_future, counter, device);
            }
        }
        op.member = member.to_string();
        let current = row(pool, &op.entity, &op.id).await;
        if op.kind == "create" && current.is_some() && op.entity != "workspace" {
            op.kind = "set".into();
        }
        // Fields only the host may set.
        op.fields.remove("number");
        match (op.entity.as_str(), op.kind.as_str()) {
            ("issue", "create") => {
                op.fields.insert("reporter".into(), json!(member));
                op.fields.insert("created_at".into(), json!(now_iso()));
            }
            ("comment", "create") => {
                op.fields.insert("author".into(), json!(member));
                op.fields.insert("created_at".into(), json!(now_iso()));
            }
            ("comment", "set") => {
                op.fields.remove("author");
                op.fields.insert("edited_at".into(), json!(now_iso()));
            }
            ("worklog", "create") => {
                op.fields.entry("member").or_insert(json!(member));
                op.fields.insert("created_at".into(), json!(now_iso()));
            }
            ("project" | "sprint", "create") => {
                op.fields.insert("created_at".into(), json!(now_iso()));
                if op.entity == "project" {
                    op.fields.insert("created_by".into(), json!(member));
                }
            }
            _ => {}
        }
        if !trusted {
            let lead = lead_of(pool, &op, current.as_ref()).await;
            let ctx = Ctx { member, role, row: current.as_ref(), lead: lead.as_deref(), members_create_projects };
            if let Err(reason) = allowed(&op, &ctx) {
                reject(&mut result, reason);
                continue;
            }
        }
        let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
        let mut number = None;
        if op.entity == "issue" && current.is_none() {
            let project = op.fields.get("project_id").and_then(Value::as_str).unwrap_or_default().to_string();
            let next: i64 = sqlx::query_scalar("INSERT INTO counters (project, next) VALUES (?1, 2) ON CONFLICT(project) DO UPDATE SET next = next + 1 RETURNING next - 1")
                .bind(&project)
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            op.fields.insert("number".into(), json!(next));
            number = Some(next);
        }
        let at = now_iso();
        let seq: i64 = sqlx::query_scalar(
            "INSERT INTO ops (seq, op_id, member, hlc, entity, eid, kind, fields, at)
             VALUES ((SELECT COALESCE(MAX(seq), 0) + 1 FROM ops), ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING seq",
        )
        .bind(&op.op_id)
        .bind(&op.member)
        .bind(&op.hlc)
        .bind(&op.entity)
        .bind(&op.id)
        .bind(&op.kind)
        .bind(Value::Object(op.fields.clone()).to_string())
        .bind(&at)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        merge(&mut tx, &op, seq).await.map_err(|e| e.to_string())?;
        if op.entity == "member" {
            // Keep the host's auth table in step with role and active changes.
            if let Some(role) = op.fields.get("role").and_then(Value::as_str) {
                sqlx::query("UPDATE auth SET role = ?2 WHERE member = ?1").bind(&op.id).bind(role).execute(&mut *tx).await.map_err(|e| e.to_string())?;
            }
            if let Some(active) = op.fields.get("active").and_then(Value::as_bool) {
                sqlx::query("UPDATE auth SET active = ?2 WHERE member = ?1").bind(&op.id).bind(active as i64).execute(&mut *tx).await.map_err(|e| e.to_string())?;
            }
        }
        tx.commit().await.map_err(|e| e.to_string())?;
        let mut accepted = json!({ "op_id": op.op_id, "seq": seq });
        if let Some(n) = number {
            accepted["number"] = json!(n);
        }
        result.accepted.push(accepted);
    }
    Ok(result)
}

/// Rows changed after `after`, plus the op history. A first pull gets every row and the
/// latest 500 ops so a large history doesn't slow down joining.
pub async fn pull(pool: &SqlitePool, after: i64) -> Result<Value, String> {
    let rows = sqlx::query("SELECT entity, id, data, seq FROM rows WHERE seq > ?1 ORDER BY seq")
        .bind(after)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let rows: Vec<Value> = rows
        .iter()
        .map(|r| {
            let data: Value = serde_json::from_str(r.get::<String, _>("data").as_str()).unwrap_or(json!({}));
            json!({ "entity": r.get::<String, _>("entity"), "id": r.get::<String, _>("id"), "data": data, "seq": r.get::<i64, _>("seq") })
        })
        .collect();
    let seq: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(seq), 0) FROM ops").fetch_one(pool).await.map_err(|e| e.to_string())?;
    let floor = if after == 0 { (seq - 500).max(0) } else { after };
    let ops = sqlx::query("SELECT * FROM ops WHERE seq > ?1 ORDER BY seq LIMIT 2000")
        .bind(floor)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let ops: Vec<Value> = ops.iter().map(op_json).collect();
    Ok(json!({ "protocol": PROTOCOL, "seq": seq, "rows": rows, "ops": ops }))
}

fn op_json(r: &sqlx::sqlite::SqliteRow) -> Value {
    json!({
        "seq": r.get::<i64, _>("seq"), "op_id": r.get::<String, _>("op_id"), "member": r.get::<String, _>("member"),
        "hlc": r.get::<String, _>("hlc"), "entity": r.get::<String, _>("entity"), "id": r.get::<String, _>("eid"),
        "kind": r.get::<String, _>("kind"), "at": r.get::<String, _>("at"),
        "fields": serde_json::from_str::<Value>(r.get::<String, _>("fields").as_str()).unwrap_or(json!({})),
    })
}

/// A single-use invite. Returns the secret code (only its hash is stored).
pub async fn create_invite(pool: &SqlitePool, role: &str, by: &str, by_role: &str) -> Result<String, String> {
    if !ROLES.contains(&role) || role == "owner" {
        return Err("Invite people as admin, member or viewer.".into());
    }
    if rank_of(by_role) < 3 {
        return Err("Only owners and admins invite people.".into());
    }
    if role == "admin" && by_role != "owner" {
        return Err("Only an owner can invite admins.".into());
    }
    let code = random_hex(16);
    let expires = (chrono::Utc::now() + chrono::Duration::days(7)).format("%Y-%m-%dT%H:%M:%SZ").to_string();
    sqlx::query("INSERT INTO invites (code_hash, role, created_by, expires) VALUES (?1, ?2, ?3, ?4)")
        .bind(hash_secret(&code))
        .bind(role)
        .bind(by)
        .bind(expires)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(code)
}

/// Redeem an invite: creates the member and returns (member id, token, role).
pub async fn redeem_invite(pool: &SqlitePool, code: &str, name: &str, device: &str) -> Result<(String, String, String), String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("Enter your name (up to 80 characters).".into());
    }
    let invite = sqlx::query("SELECT role, created_by, expires, used_by FROM invites WHERE code_hash = ?1")
        .bind(hash_secret(code))
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("This invite is not valid. Ask for a new one.")?;
    if invite.get::<Option<String>, _>("used_by").is_some() {
        return Err("This invite was already used. Ask for a new one.".into());
    }
    if invite.get::<String, _>("expires") < now_iso() {
        return Err("This invite has expired. Ask for a new one.".into());
    }
    let role: String = invite.get("role");
    let by: String = invite.get("created_by");
    let member = new_id();
    let token = random_hex(32);
    let claimed = sqlx::query("UPDATE invites SET used_by = ?2 WHERE code_hash = ?1 AND used_by IS NULL")
        .bind(hash_secret(code))
        .bind(&member)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    if claimed.rows_affected() != 1 {
        return Err("This invite was already used. Ask for a new one.".into());
    }
    sqlx::query("INSERT INTO auth (member, token_hash, role, active) VALUES (?1, ?2, ?3, 1)")
        .bind(&member)
        .bind(hash_secret(&token))
        .bind(&role)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    let colors = ["#60a5fa", "#f472b6", "#a78bfa", "#fb923c", "#facc15", "#22d3ee", "#f87171", "#34d399"];
    let color = colors[(u8::from_str_radix(&member[member.len() - 2..], 16).unwrap_or(0) as usize) % colors.len()];
    let mut op = local_op(pool, "member", &member, "create", json!({ "name": name, "role": role, "active": true, "color": color, "joined_at": now_iso(), "device": device.chars().take(80).collect::<String>() })).await;
    op.member = by.clone();
    host_apply(pool, &by, "owner", vec![op], true).await?;
    Ok((member, token, role))
}

// ---------------- replica ----------------

/// Rows with this replica's unsent ops shown on top, so edits appear instantly offline.
pub async fn state(pool: &SqlitePool) -> Result<Value, String> {
    let mut rows: Map<String, Value> = Map::new();
    for r in sqlx::query("SELECT entity, id, data FROM rows").fetch_all(pool).await.map_err(|e| e.to_string())? {
        let key = format!("{}/{}", r.get::<String, _>("entity"), r.get::<String, _>("id"));
        rows.insert(key, serde_json::from_str(r.get::<String, _>("data").as_str()).unwrap_or(json!({})));
    }
    let pending: Vec<Op> = outbox(pool).await?;
    for op in &pending {
        let entry = rows.entry(format!("{}/{}", op.entity, op.id)).or_insert(json!({}));
        if let Some(obj) = entry.as_object_mut() {
            for (k, v) in &op.fields {
                obj.insert(k.clone(), v.clone());
            }
            if op.kind == "delete" {
                obj.insert("deleted".into(), json!(true));
            }
            obj.insert("_pending".into(), json!(true));
        }
    }
    let list: Vec<Value> = rows
        .into_iter()
        .map(|(key, data)| {
            let (entity, id) = key.split_once('/').unwrap_or_default();
            json!({ "entity": entity, "id": id, "data": data })
        })
        .collect();
    let ops = sqlx::query("SELECT * FROM (SELECT * FROM ops ORDER BY seq DESC LIMIT 400) ORDER BY seq")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let ops: Vec<Value> = ops.iter().map(op_json).collect();
    Ok(json!({ "rows": list, "ops": ops, "pending": pending.len() }))
}

pub async fn outbox(pool: &SqlitePool) -> Result<Vec<Op>, String> {
    let texts: Vec<String> = sqlx::query_scalar("SELECT op FROM outbox ORDER BY n").fetch_all(pool).await.map_err(|e| e.to_string())?;
    Ok(texts.iter().filter_map(|t| serde_json::from_str(t).ok()).collect())
}

pub async fn enqueue(pool: &SqlitePool, op: &Op) -> Result<(), String> {
    validate(op)?;
    sqlx::query("INSERT OR IGNORE INTO outbox (op_id, op) VALUES (?1, ?2)")
        .bind(&op.op_id)
        .bind(serde_json::to_string(op).map_err(|e| e.to_string())?)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Store what the host sent. Rows are replaced as a whole: the host already merged them.
pub async fn apply_pull(pool: &SqlitePool, pulled: &Value) -> Result<bool, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut changed = false;
    for r in pulled["rows"].as_array().into_iter().flatten() {
        let (Some(entity), Some(id)) = (r["entity"].as_str(), r["id"].as_str()) else { continue };
        if fields_of(entity).is_none() {
            continue;
        }
        sqlx::query("INSERT INTO rows (entity, id, data, seq) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(entity, id) DO UPDATE SET data = ?3, seq = ?4")
            .bind(entity)
            .bind(id)
            .bind(r["data"].to_string())
            .bind(r["seq"].as_i64().unwrap_or(0))
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        changed = true;
    }
    let mut last_hlc = String::new();
    for o in pulled["ops"].as_array().into_iter().flatten() {
        let Ok(op) = serde_json::from_value::<Op>(o.clone()) else { continue };
        sqlx::query("INSERT OR IGNORE INTO ops (seq, op_id, member, hlc, entity, eid, kind, fields, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
            .bind(op.seq)
            .bind(&op.op_id)
            .bind(&op.member)
            .bind(&op.hlc)
            .bind(&op.entity)
            .bind(&op.id)
            .bind(&op.kind)
            .bind(Value::Object(op.fields.clone()).to_string())
            .bind(&op.at)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        sqlx::query("DELETE FROM outbox WHERE op_id = ?1").bind(&op.op_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
        if op.hlc > last_hlc {
            last_hlc = op.hlc;
        }
        changed = true;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    if let Some(seq) = pulled["seq"].as_i64() {
        set_meta(pool, "last_seq", &seq.to_string()).await?;
    }
    // Move this device's clock past everything it has seen, so its next edit sorts after.
    let mine = get_meta(pool, "hlc").await;
    if last_hlc > mine {
        set_meta(pool, "hlc", &last_hlc).await?;
    }
    Ok(changed)
}

/// Drop ops the host answered for. Rejected ones vanish from the overlay, which rolls the
/// screen back to the host's version.
pub async fn settle(pool: &SqlitePool, result: &Value) -> Result<Vec<String>, String> {
    let mut reasons = Vec::new();
    for list in ["accepted", "rejected"] {
        for item in result[list].as_array().into_iter().flatten() {
            if let Some(op_id) = item["op_id"].as_str() {
                sqlx::query("DELETE FROM outbox WHERE op_id = ?1").bind(op_id).execute(pool).await.map_err(|e| e.to_string())?;
            }
            if list == "rejected" {
                reasons.push(item["reason"].as_str().unwrap_or("Rejected by the host.").to_string());
            }
        }
    }
    Ok(reasons)
}

/// Everything in the workspace as one JSON document (for export and backups).
pub async fn export(pool: &SqlitePool) -> Result<Value, String> {
    let rows = sqlx::query("SELECT entity, id, data FROM rows ORDER BY entity, id").fetch_all(pool).await.map_err(|e| e.to_string())?;
    let rows: Vec<Value> = rows
        .iter()
        .map(|r| json!({ "entity": r.get::<String, _>("entity"), "id": r.get::<String, _>("id"), "data": serde_json::from_str::<Value>(r.get::<String, _>("data").as_str()).unwrap_or(json!({})) }))
        .collect();
    let ops = sqlx::query("SELECT * FROM ops ORDER BY seq").fetch_all(pool).await.map_err(|e| e.to_string())?;
    Ok(json!({
        "format": "mizan-team-export", "protocol": PROTOCOL, "schema": SCHEMA, "exported_at": now_iso(),
        "workspace": get_meta(pool, "ws_id").await, "rows": rows, "ops": ops.iter().map(op_json).collect::<Vec<_>>(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn op(entity: &str, id: &str, kind: &str, hlc: &str, fields: Value) -> Op {
        Op { op_id: new_id(), hlc: hlc.into(), entity: entity.into(), id: id.into(), kind: kind.into(), fields: fields.as_object().cloned().unwrap_or_default(), member: String::new(), seq: 0, at: String::new() }
    }

    async fn host() -> (SqlitePool, String) {
        let pool = open_memory().await.unwrap();
        let owner = init_host(&pool, "ws1", "Acme", "Ana", "dev1").await.unwrap();
        (pool, owner)
    }

    fn h(ms: i64, device: &str) -> String {
        format_hlc(ms, 0, device)
    }

    #[test]
    fn hlc_orders_as_text_and_rejects_garbage() {
        assert!(format_hlc(5, 0, "a") < format_hlc(5, 1, "a"));
        assert!(format_hlc(5, 9, "z") < format_hlc(6, 0, "a"));
        assert!(parse_hlc("bad").is_none());
        assert!(parse_hlc(&format_hlc(1, 2, "d ev")).is_none());
        let a = next_hlc(&format_hlc(now_ms() + 10_000, 3, "x"), "me");
        assert_eq!(parse_hlc(&a).unwrap().1, 4, "never goes backwards");
    }

    #[test]
    fn fields_merge_independently_and_numbers_come_from_the_host() {
        tauri::async_runtime::block_on(async {
            let (pool, owner) = host().await;
            let p = op("project", "p1", "create", &h(1, "a"), json!({ "key": "WEB", "name": "Website", "status": "active" }));
            let i = op("issue", "i1", "create", &h(2, "a"), json!({ "project_id": "p1", "title": "Draft", "status": "todo", "number": 99 }));
            let i2 = op("issue", "i2", "create", &h(3, "a"), json!({ "project_id": "p1", "title": "Second" }));
            let r = host_apply(&pool, &owner, "owner", vec![p, i, i2], false).await.unwrap();
            assert!(r.rejected.is_empty(), "{:?}", r.rejected);
            assert_eq!(r.accepted[1]["number"], 1, "client-sent numbers are ignored");
            assert_eq!(r.accepted[2]["number"], 2);
            // Two offline edits: newer title from b, older status from c, newer status from b.
            let edits = vec![
                op("issue", "i1", "set", &h(20, "b"), json!({ "title": "Final draft", "status": "done" })),
                op("issue", "i1", "set", &h(10, "c"), json!({ "status": "in_review", "assignee": "m2" })),
            ];
            host_apply(&pool, &owner, "owner", edits, false).await.unwrap();
            let row = row(&pool, "issue", "i1").await.unwrap();
            assert_eq!(row["title"], "Final draft");
            assert_eq!(row["status"], "done", "older status loses");
            assert_eq!(row["assignee"], "m2", "a field only c touched is kept");
            assert_eq!(row["number"], 1);
        });
    }

    #[test]
    fn delivery_order_does_not_change_the_result() {
        tauri::async_runtime::block_on(async {
            let edits = [
                op("issue", "i1", "set", &h(30, "b"), json!({ "title": "B" })),
                op("issue", "i1", "set", &h(30, "c"), json!({ "title": "C", "priority": 1 })),
                op("issue", "i1", "delete", &h(40, "b"), json!({})),
                op("issue", "i1", "set", &h(35, "c"), json!({ "priority": 2 })),
            ];
            let mut results = Vec::new();
            for order in [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1]] {
                let (pool, owner) = host().await;
                let base = vec![
                    op("project", "p1", "create", &h(1, "a"), json!({ "key": "WEB", "name": "W" })),
                    op("issue", "i1", "create", &h(2, "a"), json!({ "project_id": "p1", "title": "A" })),
                ];
                host_apply(&pool, &owner, "owner", base, false).await.unwrap();
                let batch: Vec<Op> = order.iter().map(|&k| { let mut o = edits[k].clone(); o.op_id = new_id(); o }).collect();
                host_apply(&pool, &owner, "owner", batch, false).await.unwrap();
                let mut r = row(&pool, "issue", "i1").await.unwrap();
                for per_run in ["created_at", "reporter"] {
                    r.as_object_mut().unwrap().remove(per_run);
                }
                results.push(r);
            }
            assert_eq!(results[0], results[1]);
            assert_eq!(results[0], results[2]);
            assert_eq!(results[0]["title"], "C", "ties break by device id");
            assert_eq!(results[0]["deleted"], true);
            assert_eq!(results[0]["priority"], 2);
        });
    }

    #[test]
    fn permissions_follow_the_matrix() {
        tauri::async_runtime::block_on(async {
            let (pool, owner) = host().await;
            host_apply(&pool, &owner, "owner", vec![
                op("project", "p1", "create", &h(1, "a"), json!({ "key": "WEB", "name": "W" })),
                op("issue", "i1", "create", &h(2, "a"), json!({ "project_id": "p1", "title": "Owner's" })),
            ], false).await.unwrap();
            let code = create_invite(&pool, "viewer", &owner, "owner").await.unwrap();
            let (viewer, token, role) = redeem_invite(&pool, &code, "Vic", "phone").await.unwrap();
            assert_eq!(role, "viewer");
            assert!(redeem_invite(&pool, &code, "Again", "x").await.is_err(), "invites are single use");
            assert_eq!(authenticate(&pool, &token).await.unwrap().member, viewer);
            let r = host_apply(&pool, &viewer, "viewer", vec![
                op("issue", "i1", "set", &h(5, "v"), json!({ "title": "hacked" })),
                op("comment", "c1", "create", &h(6, "v"), json!({ "issue_id": "i1", "body": "Looks good", "author": "someone-else" })),
            ], false).await.unwrap();
            assert_eq!(r.rejected.len(), 1);
            assert_eq!(row(&pool, "comment", "c1").await.unwrap()["author"], json!(viewer), "author comes from the token");

            let code = create_invite(&pool, "member", &owner, "owner").await.unwrap();
            let (m, _, _) = redeem_invite(&pool, &code, "Mo", "laptop").await.unwrap();
            let r = host_apply(&pool, &m, "member", vec![
                op("issue", "i1", "delete", &h(7, "m"), json!({})),
                op("comment", "c1", "set", &h(8, "m"), json!({ "body": "edited by someone else" })),
                op("member", &m, "set", &h(9, "m"), json!({ "role": "admin" })),
                op("member", &m, "set", &h(9, "m"), json!({ "name": "Moe" })),
                op("issue", "i2", "create", &h(10, "m"), json!({ "project_id": "p1", "title": "Mine" })),
                op("issue", "i2", "delete", &h(11, "m"), json!({})),
            ], false).await.unwrap();
            let reasons: Vec<&str> = r.rejected.iter().map(|x| x["reason"].as_str().unwrap()).collect();
            assert_eq!(reasons.len(), 3, "{reasons:?}");
            assert_eq!(r.accepted.len(), 3);

            // Deactivating a member revokes their token.
            host_apply(&pool, &owner, "owner", vec![op("member", &viewer, "set", &h(50, "a"), json!({ "active": false }))], false).await.unwrap();
            assert!(authenticate(&pool, &token).await.is_none());
            assert!(create_invite(&pool, "admin", &m, "member").await.is_err());
        });
    }

    #[test]
    fn replicas_show_pending_edits_and_converge_after_pull() {
        tauri::async_runtime::block_on(async {
            let (hostdb, owner) = host().await;
            let code = create_invite(&hostdb, "member", &owner, "owner").await.unwrap();
            let (m, _, _) = redeem_invite(&hostdb, &code, "Mo", "laptop").await.unwrap();
            host_apply(&hostdb, &owner, "owner", vec![op("project", "p1", "create", &h(1, "a"), json!({ "key": "WEB", "name": "W" }))], false).await.unwrap();

            let replica = open_memory().await.unwrap();
            set_meta(&replica, "device", "laptop").await.unwrap();
            apply_pull(&replica, &pull(&hostdb, 0).await.unwrap()).await.unwrap();
            let edit = local_op(&replica, "issue", "i9", "create", json!({ "project_id": "p1", "title": "Offline idea" })).await;
            enqueue(&replica, &edit).await.unwrap();
            let shown = state(&replica).await.unwrap();
            assert!(shown["rows"].as_array().unwrap().iter().any(|r| r["data"]["title"] == "Offline idea" && r["data"]["_pending"] == true));

            let result = host_apply(&hostdb, &m, "member", outbox(&replica).await.unwrap(), false).await.unwrap();
            settle(&replica, &serde_json::to_value(&result).unwrap()).await.unwrap();
            let after: i64 = get_meta(&replica, "last_seq").await.parse().unwrap();
            apply_pull(&replica, &pull(&hostdb, after).await.unwrap()).await.unwrap();
            assert_eq!(row(&replica, "issue", "i9").await.unwrap(), row(&hostdb, "issue", "i9").await.unwrap());
            assert_eq!(row(&replica, "issue", "i9").await.unwrap()["number"], 1);
            assert!(outbox(&replica).await.unwrap().is_empty());
        });
    }

    #[test]
    fn bad_shapes_are_rejected() {
        let bad = [
            op("issue", "i1", "create", &h(1, "a"), json!({ "title": "no project" })),
            op("issue", "i1", "set", &h(1, "a"), json!({ "status": "nope" })),
            op("issue", "i1", "set", &h(1, "a"), json!({ "secret": 1 })),
            op("project", "p1", "create", &h(1, "a"), json!({ "key": "w", "name": "x" })),
            op("issue", "../x", "set", &h(1, "a"), json!({ "title": "x" })),
            op("issue", "i1", "set", "yesterday", json!({ "title": "x" })),
            op("tasks", "i1", "set", &h(1, "a"), json!({ "title": "x" })),
        ];
        for o in bad {
            assert!(validate(&o).is_err(), "{o:?}");
        }
    }
}
