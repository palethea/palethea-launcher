pub mod versions;
pub mod downloader;
pub mod launcher;
pub mod instances;
pub mod settings;
pub mod auth;
pub mod modrinth;
pub mod files;
pub mod fabric;
pub mod forge;
pub mod java;
pub mod logger;
pub mod ping;

use std::sync::Mutex;
static LAUNCHER_VERSION: Mutex<String> = Mutex::new(String::new());

pub fn set_launcher_version(version: String) {
    if let Ok(mut v) = LAUNCHER_VERSION.lock() {
        *v = version;
    }
}

pub fn get_launcher_version() -> String {
    if let Ok(v) = LAUNCHER_VERSION.lock() {
        if !v.is_empty() {
            return v.clone();
        }
    }
    // Fallback if not set yet (should basically never happen after setup)
    "0.2.11".to_string()
}
