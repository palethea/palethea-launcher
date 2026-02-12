use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LogPayload {
    pub level: String,
    pub message: String,
    pub timestamp: String,
}

pub fn emit_log(app_handle: &AppHandle, level: &str, message: &str) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string();
    
    let _ = app_handle.emit("app-log", LogPayload {
        level: level.to_string(),
        message: message.to_string(),
        timestamp,
    });
    
    // Also log to standard output for debugging
    match level {
        "info" => log::info!("{}", message),
        "warn" => log::warn!("{}", message),
        "error" => log::error!("{}", message),
        _ => log::debug!("{}", message),
    }
}

pub fn append_shortcut_debug(message: &str) {
    append_debug_file("shortcut_debug.log", message);
}

fn append_debug_file(filename: &str, message: &str) {
    let debug_path = crate::minecraft::downloader::get_minecraft_dir().join(filename);
    if let Some(parent) = debug_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let line = format!("[{}] {}\n", timestamp, message);

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(debug_path) {
        let _ = file.write_all(line.as_bytes());
    }
}

#[macro_export]
macro_rules! log_info {
    ($app:expr, $($arg:tt)*) => {
        $crate::minecraft::logger::emit_log($app, "info", &format!($($arg)*))
    };
}

#[macro_export]
macro_rules! log_warn {
    ($app:expr, $($arg:tt)*) => {
        $crate::minecraft::logger::emit_log($app, "warn", &format!($($arg)*))
    };
}

#[macro_export]
macro_rules! log_error {
    ($app:expr, $($arg:tt)*) => {
        $crate::minecraft::logger::emit_log($app, "error", &format!($($arg)*))
    };
}
