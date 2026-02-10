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
pub mod discord;

use std::sync::Mutex;
use std::sync::LazyLock;
use std::time::Duration;
static LAUNCHER_VERSION: Mutex<String> = Mutex::new(String::new());
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(format!("PaletheaLauncher/{}", get_launcher_version()))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(900))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});

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

pub fn http_client() -> reqwest::Client {
    HTTP_CLIENT.clone()
}
