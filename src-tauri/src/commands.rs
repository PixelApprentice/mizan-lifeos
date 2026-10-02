// Commands bridging the disc system (tracker.csv, logs, day math) and the site shield.

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
    let mut header: Vec<String> = lines[0].split(',').map(String::from).collect();
    // Custom routine items get their own column, appended once. Older rows read it as empty.
    let column_ok = |k: &str| {
        k.len() <= 40 && k.starts_with(|c: char| c.is_ascii_lowercase()) && k.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
    };
    let mut new_columns: Vec<&String> = fields.keys().filter(|k| !header.contains(k)).collect();
    if new_columns.iter().any(|k| !column_ok(k)) {
        return Err("unknown tracker column in update".into());
    }
    if header.len() + new_columns.len() > 200 {
        return Err("the tracker has too many columns".into());
    }
    new_columns.sort();
    for k in new_columns {
        header.push(k.clone());
    }
    lines[0] = header.join(",");
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracker_accepts_custom_routine_columns() {
        let dir = std::env::temp_dir().join(format!("mizan-tracker-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let disc = Some(dir.display().to_string());
        upsert_tracker_row("2025-01-02".into(), HashMap::from([("movement".into(), "1".into())]), disc.clone()).unwrap();
        upsert_tracker_row("2025-01-03".into(), HashMap::from([("reading_min".into(), "25".into())]), disc.clone()).unwrap();
        let rows = read_tracker(disc.clone()).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["reading_min"], "");
        assert_eq!(rows[1]["reading_min"], "25");
        assert_eq!(rows[0]["movement"], "1");
        for bad in ["Bad", "1x", "a-b", "a,b"] {
            assert!(upsert_tracker_row("2025-01-04".into(), HashMap::from([(bad.to_string(), "1".into())]), disc.clone()).is_err(), "{bad}");
        }
        let _ = fs::remove_dir_all(&dir);
    }
}
