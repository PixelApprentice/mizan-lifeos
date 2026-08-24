// Commands bridging the disc system (tracker.csv, logs, day math) and task breakdown.

use crate::lifeos::{self, disc_path, DayInfo, LifeosConfig};
use std::collections::HashMap;
use std::fs;
use std::process::Command;

#[tauri::command]
pub fn day_info(date: Option<String>, disc: Option<String>) -> Result<DayInfo, String> {
    let date = lifeos::requested_date(date)?;
    lifeos::info(date, &lifeos::load_config(&disc_path(&disc)?)?)
}

#[tauri::command]
pub fn get_lifeos_config(disc: Option<String>) -> Result<LifeosConfig, String> {
    lifeos::load_config(&disc_path(&disc)?)
}

#[tauri::command]
pub fn set_lifeos_start(start_date: String, disc: Option<String>) -> Result<LifeosConfig, String> {
    lifeos::set_start(&disc_path(&disc)?, start_date)
}

#[tauri::command]
pub fn read_tracker(disc: Option<String>) -> Result<Vec<HashMap<String, String>>, String> {
    let root = disc_path(&disc)?;
    lifeos::initialize(&root)?;
    let path = root.join("tracker.csv");
    let text = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut lines = text.lines();
    let header: Vec<&str> = lines.next().unwrap_or("").split(',').collect();
    let mut rows = Vec::new();
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let cells: Vec<&str> = line.split(',').collect();
        let mut row = HashMap::new();
        for (i, h) in header.iter().enumerate() {
            row.insert(h.to_string(), cells.get(i).unwrap_or(&"").to_string());
        }
        rows.push(row);
    }
    Ok(rows)
}

