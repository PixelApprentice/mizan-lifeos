// Focus (deep mode): session state file, hosts blocking via pkexec helper,
// Hyprland watcher that warns then closes blacklisted app windows.

use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

static APP: OnceLock<AppHandle> = OnceLock::new();

const WARN_GRACE_SECS: i64 = 10;
const BROKEN_LINGER_SECS: i64 = 300; // hosts stay blocked 5 min after a broken session

pub fn state_dir() -> PathBuf {
    let home = std::env::var("HOME").expect("HOME is required to locate local focus state");
    let dir = PathBuf::from(home).join(".local/state/mizan");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn state_file() -> PathBuf {
    state_dir().join("focus.json")
}

fn sessions_file() -> PathBuf {
    state_dir().join("sessions.jsonl")
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FocusState {
    pub started_at: String,
    pub ends_at: String,
    pub planned_min: i64,
    pub sites: Vec<String>,
    pub apps: Vec<String>,
    pub kills: u32,
    /// What this session is for (shown in notifications; written to the log).
    pub intent: Option<String>,
    /// disc system path captured at start so the watcher thread needs no DB access.
    pub disc: Option<String>,
    /// Timer pause (counting only — blocking stays active). None = running.
    #[serde(default)]
    pub paused_at: Option<String>,
    /// Corner mini-timer: "auto" (only when waybar is hidden), "always", "never".
    #[serde(default = "default_overlay_mode")]
    pub overlay_mode: String,
    /// Set when the user ended early; hosts unblock is delayed BROKEN_LINGER_SECS.
    pub broken_at: Option<String>,
    pub broken_reason: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct SessionRecord {
    pub started_at: String,
    pub ended_at: String,
    pub planned_min: i64,
    pub actual_min: i64,
    pub broken: bool,
    pub reason: String,
    pub kills: u32,
}

fn read_state() -> Option<FocusState> {
    let text = fs::read_to_string(state_file()).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_state(s: &FocusState) {
    if let Ok(text) = serde_json::to_string_pretty(s) {
        let _ = fs::write(state_file(), text);
    }
}

fn clear_state() {
    let _ = fs::remove_file(state_file());
}

fn default_overlay_mode() -> String {
    "auto".into()
}

/// ML4W hides waybar by touching a flag file and killing the process.
fn waybar_hidden() -> bool {
    if let Ok(home) = std::env::var("HOME") {
        if PathBuf::from(home)
            .join(".config/ml4w/settings/waybar-disabled")
            .exists()
        {
            return true;
        }
    }
    !Command::new("pgrep")
        .args(["-x", "waybar"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn parse_t(s: &str) -> Option<DateTime<Local>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&Local))
}

fn hosts_helper(action: &str, sites: &[String]) -> Result<(), String> {
    let mut cmd = Command::new("pkexec");
    cmd.arg("/usr/local/bin/mizan-hosts").arg(action);
    if action == "on" {
        cmd.args(sites);
    }
    let out = cmd.output().map_err(|e| format!("pkexec failed: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "mizan-hosts {action} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(())
}

/// Rotating message pools instead of one fixed string. Index keyed on the minute so
/// repeated notifications don't read like a broken record.
fn pick<'a>(pool: &[&'a str], seed: usize) -> &'a str {
    pool[seed % pool.len()]
}

const WARN_MSGS: &[&str] = &[
    "closes in 10 s. Save your work.",
    "closes in 10 s. You chose this block yourself.",
    "closes in 10 s. The task is still open.",
    "closes in 10 s. Back to the build.",
];
const DONE_MSGS: &[&str] = &[
    "Session done. Log what exists now that didn't this morning.",
    "Session done. One more brick laid.",
    "Session done. Alhamdulillah — now write the log.",
    "Session done. Streak protected.",
];
const KILL_ESCALATION: &[&str] = &[
    "", // 0 kills — nothing to say
    "One app had to be closed for you.",
    "Two apps closed. The urge is a pattern today — one hadith, then back.",
    "Three or more closes. This goes in the Friday review.",
];

fn notify(title: &str, body: &str, urgent: bool) {
    let _ = Command::new("notify-send")
        .args([
            "-a",
            "Mizan",
            "-u",
            if urgent { "critical" } else { "normal" },
            title,
            body,
        ])
        .spawn();
}

fn record_session(state: &FocusState, ended: DateTime<Local>, broken: bool, reason: &str) {
    let started = parse_t(&state.started_at).unwrap_or(ended);
    let rec = SessionRecord {
        started_at: state.started_at.clone(),
        ended_at: ended.to_rfc3339(),
        planned_min: state.planned_min,
        actual_min: (ended - started).num_minutes(),
        broken,
        reason: reason.to_string(),
        kills: state.kills,
    };
    if let Ok(line) = serde_json::to_string(&rec) {
        if let Ok(mut f) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(sessions_file())
        {
            let _ = writeln!(f, "{line}");
        }
    }
    // One honest line into today's disc log.
    let disc = state
        .disc
        .clone()
        .or_else(|| std::env::var("MIZAN_DISC").ok())
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var("HOME").expect("HOME is required to locate local logs"))
                .join("Documents/lifeos")
                .to_string_lossy()
                .into_owned()
        });
    let log = PathBuf::from(disc)
        .join("log")
        .join(format!("{}.md", ended.format("%Y-%m-%d")));
    let _log_guard = match crate::lifeos::LOG_LOCK.lock() {
        Ok(guard) => guard,
        Err(error) => {
            eprintln!("Cannot append the focus summary to the daily log: {error}");
            return;
        }
    };
    if let Ok(mut f) = fs::OpenOptions::new().append(true).open(log) {
        let verdict = if broken {
            format!("BROKEN at {} — reason: {reason}", ended.format("%-I:%M %p"))
        } else {
            "completed".to_string()
        };
        let intent = state.intent.as_deref().unwrap_or("(no stated intent)");
        let _ = writeln!(
            f,
            "\nDeep session [{intent}]: {} min planned, {} min actual, {} app closes, {verdict}",
            rec.planned_min, rec.actual_min, rec.kills
        );
    }
}

