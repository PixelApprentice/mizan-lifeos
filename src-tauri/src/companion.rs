// Phone companion: an opt-in server on the local network. A paired phone can mirror the
// focus timer full-screen, control the session, park thoughts, and keep a full local copy of
// tasks, projects, and calendar events that syncs whenever both devices share a network.
//
// Sync is local-first and git-like in spirit: each side keeps every record, edits offline,
// and exchanges changes on reconnect. Conflicts resolve per record, last writer wins, using
// `updated_at` stamps maintained by SQLite triggers; deletions travel as tombstones.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Row, Sqlite, SqlitePool, Transaction};
use std::fs;
use std::io::Read;
use std::net::UdpSocket;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Header, Method, Request, Response, Server};

pub const DEFAULT_PORT: u16 = 47615;
const DB_URL: &str = "sqlite:mizan.db";
const PAGE: &str = include_str!("../../companion/index.html");
const MAX_BODY: u64 = 4 * 1024 * 1024;
const STATUSES: [&str; 4] = ["backlog", "open", "doing", "done"];
const KINDS: [&str; 6] = ["code", "study", "deen", "freelance", "school", "other"];

static APP: OnceLock<AppHandle> = OnceLock::new();
static RUNNING: Mutex<Option<Running>> = Mutex::new(None);

struct Running {
    server: Arc<Server>,
    port: u16,
}

#[derive(Serialize, Deserialize, Clone)]
struct Config {
    enabled: bool,
    port: u16,
    token: String,
    /// Stable identity of this desktop. The phone uses it to recognise the same desktop at a
    /// new address (hotspot and USB tethering hand out a new subnet each time).
    #[serde(default)]
    id: String,
}

#[derive(Serialize)]
pub struct CompanionStatus {
    enabled: bool,
    running: bool,
    port: u16,
    addresses: Vec<String>,
    pair_url: Option<String>,
    qr_svg: Option<String>,
    error: Option<String>,
}

fn config_file() -> PathBuf {
    crate::focus::state_dir().join("companion.json")
}

fn new_token() -> String {
    let mut bytes = [0u8; 16];
    let filled = fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .is_ok();
    if !filled {
        // Extremely unlikely on Linux; still avoid a predictable constant.
        let seed = Utc::now().timestamp_nanos_opt().unwrap_or_default() as u128 ^ std::process::id() as u128;
        bytes.copy_from_slice(&seed.to_le_bytes());
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn load_config() -> Config {
    let mut config = fs::read_to_string(config_file())
        .ok()
        .and_then(|text| serde_json::from_str::<Config>(&text).ok())
        .filter(|c| c.token.len() >= 32)
        .unwrap_or_else(|| Config { enabled: false, port: DEFAULT_PORT, token: new_token(), id: String::new() });
    if config.id.len() < 12 {
        config.id = new_token()[..12].to_string();
        let _ = save_config(&config);
    }
    config
}

fn save_config(config: &Config) -> Result<(), String> {
    let text = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    let path = config_file();
    fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// LAN addresses a phone can reach, primary route first. Container bridges are skipped.
pub(crate) fn lan_addresses() -> Vec<String> {
    let mut found = Vec::new();
    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
        // connect() on UDP only selects a route; no packet is sent.
        if socket.connect("192.0.2.1:9").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                if !addr.ip().is_loopback() && !addr.ip().is_unspecified() {
                    found.push(addr.ip().to_string());
                }
            }
        }
    }
    if let Ok(out) = Command::new("ip").args(["-o", "-4", "addr", "show", "scope", "global"]).output() {
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            let Some(iface) = parts.get(1) else { continue };
            if ["docker", "br-", "veth", "virbr", "podman", "cni"].iter().any(|p| iface.starts_with(p)) {
                continue;
            }
            if let Some(ip) = parts.iter().position(|p| *p == "inet").and_then(|i| parts.get(i + 1)) {
                let ip = ip.split('/').next().unwrap_or_default().to_string();
                if !ip.is_empty() && !found.contains(&ip) {
                    found.push(ip);
                }
            }
        }
    }
    found
}

pub(crate) fn qr_svg(text: &str) -> Option<String> {
    use qrcode::render::svg;
    let code = qrcode::QrCode::new(text.as_bytes()).ok()?;
    Some(
        code.render::<svg::Color>()
            .min_dimensions(240, 240)
            .dark_color(svg::Color("#000000"))
            .light_color(svg::Color("#ffffff"))
            .quiet_zone(true)
            .build(),
    )
}

