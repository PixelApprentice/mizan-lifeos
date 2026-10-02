// Team workspaces: shared projects and issues, kept apart from the personal LifeOS.
//
// Each workspace is its own SQLite file under `<app config>/team/<id>.db`. This module never
// opens `mizan.db`, so team code cannot read personal tasks, logs or focus history.
// A workspace is either hosted here (`mode = host`: this desktop orders changes and serves
// teammates on the LAN) or a replica of one hosted elsewhere (`mode = replica`).

pub mod server;
pub mod store;

use serde_json::{json, Value};
use sqlx::sqlite::SqlitePool;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub const DEFAULT_PORT: u16 = 47616;

static APP: OnceLock<AppHandle> = OnceLock::new();
static DIR: OnceLock<PathBuf> = OnceLock::new();
static POOLS: Mutex<Option<HashMap<String, SqlitePool>>> = Mutex::new(None);
static BACKOFF: Mutex<Option<HashMap<String, (Instant, u64)>>> = Mutex::new(None);

fn dir() -> Result<PathBuf, String> {
    let dir = DIR.get().cloned().ok_or("Mizan is still starting.")?;
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir)
}

fn valid_ws(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric())
}

fn file_of(ws: &str) -> Result<PathBuf, String> {
    if !valid_ws(ws) {
        return Err("Invalid workspace id.".into());
    }
    Ok(dir()?.join(format!("{ws}.db")))
}

async fn pool_for(ws: &str, create: bool) -> Result<SqlitePool, String> {
    if let Some(pool) = POOLS.lock().map_err(|e| e.to_string())?.as_ref().and_then(|m| m.get(ws)).cloned() {
        return Ok(pool);
    }
    let file = file_of(ws)?;
    if !create && !file.exists() {
        return Err("This workspace is not on this computer.".into());
    }
    let pool = store::open(&file).await?;
    POOLS.lock().map_err(|e| e.to_string())?.get_or_insert_with(HashMap::new).insert(ws.to_string(), pool.clone());
    Ok(pool)
}

/// A workspace this desktop hosts (the only kind the HTTP server will serve).
pub(crate) async fn hosted_pool(ws: &str) -> Result<SqlitePool, String> {
    let pool = pool_for(ws, false).await.map_err(|_| "No such workspace on this host.".to_string())?;
    if store::get_meta(&pool, "mode").await != "host" {
        return Err("No such workspace on this host.".into());
    }
    Ok(pool)
}

/// Hosted workspaces are the only full copy of a team's data, so they get the same daily
/// snapshots as the personal database (`backups/team-<id>/`, newest 14 kept).
pub async fn backup_hosted(root: &std::path::Path, day: &str) {
    for ws in workspace_ids() {
        let Ok(pool) = hosted_pool(&ws).await else { continue };
        if let Err(error) = crate::backup::snapshot(&pool, &root.join(format!("team-{ws}")), day).await {
            eprintln!("team {ws}: {error}");
        }
    }
}

fn workspace_ids() -> Vec<String> {
    let Ok(dir) = dir() else { return Vec::new() };
    let mut ids: Vec<String> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.file_name().to_str().and_then(|n| n.strip_suffix(".db")).map(String::from))
        .filter(|id| valid_ws(id))
        .collect();
    ids.sort();
    ids
}

pub(crate) fn changed(ws: &str) {
    if let Some(app) = APP.get() {
        let _ = app.emit("team://changed", json!({ "ws": ws }));
    }
}

/// Stable id of this computer in clocks and member records.
fn device_id() -> String {
    let path = crate::focus::state_dir().join("team-device");
    if let Ok(id) = fs::read_to_string(&path) {
        let id = id.trim().to_string();
        if id.len() >= 8 && id.chars().all(|c| c.is_ascii_alphanumeric()) {
            return id;
        }
    }
    let id = store::random_hex(6);
    let _ = fs::write(&path, &id);
    id
}

// ---------------- hosting settings ----------------

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct HostConfig {
    enabled: bool,
    port: u16,
}

fn host_config_file() -> PathBuf {
    crate::focus::state_dir().join("team-host.json")
}