#[tauri::command]
pub fn focus_start(
    minutes: i64,
    sites: Vec<String>,
    apps: Vec<String>,
    intent: Option<String>,
    disc: Option<String>,
    overlay_mode: Option<String>,
) -> Result<FocusState, String> {
    // Recover from stale state instead of refusing forever (the "can't restart" bug):
    // an expired session or a broken session past its linger window is cleaned up here.
    if let Some(existing) = read_state() {
        let now = Local::now();
        if let Some(b) = existing.broken_at.as_deref().and_then(parse_t) {
            let left = BROKEN_LINGER_SECS - (now - b).num_seconds();
            if left > 0 {
                return Err(format!(
                    "Broken-session penalty: {} more minute(s) before you may start again.",
                    (left + 59) / 60
                ));
            }
            let _ = hosts_helper("off", &[]);
            clear_state();
            close_overlay();
        } else if existing.paused_at.is_none()
            && parse_t(&existing.ends_at).map(|e| now >= e).unwrap_or(true)
        {
            finish(&existing, now);
        } else {
            return Err("A focus session is already running.".into());
        }
    }
    if !(5..=480).contains(&minutes) {
        return Err("Session length must be 5–480 minutes.".into());
    }
    if !sites.is_empty() {
        hosts_helper("on", &sites)?;
    }
    let now = Local::now();
    let state = FocusState {
        started_at: now.to_rfc3339(),
        ends_at: (now + chrono::Duration::minutes(minutes)).to_rfc3339(),
        planned_min: minutes,
        sites,
        apps,
        kills: 0,
        intent: intent.clone(),
        disc,
        paused_at: None,
        overlay_mode: overlay_mode.unwrap_or_else(default_overlay_mode),
        broken_at: None,
        broken_reason: None,
    };
    write_state(&state);
    let body = match intent.as_deref().filter(|i| !i.trim().is_empty()) {
        Some(i) => format!("{minutes} min on: {i}"),
        None => format!("{minutes} minutes. Blocked sites and apps are enforced."),
    };
    notify("Deep mode ON", &body, false);
    Ok(state)
}

#[tauri::command]
pub fn focus_end(reason: Option<String>) -> Result<(), String> {
    let mut state = read_state().ok_or("No focus session running.")?;
    let now = Local::now();
    let ends = parse_t(&state.ends_at).unwrap_or(now);
    if now < ends {
        // Early end = broken session. Friction: hosts stay blocked 5 more minutes.
        let reason = reason.unwrap_or_else(|| "no reason given".into());
        if reason.trim().len() < 5 {
            return Err("Type a real reason (5+ characters). It goes in the log.".into());
        }
        state.broken_at = Some(now.to_rfc3339());
        state.broken_reason = Some(reason.clone());
        write_state(&state);
        record_session(&state, now, true, &reason);
        notify(
            "Session BROKEN — logged",
            &format!(
                "Sites stay blocked for {} more minutes.",
                BROKEN_LINGER_SECS / 60
            ),
            true,
        );
        Ok(())
    } else {
        finish(&state, now);
        Ok(())
    }
}

fn finish(state: &FocusState, now: DateTime<Local>) {
    let _ = hosts_helper("off", &[]);
    if state.broken_at.is_none() {
        record_session(state, now, false, "");
        let seed = now.timestamp() as usize / 60;
        let mut body = format!("{} min. {}", state.planned_min, pick(DONE_MSGS, seed));
        let esc = KILL_ESCALATION[(state.kills as usize).min(KILL_ESCALATION.len() - 1)];
        if !esc.is_empty() {
            body.push(' ');
            body.push_str(esc);
        }
        notify("Deep mode complete", &body, false);
    }
    clear_state();
    close_overlay();
}