fn status(error: Option<String>) -> CompanionStatus {
    let config = load_config();
    let running = RUNNING.lock().ok().and_then(|r| r.as_ref().map(|r| r.port));
    let addresses = lan_addresses();
    // Every address goes into the link so the phone can fall back to another network
    // (Wi-Fi, hotspot, USB tethering) without scanning again.
    let pair_url = match (running, addresses.first()) {
        (Some(port), Some(ip)) => Some(format!(
            "http://{ip}:{port}/#pair={}&id={}&hosts={}",
            config.token,
            config.id,
            addresses.join(",")
        )),
        _ => None,
    };
    CompanionStatus {
        enabled: config.enabled,
        running: running.is_some(),
        port: running.unwrap_or(config.port),
        qr_svg: pair_url.as_deref().and_then(qr_svg),
        pair_url,
        addresses,
        error,
    }
}

fn stop() {
    if let Ok(mut running) = RUNNING.lock() {
        if let Some(r) = running.take() {
            r.server.unblock();
        }
    }
}

fn start(config: &Config) -> Result<(), String> {
    stop();
    let server = Server::http(("0.0.0.0", config.port))
        .map_err(|e| format!("Cannot listen on port {}: {e}", config.port))?;
    let server = Arc::new(server);
    let worker = server.clone();
    let token = config.token.clone();
    let id = config.id.clone();
    let port = config.port;
    std::thread::Builder::new()
        .name("mizan-companion".into())
        .spawn(move || {
            for request in worker.incoming_requests() {
                let (token, id) = (token.clone(), id.clone());
                // One short-lived thread per request so a slow phone cannot stall the others.
                let _ = std::thread::Builder::new().spawn(move || handle(request, &token, &id, port));
            }
        })
        .map_err(|e| e.to_string())?;
    *RUNNING.lock().map_err(|e| e.to_string())? = Some(Running { server, port: config.port });
    Ok(())
}

/// Called once at startup: resume the server if the user left it enabled.
pub fn init(app: AppHandle) {
    let _ = APP.set(app);
    let config = load_config();
    if config.enabled {
        if let Err(error) = start(&config) {
            eprintln!("Phone companion did not start: {error}");
        }
    }
}

#[tauri::command]
pub fn companion_status() -> CompanionStatus {
    status(None)
}

#[tauri::command]
pub fn companion_set_enabled(enabled: bool, port: Option<u16>) -> Result<CompanionStatus, String> {
    let mut config = load_config();
    if let Some(port) = port {
        if port < 1024 {
            return Err("Choose a port from 1024 to 65535.".into());
        }
        config.port = port;
    }
    config.enabled = enabled;
    save_config(&config)?;
    if enabled {
        if let Err(error) = start(&config) {
            return Ok(status(Some(error)));
        }
    } else {
        stop();
    }
    Ok(status(None))
}

/// New pairing code: every paired phone must scan again.
#[tauri::command]
pub fn companion_reset_token() -> Result<CompanionStatus, String> {
    let mut config = load_config();
    config.token = new_token();
    save_config(&config)?;
    if config.enabled {
        if let Err(error) = start(&config) {
            return Ok(status(Some(error)));
        }
    }
    Ok(status(None))
}

fn adb_path() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).map(|d| d.join("adb")).collect())
        .unwrap_or_default();
    for var in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Some(sdk) = std::env::var_os(var) {
            candidates.push(PathBuf::from(sdk).join("platform-tools/adb"));
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join("Android/Sdk/platform-tools/adb"));
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// USB cable without any network: `adb reverse` makes `127.0.0.1:<port>` on the phone reach
/// this computer. Needs USB debugging on the phone (one-time "Allow" prompt).
#[tauri::command]
pub fn companion_usb_connect() -> Result<String, String> {
    let port = RUNNING
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|r| r.port)
        .ok_or("Turn the phone companion on first.")?;
    let adb = adb_path().ok_or(
        "adb was not found. Install Android platform tools (Arch: `sudo pacman -S android-tools`), \
         or use USB tethering instead, which needs nothing extra.",
    )?;
    let out = Command::new(&adb).arg("devices").output().map_err(|e| format!("Cannot run adb: {e}"))?;
    let listing = String::from_utf8_lossy(&out.stdout);
    let devices: Vec<(&str, &str)> = listing
        .lines()
        .skip(1)
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            Some((parts.next()?, parts.next()?))
        })
        .collect();
    if devices.is_empty() {
        return Err("No phone found. Plug it in with a data cable and turn on USB debugging \
                    (Settings → Developer options)."
            .into());
    }
    let mut linked = Vec::new();
    let mut problems = Vec::new();
    for (serial, state) in devices {
        match state {
            "device" => {
                // The team host (if this computer runs one) rides the same cable.
                if let Some(team_port) = crate::team::server::running_port() {
                    let rule = format!("tcp:{team_port}");
                    let _ = Command::new(&adb).args(["-s", serial, "reverse", &rule, &rule]).output();
                }
                let rule = format!("tcp:{port}");
                let result = Command::new(&adb).args(["-s", serial, "reverse", &rule, &rule]).output();
                match result {
                    Ok(o) if o.status.success() => linked.push(serial.to_string()),
                    Ok(o) => problems.push(format!("{serial}: {}", String::from_utf8_lossy(&o.stderr).trim())),
                    Err(e) => problems.push(format!("{serial}: {e}")),
                }
            }
            "unauthorized" => problems.push(format!("{serial}: tap \"Allow\" on the phone's USB debugging prompt, then try again")),
            other => problems.push(format!("{serial}: {other}")),
        }
    }
    if linked.is_empty() {
        return Err(problems.join("; "));
    }
    let mut message = format!(
        "USB link ready for {}. The phone app connects through the cable automatically; keep it plugged in.",
        linked.join(", ")
    );
    if !problems.is_empty() {
        message.push_str(&format!(" Not linked: {}.", problems.join("; ")));
    }
    Ok(message)
}

