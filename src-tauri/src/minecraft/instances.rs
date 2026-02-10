use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

use crate::minecraft::downloader::{get_instances_dir, get_minecraft_dir};

// ----------
// Windows console hiding
// Description: Constants and imports for hiding CMD windows on Windows
// ----------
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum ModLoader {
    Vanilla,
    Fabric,
    Forge,
    NeoForge,
}

impl std::fmt::Display for ModLoader {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ModLoader::Vanilla => write!(f, "Vanilla"),
            ModLoader::Fabric => write!(f, "Fabric"),
            ModLoader::Forge => write!(f, "Forge"),
            ModLoader::NeoForge => write!(f, "NeoForge"),
        }
    }
}

impl Default for ModLoader {
    fn default() -> Self {
        ModLoader::Vanilla
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub version_id: String,
    pub created_at: String,
    pub last_played: Option<String>,
    pub java_path: Option<String>,
    pub jvm_args: Option<String>,
    pub memory_min: Option<u32>,
    pub memory_max: Option<u32>,
    pub game_directory: Option<String>,
    pub resolution_width: Option<u32>,
    pub resolution_height: Option<u32>,
    #[serde(default)]
    pub mod_loader: ModLoader,
    #[serde(default)]
    pub mod_loader_version: Option<String>,
    #[serde(default)]
    pub console_auto_update: bool,
    #[serde(default)]
    pub logo_filename: Option<String>,
    #[serde(default)]
    pub playtime_seconds: u64,
    #[serde(default)]
    pub total_launches: u64,
    #[serde(default)]
    pub color_accent: Option<String>,
    #[serde(default)]
    pub preferred_account: Option<String>,
    #[serde(default = "default_true")]
    pub check_mod_updates_on_launch: bool,
}

impl Instance {
    pub fn new(name: String, version_id: String) -> Self {
        Instance {
            id: Uuid::new_v4().to_string(),
            name,
            version_id,
            created_at: chrono_now(),
            last_played: None,
            java_path: None,
            jvm_args: None,
            memory_min: Some(512),
            memory_max: Some(4096),
            game_directory: None,
            resolution_width: None,
            resolution_height: None,
            mod_loader: ModLoader::Vanilla,
            mod_loader_version: None,
            console_auto_update: true,
            logo_filename: Some("minecraft_logo.png".to_string()),
            playtime_seconds: 0,
            total_launches: 0,
            color_accent: None,
            preferred_account: None,
            check_mod_updates_on_launch: true,
        }
    }
    
    pub fn get_directory(&self) -> PathBuf {
        get_instances_dir().join(&self.id)
    }
    
