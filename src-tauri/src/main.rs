// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn log_panics() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(home) = std::env::var_os("HOME") {
            let dir = std::path::PathBuf::from(home).join(".local/state/mizan");
            let _ = std::fs::create_dir_all(&dir);
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join("crash.log"))
            {
                use std::io::Write;
                let thread = std::thread::current();
                let _ = writeln!(
                    f,
                    "[{}] thread '{}' {info}\n{}",
                    chrono::Local::now().to_rfc3339(),
                    thread.name().unwrap_or("unnamed"),
                    std::backtrace::Backtrace::force_capture()
                );
            }
        }
        default_hook(info);
    }));
}

fn main() {
    log_panics();
    // WebKitGTK's DMA-BUF renderer is a common cause of sudden aborts ("Error 71 (Protocol
    // error) dispatching to Wayland display") and blank windows on Wayland compositors such
    // as Hyprland. Use the stable path unless the user explicitly chose otherwise.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
        && std::env::var_os("MIZAN_ENABLE_DMABUF").is_none()
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    mizan_lib::run()
}