// ---------------- HTTP plumbing ----------------

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("static header")
}

fn respond(request: Request, code: u16, content_type: &str, body: Vec<u8>) {
    let mut response = Response::from_data(body).with_status_code(code);
    for (name, value) in [
        ("Content-Type", content_type),
        ("Cache-Control", "no-store"),
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Headers", "content-type, x-mizan-token"),
        ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
        ("Access-Control-Allow-Private-Network", "true"),
        ("X-Content-Type-Options", "nosniff"),
    ] {
        response.add_header(header(name, value));
    }
    let _ = request.respond(response);
}

fn respond_json(request: Request, code: u16, value: Value) {
    respond(request, code, "application/json", value.to_string().into_bytes());
}

fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn query_param(url: &str, key: &str) -> Option<String> {
    let query = url.split_once('?')?.1;
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        (k == key).then(|| v.replace("%3A", ":").replace("%3a", ":"))
    })
}

fn authorized(request: &Request, token: &str) -> bool {
    let from_header = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("x-mizan-token"))
        .map(|h| h.value.as_str().to_string());
    from_header
        .or_else(|| query_param(request.url(), "token"))
        .is_some_and(|given| same(&given, token))
}

fn read_json(request: &mut Request) -> Result<Value, String> {
    let mut body = String::new();
    request
        .as_reader()
        .take(MAX_BODY)
        .read_to_string(&mut body)
        .map_err(|e| format!("Cannot read request: {e}"))?;
    if body.trim().is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(&body).map_err(|e| format!("Invalid JSON: {e}"))
}

fn handle(mut request: Request, token: &str, id: &str, port: u16) {
    let method = request.method().clone();
    let path = request.url().split('?').next().unwrap_or("/").to_string();
    if method == Method::Options {
        return respond(request, 204, "text/plain", Vec::new());
    }
    match (&method, path.as_str()) {
        (Method::Get, "/") | (Method::Get, "/index.html") => {
            return respond(request, 200, "text/html; charset=utf-8", PAGE.as_bytes().to_vec())
        }
        // Unauthenticated so the phone can look for its desktop on a new network without
        // sending the pairing code to every address it tries.
        (Method::Get, "/api/ping") => return respond_json(request, 200, json!({ "app": "mizan", "id": id })),
        (Method::Get, "/manifest.webmanifest") => {
            let manifest = json!({
                "name": "Mizan", "short_name": "Mizan", "start_url": "/", "display": "fullscreen",
                "orientation": "any", "background_color": "#000000", "theme_color": "#000000"
            });
            return respond(request, 200, "application/manifest+json", manifest.to_string().into_bytes());
        }
        _ => {}
    }
    if !path.starts_with("/api/") {
        return respond_json(request, 404, json!({ "error": "Not found." }));
    }
    if !authorized(&request, token) {
        return respond_json(request, 401, json!({ "error": "Pairing code missing or out of date. Scan the QR code in Mizan Settings again." }));
    }
    let body = if method == Method::Post { read_json(&mut request) } else { Ok(json!({})) };
    let result = body.and_then(|body| route(&method, &path, request.url(), body));
    let result = match (result, path.as_str()) {
        (Ok(mut value), "/api/hello") => {
            value["id"] = json!(id);
            value["port"] = json!(port);
            value["addresses"] = json!(lan_addresses());
            Ok(value)
        }
        (result, _) => result,
    };
    match result {
        Ok(value) => respond_json(request, 200, value),
        Err(error) => respond_json(request, 400, json!({ "error": error })),
    }
}