/// Insert or replace the row for `date`. Missing fields stay empty (insert) or keep prior value (update).
#[tauri::command]
pub fn upsert_tracker_row(
    date: String,
    fields: HashMap<String, String>,
    disc: Option<String>,
) -> Result<(), String> {
    lifeos::parse_date(&date)?;
    let root = disc_path(&disc)?;
    lifeos::initialize(&root)?;
    let path = root.join("tracker.csv");
    let text = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut lines: Vec<String> = text.lines().map(String::from).collect();
    if lines.is_empty() {
        return Err("tracker.csv is empty (no header)".into());
    }
    let header: Vec<String> = lines[0].split(',').map(String::from).collect();
    if fields.keys().any(|k| !header.contains(k)) {
        return Err("unknown tracker column in update".into());
    }
    // Commas would corrupt the CSV; the notes field is the only free-text one.
    if fields.values().any(|v| v.contains([',', '\n', '\r'])) {
        return Err("field values must not contain commas or newlines".into());
    }
    let mut existing: Option<usize> = None;
    for (i, line) in lines.iter().enumerate().skip(1) {
        if line.starts_with(&format!("{date},")) {
            existing = Some(i);
            break;
        }
    }
    let mut cells: Vec<String> = match existing {
        Some(i) => lines[i].split(',').map(String::from).collect(),
        None => vec![String::new(); header.len()],
    };
    cells.resize(header.len(), String::new());
    for (i, h) in header.iter().enumerate() {
        if h == "date" {
            cells[i] = date.clone();
        } else if let Some(v) = fields.get(h) {
            cells[i] = v.clone();
        }
    }
    let row = cells.join(",");
    match existing {
        Some(i) => lines[i] = row,
        None => lines.push(row),
    }
    fs::write(&path, lines.join("\n") + "\n").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ensure_day_log(date: Option<String>, disc: Option<String>) -> Result<String, String> {
    let date = lifeos::requested_date(date)?;
    Ok(lifeos::ensure_log(&disc_path(&disc)?, date)?
        .display()
        .to_string())
}

#[tauri::command]
pub fn read_day_log(date: String, disc: Option<String>) -> Result<String, String> {
    if !valid_date(&date) {
        return Err("date must be YYYY-MM-DD".into());
    }
    let path = disc_path(&disc)?.join("log").join(format!("{date}.md"));
    fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Overwrite the whole log file for `date` with edited content from the in-app editor.
/// The date is validated so it can never escape the `log/` directory, and the file must
/// already exist (the UI creates it via `ensure_day_log` before editing).
#[tauri::command]
pub fn write_day_log(
    date: String,
    content: String,
    disc: Option<String>,
    expected: Option<String>,
) -> Result<(), String> {
    let _guard = lifeos::LOG_LOCK.lock().map_err(|e| e.to_string())?;
    if !valid_date(&date) {
        return Err("date must be YYYY-MM-DD".into());
    }
    let path = disc_path(&disc)?.join("log").join(format!("{date}.md"));
    if !path.exists() {
        return Err("no log for that day yet — create it first".into());
    }
    if let Some(expected) = expected {
        let actual = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        if actual != expected {
            return Err("The log changed while saving. Your draft was kept; retry Save.".into());
        }
    }
    let pending = path.with_extension("md.pending");
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&pending)
        .map_err(|e| e.to_string())?;
    let result = file
        .write_all(content.as_bytes())
        .and_then(|_| file.sync_all())
        .and_then(|_| fs::rename(&pending, &path));
    if result.is_err() {
        let _ = fs::remove_file(&pending);
    }
    result.map_err(|e| format!("{}: {e}", path.display()))
}

/// Guard against path traversal: only a real calendar date maps to a log filename.
fn valid_date(date: &str) -> bool {
    lifeos::parse_date(date).is_ok()
}

#[tauri::command]
pub fn append_to_log(date: String, text: String, disc: Option<String>) -> Result<(), String> {
    let _guard = lifeos::LOG_LOCK.lock().map_err(|e| e.to_string())?;
    use std::io::Write;
    if !valid_date(&date) {
        return Err("date must be YYYY-MM-DD".into());
    }
    let path = disc_path(&disc)?.join("log").join(format!("{date}.md"));
    let mut f = fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    writeln!(f, "\n{text}").map_err(|e| e.to_string())
}

/// Break tasks into local steps without sending their text to a provider.
#[tauri::command]
pub fn breakdown_task(title: String, kind: String, use_ai: bool) -> Result<Vec<String>, String> {
    if use_ai {
        return Err("Remote task decomposition is disabled. Use local template steps.".into());
    }
    if title.trim().is_empty() {
        return Err("Task title is required.".into());
    }
    Ok(template_breakdown(&title, &kind))
}

fn template_breakdown(title: &str, kind: &str) -> Vec<String> {
    let t = title.trim();
    match kind {
        "code" => vec![
            format!(
                "Write the spec for \"{t}\" in the README (what, data model, endpoints/screens)"
            ),
            format!("Draw the data model / component sketch for \"{t}\" on paper"),
            format!("Write one failing test for the core of \"{t}\""),
            format!("Implement the smallest slice of \"{t}\" that makes the test pass"),
            format!("Refactor: every function ≤ 25 lines, named as verbs"),
            format!("Commit + push \"{t}\"; update README with how to run"),
            format!("Teach it: one-take video on the trickiest part of \"{t}\""),
        ],
        "study" => vec![
            format!("Skim \"{t}\" once for structure (10 min, no notes)"),
            format!("Read \"{t}\" and write 5 recall questions"),
            format!("Close the material; answer your questions from memory"),
            format!("Apply \"{t}\" in the current project today"),
            format!("Explain \"{t}\" in the daily video"),
        ],
        "freelance" => vec![
            format!("Define done for \"{t}\" in one sentence the client would sign"),
            format!("List the 3 screens/endpoints \"{t}\" actually needs"),
            format!("Build slice 1 of \"{t}\""),
            format!("Demo to the client / get feedback"),
            format!("Invoice or next-step agreed"),
        ],
        "deen" => vec![
            format!("Read \"{t}\" (text + meaning)"),
            format!("Write 3 lessons in your own words"),
            format!("Act on one lesson today; note where"),
        ],
        _ => vec![
            format!("Define done for \"{t}\" in one sentence"),
            format!("List the concrete steps of \"{t}\" (max 5)"),
            format!("Do step 1 for 25 minutes"),
            format!("Review and schedule the rest"),
        ],
    }
}

// ---------- Permanent ("purity shield") blocklist — always on, independent of deep mode ----------

/// Merge a downloaded hosts/domains list with the user's own entries and apply it to the
/// permanent /etc/hosts section. Returns the number of domains applied.
#[tauri::command]
pub fn perm_block_apply(extra: Vec<String>, import_url: Option<String>) -> Result<usize, String> {
    let mut domains: Vec<String> = extra
        .into_iter()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| is_domain(s))
        .collect();

    if let Some(url) = import_url.filter(|u| !u.trim().is_empty()) {
        let out = Command::new("curl")
            .args(["-sL", "--max-time", "90", url.trim()])
            .output()
            .map_err(|e| format!("curl: {e}"))?;
        if !out.status.success() {
            return Err("download failed — check the URL and your connection".into());
        }
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            let l = line.trim();
            if l.is_empty() || l.starts_with('#') {
                continue;
            }
            // Accept hosts format ("0.0.0.0 domain" / "127.0.0.1 domain") or plain domain lines.
            let dom = l
                .strip_prefix("0.0.0.0 ")
                .or_else(|| l.strip_prefix("127.0.0.1 "))
                .unwrap_or(l)
                .trim()
                .to_lowercase();
            if is_domain(&dom) {
                domains.push(dom);
            }
        }
    }
    domains.sort();
    domains.dedup();
    if domains.is_empty() {
        return Err("no valid domains found".into());
    }
    let file = crate::focus::state_dir().join("perm_block.txt");
    fs::write(&file, domains.join("\n")).map_err(|e| e.to_string())?;
    let out = Command::new("pkexec")
        .arg("/usr/local/bin/mizan-hosts-perm")
        .arg("perm-file")
        .arg(&file)
        .output()
        .map_err(|e| format!("pkexec: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(domains.len())
}

#[tauri::command]
pub fn perm_block_clear() -> Result<(), String> {
    let out = Command::new("pkexec")
        .args(["/usr/local/bin/mizan-hosts-perm", "perm-off"])
        .output()
        .map_err(|e| format!("pkexec: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

fn is_domain(s: &str) -> bool {
    !s.is_empty()
        && s.contains('.')
        && s != "0.0.0.0"
        && s != "localhost"
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}