#[tauri::command]
pub fn focus_status() -> Option<FocusState> {
    read_state()
}

/// True while a non-broken session is counting down or paused.
pub fn session_running() -> bool {
    read_state()
        .map(|s| {
            s.broken_at.is_none()
                && (s.paused_at.is_some()
                    || parse_t(&s.ends_at)
                        .map(|e| Local::now() < e)
                        .unwrap_or(false))
        })
        .unwrap_or(false)
}

/// Leave nothing running behind: end any session (an early exit is logged as BROKEN with
/// the given reason), lift the deep-mode hosts block, close the corner window. Without the
/// app's watcher nothing would ever lift the block, which is how a stale block survived before.
pub fn shutdown_cleanup(reason: Option<String>) -> Result<(), String> {
    let hosts = fs::read_to_string("/etc/hosts")
        .map_err(|e| format!("Cannot verify deep-mode blocking before exit: {e}"))?;
    if hosts.lines().any(|line| line.trim() == "# MIZAN-BEGIN") {
        hosts_helper("off", &[])?;
    }
    if let Some(state) = read_state() {
        let now = Local::now();
        if session_running() {
            let r = reason
                .filter(|r| !r.trim().is_empty())
                .unwrap_or_else(|| "exited the app".into());
            record_session(&state, now, true, &format!("exited app — {r}"));
        } else if state.broken_at.is_none() {
            record_session(&state, now, false, "");
        }
    }
    match fs::remove_file(state_file()) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("Cannot clear the focus timer before exit: {e}")),
    }
    close_overlay();
    Ok(())
}

/// Exit button: clean up, then terminate the whole process (all windows, watcher thread).
#[tauri::command]
pub fn app_quit(app: AppHandle, reason: Option<String>) -> Result<(), String> {
    shutdown_cleanup(reason)?;
    app.exit(0);
    Ok(())
}

/// Toggle pause. Pausing freezes the countdown only; sites and apps stay blocked.
#[tauri::command]
pub fn focus_pause() -> Result<FocusState, String> {
    let mut s = read_state().ok_or("No focus session running.")?;
    if s.broken_at.is_some() {
        return Err("Session already broken.".into());
    }
    let now = Local::now();
    match s.paused_at.take() {
        Some(p) => {
            // Resume: push the end time out by however long we were paused.
            if let (Some(pt), Some(ends)) = (parse_t(&p), parse_t(&s.ends_at)) {
                s.ends_at = (ends + (now - pt)).to_rfc3339();
            }
        }
        None => s.paused_at = Some(now.to_rfc3339()),
    }
    write_state(&s);
    Ok(s)
}

// ---------- Corner overlay window (semi-transparent ASCII mini-timer) ----------

/// Hyprland ≥ 0.55 replaced the config keywords with a Lua API: `hyprctl keyword windowrulev2`
/// and `hyprctl dispatch closewindow address:…` no longer parse. Use `hyprctl eval` with the
/// Lua API first and fall back to the legacy commands so older Hyprland still works.
fn hyprctl_lua(script: &str) -> bool {
    Command::new("hyprctl")
        .args(["eval", script])
        .output()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "ok")
        .unwrap_or(false)
}

/// Only a hex address ever reaches a Lua string or legacy arg — no injection surface.
fn valid_address(addr: &str) -> bool {
    !addr.is_empty() && addr.chars().all(|c| c.is_ascii_hexdigit() || c == 'x')
}

fn hypr_close_window(address: &str) {
    if !valid_address(address) {
        return;
    }
    let lua = format!("hl.dispatch(hl.dsp.window.close({{ window = 'address:{address}' }}))");
    if !hyprctl_lua(&lua) {
        let _ = Command::new("hyprctl")
            .args(["dispatch", "closewindow", &format!("address:{address}")])
            .output();
    }
}

fn hypr_overlay_rules() {
    // Apply once per app run — repeated `hl.window_rule` calls would stack duplicate rules.
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        // Float + pin the overlay in the top-right corner on Hyprland; harmless elsewhere.
        // no_focus keeps it from stealing keyboard focus; it stays draggable via startDragging.
        let lua =
            "hl.window_rule({ name = 'mizan-overlay', match = { title = '^(mizan overlay)$' }, \
               float = true, pin = true, no_focus = true, border_size = 0, rounding = 0, \
               size = '190 96', move = '100%-206 46' })";
        if hyprctl_lua(lua) {
            return;
        }
        // Pre-0.55 Hyprland: legacy windowrulev2 keywords.
        for rule in [
            "float, title:^(mizan overlay)$",
            "pin, title:^(mizan overlay)$",
            "noborder, title:^(mizan overlay)$",
            "nofocus, title:^(mizan overlay)$",
            "size 190 96, title:^(mizan overlay)$",
            "move 100%-206 46, title:^(mizan overlay)$",
        ] {
            let _ = Command::new("hyprctl")
                .args(["keyword", "windowrulev2", rule])
                .output();
        }
    });
}