    pub fn get_game_directory(&self) -> PathBuf {
        match &self.game_directory {
            Some(path) => PathBuf::from(path),
            None => self.get_directory().join("minecraft"),
        }
    }
}

fn chrono_now() -> String {
    // Simple timestamp without chrono dependency
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", duration.as_secs())
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct InstancesConfig {
    pub instances: Vec<Instance>,
}

fn get_instances_config_path() -> PathBuf {
    get_minecraft_dir().join("instances.json")
}

/// Load all instances from config
pub fn load_instances() -> Result<Vec<Instance>, String> {
    let config_path = get_instances_config_path();
    
    if !config_path.exists() {
        return Ok(Vec::new());
    }
    
    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read instances config: {}", e))?;
    
    let config: InstancesConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse instances config: {}", e))?;
    
    Ok(config.instances)
}

/// Save instances to config
pub fn save_instances(instances: &[Instance]) -> Result<(), String> {
    let config_path = get_instances_config_path();
    
    // Ensure parent directory exists
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    
    let config = InstancesConfig {
        instances: instances.to_vec(),
    };
    
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize instances: {}", e))?;
    
    fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write instances config: {}", e))?;
    
    Ok(())
}

/// Create a new instance
pub fn create_instance(name: String, version_id: String) -> Result<Instance, String> {
    let mut instances = load_instances()?;
    
    let instance = Instance::new(name, version_id);
    
    // Create instance directory
    let instance_dir = instance.get_directory();
    fs::create_dir_all(&instance_dir)
        .map_err(|e| format!("Failed to create instance directory: {}", e))?;
    
    // Create game directory
    let game_dir = instance.get_game_directory();
    fs::create_dir_all(&game_dir)
        .map_err(|e| format!("Failed to create game directory: {}", e))?;
    
    instances.push(instance.clone());
    save_instances(&instances)?;
    
    Ok(instance)
}

/// Delete an instance
pub async fn delete_instance(instance_id: &str) -> Result<(), String> {
    let mut instances = load_instances()?;
    
    // Find and remove the instance
    let initial_len = instances.len();
    instances.retain(|i| i.id != instance_id);
    
    if instances.len() == initial_len {
        return Err("Instance not found".to_string());
    }
    
    // Delete instance directory
    let instance_dir = get_instances_dir().join(instance_id);
    if instance_dir.exists() {
        tokio::fs::remove_dir_all(&instance_dir)
            .await
            .map_err(|e| format!("Failed to delete instance directory: {}", e))?;
    }
    
    save_instances(&instances)?;
    
    Ok(())
}

/// Update an instance
pub fn update_instance(instance: Instance) -> Result<Instance, String> {
    let mut instances = load_instances()?;
    
    let pos = instances.iter().position(|i| i.id == instance.id)
        .ok_or("Instance not found")?;
    
    instances[pos] = instance.clone();
    save_instances(&instances)?;
    
    Ok(instance)
}

/// Get a single instance by ID
pub fn get_instance(instance_id: &str) -> Result<Instance, String> {
    let instances = load_instances()?;
    
    instances.into_iter()
        .find(|i| i.id == instance_id)
        .ok_or_else(|| "Instance not found".to_string())
}

/// Clone an instance with all its files
#[allow(dead_code)]
pub fn clone_instance(instance_id: &str, new_name: String) -> Result<Instance, String> {
    let source = get_instance(instance_id)?;
    let mut instances = load_instances()?;
    
    let new_id = Uuid::new_v4().to_string();
    let cloned = Instance {
        id: new_id.clone(),
        name: new_name,
        version_id: source.version_id.clone(),
        created_at: chrono_now(),
        last_played: None,
        java_path: source.java_path.clone(),
        jvm_args: source.jvm_args.clone(),
        memory_min: source.memory_min,
        memory_max: source.memory_max,
        game_directory: None, // Will use default based on new ID
        resolution_width: source.resolution_width,
        resolution_height: source.resolution_height,
        mod_loader: source.mod_loader.clone(),
        mod_loader_version: source.mod_loader_version.clone(),
        console_auto_update: source.console_auto_update,
        logo_filename: source.logo_filename.clone(),
        playtime_seconds: 0, // Reset playtime for clone
        total_launches: 0,
        color_accent: source.color_accent.clone(),
        preferred_account: source.preferred_account.clone(),
        check_mod_updates_on_launch: source.check_mod_updates_on_launch,
    };
    
    // Create new instance directory
    let new_instance_dir = get_instances_dir().join(&new_id);
    fs::create_dir_all(&new_instance_dir)
        .map_err(|e| format!("Failed to create instance directory: {}", e))?;
    
    // Copy game directory contents
    let source_game_dir = source.get_game_directory();
    let new_game_dir = new_instance_dir.join("minecraft");
    
    if source_game_dir.exists() {
        copy_dir_recursive(&source_game_dir, &new_game_dir)
            .map_err(|e| format!("Failed to copy instance files: {}", e))?;
    } else {
        fs::create_dir_all(&new_game_dir)
            .map_err(|e| format!("Failed to create game directory: {}", e))?;
    }
    
    instances.push(cloned.clone());
    save_instances(&instances)?;
    
    Ok(cloned)
}

/// Clear per-instance preferred account bindings that match a removed account username
pub fn clear_preferred_account(username: &str) -> Result<u32, String> {
    let mut instances = load_instances()?;
    let mut cleared = 0u32;

    for instance in &mut instances {
        if instance.preferred_account.as_deref() == Some(username) {
            instance.preferred_account = None;
            cleared += 1;
        }
    }

    if cleared > 0 {
        save_instances(&instances)?;
    }

    Ok(cleared)
}

/// Recursively copy a directory, handling symlinks
#[allow(dead_code)]
fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        
        if file_type.is_symlink() {
            // Read the symlink target and recreate it
            let target = fs::read_link(&src_path)?;
            #[cfg(unix)]
            {
                std::os::unix::fs::symlink(&target, &dst_path)?;
            }
            #[cfg(windows)]
            {
                // On Windows, determine if target is a file or directory
                if target.is_dir() {
                    std::os::windows::fs::symlink_dir(&target, &dst_path)?;
                } else {
                    std::os::windows::fs::symlink_file(&target, &dst_path)?;
                }
            }
        } else if file_type.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    
    Ok(())
}

// ============== SESSION TRACKING ==============

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GameSession {
    pub instance_id: String,
    pub start_time: u64,
    pub pid: Option<u32>,
    #[serde(default)]
    pub launch_username: Option<String>,
}

fn get_session_file_path() -> PathBuf {
    get_minecraft_dir().join("active_sessions.json")
}

fn get_legacy_session_file_path() -> PathBuf {
    get_minecraft_dir().join("active_session.json")
}

fn load_active_sessions() -> HashMap<String, GameSession> {
    let path = get_session_file_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(mut sessions) = serde_json::from_str::<HashMap<String, GameSession>>(&content) {
                sessions.retain(|_, s| !s.instance_id.is_empty());
                return sessions;
            }
        }
    }

    let legacy_path = get_legacy_session_file_path();
    if legacy_path.exists() {
        if let Ok(content) = fs::read_to_string(&legacy_path) {
            if let Ok(session) = serde_json::from_str::<GameSession>(&content) {
                let mut sessions = HashMap::new();
                if !session.instance_id.is_empty() {
                    sessions.insert(session.instance_id.clone(), session);
                }
                return sessions;
            }
        }
    }

    HashMap::new()
}