fn now_stamp() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

fn route(method: &Method, path: &str, url: &str, body: Value) -> Result<Value, String> {
    let app = APP.get().ok_or("Mizan is still starting.")?;
    match (method, path) {
        (Method::Get, "/api/hello") => Ok(json!({
            "app": "mizan",
            "version": env!("CARGO_PKG_VERSION"),
            "now": now_stamp(),
            "host": std::fs::read_to_string("/etc/hostname").unwrap_or_default().trim(),
        })),
        (Method::Get, "/api/focus") => Ok(json!({ "now": now_stamp(), "state": crate::focus::focus_status() })),
        (Method::Post, "/api/focus/start") => {
            let minutes = body["minutes"].as_i64().ok_or("Choose a session length.")?;
            let intent = body["intent"].as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from);
            let pool = pool(app)?;
            let (sites, apps, disc) = tauri::async_runtime::block_on(async {
                let sites = setting(&pool, "blocked_sites").await;
                let apps = setting(&pool, "blocked_apps").await;
                let disc = setting(&pool, "disc_path").await;
                (sites, apps, disc)
            });
            let split = |v: String| v.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect::<Vec<_>>();
            let state = crate::focus::focus_start(minutes, split(sites), split(apps), intent, Some(disc).filter(|d| !d.is_empty()))?;
            crate::focus::focus_changed();
            Ok(json!({ "now": now_stamp(), "state": state }))
        }
        (Method::Post, "/api/focus/pause") => {
            let state = crate::focus::focus_pause()?;
            crate::focus::focus_changed();
            Ok(json!({ "now": now_stamp(), "state": state }))
        }
        (Method::Post, "/api/focus/end") => {
            crate::focus::focus_end(body["reason"].as_str().map(String::from))?;
            crate::focus::focus_changed();
            Ok(json!({ "now": now_stamp(), "state": crate::focus::focus_status() }))
        }
        (Method::Post, "/api/focus/phone-left") | (Method::Get, "/api/focus/phone-left") => {
            Ok(json!({ "phone_leaves": crate::focus::phone_left()? }))
        }
        (Method::Get, "/api/sync") => {
            let since = query_param(url, "since").unwrap_or_default();
            let pool = pool(app)?;
            tauri::async_runtime::block_on(pull(&pool, &since))
        }
        (Method::Post, "/api/sync") => {
            let pool = pool(app)?;
            let since = body["since"].as_str().unwrap_or_default().to_string();
            let (applied, rejected) = tauri::async_runtime::block_on(push(&pool, &body))?;
            if applied > 0 {
                let _ = app.emit("mizan://data-changed", ());
            }
            let mut response = tauri::async_runtime::block_on(pull(&pool, &since))?;
            response["applied"] = json!(applied);
            response["rejected"] = json!(rejected);
            Ok(response)
        }
        _ => Err("Unknown request.".into()),
    }
}

// ---------------- database ----------------

pub(crate) fn pool(app: &AppHandle) -> Result<SqlitePool, String> {
    let instances = app
        .try_state::<tauri_plugin_sql::DbInstances>()
        .ok_or("The database is not ready yet.")?;
    tauri::async_runtime::block_on(async {
        let map = instances.0.read().await;
        #[allow(unreachable_patterns)]
        match map.get(DB_URL) {
            Some(tauri_plugin_sql::DbPool::Sqlite(pool)) => Ok(pool.clone()),
            _ => Err("The database is not ready yet. Open the Mizan window once.".to_string()),
        }
    })
}

async fn setting(pool: &SqlitePool, key: &str) -> String {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?1")
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_default()
}

fn text(row: &sqlx::sqlite::SqliteRow, column: &str) -> Value {
    row.try_get::<Option<String>, _>(column).ok().flatten().map(Value::String).unwrap_or(Value::Null)
}

fn int(row: &sqlx::sqlite::SqliteRow, column: &str) -> Value {
    row.try_get::<Option<i64>, _>(column).ok().flatten().map(Value::from).unwrap_or(Value::Null)
}

fn real(row: &sqlx::sqlite::SqliteRow, column: &str) -> Value {
    row.try_get::<Option<f64>, _>(column).ok().flatten().map(Value::from).unwrap_or(Value::Null)
}

