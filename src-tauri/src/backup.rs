// Daily snapshot of the database. Phone sync writes into the same file, so a bad merge,
// a crash mid-write, or a mistaken bulk delete must always be recoverable.

use sqlx::SqlitePool;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::AppHandle;

const KEEP: usize = 14;

pub fn backup_dir() -> PathBuf {
    crate::focus::state_dir().join("backups")
}

/// `VACUUM INTO` writes a consistent copy even while the app is using the database.
pub async fn snapshot(pool: &SqlitePool, dir: &Path, day: &str) -> Result<Option<PathBuf>, String> {
    fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let target = dir.join(format!("mizan-{day}.db"));
    if target.exists() {
        return Ok(None);
    }
    let partial = dir.join(format!("mizan-{day}.db.partial"));
    let _ = fs::remove_file(&partial);
    sqlx::query("VACUUM INTO ?")
        .bind(partial.to_string_lossy().into_owned())
        .execute(pool)
        .await
        .map_err(|e| format!("Backup failed: {e}"))?;
    fs::rename(&partial, &target).map_err(|e| e.to_string())?;
    prune(dir);
    Ok(Some(target))
}

fn prune(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut snapshots: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("mizan-") && n.ends_with(".db"))
        })
        .collect();
    snapshots.sort();
    let extra = snapshots.len().saturating_sub(KEEP);
    for old in snapshots.into_iter().take(extra) {
        let _ = fs::remove_file(old);
    }
}

/// The database opens when the window loads, so wait for it, then snapshot once a day.
pub fn spawn(app: AppHandle) {
    let _ = std::thread::Builder::new().name("mizan-backup".into()).spawn(move || loop {
        if let Ok(pool) = crate::companion::pool(&app) {
            let day = chrono::Local::now().format("%Y-%m-%d").to_string();
            match tauri::async_runtime::block_on(snapshot(&pool, &backup_dir(), &day)) {
                Ok(_) => {
                    tauri::async_runtime::block_on(crate::team::backup_hosted(&backup_dir(), &day));
                    std::thread::sleep(Duration::from_secs(60 * 60))
                }
                Err(error) => {
                    eprintln!("{error}");
                    std::thread::sleep(Duration::from_secs(10 * 60));
                }
            }
        } else {
            std::thread::sleep(Duration::from_secs(5));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    #[test]
    fn snapshots_once_per_day_and_keeps_the_newest_fourteen() {
        tauri::async_runtime::block_on(async {
            let root = std::env::temp_dir().join(format!("mizan-backup-test-{}", std::process::id()));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(&root).unwrap();
            let options = SqliteConnectOptions::new().filename(root.join("live.db")).create_if_missing(true);
            let pool = SqlitePoolOptions::new().max_connections(1).connect_with(options).await.unwrap();
            sqlx::query("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('kept')").execute(&pool).await.unwrap();
            let dir = root.join("backups");

            let first = snapshot(&pool, &dir, "2030-01-01").await.unwrap().expect("first snapshot");
            assert!(snapshot(&pool, &dir, "2030-01-01").await.unwrap().is_none(), "one per day");
            let copy = SqlitePoolOptions::new()
                .connect_with(SqliteConnectOptions::new().filename(&first))
                .await
                .unwrap();
            let v: String = sqlx::query_scalar("SELECT v FROM t").fetch_one(&copy).await.unwrap();
            assert_eq!(v, "kept");
            copy.close().await;

            for day in 2..=20 {
                snapshot(&pool, &dir, &format!("2030-01-{day:02}")).await.unwrap();
            }
            let mut names: Vec<String> = fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
            names.sort();
            assert_eq!(names.len(), KEEP);
            assert_eq!(names.first().unwrap(), "mizan-2030-01-07.db");
            assert_eq!(names.last().unwrap(), "mizan-2030-01-20.db");
            pool.close().await;
            let _ = fs::remove_dir_all(&root);
        });
    }
}
