use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use crate::minecraft::downloader::get_minecraft_dir;

// ----------
// LauncherSettings
// Description: Global settings for the launcher, persisted to settings.json
// ----------
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LauncherSettings {
    pub java_path: Option<String>,
    pub java_args: Option<String>,
    pub max_memory: Option<u32>,
    pub enable_console: Option<bool>,
    pub account_preview_mode: Option<String>,
    pub show_welcome: Option<bool>,
    /// Update channel preference: "stable" or "prerelease"
    #[serde(default = "default_update_channel")]
    pub update_channel: Option<String>,
    pub accent_color: Option<String>,
    pub background_style: Option<String>,
    pub edit_mode_preference: Option<String>,
    pub enable_instance_animations: Option<bool>,
}

fn default_update_channel() -> Option<String> {
    Some("stable".to_string())
}

impl Default for LauncherSettings {
    fn default() -> Self {
        LauncherSettings {
            java_path: None,
            java_args: None,
            max_memory: Some(4096),
            enable_console: Some(false),
            account_preview_mode: Some("simple".to_string()),
            show_welcome: Some(true),
            update_channel: Some("stable".to_string()),
            accent_color: Some("#E89C88".to_string()),
            background_style: Some("gradient".to_string()),
            edit_mode_preference: Some("ask".to_string()),
            enable_instance_animations: Some(true),
        }
    }
}

fn get_settings_path() -> PathBuf {
    get_minecraft_dir().join("settings.json")
}

pub fn load_settings() -> LauncherSettings {
    let path = get_settings_path();
    
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(settings) = serde_json::from_str(&content) {
                return settings;
            }
        }
    }
    
    LauncherSettings::default()
}

pub fn save_settings(settings: &LauncherSettings) -> Result<(), String> {
    let path = get_settings_path();
    
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    
    let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    
    Ok(())
}

pub fn set_java_path(path: Option<String>) -> Result<(), String> {
    let mut settings = load_settings();
    settings.java_path = path;
    save_settings(&settings)
}

pub fn get_java_path() -> Option<String> {
    load_settings().java_path
}
