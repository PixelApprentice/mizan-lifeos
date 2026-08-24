use chrono::{Datelike, Local, NaiveDate, Weekday};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const TEMPLATE: &str = include_str!("../../templates/day.md");
const TRACKER: &str = include_str!("../../templates/tracker.csv");
static CONFIG_LOCK: Mutex<()> = Mutex::new(());
pub static LOG_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Deserialize, Serialize)]
pub struct LifeosConfig {
    pub start_date: String,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Prayers {
    pub fajr: String,
    pub dhuhr: String,
    pub asr: String,
    pub maghrib: String,
    pub isha: String,
}

impl Default for Prayers {
    fn default() -> Self {
        Self {
            fajr: "check".into(),
            dhuhr: "check".into(),
            asr: "check".into(),
            maghrib: "check".into(),
            isha: "check".into(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct DayInfo {
    pub date: String,
    pub day1: String,
    pub day1_weekday: u32,
    pub dow: String,
    pub day: i64,
    pub week: i64,
    pub fasting: bool,
    pub prayers: Prayers,
}

pub fn disc_path(over: &Option<String>) -> Result<PathBuf, String> {
    if let Some(p) = over.as_deref().filter(|p| !p.trim().is_empty()) {
        return Ok(PathBuf::from(p));
    }
    if let Ok(p) = std::env::var("MIZAN_DISC") {
        if !p.trim().is_empty() {
            return Ok(PathBuf::from(p));
        }
    }
    std::env::var_os("HOME")
        .filter(|p| !p.is_empty())
        .map(|home| PathBuf::from(home).join("Documents/lifeos"))
        .ok_or_else(|| "Set a data folder in Settings (HOME is unavailable)".into())
}

pub fn parse_date(date: &str) -> Result<NaiveDate, String> {
    let parsed = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| "date must be a real calendar date in YYYY-MM-DD format".to_string())?;
    if date.len() != 10 || parsed.format("%Y-%m-%d").to_string() != date {
        return Err("date must be YYYY-MM-DD".into());
    }
    Ok(parsed)
}

pub fn requested_date(date: Option<String>) -> Result<NaiveDate, String> {
    date.map(|date| parse_date(&date))
        .unwrap_or_else(|| Ok(Local::now().date_naive()))
}

fn create_if_missing(path: &Path, content: &str) -> Result<(), String> {
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(mut file) => file
            .write_all(content.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|e| format!("{}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

fn load_config_inner(root: &Path) -> Result<LifeosConfig, String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let path = root.join("lifeos.json");
    let initial = LifeosConfig {
        start_date: Local::now().format("%Y-%m-%d").to_string(),
        extra: BTreeMap::new(),
    };
    create_if_missing(
        &path,
        &(serde_json::to_string_pretty(&initial).map_err(|e| e.to_string())? + "\n"),
    )?;
    let text = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let config: LifeosConfig =
        serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    parse_date(&config.start_date)?;
    Ok(config)
}

pub fn load_config(root: &Path) -> Result<LifeosConfig, String> {
    let _guard = CONFIG_LOCK.lock().map_err(|e| e.to_string())?;
    load_config_inner(root)
}

pub fn set_start(root: &Path, start_date: String) -> Result<LifeosConfig, String> {
    parse_date(&start_date)?;
    let _guard = CONFIG_LOCK.lock().map_err(|e| e.to_string())?;
    let mut config = load_config_inner(root)?;
    config.start_date = start_date;
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())? + "\n";
    // Stage in the data directory so rename stays on the same filesystem.
    let pending = root.join("lifeos.json.pending");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&pending)
        .map_err(|e| format!("{}: {e}", pending.display()))?;
    let result = file
        .write_all(content.as_bytes())
        .and_then(|_| file.sync_all())
        .and_then(|_| fs::rename(&pending, root.join("lifeos.json")));
    if result.is_err() {
        let _ = fs::remove_file(&pending);
    }
    result.map_err(|e| e.to_string())?;
    Ok(config)
}

pub fn info(date: NaiveDate, config: &LifeosConfig) -> Result<DayInfo, String> {
    let start = parse_date(&config.start_date)?;
    let day = (date - start).num_days() + 1;
    let prayer_value = config
        .extra
        .get("monthly_prayers")
        .and_then(|months| months.get(date.month().to_string()));
    let prayers = match prayer_value {
        Some(value) => serde_json::from_value(value.clone())
            .map_err(|e| format!("Invalid offline prayer times: {e}"))?,
        None => Prayers::default(),
    };
    Ok(DayInfo {
        date: date.format("%Y-%m-%d").to_string(),
        day1: config.start_date.clone(),
        day1_weekday: start.weekday().num_days_from_sunday(),
        dow: date.format("%A").to_string(),
        day,
        week: (day.max(1) - 1) / 7 + 1,
        fasting: matches!(date.weekday(), Weekday::Mon | Weekday::Thu),
        prayers,
    })
}

pub fn initialize(root: &Path) -> Result<(), String> {
    load_config(root)?;
    fs::create_dir_all(root.join("log")).map_err(|e| e.to_string())?;
    create_if_missing(&root.join("log/TEMPLATE.md"), TEMPLATE)?;
    create_if_missing(&root.join("tracker.csv"), TRACKER)
}

pub fn ensure_log(root: &Path, date: NaiveDate) -> Result<PathBuf, String> {
    initialize(root)?;
    let day = info(date, &load_config(root)?)?;
    let path = root.join("log").join(format!("{}.md", day.date));
    if path.exists() {
        return Ok(path);
    }
    let mut content =
        fs::read_to_string(root.join("log/TEMPLATE.md")).map_err(|e| e.to_string())?;
    for (key, value) in [
        ("DATE", day.date),
        ("DAY", day.day.to_string()),
        ("DAY1", day.day1),
        ("DOW", day.dow),
        ("WEEK", day.week.to_string()),
        ("FASTING", if day.fasting { "yes" } else { "no" }.into()),
        ("FAJR", day.prayers.fajr),
        ("DHUHR", day.prayers.dhuhr),
        ("ASR", day.prayers.asr),
        ("MAGHRIB", day.prayers.maghrib),
        ("ISHA", day.prayers.isha),
    ] {
        content = content.replace(&format!("{{{{{key}}}}}"), &value);
    }
    create_if_missing(&path, &content)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target/lifeos-tests")
                .join(format!(
                    "{}-{}",
                    std::process::id(),
                    NEXT.fetch_add(1, Ordering::SeqCst)
                ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn config() -> LifeosConfig {
        LifeosConfig {
            start_date: "2030-01-01".into(),
            extra: BTreeMap::new(),
        }
    }

    #[test]
    fn day_one() {
        let day = info(parse_date("2030-01-01").unwrap(), &config()).unwrap();
        assert_eq!((day.day, day.week, day.day1_weekday), (1, 1, 2));
        assert_eq!(day.dow, "Tuesday");
    }

    #[test]
    fn day_101_does_not_restart() {
        let day = info(parse_date("2030-04-11").unwrap(), &config()).unwrap();
        assert_eq!((day.day, day.week), (101, 15));
    }

    #[test]
    fn far_future_is_unlimited() {
        let start = parse_date(&config().start_date).unwrap();
        let date = start + chrono::Duration::days(100_000);
        let day = info(date, &config()).unwrap();
        assert_eq!((day.day, day.week), (100_001, 14_286));
    }

    #[test]
    fn before_start_keeps_signed_day_and_upcoming_week() {
        for (date, expected) in [("2029-12-31", 0), ("2029-12-20", -11)] {
            let day = info(parse_date(date).unwrap(), &config()).unwrap();
            assert_eq!((day.day, day.week), (expected, 1));
        }
    }

    #[test]
    fn validates_canonical_calendar_dates() {
        for invalid in [
            "2030-02-29",
            "2030-13-01",
            "2030-1-2",
            "../2030-01-01",
            "",
            "2030-01-01\n",
        ] {
            assert!(parse_date(invalid).is_err(), "{invalid}");
        }
        assert!(parse_date("2028-02-29").is_ok());
    }

    #[test]
    fn config_defaults_today_and_persists_without_losing_custom_fields() {
        let dir = Fixture::new();
        assert_eq!(
            load_config(&dir.0).unwrap().start_date,
            Local::now().format("%Y-%m-%d").to_string()
        );
        fs::write(
            dir.0.join("lifeos.json"),
            r#"{"start_date":"2030-01-01","custom":{"keep":true}}"#,
        )
        .unwrap();
        set_start(&dir.0, "2027-03-04".into()).unwrap();
        let saved = load_config(&dir.0).unwrap();
        assert_eq!(saved.start_date, "2027-03-04");
        assert_eq!(saved.extra["custom"]["keep"], true);
        assert!(set_start(&dir.0, "2027-02-29".into()).is_err());
        assert_eq!(load_config(&dir.0).unwrap().start_date, "2027-03-04");
    }

    #[test]
    fn log_save_rejects_stale_content_and_persists_success() {
        let dir = Fixture::new();
        let date = "2030-01-01".to_string();
        ensure_log(&dir.0, parse_date(&date).unwrap()).unwrap();
        let root = Some(dir.0.to_string_lossy().into_owned());
        let original = crate::commands::read_day_log(date.clone(), root.clone()).unwrap();
        crate::commands::append_to_log(date.clone(), "External note".into(), root.clone()).unwrap();
        assert!(crate::commands::write_day_log(
            date.clone(),
            "Stale overwrite".into(),
            root.clone(),
            Some(original)
        )
        .is_err());
        let disk = crate::commands::read_day_log(date.clone(), root.clone()).unwrap();
        assert!(disk.contains("External note"));
        let updated = format!("{disk}\nEdited in app");
        crate::commands::write_day_log(date.clone(), updated.clone(), root.clone(), Some(disk))
            .unwrap();
        assert_eq!(crate::commands::read_day_log(date, root).unwrap(), updated);
        assert!(!dir.0.join("log/2030-01-01.md.pending").exists());
    }

    #[test]
    fn initialization_and_logs_preserve_existing_records() {
        let dir = Fixture::new();
        set_start(&dir.0, config().start_date).unwrap();
        let first = ensure_log(&dir.0, parse_date("2030-01-01").unwrap()).unwrap();
        assert!(fs::read_to_string(&first)
            .unwrap()
            .starts_with("# Day 1 — Tuesday"));
        fs::write(&first, "private notes").unwrap();
        fs::write(dir.0.join("tracker.csv"), "existing tracker").unwrap();
        fs::write(dir.0.join("log/TEMPLATE.md"), "custom {{DATE}} day {{DAY}}").unwrap();
        ensure_log(&dir.0, parse_date("2030-01-01").unwrap()).unwrap();
        let later = ensure_log(&dir.0, parse_date("2030-04-11").unwrap()).unwrap();
        assert_eq!(
            fs::read_to_string(later).unwrap(),
            "custom 2030-04-11 day 101"
        );
        assert_eq!(fs::read_to_string(first).unwrap(), "private notes");
        assert_eq!(
            fs::read_to_string(dir.0.join("tracker.csv")).unwrap(),
            "existing tracker"
        );
    }
}