fn create_overlay(app: &AppHandle) {
    if app.get_webview_window("overlay").is_some() {
        return;
    }
    hypr_overlay_rules();
    let _ = WebviewWindowBuilder::new(
        app,
        "overlay",
        WebviewUrl::App("index.html#/overlay".into()),
    )
    .title("mizan overlay")
    .inner_size(190.0, 96.0)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .build();
}

/// Show/hide from any thread; window creation must happen on the main thread.
fn set_overlay(visible: bool) {
    let Some(app) = APP.get() else { return };
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let exists = app2.get_webview_window("overlay").is_some();
        if visible && !exists {
            create_overlay(&app2);
        } else if !visible && exists {
            if let Some(w) = app2.get_webview_window("overlay") {
                let _ = w.close();
            }
        }
    });
}

#[tauri::command]
pub fn overlay_show(app: AppHandle) -> Result<(), String> {
    create_overlay(&app);
    Ok(())
}

#[tauri::command]
pub fn overlay_hide(app: AppHandle) {
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.close();
    }
}

fn close_overlay() {
    if let Some(app) = APP.get() {
        if let Some(w) = app.get_webview_window("overlay") {
            let _ = w.close();
        }
    }
}

#[tauri::command]
pub fn read_sessions() -> Result<Vec<SessionRecord>, String> {
    let text = fs::read_to_string(sessions_file()).unwrap_or_default();
    Ok(text
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect())
}

// ---------- Hyprland watcher ----------

#[derive(Deserialize)]
struct HyprClient {
    address: String,
    class: String,
    title: String,
}

static WARNED: Mutex<Option<HashMap<String, DateTime<Local>>>> = Mutex::new(None);

pub fn spawn_watcher(app: AppHandle) {
    let _ = APP.set(app);
    std::thread::spawn(|| loop {
        watch_tick();
        std::thread::sleep(Duration::from_secs(3));
    });
}

fn watch_tick() {
    let Some(state) = read_state() else {
        if let Ok(mut w) = WARNED.lock() {
            *w = None;
        }
        return;
    };
    let now = Local::now();

    // Broken session past its linger window → unblock and clear.
    if let Some(b) = state.broken_at.as_deref().and_then(parse_t) {
        if (now - b).num_seconds() >= BROKEN_LINGER_SECS {
            let _ = hosts_helper("off", &[]);
            clear_state();
            close_overlay();
        }
        return; // no app enforcement after a break; the damage is logged
    }

    // Natural expiry — never while paused (pause freezes the countdown).
    if state.paused_at.is_none() {
        if let Some(ends) = parse_t(&state.ends_at) {
            if now >= ends {
                finish(&state, now);
                return;
            }
        }
    }

    // Corner overlay follows the chosen mode; "auto" tracks waybar visibility live.
    match state.overlay_mode.as_str() {
        "always" => set_overlay(true),
        "never" => set_overlay(false),
        _ => set_overlay(waybar_hidden()),
    }

    if state.apps.is_empty() {
        return;
    }
    let Ok(out) = Command::new("hyprctl").args(["clients", "-j"]).output() else {
        return;
    };
    let Ok(clients) = serde_json::from_slice::<Vec<HyprClient>>(&out.stdout) else {
        return;
    };
    let mut warned = WARNED.lock().unwrap_or_else(|e| e.into_inner());
    let map = warned.get_or_insert_with(HashMap::new);
    let mut kills = 0u32;

    for c in clients {
        let class = c.class.to_lowercase();
        if !state
            .apps
            .iter()
            .any(|a| !a.is_empty() && class.contains(&a.to_lowercase()))
        {
            continue;
        }
        match map.get(&c.address) {
            None => {
                map.insert(c.address.clone(), now);
                let seed = now.timestamp() as usize / 60;
                notify(
                    "Deep mode: blocked app",
                    &format!("\"{}\" {}", c.title, pick(WARN_MSGS, seed)),
                    true,
                );
            }
            Some(t) if (now - *t).num_seconds() >= WARN_GRACE_SECS => {
                hypr_close_window(&c.address);
                map.remove(&c.address);
                kills += 1;
            }
            _ => {}
        }
    }
    if kills > 0 {
        let mut s = state;
        s.kills += kills;
        write_state(&s);
    }
}