fn host_config() -> HostConfig {
    fs::read_to_string(host_config_file())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(HostConfig { enabled: false, port: DEFAULT_PORT })
}

fn hosting_status(error: Option<String>) -> Value {
    let config = host_config();
    json!({
        "enabled": config.enabled, "running": server::running_port().is_some(),
        "port": server::running_port().unwrap_or(config.port),
        "addresses": crate::companion::lan_addresses(), "error": error,
    })
}

// ---------------- startup and background sync ----------------

pub fn init(app: AppHandle) {
    if let Ok(base) = app.path().app_config_dir() {
        let _ = DIR.set(base.join("team"));
    }
    let _ = APP.set(app);
    let config = host_config();
    if config.enabled {
        if let Err(error) = server::start(config.port) {
            eprintln!("Team hosting did not start: {error}");
        }
    }
    let _ = std::thread::Builder::new().name("mizan-team-sync".into()).spawn(|| loop {
        std::thread::sleep(Duration::from_secs(3));
        for ws in workspace_ids() {
            let due = BACKOFF.lock().ok().and_then(|b| b.as_ref().and_then(|m| m.get(&ws)).map(|(at, _)| *at)).is_none_or(|at| Instant::now() >= at);
            if due {
                let _ = tauri::async_runtime::block_on(sync_once(&ws));
            }
        }
    });
}

fn note_result(ws: &str, ok: bool) {
    if let Ok(mut guard) = BACKOFF.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        if ok {
            map.remove(ws);
        } else {
            let wait = map.get(ws).map(|(_, s)| (*s * 2).min(60)).unwrap_or(3);
            map.insert(ws.to_string(), (Instant::now() + Duration::from_secs(wait), wait));
        }
    }
}

fn bases(pool_hosts: &str, port: &str, preferred: &str) -> Vec<String> {
    let mut list: Vec<String> = Vec::new();
    if !preferred.is_empty() {
        list.push(preferred.to_string());
    }
    for host in pool_hosts.split(',').map(str::trim).filter(|h| !h.is_empty()) {
        let base = format!("http://{host}:{port}");
        if !list.contains(&base) {
            list.push(base);
        }
    }
    list
}

/// Push this replica's outbox, then pull. Hosted workspaces have nothing to do.
async fn sync_once(ws: &str) -> Result<(), String> {
    let pool = pool_for(ws, false).await?;
    if store::get_meta(&pool, "mode").await != "replica" {
        return Ok(());
    }
    let token = store::get_meta(&pool, "token").await;
    let after: i64 = store::get_meta(&pool, "last_seq").await.parse().unwrap_or(0);
    let candidates = bases(&store::get_meta(&pool, "hosts").await, &store::get_meta(&pool, "port").await, &store::get_meta(&pool, "base").await);
    let pending = store::outbox(&pool).await?;
    let path = |action: &str| format!("/team/v1/ws/{ws}/{action}");
    let mut last_error = "The host is not reachable. Changes are kept here and sent when it is back.".to_string();
    for base in candidates {
        let (base2, token2, pending2, ops_path, pull_path) = (base.clone(), token.clone(), pending.clone(), path("ops"), path(&format!("pull?after={after}")));
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            let pushed = if pending2.is_empty() {
                None
            } else {
                Some(server::request(&base2, "POST", &ops_path, Some(&token2), Some(&json!({ "ops": pending2 })), Duration::from_secs(15))?)
            };
            let pulled = server::request(&base2, "GET", &pull_path, Some(&token2), None, Duration::from_secs(20))?;
            Ok::<_, (u16, String)>((pushed, pulled))
        })
        .await
        .map_err(|e| e.to_string())?;
        match outcome {
            Ok((pushed, pulled)) => {
                let mut notes = Vec::new();
                if let Some(result) = pushed {
                    notes = store::settle(&pool, &result).await?;
                }
                let changed_any = store::apply_pull(&pool, &pulled).await?;
                store::set_meta(&pool, "base", &base).await?;
                store::set_meta(&pool, "last_sync", &store::now_iso()).await?;
                store::set_meta(&pool, "role", pulled["role"].as_str().unwrap_or_default()).await?;
                let error = if notes.is_empty() { String::new() } else { format!("Some changes were not saved: {}", notes.join(" ")) };
                store::set_meta(&pool, "last_error", &error).await?;
                note_result(ws, true);
                if changed_any || !notes.is_empty() || !pending.is_empty() {
                    changed(ws);
                }
                return Ok(());
            }
            Err((401, error)) => {
                last_error = error;
                break;
            }
            Err((_, error)) if error.starts_with("Cannot reach") => continue,
            Err((_, error)) => {
                last_error = error;
                break;
            }
        }
    }
    let before = store::get_meta(&pool, "last_error").await;
    store::set_meta(&pool, "last_error", &last_error).await?;
    if before != last_error {
        changed(ws);
    }
    note_result(ws, false);
    Err(last_error)
}

