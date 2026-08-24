// Mizan — personal discipline app. Library entry: plugins, migrations, commands, focus watcher.

mod commands;
mod focus;
mod lifeos;

use tauri::{Emitter, WindowEvent};
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "initial schema",
            sql: r#"
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                notes TEXT DEFAULT '',
                kind TEXT DEFAULT 'code',        -- code | study | deen | freelance | school | other
                status TEXT DEFAULT 'open',      -- open | doing | done
                parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
                est_min INTEGER DEFAULT 25,
                due TEXT,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            );
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                start TEXT NOT NULL,
                end TEXT NOT NULL,
                task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
                color TEXT DEFAULT '',
                done INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            INSERT OR IGNORE INTO settings (key, value) VALUES
                ('disc_path', ''),
                ('blocked_sites', ''),
                ('blocked_apps', '');
        "#,
            kind: MigrationKind::Up,
        },
        // Projects (kanban board) — tasks optionally belong to a project; priority orders
        // the board and the auto-planner (1 = high, 2 = normal, 3 = low).
        Migration {
            version: 2,
            description: "projects + task priority",
            sql: r#"
                CREATE TABLE IF NOT EXISTS projects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    goal TEXT DEFAULT '',
                    color TEXT DEFAULT '#34d399',
                    due TEXT,
                    status TEXT DEFAULT 'active',  -- active | archived
                    created_at TEXT DEFAULT (datetime('now','localtime'))
                );
                ALTER TABLE tasks ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
                ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 2;
            "#,
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:mizan.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::day_info,
            commands::get_lifeos_config,
            commands::set_lifeos_start,
            commands::read_tracker,
            commands::upsert_tracker_row,
            commands::ensure_day_log,
            commands::append_to_log,
            commands::read_day_log,
            commands::write_day_log,
            commands::breakdown_task,
            commands::perm_block_apply,
            commands::perm_block_clear,
            focus::focus_start,
            focus::focus_end,
            focus::focus_status,
            focus::focus_pause,
            focus::read_sessions,
            focus::overlay_show,
            focus::overlay_hide,
            focus::app_quit,
        ])
        .setup(|app| {
            focus::spawn_watcher(app.handle().clone());
            Ok(())
        })
        // Closing the main window quits the whole app (overlay included) instead of leaving
        // a headless process behind. Mid-session, the UI asks for a reason first.
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.emit("mizan://close-requested", ()) {
                    eprintln!("Could not request a safe exit: {error}");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