async fn pull(pool: &SqlitePool, since: &str) -> Result<Value, String> {
    let now = now_stamp();
    let e = |e: sqlx::Error| format!("Database read failed: {e}");
    let tasks = sqlx::query(
        "SELECT t.sync_id, t.title, t.notes, t.kind, t.status, t.est_min, t.due, t.priority, t.position,
                t.completed_at, t.created_at, t.updated_at, p.sync_id AS parent_sync, pr.sync_id AS project_sync
         FROM tasks t LEFT JOIN tasks p ON p.id = t.parent_id LEFT JOIN projects pr ON pr.id = t.project_id
         WHERE t.updated_at > ?1 ORDER BY t.updated_at",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .map_err(e)?
    .iter()
    .map(|r| json!({
        "sync_id": text(r, "sync_id"), "title": text(r, "title"), "notes": text(r, "notes"),
        "kind": text(r, "kind"), "status": text(r, "status"), "est_min": int(r, "est_min"),
        "due": text(r, "due"), "priority": int(r, "priority"), "position": real(r, "position"),
        "completed_at": text(r, "completed_at"), "created_at": text(r, "created_at"),
        "updated_at": text(r, "updated_at"), "parent_sync": text(r, "parent_sync"),
        "project_sync": text(r, "project_sync"),
    }))
    .collect::<Vec<_>>();
    let projects = sqlx::query(
        "SELECT sync_id, name, goal, color, due, status, created_at, updated_at FROM projects WHERE updated_at > ?1",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .map_err(e)?
    .iter()
    .map(|r| json!({
        "sync_id": text(r, "sync_id"), "name": text(r, "name"), "goal": text(r, "goal"),
        "color": text(r, "color"), "due": text(r, "due"), "status": text(r, "status"),
        "created_at": text(r, "created_at"), "updated_at": text(r, "updated_at"),
    }))
    .collect::<Vec<_>>();
    let events = sqlx::query(
        "SELECT e.sync_id, e.title, e.start, e.end, e.color, e.done, e.updated_at, t.sync_id AS task_sync
         FROM events e LEFT JOIN tasks t ON t.id = e.task_id WHERE e.updated_at > ?1",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .map_err(e)?
    .iter()
    .map(|r| json!({
        "sync_id": text(r, "sync_id"), "title": text(r, "title"), "start": text(r, "start"),
        "end": text(r, "end"), "color": text(r, "color"), "done": int(r, "done"),
        "updated_at": text(r, "updated_at"), "task_sync": text(r, "task_sync"),
    }))
    .collect::<Vec<_>>();
    let deletions = sqlx::query("SELECT kind, sync_id, deleted_at FROM tombstones WHERE deleted_at > ?1")
        .bind(since)
        .fetch_all(pool)
        .await
        .map_err(e)?
        .iter()
        .map(|r| json!({ "kind": text(r, "kind"), "sync_id": text(r, "sync_id"), "deleted_at": text(r, "deleted_at") }))
        .collect::<Vec<_>>();
    Ok(json!({ "now": now, "tasks": tasks, "projects": projects, "events": events, "deletions": deletions }))
}

fn valid_sync_id(id: &str) -> bool {
    (8..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn valid_stamp(stamp: &str) -> bool {
    DateTime::parse_from_rfc3339(stamp).is_ok()
}

fn opt_str(value: &Value, key: &str) -> Option<String> {
    value[key].as_str().map(String::from)
}

async fn id_for(tx: &mut Transaction<'_, Sqlite>, table: &str, sync_id: Option<String>) -> Option<i64> {
    let sync_id = sync_id?;
    // `table` is always a fixed literal chosen by this module.
    sqlx::query_scalar::<_, i64>(&format!("SELECT id FROM {table} WHERE sync_id = ?1"))
        .bind(sync_id)
        .fetch_optional(&mut **tx)
        .await
        .ok()
        .flatten()
}

/// Last writer wins: apply only when the incoming stamp is newer than both the local row
/// and any local deletion of that record.
async fn newer(tx: &mut Transaction<'_, Sqlite>, table: &str, kind: &str, sync_id: &str, stamp: &str) -> Result<Option<Option<i64>>, sqlx::Error> {
    let existing = sqlx::query(&format!("SELECT id, updated_at FROM {table} WHERE sync_id = ?1"))
        .bind(sync_id)
        .fetch_optional(&mut **tx)
        .await?;
    if let Some(row) = existing {
        let local: Option<String> = row.try_get("updated_at")?;
        return Ok((local.as_deref().unwrap_or("") < stamp).then(|| Some(row.get::<i64, _>("id"))));
    }
    let deleted: Option<String> = sqlx::query_scalar("SELECT deleted_at FROM tombstones WHERE kind = ?1 AND sync_id = ?2")
        .bind(kind)
        .bind(sync_id)
        .fetch_optional(&mut **tx)
        .await?;
    Ok(deleted.is_none_or(|d| d.as_str() < stamp).then_some(None))
}

fn validate_task(t: &Value) -> Result<(), String> {
    let title = t["title"].as_str().unwrap_or_default().trim();
    if title.is_empty() || title.chars().count() > 500 {
        return Err("task title".into());
    }
    if !STATUSES.contains(&t["status"].as_str().unwrap_or_default()) || !KINDS.contains(&t["kind"].as_str().unwrap_or_default()) {
        return Err("task status or kind".into());
    }
    if t["est_min"].as_i64().is_none_or(|m| !(5..=1440).contains(&m)) || t["priority"].as_i64().is_none_or(|p| !(1..=3).contains(&p)) {
        return Err("task estimate or priority".into());
    }
    Ok(())
}

async fn push(pool: &SqlitePool, body: &Value) -> Result<(usize, usize), String> {
    let e = |e: sqlx::Error| format!("Database write failed: {e}");
    let mut tx = pool.begin().await.map_err(e)?;
    let (mut applied, mut rejected) = (0usize, 0usize);
    let list = |key: &str| body[key].as_array().cloned().unwrap_or_default();
    let usable = |v: &Value| {
        v["sync_id"].as_str().is_some_and(valid_sync_id) && v["updated_at"].as_str().is_some_and(valid_stamp)
    };

    for p in list("projects") {
        if !usable(&p) || p["name"].as_str().is_none_or(|n| n.trim().is_empty()) {
            rejected += 1;
            continue;
        }
        let (sid, stamp) = (p["sync_id"].as_str().unwrap(), p["updated_at"].as_str().unwrap());
        let Some(existing) = newer(&mut tx, "projects", "project", sid, stamp).await.map_err(e)? else { continue };
        let q = match existing {
            Some(id) => sqlx::query("UPDATE projects SET name=?2, goal=?3, color=?4, due=?5, status=?6, updated_at=?7 WHERE id=?1").bind(id),
            None => sqlx::query("INSERT INTO projects (sync_id, created_at, name, goal, color, due, status, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)")
                .bind(sid)
                .bind(opt_str(&p, "created_at").unwrap_or_else(now_stamp)),
        };
        let q = rebind(q, vec![
            json!(p["name"].as_str().unwrap().trim()), json!(p["goal"].as_str().unwrap_or("")),
            json!(p["color"].as_str().unwrap_or("#34d399")), p["due"].clone(),
            json!(p["status"].as_str().unwrap_or("active")), json!(stamp),
        ]);
        q.execute(&mut *tx).await.map_err(e)?;
        applied += 1;
    }

    // Parents before children: retry until no progress, then attach orphans at the root.
    let mut pending: Vec<Value> = list("tasks");
    let mut force = false;
    while !pending.is_empty() {
        let before = pending.len();
        let mut next = Vec::new();
        for t in pending {
            if !usable(&t) || validate_task(&t).is_err() {
                rejected += 1;
                continue;
            }
            let parent_sync = opt_str(&t, "parent_sync");
            let parent_id = id_for(&mut tx, "tasks", parent_sync.clone()).await;
            if parent_sync.is_some() && parent_id.is_none() && !force {
                next.push(t);
                continue;
            }
            let (sid, stamp) = (t["sync_id"].as_str().unwrap(), t["updated_at"].as_str().unwrap());
            let Some(existing) = newer(&mut tx, "tasks", "task", sid, stamp).await.map_err(e)? else { continue };
            let project_id = id_for(&mut tx, "projects", opt_str(&t, "project_sync")).await;
            let values = vec![
                json!(t["title"].as_str().unwrap().trim()), json!(t["notes"].as_str().unwrap_or("")),
                t["kind"].clone(), t["status"].clone(), t["est_min"].clone(), t["due"].clone(),
                t["priority"].clone(), json!(t["position"].as_f64().unwrap_or(0.0)), t["completed_at"].clone(),
                json!(parent_id), json!(project_id), json!(stamp),
            ];
            let q = match existing {
                Some(id) => sqlx::query("UPDATE tasks SET title=?2, notes=?3, kind=?4, status=?5, est_min=?6, due=?7, priority=?8, position=?9, completed_at=?10, parent_id=?11, project_id=?12, updated_at=?13 WHERE id=?1").bind(id),
                None => sqlx::query("INSERT INTO tasks (sync_id, title, notes, kind, status, est_min, due, priority, position, completed_at, parent_id, project_id, updated_at, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)")
                    .bind(sid),
            };
            let mut q = rebind(q, values);
            if existing.is_none() {
                q = q.bind(opt_str(&t, "created_at").unwrap_or_else(now_stamp));
            }
            q.execute(&mut *tx).await.map_err(e)?;
            applied += 1;
        }
        if force {
            break;
        }
        force = next.len() == before;
        pending = next;
    }

    for ev in list("events") {
        let start_ok = ev["start"].as_str().is_some_and(|s| !s.is_empty());
        if !usable(&ev) || !start_ok || ev["title"].as_str().is_none_or(|t| t.trim().is_empty()) {
            rejected += 1;
            continue;
        }
        let (sid, stamp) = (ev["sync_id"].as_str().unwrap(), ev["updated_at"].as_str().unwrap());
        let Some(existing) = newer(&mut tx, "events", "event", sid, stamp).await.map_err(e)? else { continue };
        let task_id = id_for(&mut tx, "tasks", opt_str(&ev, "task_sync")).await;
        let values = vec![
            json!(ev["title"].as_str().unwrap().trim()), ev["start"].clone(), ev["end"].clone(),
            json!(ev["color"].as_str().unwrap_or("")), json!(ev["done"].as_i64().unwrap_or(0)), json!(task_id), json!(stamp),
        ];
        let q = match existing {
            Some(id) => sqlx::query("UPDATE events SET title=?2, start=?3, end=?4, color=?5, done=?6, task_id=?7, updated_at=?8 WHERE id=?1").bind(id),
            None => sqlx::query("INSERT INTO events (sync_id, title, start, end, color, done, task_id, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)").bind(sid),
        };
        rebind(q, values).execute(&mut *tx).await.map_err(e)?;
        applied += 1;
    }

    for d in list("deletions") {
        let (Some(kind), Some(sid), Some(at)) = (d["kind"].as_str(), d["sync_id"].as_str(), d["deleted_at"].as_str()) else {
            rejected += 1;
            continue;
        };
        let table = match kind {
            "task" => "tasks",
            "project" => "projects",
            "event" => "events",
            _ => {
                rejected += 1;
                continue;
            }
        };
        if !valid_sync_id(sid) || !valid_stamp(at) {
            rejected += 1;
            continue;
        }
        let result = sqlx::query(&format!("DELETE FROM {table} WHERE sync_id = ?1 AND COALESCE(updated_at, '') <= ?2"))
            .bind(sid)
            .bind(at)
            .execute(&mut *tx)
            .await
            .map_err(e)?;
        applied += result.rows_affected() as usize;
        if result.rows_affected() == 0 {
            // The desktop copy was edited after the phone deleted it, so it wins. Re-stamp it so the
            // phone receives it again even if that edit is older than the phone's last sync.
            sqlx::query(&format!("UPDATE {table} SET updated_at = ?2 WHERE sync_id = ?1"))
                .bind(sid)
                .bind(now_stamp())
                .execute(&mut *tx)
                .await
                .map_err(e)?;
        }
        sqlx::query("INSERT INTO tombstones (kind, sync_id, deleted_at) VALUES (?1, ?2, ?3) ON CONFLICT(kind, sync_id) DO UPDATE SET deleted_at = MAX(deleted_at, excluded.deleted_at)")
            .bind(kind)
            .bind(sid)
            .bind(at)
            .execute(&mut *tx)
            .await
            .map_err(e)?;
    }
    tx.commit().await.map_err(e)?;
    Ok((applied, rejected))
}

type Query<'q> = sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments<'q>>;

fn rebind(mut q: Query<'_>, values: Vec<Value>) -> Query<'_> {
    for value in values {
        q = match value {
            Value::Null => q.bind(None::<String>),
            Value::Bool(b) => q.bind(b as i64),
            Value::Number(n) if n.is_i64() => q.bind(n.as_i64()),
            Value::Number(n) => q.bind(n.as_f64()),
            Value::String(s) => q.bind(s),
            other => q.bind(other.to_string()),
        };
    }
    q
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn db() -> SqlitePool {
        let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        for migration in crate::migrations() {
            sqlx::raw_sql(migration.sql).execute(&pool).await.unwrap();
        }
        pool
    }

    async fn title_of(pool: &SqlitePool, sync_id: &str) -> Option<String> {
        sqlx::query_scalar("SELECT title FROM tasks WHERE sync_id = ?1").bind(sync_id).fetch_optional(pool).await.unwrap()
    }

    fn task(sync_id: &str, title: &str, stamp: &str, parent: Option<&str>) -> Value {
        json!({ "sync_id": sync_id, "title": title, "notes": "", "kind": "code", "status": "open", "est_min": 25,
                "due": null, "priority": 2, "position": 1000.0, "completed_at": null, "updated_at": stamp,
                "parent_sync": parent, "project_sync": null })
    }

    #[test]
    fn desktop_rows_get_sync_metadata_and_are_pulled() {
        tauri::async_runtime::block_on(async {
            let pool = db().await;
            sqlx::query("INSERT INTO tasks (title) VALUES ('Desktop task')").execute(&pool).await.unwrap();
            let pulled = pull(&pool, "").await.unwrap();
            let tasks = pulled["tasks"].as_array().unwrap();
            assert_eq!(tasks.len(), 1);
            assert!(valid_sync_id(tasks[0]["sync_id"].as_str().unwrap()));
            assert!(valid_stamp(tasks[0]["updated_at"].as_str().unwrap()));
            let later = pull(&pool, pulled["now"].as_str().unwrap()).await.unwrap();
            assert!(later["tasks"].as_array().unwrap().is_empty());
        });
    }

    #[test]
    fn last_writer_wins_and_children_can_arrive_before_parents() {
        tauri::async_runtime::block_on(async {
            let pool = db().await;
            let body = json!({ "tasks": [
                task("child-0001", "Child", "2030-01-01T00:00:01.000Z", Some("parent-0001")),
                task("parent-0001", "Parent", "2030-01-01T00:00:00.000Z", None),
                json!({ "sync_id": "bad-00001", "title": "", "updated_at": "2030-01-01T00:00:00.000Z" }),
            ]});
            assert_eq!(push(&pool, &body).await.unwrap(), (2, 1));
            let linked: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks c JOIN tasks p ON p.id = c.parent_id WHERE c.sync_id='child-0001' AND p.sync_id='parent-0001'")
                .fetch_one(&pool).await.unwrap();
            assert_eq!(linked, 1);

            let stale = json!({ "tasks": [task("parent-0001", "Older edit", "2029-01-01T00:00:00.000Z", None)] });
            assert_eq!(push(&pool, &stale).await.unwrap(), (0, 0));
            assert_eq!(title_of(&pool, "parent-0001").await.as_deref(), Some("Parent"));

            let fresh = json!({ "tasks": [task("parent-0001", "Newer edit", "2030-02-01T00:00:00.000Z", None)] });
            assert_eq!(push(&pool, &fresh).await.unwrap(), (1, 0));
            assert_eq!(title_of(&pool, "parent-0001").await.as_deref(), Some("Newer edit"));
        });
    }

    #[test]
    fn deletions_cascade_leave_tombstones_and_block_stale_resurrection() {
        tauri::async_runtime::block_on(async {
            let pool = db().await;
            let body = json!({ "tasks": [
                task("parent-0001", "Parent", "2030-01-01T00:00:00.000Z", None),
                task("child-0001", "Child", "2030-01-01T00:00:00.000Z", Some("parent-0001")),
            ]});
            assert_eq!(push(&pool, &body).await.unwrap(), (2, 0));
            let delete = json!({ "deletions": [{ "kind": "task", "sync_id": "parent-0001", "deleted_at": "2030-03-01T00:00:00.000Z" }] });
            push(&pool, &delete).await.unwrap();
            let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks").fetch_one(&pool).await.unwrap();
            assert_eq!(left, 0);
            let tombstones: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tombstones WHERE kind='task'").fetch_one(&pool).await.unwrap();
            assert_eq!(tombstones, 2);
            assert_eq!(pull(&pool, "").await.unwrap()["deletions"].as_array().unwrap().len(), 2);

            let old_copy = json!({ "tasks": [task("parent-0001", "Parent", "2030-02-01T00:00:00.000Z", None)] });
            push(&pool, &old_copy).await.unwrap();
            assert_eq!(title_of(&pool, "parent-0001").await, None);
        });
    }

    #[test]
    fn newer_desktop_edit_survives_phone_deletion_and_is_sent_back() {
        tauri::async_runtime::block_on(async {
            let pool = db().await;
            let ago = |secs: i64| (chrono::Utc::now() - chrono::Duration::seconds(secs)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
            // Phone deletes at -120 s (offline), desktop edits at -60 s, phone last synced at -30 s.
            push(&pool, &json!({ "tasks": [task("keep-00001", "Edited on desktop", &ago(60), None)] })).await.unwrap();
            let delete = json!({ "deletions": [{ "kind": "task", "sync_id": "keep-00001", "deleted_at": ago(120) }] });
            push(&pool, &delete).await.unwrap();
            assert_eq!(title_of(&pool, "keep-00001").await.as_deref(), Some("Edited on desktop"));
            let pulled = pull(&pool, &ago(30)).await.unwrap();
            assert!(pulled["tasks"].as_array().unwrap().iter().any(|t| t["sync_id"] == "keep-00001"));
        });
    }
}
