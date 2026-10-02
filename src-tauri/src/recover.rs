// Keeps the window alive when WebKit's renderer process dies (GPU driver bug, out of
// memory). Without this the window goes blank or vanishes and the session looks "crashed".
// Data is safe either way: it lives in SQLite and the focus state file, not in the page.

use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const MAX_RELOADS: usize = 3;
const WINDOW: Duration = Duration::from_secs(120);

static RECENT: Mutex<Vec<Instant>> = Mutex::new(Vec::new());

pub fn crash_log(message: &str) {
    let path = crate::focus::state_dir().join("crash.log");
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "[{}] {message}", chrono::Local::now().to_rfc3339());
    }
    eprintln!("{message}");
}

/// True if another reload is allowed: at most `MAX_RELOADS` within `WINDOW`, so a renderer
/// that dies immediately on every load cannot spin forever.
fn allow_reload(now: Instant) -> bool {
    let Ok(mut recent) = RECENT.lock() else { return false };
    recent.retain(|t| now.duration_since(*t) < WINDOW);
    if recent.len() >= MAX_RELOADS {
        return false;
    }
    recent.push(now);
    true
}

#[cfg(target_os = "linux")]
pub fn watch_renderer(app: &tauri::AppHandle) {
    use tauri::Manager;
    use webkit2gtk::{WebProcessTerminationReason as Reason, WebViewExt};
    let Some(window) = app.get_webview_window("main") else { return };
    let attached = window.with_webview(|platform| {
        platform.inner().connect_web_process_terminated(|view, reason| {
            let why = match reason {
                Reason::Crashed => "crashed",
                Reason::ExceededMemoryLimit => "ran out of memory",
                Reason::TerminatedByApi => return, // deliberate shutdown, not a failure
                _ => "stopped",
            };
            if allow_reload(Instant::now()) {
                crash_log(&format!("WebKit renderer {why}; reloading the window."));
                view.reload();
            } else {
                crash_log(&format!(
                    "WebKit renderer {why} {MAX_RELOADS} times in {}s; not reloading again. \
                     Restart Mizan; if it keeps happening run it from a terminal and check the output.",
                    WINDOW.as_secs()
                ));
            }
        });
    });
    if let Err(error) = attached {
        crash_log(&format!("Cannot watch the WebKit renderer: {error}"));
    }
}

#[cfg(not(target_os = "linux"))]
pub fn watch_renderer(_app: &tauri::AppHandle) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reloads_are_limited_within_the_window_and_recover_after_it() {
        let start = Instant::now();
        assert!(allow_reload(start));
        assert!(allow_reload(start + Duration::from_secs(1)));
        assert!(allow_reload(start + Duration::from_secs(2)));
        assert!(!allow_reload(start + Duration::from_secs(3)), "fourth crash in a row is not reloaded");
        assert!(allow_reload(start + WINDOW + Duration::from_secs(3)), "allowed again once the window passes");
    }
}