fn save_active_sessions(sessions: &HashMap<String, GameSession>) -> Result<(), String> {
    if sessions.is_empty() {
        let _ = fs::remove_file(get_session_file_path());
        let _ = fs::remove_file(get_legacy_session_file_path());
        return Ok(());
    }

    let content = serde_json::to_string(sessions)
        .map_err(|e| format!("Failed to serialize sessions: {}", e))?;
    fs::write(get_session_file_path(), content)
        .map_err(|e| format!("Failed to write sessions file: {}", e))?;
    let _ = fs::remove_file(get_legacy_session_file_path());
    Ok(())
}

/// Write an active session to disk (called when game launches)
pub fn write_active_session(
    instance_id: &str,
    start_time: u64,
    pid: Option<u32>,
    launch_username: Option<String>,
) -> Result<(), String> {
    let mut sessions = load_active_sessions();
    sessions.insert(
        instance_id.to_string(),
        GameSession {
            instance_id: instance_id.to_string(),
            start_time,
            pid,
            launch_username,
        },
    );
    save_active_sessions(&sessions)
}

/// Clear one active session entry (called when a specific game exits normally)
pub fn clear_active_session(instance_id: &str) {
    let mut sessions = load_active_sessions();
    sessions.remove(instance_id);
    let _ = save_active_sessions(&sessions);
}

/// Clear all active session entries (called when fully exiting launcher)
pub fn clear_all_active_sessions() {
    let _ = fs::remove_file(get_session_file_path());
    let _ = fs::remove_file(get_legacy_session_file_path());
}

pub fn is_process_running(pid: u32) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        if let Ok(out) = Command::new("tasklist")
            .args(&["/FI", &format!("PID eq {}", pid)])
            .creation_flags(CREATE_NO_WINDOW)
            .output() 
        {
            let s = String::from_utf8_lossy(&out.stdout);
            return s.contains(&pid.to_string());
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(status) = std::process::Command::new("kill").args(&["-0", &pid.to_string()]).status() {
            return status.success();
        }
        false
    }
}