// ---------------- commands ----------------

async fn summary(ws: &str) -> Result<Value, String> {
    let pool = pool_for(ws, false).await?;
    let mode = store::get_meta(&pool, "mode").await;
    let me = store::get_meta(&pool, "member_id").await;
    let workspace = store::row(&pool, "workspace", "ws").await.unwrap_or(json!({}));
    let member = store::row(&pool, "member", &me).await.unwrap_or(json!({}));
    let pending = store::outbox(&pool).await?.len();
    Ok(json!({
        "id": ws, "mode": mode, "me": me,
        "name": workspace["name"].as_str().map(String::from).unwrap_or_else(|| fallback_name(&mode)),
        "role": member["role"].as_str().unwrap_or("member"),
        "pending": pending, "last_sync": store::get_meta(&pool, "last_sync").await,
        "error": store::get_meta(&pool, "last_error").await,
        "host": store::get_meta(&pool, "base").await,
    }))
}

fn fallback_name(mode: &str) -> String {
    if mode == "replica" { "Joining…".into() } else { "Workspace".into() }
}

#[tauri::command]
pub async fn team_list() -> Result<Vec<Value>, String> {
    let mut list = Vec::new();
    for ws in workspace_ids() {
        match summary(&ws).await {
            Ok(s) => list.push(s),
            Err(error) => list.push(json!({ "id": ws, "name": "Unreadable workspace", "error": error, "mode": "broken" })),
        }
    }
    Ok(list)
}

#[tauri::command]
pub async fn team_create(name: String, owner_name: String) -> Result<Value, String> {
    let name = name.trim();
    let owner_name = owner_name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("Name the workspace (up to 80 characters).".into());
    }
    if owner_name.is_empty() {
        return Err("Enter your name as teammates will see it.".into());
    }
    let ws = store::new_id();
    let pool = pool_for(&ws, true).await?;
    store::init_host(&pool, &ws, name, owner_name, &device_id()).await?;
    summary(&ws).await
}

#[tauri::command]
pub async fn team_state(ws: String) -> Result<Value, String> {
    let pool = pool_for(&ws, false).await?;
    let mut state = store::state(&pool).await?;
    state["workspace"] = summary(&ws).await?;
    Ok(state)
}

/// Apply edits from the UI. Each item is `{entity, id, kind, fields}`; this side adds the
/// op id and clock. Hosted: merged now. Replica: queued and sent by the sync loop.
#[tauri::command]
pub async fn team_submit(ws: String, ops: Vec<Value>) -> Result<Value, String> {
    let pool = pool_for(&ws, false).await?;
    let mode = store::get_meta(&pool, "mode").await;
    let mut stamped = Vec::new();
    for item in ops.iter().take(500) {
        let entity = item["entity"].as_str().ok_or("Missing entity.")?;
        let id = item["id"].as_str().ok_or("Missing id.")?;
        let kind = item["kind"].as_str().unwrap_or("set");
        let op = store::local_op(&pool, entity, id, kind, item["fields"].clone()).await;
        store::validate(&op)?;
        stamped.push(op);
    }
    if mode == "host" {
        let me = store::get_meta(&pool, "member_id").await;
        let role = store::row(&pool, "member", &me).await.and_then(|m| m["role"].as_str().map(String::from)).unwrap_or_default();
        let result = store::host_apply(&pool, &me, &role, stamped, false).await?;
        changed(&ws);
        return serde_json::to_value(result).map_err(|e| e.to_string());
    }
    for op in &stamped {
        store::enqueue(&pool, op).await?;
    }
    changed(&ws);
    let ws2 = ws.clone();
    tauri::async_runtime::spawn(async move {
        note_result(&ws2, true);
        let _ = sync_once(&ws2).await;
    });
    Ok(json!({ "queued": stamped.len() }))
}

