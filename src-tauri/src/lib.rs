// Mizan — personal discipline app. Library entry: plugins, migrations, commands, focus watcher.

mod backup;
mod commands;
mod companion;
mod focus;
mod lifeos;
mod recover;
mod team;

use tauri::{Emitter, WindowEvent};
use tauri_plugin_sql::{Migration, MigrationKind};

pub(crate) fn migrations() -> Vec<Migration> {
    vec![
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
        // Manual board order, completion time (stats), and sync bookkeeping for the phone
        // companion: stable sync ids, last-modified stamps, and tombstones for deletions.
        // Triggers keep these current for every writer (UI, sync server) automatically.
        Migration {
            version: 3,
            description: "task order, completion time, sync metadata",
            sql: r#"
                ALTER TABLE tasks ADD COLUMN position REAL NOT NULL DEFAULT 0;
                ALTER TABLE tasks ADD COLUMN completed_at TEXT;
                ALTER TABLE tasks ADD COLUMN sync_id TEXT;
                ALTER TABLE tasks ADD COLUMN updated_at TEXT;
                ALTER TABLE projects ADD COLUMN sync_id TEXT;
                ALTER TABLE projects ADD COLUMN updated_at TEXT;
                ALTER TABLE events ADD COLUMN sync_id TEXT;
                ALTER TABLE events ADD COLUMN updated_at TEXT;

                UPDATE tasks SET position = 1024 * (
                    SELECT COUNT(*) FROM tasks AS o
                    WHERE o.status = tasks.status AND o.parent_id IS tasks.parent_id
                      AND (CASE WHEN tasks.parent_id IS NULL
                                THEN (o.priority < tasks.priority OR (o.priority = tasks.priority AND o.id <= tasks.id))
                                ELSE o.id <= tasks.id END)
                );
                UPDATE tasks SET completed_at = created_at WHERE status = 'done';
                UPDATE tasks SET sync_id = lower(hex(randomblob(16))), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
                UPDATE projects SET sync_id = lower(hex(randomblob(16))), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
                UPDATE events SET sync_id = lower(hex(randomblob(16))), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
                CREATE UNIQUE INDEX IF NOT EXISTS tasks_sync_id ON tasks(sync_id);
                CREATE UNIQUE INDEX IF NOT EXISTS projects_sync_id ON projects(sync_id);
                CREATE UNIQUE INDEX IF NOT EXISTS events_sync_id ON events(sync_id);
                CREATE INDEX IF NOT EXISTS tasks_lane ON tasks(parent_id, status, position);

                CREATE TABLE IF NOT EXISTS tombstones (
                    kind TEXT NOT NULL,
                    sync_id TEXT NOT NULL,
                    deleted_at TEXT NOT NULL,
                    PRIMARY KEY (kind, sync_id)
                );

                -- Rows written by sync carry their own sync_id and stamp; plain app writes get them here.
                -- OLD.sync_id IS NULL means the insert trigger is filling in metadata, so it is not an edit.
                CREATE TRIGGER tasks_sync_insert AFTER INSERT ON tasks WHEN NEW.sync_id IS NULL OR NEW.updated_at IS NULL BEGIN
                    UPDATE tasks SET sync_id = COALESCE(NEW.sync_id, lower(hex(randomblob(16)))),
                        updated_at = COALESCE(NEW.updated_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = NEW.id;
                END;
                CREATE TRIGGER tasks_sync_update AFTER UPDATE ON tasks WHEN NEW.updated_at IS OLD.updated_at AND OLD.sync_id IS NOT NULL BEGIN
                    UPDATE tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
                END;
                CREATE TRIGGER tasks_sync_delete AFTER DELETE ON tasks WHEN OLD.sync_id IS NOT NULL BEGIN
                    INSERT OR REPLACE INTO tombstones VALUES ('task', OLD.sync_id, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
                END;

                CREATE TRIGGER projects_sync_insert AFTER INSERT ON projects WHEN NEW.sync_id IS NULL OR NEW.updated_at IS NULL BEGIN
                    UPDATE projects SET sync_id = COALESCE(NEW.sync_id, lower(hex(randomblob(16)))),
                        updated_at = COALESCE(NEW.updated_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = NEW.id;
                END;
                CREATE TRIGGER projects_sync_update AFTER UPDATE ON projects WHEN NEW.updated_at IS OLD.updated_at AND OLD.sync_id IS NOT NULL BEGIN
                    UPDATE projects SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
                END;
                CREATE TRIGGER projects_sync_delete AFTER DELETE ON projects WHEN OLD.sync_id IS NOT NULL BEGIN
                    INSERT OR REPLACE INTO tombstones VALUES ('project', OLD.sync_id, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
                END;

                CREATE TRIGGER events_sync_insert AFTER INSERT ON events WHEN NEW.sync_id IS NULL OR NEW.updated_at IS NULL BEGIN
                    UPDATE events SET sync_id = COALESCE(NEW.sync_id, lower(hex(randomblob(16)))),
                        updated_at = COALESCE(NEW.updated_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = NEW.id;
                END;
                CREATE TRIGGER events_sync_update AFTER UPDATE ON events WHEN NEW.updated_at IS OLD.updated_at AND OLD.sync_id IS NOT NULL BEGIN
                    UPDATE events SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
                END;
                CREATE TRIGGER events_sync_delete AFTER DELETE ON events WHEN OLD.sync_id IS NOT NULL BEGIN
                    INSERT OR REPLACE INTO tombstones VALUES ('event', OLD.sync_id, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
                END;
            "#,
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = migrations();

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
            commands::perm_block_apply,
            commands::perm_block_clear,
            focus::focus_start,
            focus::focus_end,
            focus::focus_status,
            focus::focus_pause,
            focus::read_sessions,
            focus::app_quit,
            companion::companion_status,
            companion::companion_set_enabled,
            companion::companion_reset_token,
            companion::companion_usb_connect,
            team::team_list,
            team::team_create,
            team::team_state,
            team::team_submit,
            team::team_sync,
            team::team_hosting,
            team::team_invite,
            team::team_join,
            team::team_remove,
            team::team_export,
            team::team_my_issues,
        ])
        .setup(|app| {
            focus::spawn_watcher(app.handle().clone());
            companion::init(app.handle().clone());
            team::init(app.handle().clone());
            backup::spawn(app.handle().clone());
            recover::watch_renderer(app.handle());
            Ok(())
        })
        // Closing the main window quits the whole app instead of leaving
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