/// Check for orphaned sessions on startup and credit playtime or recover processes.
/// Returns a list of recovered sessions:
/// (instance_id, start_time_or_credited_duration, pid, original_playtime, launch_username)
pub fn recover_orphaned_sessions() -> Vec<(String, u64, Option<u32>, u64, Option<String>)> {
    let sessions = load_active_sessions();
    if sessions.is_empty() {
        return Vec::new();
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let mut recovered = Vec::new();
    let mut still_running = HashMap::new();

    for (_key, session) in sessions {
        let instance_id = session.instance_id.clone();
        let original_playtime = if let Ok(inst) = get_instance(&instance_id) {
            inst.playtime_seconds
        } else {
            0
        };

        if let Some(pid) = session.pid {
            if is_process_running(pid) {
                let launch_username = session.launch_username.clone();
                let session_start_time = session.start_time;
                still_running.insert(instance_id.clone(), session);
                recovered.push((
                    instance_id,
                    session_start_time,
                    Some(pid),
                    original_playtime,
                    launch_username,
                ));
                continue;
            }
        }

        let duration = now.saturating_sub(session.start_time);
        if duration <= 86400 {
            if let Ok(mut instance) = get_instance(&instance_id) {
                instance.playtime_seconds += duration;
                let _ = update_instance(instance.clone());
                log_session(&instance_id, &instance.name, now, duration);
            }

            recovered.push((
                instance_id,
                duration,
                None,
                original_playtime,
                session.launch_username.clone(),
            ));
        }
    }

    let _ = save_active_sessions(&still_running);
    recovered
}

// --- Session History ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionRecord {
    pub instance_id: String,
    pub instance_name: String,
    pub timestamp: u64,
    pub duration_seconds: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyActivity {
    pub date: String,
    pub seconds: u64,
}

fn get_session_history_path() -> PathBuf {
    get_minecraft_dir().join("session_history.json")
}

pub fn log_session(instance_id: &str, instance_name: &str, timestamp: u64, duration_seconds: u64) {
    if duration_seconds == 0 {
        return;
    }

    let path = get_session_history_path();
    let mut records = load_session_history();

    records.push(SessionRecord {
        instance_id: instance_id.to_string(),
        instance_name: instance_name.to_string(),
        timestamp,
        duration_seconds,
    });

    if let Ok(json) = serde_json::to_string(&records) {
        let _ = fs::write(&path, json);
    }
}

pub fn load_session_history() -> Vec<SessionRecord> {
    let path = get_session_history_path();
    if !path.exists() {
        return Vec::new();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn get_daily_activity(days: u32) -> Vec<DailyActivity> {
    use chrono::{Local, Duration, NaiveDate};

    let today = Local::now().date_naive();
    let cutoff_date = today - Duration::days(days as i64 - 1);
    let cutoff_ts = cutoff_date.and_hms_opt(0, 0, 0)
        .and_then(|dt| dt.and_local_timezone(Local).single())
        .map(|dt| dt.timestamp() as u64)
        .unwrap_or(0);

    let records = load_session_history();

    // Build a map of date -> total seconds
    let mut daily: std::collections::HashMap<NaiveDate, u64> = std::collections::HashMap::new();

    for rec in &records {
        if rec.timestamp < cutoff_ts {
            continue;
        }
        let date = chrono::DateTime::from_timestamp(rec.timestamp as i64, 0)
            .map(|dt| dt.with_timezone(&Local).date_naive())
            .unwrap_or(today);
        *daily.entry(date).or_insert(0) += rec.duration_seconds;
    }

    // Build result with all days filled in (including zeros)
    let mut result = Vec::with_capacity(days as usize);
    for i in 0..days {
        let date = cutoff_date + Duration::days(i as i64);
        let seconds = daily.get(&date).copied().unwrap_or(0);
        result.push(DailyActivity {
            date: date.format("%Y-%m-%d").to_string(),
            seconds,
        });
    }

    result
}