#[tauri::command]
pub async fn team_sync(ws: String) -> Result<Value, String> {
    note_result(&ws, true);
    let outcome = sync_once(&ws).await;
    let mut s = summary(&ws).await?;
    if let Err(error) = outcome {
        s["error"] = json!(error);
    }
    Ok(s)
}

#[tauri::command]
pub fn team_hosting(enabled: Option<bool>, port: Option<u16>) -> Result<Value, String> {
    let mut config = host_config();
    if let Some(port) = port {
        if port < 1024 {
            return Err("Choose a port from 1024 to 65535.".into());
        }
        config.port = port;
    }
    if let Some(enabled) = enabled {
        config.enabled = enabled;
        let text = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
        fs::write(host_config_file(), text).map_err(|e| e.to_string())?;
        if enabled {
            if let Err(error) = server::start(config.port) {
                return Ok(hosting_status(Some(error)));
            }
        } else {
            server::stop();
        }
    }
    Ok(hosting_status(None))
}

fn encode(text: &str) -> String {
    text.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Some(b) = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// `mizan-team://join?ws=…&code=…&hosts=ip,ip&port=…&name=…`
fn invite_link(ws: &str, code: &str, hosts: &[String], port: &str, name: &str) -> String {
    format!("mizan-team://join?ws={ws}&code={code}&hosts={}&port={port}&name={}", hosts.join(","), encode(name))
}

fn parse_invite(link: &str) -> Result<HashMap<String, String>, String> {
    let query = link.trim().split_once('?').map(|(_, q)| q).ok_or("This is not a Mizan team invite.")?;
    let map: HashMap<String, String> = query
        .split('&')
        .filter_map(|p| p.split_once('=').map(|(k, v)| (k.to_string(), decode(v))))
        .collect();
    for key in ["ws", "code", "hosts", "port"] {
        if map.get(key).is_none_or(|v| v.is_empty()) {
            return Err("This invite link is incomplete. Copy the whole link.".into());
        }
    }
    Ok(map)
}

#[tauri::command]
pub async fn team_invite(ws: String, role: String) -> Result<Value, String> {
    let pool = pool_for(&ws, false).await?;
    let me = store::get_meta(&pool, "member_id").await;
    let my_role = store::row(&pool, "member", &me).await.and_then(|m| m["role"].as_str().map(String::from)).unwrap_or_default();
    let name = store::row(&pool, "workspace", "ws").await.and_then(|w| w["name"].as_str().map(String::from)).unwrap_or_default();
    let (code, hosts, port) = if store::get_meta(&pool, "mode").await == "host" {
        let port = server::running_port().ok_or("Turn on team hosting first, so teammates can reach this computer.")?;
        (store::create_invite(&pool, &role, &me, &my_role).await?, crate::companion::lan_addresses(), port.to_string())
    } else {
        let base = store::get_meta(&pool, "base").await;
        let token = store::get_meta(&pool, "token").await;
        let path = format!("/team/v1/ws/{ws}/invites");
        let body = json!({ "role": role });
        let reply = tauri::async_runtime::spawn_blocking(move || server::request(&base, "POST", &path, Some(&token), Some(&body), Duration::from_secs(10)))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|(_, e)| e)?;
        let code = reply["code"].as_str().ok_or("The host did not return an invite.")?.to_string();
        (code, store::get_meta(&pool, "hosts").await.split(',').map(String::from).collect(), store::get_meta(&pool, "port").await)
    };
    if hosts.is_empty() {
        return Err("This computer has no network address. Connect to Wi-Fi, Ethernet or a hotspot first.".into());
    }
    let link = invite_link(&ws, &code, &hosts, &port, &name);
    Ok(json!({ "link": link, "qr_svg": crate::companion::qr_svg(&link), "role": role, "expires_in_days": 7 }))
}

#[tauri::command]
pub async fn team_join(invite: String, name: String) -> Result<Value, String> {
    let params = parse_invite(&invite)?;
    let ws = params["ws"].clone();
    if !valid_ws(&ws) {
        return Err("This invite link is damaged.".into());
    }
    if file_of(&ws)?.exists() {
        return Err("This workspace is already on this computer.".into());
    }
    let port = params["port"].clone();
    let hosts = params["hosts"].clone();
    let body = json!({ "ws": ws, "code": params["code"], "name": name.trim(), "device": device_id() });
    let candidates = bases(&hosts, &port, "");
    let reply = tauri::async_runtime::spawn_blocking(move || {
        let mut last = (0, "None of the host's addresses answered. Join the same network as the host and try again.".to_string());
        for base in candidates {
            match server::request(&base, "POST", "/team/v1/join", None, Some(&body), Duration::from_secs(10)) {
                Ok(v) => return Ok((base, v)),
                Err((0, e)) => last = (0, e),
                Err(other) => return Err(other),
            }
        }
        Err(last)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|(_, e)| e)?;
    let (base, reply) = reply;
    let pool = pool_for(&ws, true).await?;
    for (key, value) in [
        ("ws_id", ws.as_str()), ("mode", "replica"), ("device", &device_id()), ("hosts", &hosts), ("port", &port), ("base", &base),
        ("member_id", reply["member"].as_str().unwrap_or_default()), ("token", reply["token"].as_str().unwrap_or_default()), ("last_seq", "0"),
    ] {
        store::set_meta(&pool, key, value).await?;
    }
    let _ = sync_once(&ws).await;
    summary(&ws).await
}

#[tauri::command]
pub async fn team_remove(ws: String) -> Result<(), String> {
    let file = file_of(&ws)?;
    let open = POOLS.lock().map_err(|e| e.to_string())?.as_mut().and_then(|m| m.remove(&ws));
    if let Some(pool) = open {
        pool.close().await;
    }
    for suffix in ["", "-wal", "-shm"] {
        let path = PathBuf::from(format!("{}{suffix}", file.display()));
        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn team_export(ws: String) -> Result<String, String> {
    let pool = pool_for(&ws, false).await?;
    let data = store::export(&pool).await?;
    let home = PathBuf::from(std::env::var("HOME").map_err(|e| e.to_string())?);
    let folder = [home.join("Downloads"), home.clone()].into_iter().find(|p| p.is_dir()).unwrap_or(home);
    let path = folder.join(format!("mizan-team-{}-{}.json", &ws[..ws.len().min(8)], chrono::Local::now().format("%Y-%m-%d-%H%M")));
    fs::write(&path, serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

/// The bridge: open issues assigned to me in every workspace, for the personal Today view.
/// Read-only, and it reads team files only.
#[tauri::command]
pub async fn team_my_issues() -> Result<Vec<Value>, String> {
    let mut out = Vec::new();
    for ws in workspace_ids() {
        let Ok(pool) = pool_for(&ws, false).await else { continue };
        let me = store::get_meta(&pool, "member_id").await;
        let state = store::state(&pool).await?;
        let rows = state["rows"].as_array().cloned().unwrap_or_default();
        let ws_name = rows.iter().find(|r| r["entity"] == "workspace").and_then(|r| r["data"]["name"].as_str()).unwrap_or("Workspace").to_string();
        let keys: HashMap<String, String> = rows
            .iter()
            .filter(|r| r["entity"] == "project")
            .map(|r| (r["id"].as_str().unwrap_or_default().to_string(), r["data"]["key"].as_str().unwrap_or("?").to_string()))
            .collect();
        for r in rows.iter().filter(|r| r["entity"] == "issue") {
            let d = &r["data"];
            let open = !["done", "canceled"].contains(&d["status"].as_str().unwrap_or(""));
            if d["assignee"].as_str() == Some(me.as_str()) && open && d["deleted"] != true {
                let key = keys.get(d["project_id"].as_str().unwrap_or_default()).cloned().unwrap_or_else(|| "?".into());
                out.push(json!({
                    "ws": ws, "ws_name": ws_name, "id": r["id"], "key": format!("{key}-{}", d["number"].as_i64().map(|n| n.to_string()).unwrap_or("?".into())),
                    "title": d["title"], "status": d["status"], "priority": d["priority"], "due": d["due"], "estimate": d["estimate"],
                }));
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invite_links_round_trip() {
        let link = invite_link("abc123", "c0de", &["192.168.1.5".into(), "10.0.0.2".into()], "47616", "Acme & Co");
        let p = parse_invite(&link).unwrap();
        assert_eq!(p["name"], "Acme & Co");
        assert_eq!(p["hosts"], "192.168.1.5,10.0.0.2");
        assert!(parse_invite("mizan-team://join?ws=a").is_err());
        assert_eq!(bases("1.2.3.4, 5.6.7.8", "1", "http://5.6.7.8:1"), vec!["http://5.6.7.8:1", "http://1.2.3.4:1"]);
        assert!(!valid_ws("../etc"));
    }

    /// A teammate (or the phone) joining over real HTTP, pushing an edit and pulling it back.
    #[test]
    fn join_push_and_pull_over_http() {
        let tmp = std::env::temp_dir().join(format!("mizan-team-test-{}", store::random_hex(4)));
        let _ = DIR.set(tmp.clone());
        tauri::async_runtime::block_on(async {
            let ws = team_create("Acme".into(), "Ana".into()).await.unwrap()["id"].as_str().unwrap().to_string();
            let pool = pool_for(&ws, false).await.unwrap();
            let owner = store::get_meta(&pool, "member_id").await;
            team_submit(ws.clone(), vec![json!({ "entity": "project", "id": "p1", "kind": "create", "fields": { "key": "WEB", "name": "Website" } })]).await.unwrap();
            let code = store::create_invite(&pool, "member", &owner, "owner").await.unwrap();
            let port = 47_900 + (std::process::id() % 90) as u16;
            server::start(port).unwrap();
            let base = format!("http://127.0.0.1:{port}");
            let (ws2, base2) = (ws.clone(), base.clone());
            let joined = tauri::async_runtime::spawn_blocking(move || {
                let t = Duration::from_secs(5);
                assert_eq!(server::request(&base2, "GET", "/team/v1/ping", None, None, t).unwrap()["app"], "mizan-team");
                let joined = server::request(&base2, "POST", "/team/v1/join", None, Some(&json!({ "ws": ws2, "code": code, "name": "Mo" })), t).unwrap();
                let token = joined["token"].as_str().unwrap().to_string();
                let op = json!({ "op_id": "op1", "hlc": store::format_hlc(store::now_ms(), 0, "phone"), "entity": "issue", "id": "i1", "kind": "create",
                                 "fields": { "project_id": "p1", "title": "From the phone", "status": "todo" } });
                let pushed = server::request(&base2, "POST", &format!("/team/v1/ws/{ws2}/ops"), Some(&token), Some(&json!({ "ops": [op] })), t).unwrap();
                assert_eq!(pushed["accepted"][0]["number"], 1);
                let pulled = server::request(&base2, "GET", &format!("/team/v1/ws/{ws2}/pull?after=0"), Some(&token), None, t).unwrap();
                assert!(pulled["rows"].as_array().unwrap().iter().any(|r| r["data"]["title"] == "From the phone"));
                assert_eq!(server::request(&base2, "GET", &format!("/team/v1/ws/{ws2}/pull"), Some("wrong"), None, t).unwrap_err().0, 401);
                joined
            })
            .await
            .unwrap();
            assert_eq!(joined["role"], "member");
            server::stop();
            let mine = store::row(&pool, "issue", "i1").await.unwrap();
            assert_eq!(mine["reporter"], joined["member"]);
            team_remove(ws.clone()).await.unwrap();
            assert!(!file_of(&ws).unwrap().exists());
        });
        let _ = fs::remove_dir_all(tmp);
    }
}
