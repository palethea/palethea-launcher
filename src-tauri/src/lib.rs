mod minecraft;

use minecraft::{versions, downloader, instances, launcher, settings, auth, modrinth, files, fabric, forge, java, logger};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::sync::{Mutex, LazyLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{State, AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_opener::OpenerExt;

// Global state for tracking running game processes
static RUNNING_PROCESSES: LazyLock<Mutex<HashMap<String, u32>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

// App state for storing user info
pub struct AppState {
    pub username: Mutex<String>,
    pub uuid: Mutex<String>,
    pub access_token: Mutex<String>,
    pub is_microsoft_auth: Mutex<bool>,
    pub refresh_token: Mutex<Option<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            username: Mutex::new("Player".to_string()),
            uuid: Mutex::new(uuid::Uuid::new_v4().to_string().replace("-", "")),
            access_token: Mutex::new("0".to_string()),
            is_microsoft_auth: Mutex::new(false),
            refresh_token: Mutex::new(None),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VersionListItem {
    pub id: String,
    pub version_type: String,
    pub release_time: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoaderVersion {
    pub version: String,
    pub release_time: Option<String>,
    pub version_type: String, // "release", "beta", "recommended", "latest"
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct GlobalStats {
    pub total_playtime_seconds: u64,
    pub total_launches: u64,
    pub instance_count: u32,
    pub most_played_instance: Option<String>,
    pub favorite_version: Option<String>,
}

#[tauri::command]
fn get_global_stats() -> Result<GlobalStats, String> {
    let mut stats = GlobalStats::default();
    let instances = instances::load_instances()?;
    
    stats.instance_count = instances.len() as u32;
    
    let mut version_counts: HashMap<String, u32> = HashMap::new();
    let mut max_playtime = 0;

    for inst in instances {
        stats.total_playtime_seconds += inst.playtime_seconds;
        stats.total_launches += inst.total_launches;
        
        // Track most played
        if inst.playtime_seconds > max_playtime {
            max_playtime = inst.playtime_seconds;
            stats.most_played_instance = Some(inst.name.clone());
        }
        
        // Track favorite version
        let count = version_counts.entry(inst.version_id.clone()).or_insert(0);
        *count += 1;
    }
    
    // Find favorite version (the one with most instances created)
    stats.favorite_version = version_counts
        .into_iter()
        .max_by_key(|&(_, count)| count)
        .map(|(version, _)| version);
    
    Ok(stats)
}

#[tauri::command]
fn log_event(level: String, message: String, app_handle: AppHandle) {
    logger::emit_log(&app_handle, &level, &message);
}

// ============== VERSION COMMANDS ==============

#[tauri::command]
async fn get_versions() -> Result<Vec<VersionListItem>, String> {
    let manifest = versions::fetch_version_manifest()
        .await
        .map_err(|e| e.to_string())?;
    
    let versions: Vec<VersionListItem> = manifest.versions
        .into_iter()
        .map(|v| VersionListItem {
            id: v.id,
            version_type: v.version_type,
            release_time: v.release_time,
        })
        .collect();
    
    Ok(versions)
}

#[tauri::command]
async fn get_latest_release() -> Result<String, String> {
    let manifest = versions::fetch_version_manifest()
        .await
        .map_err(|e| e.to_string())?;
    
    Ok(manifest.latest.release)
}

// ============== INSTANCE COMMANDS ==============

#[tauri::command]
fn get_instances() -> Result<Vec<instances::Instance>, String> {
    instances::load_instances()
}

#[tauri::command]
fn create_instance(name: String, version_id: String, app_handle: AppHandle) -> Result<instances::Instance, String> {
    let instance = instances::create_instance(name, version_id)?;
    let _ = app_handle.emit("refresh-instances", ());
    Ok(instance)
}

#[tauri::command]
fn delete_instance(instance_id: String, app_handle: AppHandle) -> Result<(), String> {
    instances::delete_instance(&instance_id)?;
    let _ = app_handle.emit("refresh-instances", ());
    Ok(())
}

#[tauri::command]
fn update_instance(instance: instances::Instance, app_handle: AppHandle) -> Result<instances::Instance, String> {
    let result = instances::update_instance(instance)?;
    let _ = app_handle.emit("refresh-instances", ());
    Ok(result)
}

#[tauri::command]
fn clone_instance(instance_id: String, new_name: String, app_handle: AppHandle) -> Result<instances::Instance, String> {
    let result = instances::clone_instance(&instance_id, new_name)?;
    let _ = app_handle.emit("refresh-instances", ());
    Ok(result)
}

#[tauri::command]
fn set_instance_logo(instance_id: String, source_path: String) -> Result<instances::Instance, String> {
    let mut instance = instances::get_instance(&instance_id)?;
    downloader::ensure_instance_logos_dir()?;

    let source = std::path::PathBuf::from(&source_path);
    if !source.exists() {
        return Err("Selected file not found".to_string());
    }

    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext != "png" {
        return Err("Only PNG files are supported".to_string());
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let filename = format!("{}_{}.png", instance_id, timestamp);
    let destination = downloader::get_instance_logos_dir().join(&filename);

    fs::copy(&source, &destination)
        .map_err(|e| format!("Failed to copy logo: {}", e))?;

    if let Some(old_logo) = &instance.logo_filename {
        let old_path = downloader::get_instance_logos_dir().join(old_logo);
        let _ = fs::remove_file(old_path);
    }

    instance.logo_filename = Some(filename);
    instances::update_instance(instance.clone())?;
    Ok(instance)
}

#[tauri::command]
async fn set_instance_logo_from_url(instance_id: String, logo_url: String, app_handle: AppHandle) -> Result<instances::Instance, String> {
    logger::emit_log(&app_handle, "info", &format!("Setting instance logo from URL: {}", logo_url));
    let mut instance = instances::get_instance(&instance_id)?;
    downloader::ensure_instance_logos_dir()?;

    let client = reqwest::Client::new();
    let response = client.get(&logo_url)
        .header("User-Agent", "PaletheaLauncher/0.1.0")
        .send()
        .await
        .map_err(|e| format!("Failed to download logo: {}", e))?;

    let bytes = response.bytes().await.map_err(|e| format!("Failed to get logo bytes: {}", e))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    
    // Better extension detection
    let url_no_query = logo_url.split('?').next().unwrap_or(&logo_url);
    let ext = url_no_query.split('.').last().unwrap_or("png").to_lowercase();
    let safe_ext = if ext == "jpg" || ext == "jpeg" || ext == "png" || ext == "webp" {
        ext
    } else {
        "png".to_string()
    };

    let filename = format!("{}_{}.{}", instance_id, timestamp, safe_ext);
    let destination = downloader::get_instance_logos_dir().join(&filename);

    fs::write(&destination, &bytes)
        .map_err(|e| format!("Failed to save logo: {}", e))?;

    if let Some(old_logo) = &instance.logo_filename {
        let old_path = downloader::get_instance_logos_dir().join(old_logo);
        let _ = fs::remove_file(old_path);
    }

    instance.logo_filename = Some(filename);
    instances::update_instance(instance.clone())?;
    Ok(instance)
}

#[tauri::command]
fn clear_instance_logo(instance_id: String) -> Result<instances::Instance, String> {
    let mut instance = instances::get_instance(&instance_id)?;

    if let Some(old_logo) = &instance.logo_filename {
        let old_path = downloader::get_instance_logos_dir().join(old_logo);
        let _ = fs::remove_file(old_path);
    }

    instance.logo_filename = None;
    instances::update_instance(instance.clone())?;
    Ok(instance)
}

// ============== FABRIC/MOD LOADER COMMANDS ==============

#[tauri::command]
async fn install_fabric(instance_id: String, loader_version: String) -> Result<String, String> {
    let instance = instances::get_instance(&instance_id)?;
    
    fabric::install_fabric(&instance, &loader_version)
        .await
        .map_err(|e| e.to_string())?;
    
    // Update instance with mod loader info
    let mut updated = instance.clone();
    updated.mod_loader = instances::ModLoader::Fabric;
    updated.mod_loader_version = Some(loader_version.clone());
    instances::update_instance(updated)?;
    
    Ok(format!("Fabric {} installed successfully", loader_version))
}

#[tauri::command]
async fn install_forge(instance_id: String, loader_version: String) -> Result<String, String> {
    let instance = instances::get_instance(&instance_id)?;
    
    forge::install_forge(&instance, &loader_version)
        .await
        .map_err(|e| e.to_string())?;
    
    // Update instance with mod loader info
    let mut updated = instance.clone();
    updated.mod_loader = instances::ModLoader::Forge;
    updated.mod_loader_version = Some(loader_version.clone());
    instances::update_instance(updated)?;
    
    Ok(format!("Forge {} installed successfully", loader_version))
}

#[tauri::command]
async fn install_neoforge(instance_id: String, loader_version: String) -> Result<String, String> {
    let instance = instances::get_instance(&instance_id)?;
    
    forge::install_neoforge(&instance, &loader_version)
        .await
        .map_err(|e| e.to_string())?;
    
    // Update instance with mod loader info
    let mut updated = instance.clone();
    updated.mod_loader = instances::ModLoader::NeoForge;
    updated.mod_loader_version = Some(loader_version.clone());
    instances::update_instance(updated)?;
    
    Ok(format!("NeoForge {} installed successfully", loader_version))
}

// ============== DOWNLOAD COMMANDS ==============

#[tauri::command]
async fn download_version(version_id: String, app_handle: AppHandle) -> Result<String, String> {
    downloader::download_version(&version_id, Some(&app_handle))
        .await
        .map_err(|e| e.to_string())?;
    
    Ok(format!("Successfully downloaded version {}", version_id))
}

#[tauri::command]
fn is_version_downloaded(version_id: String) -> bool {
    let versions_dir = downloader::get_versions_dir();
    let client_jar = versions_dir.join(&version_id).join(format!("{}.jar", &version_id));
    client_jar.exists()
}

// ============== LAUNCH COMMANDS ==============

#[tauri::command]
async fn launch_instance(
    instance_id: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let instance = instances::get_instance(&instance_id)?;
    log_info!(&app_handle, "Preparing to launch instance: {}", instance.name);
    
    // Check if this instance is already running
    {
        let processes = RUNNING_PROCESSES.lock().map_err(|_| "Process state corrupted")?;
        if processes.contains_key(&instance_id) {
            log_warn!(&app_handle, "Instance {} is already running", instance.name);
            return Err("This instance is already running".to_string());
        }
    }
    
    // Check if version is downloaded
    if !is_version_downloaded(instance.version_id.clone()) {
        return Err("Version not downloaded. Please download it first.".to_string());
    }
    
    // Load version details
    let versions_dir = downloader::get_versions_dir();
    let json_path = versions_dir.join(&instance.version_id).join(format!("{}.json", &instance.version_id));
    let json_content = std::fs::read_to_string(&json_path)
        .map_err(|e| format!("Failed to read version JSON: {}", e))?;
    let version_details: versions::VersionDetails = serde_json::from_str(&json_content)
        .map_err(|e| format!("Failed to parse version JSON: {}", e))?;
    
    let username = state.username.lock().map_err(|_| "Auth state corrupted")?.clone();
    let uuid = state.uuid.lock().map_err(|_| "Auth state corrupted")?.clone();
    let access_token = state.access_token.lock().map_err(|_| "Auth state corrupted")?.clone();
    
    // Update last played and launch count
    let mut updated_instance = instance.clone();
    let start_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    updated_instance.last_played = Some(start_time.to_string());
    updated_instance.total_launches += 1;
    instances::update_instance(updated_instance)?;
    
    // Launch the game
    let mut child = launcher::launch_game(&instance, &version_details, &username, &access_token, &uuid).await?;
    
    // Store the process ID
    let process_id = child.id();
    
    // Write session file for crash recovery (include PID)
    let _ = instances::write_active_session(&instance_id, start_time, Some(process_id));
    
    {
        let mut processes = RUNNING_PROCESSES.lock().map_err(|_| "Process state corrupted")?;
        processes.insert(instance_id.clone(), process_id);
    }
    
    // Spawn a background thread to track playtime
    let instance_id_clone = instance_id.clone();
    let app_handle_clone = app_handle.clone();
    let instance_name = instance.name.clone();
    std::thread::spawn(move || {
        // Wait for the game to exit
        if let Ok(status) = child.wait() {
            let end_time = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let session_duration = end_time.saturating_sub(start_time);
            
            // Update playtime
            if let Ok(mut inst) = instances::get_instance(&instance_id_clone) {
                inst.playtime_seconds += session_duration;
                let _ = instances::update_instance(inst);
            }
            
            // Clear the session file since we exited normally
            instances::clear_active_session();
            
            // Remove from running processes
            if let Ok(mut processes) = RUNNING_PROCESSES.lock() {
                processes.remove(&instance_id_clone);
            }
            
            log_info!(&app_handle_clone, "Instance {} exited with status: {:?}, session duration: {}s", instance_name, status, session_duration);
            log::info!("Game exited with status: {:?}, session: {}s", status, session_duration);
        }
    });
    
    Ok(format!("Launched {} with version {}", instance.name, instance.version_id))
}

#[tauri::command]
fn kill_game(
    instance_id: String,
) -> Result<String, String> {
    let process_id = {
        let processes = RUNNING_PROCESSES.lock().map_err(|_| "Process state corrupted")?;
        processes.get(&instance_id).copied()
    };
    
    match process_id {
        Some(pid) => {
            // Kill the process using system commands
            #[cfg(target_os = "windows")]
            {
                std::process::Command::new("taskkill")
                    .args(&["/F", "/PID", &pid.to_string()])
                    .spawn()
                    .map_err(|e| format!("Failed to kill process: {}", e))?;
            }
            #[cfg(not(target_os = "windows"))]
            {
                std::process::Command::new("kill")
                    .args(&["-9", &pid.to_string()])
                    .spawn()
                    .map_err(|e| format!("Failed to kill process: {}", e))?;
            }
            
            // Remove from running processes
            {
                let mut processes = RUNNING_PROCESSES.lock().map_err(|_| "Process state corrupted")?;
                processes.remove(&instance_id);
            }
            
            // Clear session file
            instances::clear_active_session();
            
            Ok(format!("Killed game for instance {}", instance_id))
        }
        None => Err("Instance is not running".to_string())
    }
}

#[tauri::command]
fn get_running_instances() -> Result<Vec<String>, String> {
    let processes = RUNNING_PROCESSES.lock().map_err(|_| "Process state corrupted")?;
    let keys: Vec<String> = processes.keys().cloned().collect();
    Ok(keys)
}

#[tauri::command]
fn check_java() -> Result<String, String> {
    // First check custom java path from settings
    if let Some(custom_path) = settings::get_java_path() {
        let path = std::path::PathBuf::from(&custom_path);
        if path.exists() {
            return Ok(custom_path);
        }
    }
    
    // Fall back to auto-detection
    match launcher::find_java() {
        Some(path) => Ok(path.to_string_lossy().to_string()),
        None => Err("Java not found".to_string()),
    }
}

#[tauri::command]
fn set_java_path(path: Option<String>) -> Result<(), String> {
    settings::set_java_path(path)
}

#[tauri::command]
fn get_java_path() -> Option<String> {
    settings::get_java_path()
}

#[tauri::command]
fn get_settings() -> settings::LauncherSettings {
    settings::load_settings()
}

#[tauri::command]
fn save_settings(new_settings: settings::LauncherSettings) -> Result<(), String> {
    settings::save_settings(&new_settings)
}

#[tauri::command]
async fn download_java_for_instance(instance_id: String, version: u32) -> Result<instances::Instance, String> {
    let instance = instances::get_instance(&instance_id)?;
    let java_path = java::download_java(version)
        .await
        .map_err(|e| e.to_string())?;

    let mut updated = instance.clone();
    updated.java_path = Some(java_path.to_string_lossy().to_string());
    instances::update_instance(updated)
}

#[tauri::command]
async fn download_java_global(version: u32) -> Result<String, String> {
    let java_path = java::download_java(version)
        .await
        .map_err(|e| e.to_string())?;
    Ok(java_path.to_string_lossy().to_string())
}

// ============== AUTH COMMANDS ==============

#[tauri::command]
async fn start_microsoft_login() -> Result<auth::DeviceCodeInfo, String> {
    auth::start_device_code_flow()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn poll_microsoft_login(device_code: String, state: State<'_, AppState>) -> Result<String, String> {
    let token_response = auth::poll_for_token(&device_code)
        .await
        .map_err(|e| e.to_string())?;
    
    let access_token = token_response.access_token
        .ok_or("No access token received")?;
    
    let account = auth::complete_authentication(
        &access_token,
        token_response.refresh_token.clone()
    )
        .await
        .map_err(|e| e.to_string())?;
    
    // Update state
    *state.username.lock().unwrap() = account.username.clone();
    *state.uuid.lock().unwrap() = account.uuid.clone();
    *state.access_token.lock().unwrap() = account.access_token.clone();
    *state.is_microsoft_auth.lock().unwrap() = true;
    *state.refresh_token.lock().unwrap() = account.refresh_token.clone();
    
    // Save account to disk
    let saved = auth::SavedAccount {
        username: account.username.clone(),
        uuid: account.uuid,
        access_token: account.access_token,
        refresh_token: account.refresh_token,
        is_microsoft: true,
    };
    auth::add_account(saved)?;
    auth::set_active_account(&account.username)?;
    
    Ok(account.username)
}

#[tauri::command]
fn logout(state: State<'_, AppState>) -> Result<(), String> {
    *state.username.lock().unwrap() = "Player".to_string();
    *state.uuid.lock().unwrap() = uuid::Uuid::new_v4().to_string().replace("-", "");
    *state.access_token.lock().unwrap() = "0".to_string();
    *state.is_microsoft_auth.lock().unwrap() = false;
    *state.refresh_token.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
fn is_logged_in(state: State<'_, AppState>) -> bool {
    *state.is_microsoft_auth.lock().unwrap()
}

#[tauri::command]
fn get_current_uuid(state: State<'_, AppState>) -> String {
    state.uuid.lock().unwrap().clone()
}

#[tauri::command]
fn get_saved_accounts() -> auth::AccountsData {
    auth::load_accounts()
}

#[tauri::command]
fn remove_saved_account(username: String) -> Result<(), String> {
    auth::remove_account(&username)
}

#[tauri::command]
async fn validate_account(access_token: String) -> bool {
    auth::validate_token(&access_token).await
}

#[tauri::command]
async fn get_mc_profile_full(state: State<'_, AppState>) -> Result<auth::FullProfile, String> {
    let token = state.access_token.lock().unwrap().clone();
    if token == "0" {
        return Err("Not logged in".to_string());
    }
    
    auth::get_full_profile(&token)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn upload_skin(state: State<'_, AppState>, file_path: String, variant: String) -> Result<(), String> {
    let token = state.access_token.lock().unwrap().clone();
    if token == "0" {
        return Err("Not logged in".to_string());
    }
    
    auth::upload_mc_skin(&token, &file_path, &variant)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn reset_skin(state: State<'_, AppState>) -> Result<(), String> {
    let token = state.access_token.lock().unwrap().clone();
    if token == "0" {
        return Err("Not logged in".to_string());
    }
    
    auth::reset_mc_skin(&token)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn refresh_account(username: String, state: State<'_, AppState>) -> Result<bool, String> {
    let data = auth::load_accounts();
    
    let account = data.accounts.iter()
        .find(|a| a.username == username)
        .ok_or("Account not found")?;
    
    if !account.is_microsoft {
        // Offline accounts don't need refresh
        return Ok(true);
    }
    
    let refresh_tok = account.refresh_token.clone()
        .ok_or("No refresh token available")?;
    
    // Try to refresh the token
    let token_response = auth::refresh_token(&refresh_tok)
        .await
        .map_err(|e| e.to_string())?;
    
    let new_access_token = token_response.access_token
        .ok_or("No access token in refresh response")?;
    
    // Complete authentication with new token
    let new_account = auth::complete_authentication(
        &new_access_token,
        token_response.refresh_token.or(Some(refresh_tok))
    )
        .await
        .map_err(|e| e.to_string())?;
    
    // Update saved account
    let saved = auth::SavedAccount {
        username: new_account.username.clone(),
        uuid: new_account.uuid.clone(),
        access_token: new_account.access_token.clone(),
        refresh_token: new_account.refresh_token.clone(),
        is_microsoft: true,
    };
    auth::add_account(saved)?;
    
    // Update state if this is the active account
    if state.username.lock().unwrap().clone() == username {
        *state.username.lock().unwrap() = new_account.username;
        *state.uuid.lock().unwrap() = new_account.uuid;
        *state.access_token.lock().unwrap() = new_account.access_token;
        *state.is_microsoft_auth.lock().unwrap() = true;
        *state.refresh_token.lock().unwrap() = new_account.refresh_token;
    }
    
    Ok(true)
}

#[tauri::command]
fn switch_account(username: String, state: State<'_, AppState>) -> Result<(), String> {
    let data = auth::load_accounts();
    
    let account = data.accounts.iter()
        .find(|a| a.username == username)
        .ok_or("Account not found")?;
    
    // Update state
    *state.username.lock().unwrap() = account.username.clone();
    *state.uuid.lock().unwrap() = account.uuid.clone();
    *state.access_token.lock().unwrap() = account.access_token.clone();
    *state.is_microsoft_auth.lock().unwrap() = account.is_microsoft;
    *state.refresh_token.lock().unwrap() = account.refresh_token.clone();
    
    // Update active account
    auth::set_active_account(&username)?;
    
    Ok(())
}

// ============== USER COMMANDS ==============

#[tauri::command]
fn set_offline_user(username: String, state: State<'_, AppState>) -> Result<(), String> {
    let uuid = uuid::Uuid::new_v4().to_string().replace("-", "");
    
    *state.username.lock().unwrap() = username.clone();
    *state.uuid.lock().unwrap() = uuid.clone();
    *state.access_token.lock().unwrap() = "0".to_string();
    *state.is_microsoft_auth.lock().unwrap() = false;
    *state.refresh_token.lock().unwrap() = None;
    
    // Save offline account
    let saved = auth::SavedAccount {
        username: username.clone(),
        uuid,
        access_token: "0".to_string(),
        refresh_token: None,
        is_microsoft: false,
    };
    auth::add_account(saved)?;
    auth::set_active_account(&username)?;
    
    Ok(())
}

#[tauri::command]
fn get_current_user(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.username.lock().unwrap().clone())
}

#[tauri::command]
fn get_data_directory() -> String {
    downloader::get_minecraft_dir().to_string_lossy().to_string()
}

// ============== DISK CLEANUP COMMANDS ==============

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SkinLibraryItem {
    id: String,
    name: String,
    filename: String,
    variant: String, // "classic" or "slim"
    added_at: u64,
}

#[tauri::command]
fn get_skin_collection() -> Result<Vec<SkinLibraryItem>, String> {
    let skins_dir = downloader::get_skins_dir();
    let index_path = skins_dir.join("skins.json");
    
    if !index_path.exists() {
        return Ok(Vec::new());
    }
    
    let content = fs::read_to_string(index_path).map_err(|e| e.to_string())?;
    let skins: Vec<SkinLibraryItem> = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(skins)
}

#[tauri::command]
async fn add_to_skin_collection(name: String, source_path: String, variant: String) -> Result<SkinLibraryItem, String> {
    let skins_dir = downloader::get_skins_dir();
    fs::create_dir_all(&skins_dir).map_err(|e| e.to_string())?;
    
    let id = uuid::Uuid::new_v4().to_string();
    let filename = format!("{}.png", id);
    let dest_path = skins_dir.join(&filename);
    
    if source_path.starts_with("http") {
        let response = reqwest::get(&source_path)
            .await
            .map_err(|e| format!("Failed to download skin: {}", e))?;
        let bytes = response.bytes()
            .await
            .map_err(|e| format!("Failed to read skin bytes: {}", e))?;
        fs::write(&dest_path, bytes).map_err(|e| e.to_string())?;
    } else {
        fs::copy(source_path, &dest_path).map_err(|e| e.to_string())?;
    }
    
    let item = SkinLibraryItem {
        id,
        name,
        filename,
        variant,
        added_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    };
    
    let mut skins = get_skin_collection()?;
    skins.push(item.clone());
    
    let index_path = skins_dir.join("skins.json");
    let content = serde_json::to_string_pretty(&skins).map_err(|e| e.to_string())?;
    fs::write(index_path, content).map_err(|e| e.to_string())?;
    
    Ok(item)
}

#[tauri::command]
fn delete_skin_from_collection(id: String) -> Result<(), String> {
    let skins_dir = downloader::get_skins_dir();
    let mut skins = get_skin_collection()?;
    
    if let Some(pos) = skins.iter().position(|s| s.id == id) {
        let item = skins.remove(pos);
        let path = skins_dir.join(item.filename);
        if path.exists() {
            let _ = fs::remove_file(path);
        }
        
        let index_path = skins_dir.join("skins.json");
        let content = serde_json::to_string_pretty(&skins).map_err(|e| e.to_string())?;
        fs::write(index_path, content).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
fn get_skin_file_path(filename: String) -> String {
    downloader::get_skins_dir().join(filename).to_string_lossy().to_string()
}

// ============== DISK CLEANUP COMMANDS ==============

#[derive(Debug, Serialize)]
struct DiskUsageInfo {
    versions: u64,
    libraries: u64,
    assets: u64,
    instances: u64,
    java: u64,
    total: u64,
}

#[derive(Debug, Serialize)]
struct DownloadedVersion {
    id: String,
    size: u64,
}

fn get_dir_size(path: &std::path::Path) -> u64 {
    if !path.exists() {
        return 0;
    }
    let mut size = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                size += get_dir_size(&path);
            } else if let Ok(meta) = path.metadata() {
                size += meta.len();
            }
        }
    }
    size
}

#[tauri::command]
fn get_disk_usage() -> Result<DiskUsageInfo, String> {
    let base_dir = downloader::get_minecraft_dir();
    
    let versions_size = get_dir_size(&base_dir.join("versions"));
    let libraries_size = get_dir_size(&base_dir.join("libraries"));
    let assets_size = get_dir_size(&base_dir.join("assets"));
    let instances_size = get_dir_size(&base_dir.join("instances"));
    let java_size = get_dir_size(&base_dir.join("java"));
    
    Ok(DiskUsageInfo {
        versions: versions_size,
        libraries: libraries_size,
        assets: assets_size,
        instances: instances_size,
        java: java_size,
        total: versions_size + libraries_size + assets_size + instances_size + java_size,
    })
}

#[tauri::command]
fn get_downloaded_versions() -> Result<Vec<DownloadedVersion>, String> {
    let versions_dir = downloader::get_versions_dir();
    if !versions_dir.exists() {
        return Ok(Vec::new());
    }
    
    let mut versions = Vec::new();
    if let Ok(entries) = fs::read_dir(&versions_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    let size = get_dir_size(&entry.path());
                    versions.push(DownloadedVersion {
                        id: name.to_string(),
                        size,
                    });
                }
            }
        }
    }
    Ok(versions)
}

#[tauri::command]
fn delete_version(version_id: String) -> Result<String, String> {
    // Check if any instance uses this version
    let all_instances = instances::load_instances()?;
    for inst in &all_instances {
        if inst.version_id == version_id {
            return Err(format!("Cannot delete version {} - it is used by instance '{}'", version_id, inst.name));
        }
    }
    
    let version_dir = downloader::get_versions_dir().join(&version_id);
    if version_dir.exists() {
        fs::remove_dir_all(&version_dir)
            .map_err(|e| format!("Failed to delete version: {}", e))?;
    }
    
    Ok(format!("Deleted version {}", version_id))
}

#[tauri::command]
fn clear_assets_cache() -> Result<String, String> {
    let assets_dir = downloader::get_assets_dir();
    if assets_dir.exists() {
        fs::remove_dir_all(&assets_dir)
            .map_err(|e| format!("Failed to clear assets: {}", e))?;
    }
    Ok("Assets cache cleared".to_string())
}

// ============== MOD LOADER COMMANDS ==============

#[tauri::command]
async fn get_loader_versions(loader: String, game_version: String) -> Result<Vec<LoaderVersion>, String> {
    match loader.as_str() {
        "fabric" => {
            // Fetch Fabric loader versions from the Fabric API
            let client = reqwest::Client::new();
            let url = format!(
                "https://meta.fabricmc.net/v2/versions/loader/{}",
                game_version
            );
            let response = client
                .get(&url)
                .header("User-Agent", "PaletheaLauncher/0.1.3")
                .send()
                .await
                .map_err(|e| e.to_string())?;
            
            if !response.status().is_success() {
                return Ok(vec![]);
            }
            
            #[derive(Deserialize)]
            struct FabricLoaderVersion {
                loader: FabricLoader,
            }
            
            #[derive(Deserialize)]
            struct FabricLoader {
                version: String,
                stable: bool,
            }
            
            let versions: Vec<FabricLoaderVersion> = response
                .json()
                .await
                .map_err(|e| e.to_string())?;
            
            Ok(versions.into_iter().map(|v| {
                let lower_v = v.loader.version.to_lowercase();
                let v_type = if lower_v.contains("beta") || lower_v.contains("alpha") || lower_v.contains("rc") {
                    "snapshot".to_string()
                } else {
                    "release".to_string()
                };
                
                LoaderVersion {
                    version: v.loader.version,
                    release_time: None,
                    version_type: v_type,
                }
            }).collect())
        }
        "forge" => {
            // Fetch Forge versions
            let client = reqwest::Client::new();
            let url = format!(
                "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json"
            );
            let response = client
                .get(&url)
                .header("User-Agent", "PaletheaLauncher/0.1.3")
                .send()
                .await
                .map_err(|e| e.to_string())?;
            
            #[derive(Deserialize)]
            struct ForgePromos {
                promos: std::collections::HashMap<String, String>,
            }
            
            let promos: ForgePromos = response
                .json()
                .await
                .map_err(|e| e.to_string())?;
            
            // Find versions for this game version
            let mut versions = Vec::new();
            let recommended_key = format!("{}-recommended", game_version);
            let latest_key = format!("{}-latest", game_version);
            
            if let Some(v) = promos.promos.get(&recommended_key) {
                versions.push(LoaderVersion {
                    version: v.clone(),
                    release_time: None,
                    version_type: "recommended".to_string(),
                });
            }
            if let Some(v) = promos.promos.get(&latest_key) {
                // Check if latest is different from recommended
                if !promos.promos.get(&recommended_key).map_or(false, |rec| rec == v) {
                    versions.push(LoaderVersion {
                        version: v.clone(),
                        release_time: None,
                        version_type: "latest".to_string(),
                    });
                }
            }
            
            Ok(versions)
        }
        "neoforge" => {
            // NeoForge versions from their API
            let client = reqwest::Client::new();
            let url = "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";
            let response = client
                .get(url)
                .header("User-Agent", "PaletheaLauncher/0.1.3")
                .send()
                .await
                .map_err(|e| e.to_string())?;
            
            #[derive(Deserialize)]
            struct NeoForgeVersions {
                versions: Vec<String>,
            }
            
            let data: NeoForgeVersions = response
                .json()
                .await
                .map_err(|e| e.to_string())?;
            
            // Filter versions for this game version
            let mc_parts: Vec<&str> = game_version.split('.').collect();
            let prefix = if mc_parts.len() >= 2 {
                format!("{}.{}", mc_parts.get(1).unwrap_or(&""), mc_parts.get(2).unwrap_or(&""))
            } else {
                game_version.clone()
            };
            
            let filtered: Vec<LoaderVersion> = data.versions
                .into_iter()
                .filter(|v| v.starts_with(&prefix))
                .rev()
                .take(20)
                .map(|v| LoaderVersion {
                    version: v,
                    release_time: None,
                    version_type: "release".to_string(),
                })
                .collect();
            
            Ok(filtered)
        }
        _ => Ok(vec![]),
    }
}

// ============== MODRINTH COMMANDS ==============

#[tauri::command]
async fn search_modrinth(
    query: String,
    project_type: String,
    game_version: Option<String>,
    loader: Option<String>,
    limit: u32,
    offset: u32,
) -> Result<modrinth::ModrinthSearchResult, String> {
    modrinth::search_projects(
        &query,
        &project_type,
        game_version.as_deref(),
        loader.as_deref(),
        limit,
        offset,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_modpack_total_size(version_id: String) -> Result<u64, String> {
    modrinth::get_modpack_total_size(&version_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn install_modpack(
    instance_id: String,
    version_id: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    modrinth::install_modpack(&app_handle, &instance_id, &version_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_modrinth_project(project_id: String) -> Result<modrinth::ModrinthProject, String> {
    modrinth::get_project(&project_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_modrinth_versions(
    project_id: String,
    game_version: Option<String>,
    loader: Option<String>,
) -> Result<Vec<modrinth::ModrinthVersion>, String> {
    modrinth::get_project_versions(&project_id, game_version.as_deref(), loader.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn install_modrinth_file(
    instance_id: String,
    file_url: String,
    filename: String,
    file_type: String, // "mod", "resourcepack", "shader", "datapack"
    project_id: Option<String>,
    world_name: Option<String>,
) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    
    let dest_dir = match file_type.as_str() {
        "mod" => files::get_mods_dir(&instance),
        "resourcepack" => files::get_resourcepacks_dir(&instance),
        "shader" => files::get_shaderpacks_dir(&instance),
        "datapack" => {
            if let Some(wname) = world_name {
                files::get_saves_dir(&instance).join(wname).join("datapacks")
            } else {
                return Err("World name required for datapack installation".to_string());
            }
        },
        _ => return Err("Invalid file type".to_string()),
    };
    
    let dest_path = dest_dir.join(&filename);
    
    // Download the file
    let client = reqwest::Client::new();
    let response = client
        .get(&file_url)
        .header("User-Agent", "PaletheaLauncher/0.1.0")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    std::fs::write(&dest_path, bytes).map_err(|e| e.to_string())?;
    
    // Save metadata with project_id if provided
    if let Some(pid) = project_id {
        let meta = files::ModMeta { project_id: pid };
        let meta_path = dest_dir.join(format!("{}.meta.json", filename));
        if let Ok(json) = serde_json::to_string(&meta) {
            let _ = std::fs::write(&meta_path, json);
        }
    }
    
    Ok(())
}

// ============== FILE MANAGEMENT COMMANDS ==============

#[tauri::command]
fn get_instance_mods(instance_id: String) -> Result<Vec<files::InstalledMod>, String> {
    let instance = instances::get_instance(&instance_id)?;
    Ok(files::list_mods(&instance))
}

#[tauri::command]
fn toggle_instance_mod(instance_id: String, filename: String) -> Result<bool, String> {
    let instance = instances::get_instance(&instance_id)?;
    files::toggle_mod(&instance, &filename)
}

#[tauri::command]
fn delete_instance_mod(instance_id: String, filename: String) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    files::delete_mod(&instance, &filename)
}

#[tauri::command]
fn get_instance_resourcepacks(instance_id: String) -> Result<Vec<files::ResourcePack>, String> {
    let instance = instances::get_instance(&instance_id)?;
    Ok(files::list_resourcepacks(&instance))
}

#[tauri::command]
fn delete_instance_resourcepack(instance_id: String, filename: String) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    files::delete_resourcepack(&instance, &filename)
}

#[tauri::command]
fn get_instance_shaderpacks(instance_id: String) -> Result<Vec<files::ShaderPack>, String> {
    let instance = instances::get_instance(&instance_id)?;
    Ok(files::list_shaderpacks(&instance))
}

#[tauri::command]
fn delete_instance_shaderpack(instance_id: String, filename: String) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    files::delete_shaderpack(&instance, &filename)
}

#[tauri::command]
fn get_instance_worlds(instance_id: String) -> Result<Vec<files::World>, String> {
    let instance = instances::get_instance(&instance_id)?;
    Ok(files::list_worlds(&instance))
}

#[tauri::command]
fn delete_instance_world(instance_id: String, folder_name: String) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    files::delete_world(&instance, &folder_name)
}

#[tauri::command]
fn get_world_datapacks(instance_id: String, world_name: String) -> Result<Vec<files::Datapack>, String> {
    let instance = instances::get_instance(&instance_id)?;
    Ok(files::list_datapacks(&instance, &world_name))
}

#[tauri::command]
fn delete_instance_datapack(instance_id: String, world_name: String, filename: String) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    files::delete_datapack(&instance, &world_name, &filename)
}

#[tauri::command]
fn get_instance_screenshots(instance_id: String) -> Result<Vec<files::Screenshot>, String> {
    let instance = instances::get_instance(&instance_id)?;
    Ok(files::list_screenshots(&instance))
}

#[tauri::command]
fn delete_instance_screenshot(instance_id: String, filename: String) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    files::delete_screenshot(&instance, &filename)
}

#[tauri::command]
fn rename_instance_screenshot(instance_id: String, old_filename: String, new_filename: String) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    files::rename_screenshot(&instance, &old_filename, &new_filename)
}

#[tauri::command]
fn open_instance_screenshot(_app: AppHandle, instance_id: String, filename: String) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    let path = files::get_screenshots_dir(&instance).join(filename);
    // Use native path opening to bypass AppImage bundled xdg-open
    open_path_native(&path)
}

#[tauri::command]
fn get_instance_log(instance_id: String) -> Result<String, String> {
    let instance = instances::get_instance(&instance_id)?;
    files::get_latest_log(&instance)
}

#[tauri::command]
fn get_instance_servers(instance_id: String) -> Result<Vec<files::Server>, String> {
    let instance = instances::get_instance(&instance_id)?;
    Ok(files::list_servers(&instance))
}

#[tauri::command]
async fn open_instance_folder(_app: AppHandle, instance_id: String, folder_type: String) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    
    let path = match folder_type.as_str() {
        "root" => instance.get_game_directory(),
        "mods" => files::get_mods_dir(&instance),
        "config" => instance.get_game_directory().join("config"),
        "resourcepacks" => files::get_resourcepacks_dir(&instance),
        "shaderpacks" => files::get_shaderpacks_dir(&instance),
        "saves" => files::get_saves_dir(&instance),
        "screenshots" => files::get_screenshots_dir(&instance),
        "logs" => files::get_logs_dir(&instance),
        _ => instance.get_game_directory(),
    };
    
    // Ensure directory exists before opening
    if !path.exists() {
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }

    // Use platform-specific commands directly to avoid AppImage bundled xdg-open issues
    // See: https://github.com/tauri-apps/tauri/issues/10617
    open_path_native(&path)
}

/// Opens a path using the native file manager, bypassing AppImage bundled tools
fn open_path_native(path: &std::path::Path) -> Result<(), String> {
    use std::process::Command;
    
    #[cfg(target_os = "linux")]
    {
        // Try /usr/bin/xdg-open first (host system), then fallback to other methods
        // This bypasses the bundled xdg-open in AppImage which doesn't work correctly
        let xdg_paths = ["/usr/bin/xdg-open", "/bin/xdg-open"];
        
        for xdg_path in &xdg_paths {
            if std::path::Path::new(xdg_path).exists() {
                match Command::new(xdg_path)
                    .arg(path)
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                {
                    Ok(_) => return Ok(()),
                    Err(_) => continue,
                }
            }
        }
        
        // Fallback: try gio open
        if let Ok(_) = Command::new("gio")
            .args(["open", &path.to_string_lossy()])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            return Ok(());
        }
        
        Err("Could not find a way to open the folder. Please ensure xdg-open is installed.".to_string())
    }
    
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        Err("Unsupported platform".to_string())
    }
}

#[tauri::command]
fn get_instance_details(instance_id: String) -> Result<instances::Instance, String> {
    instances::get_instance(&instance_id)
}

#[tauri::command]
fn exit_app_fully(app: AppHandle) {
    let mut processes = RUNNING_PROCESSES.lock().expect("Process state corrupted");
    for (_instance_id, pid) in processes.drain() {
        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("taskkill")
                .args(&["/F", "/PID", &pid.to_string()])
                .spawn();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = std::process::Command::new("kill")
                .args(&["-9", &pid.to_string()])
                .spawn();
        }
    }
    // Clear session file
    instances::clear_active_session();
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    {
        // Fix for "Could not create GBM EGL display" crash on NVIDIA/Wayland/Arch
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            if let Err(err) = downloader::ensure_instance_logos_dir() {
                log::warn!("Failed to initialize instance logos folder: {}", err);
            }
            let _ = fs::create_dir_all(downloader::get_skins_dir());

            // Recover any orphaned playtime sessions from crashes or re-register running processes
            if let Some((instance_id, start_time, pid, current_playtime)) = instances::recover_orphaned_session() {
                let handle = app.handle().clone();
                let _ = handle.emit("refresh-instances", ());

                if let Some(pid_val) = pid {
                    // Re-register in the global map
                    {
                        let mut processes = RUNNING_PROCESSES.lock().expect("Process state corrupted");
                        processes.insert(instance_id.clone(), pid_val);
                    }
                    
                    let handle_clone = handle.clone();
                    let instance_id_clone = instance_id.clone();
                    
                    std::thread::spawn(move || {
                        // Wait for process to stop
                        while instances::is_process_running(pid_val) {
                            std::thread::sleep(std::time::Duration::from_secs(5));
                        }
                        
                        // Finalize playtime
                        let end_time = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs();
                        let session_duration = end_time.saturating_sub(start_time);
                        
                        if let Ok(mut inst) = instances::get_instance(&instance_id_clone) {
                            inst.playtime_seconds = current_playtime + session_duration;
                            let _ = instances::update_instance(inst);
                        }
                        
                        instances::clear_active_session();
                        
                        if let Ok(mut processes) = RUNNING_PROCESSES.lock() {
                            processes.remove(&instance_id_clone);
                        }
                        
                        let _ = handle_clone.emit("refresh-instances", ());
                    });
                    
                    log::info!("Re-registered running instance {} with PID {}", instance_id, pid_val);
                } else {
                    log::info!("Recovered orphaned session for instance {}: {}s credited", instance_id, current_playtime);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Version commands
            get_versions,
            get_latest_release,
            // Instance commands
            get_instances,
            create_instance,
            delete_instance,
            update_instance,
            clone_instance,
            get_instance_details,
            set_instance_logo,
            set_instance_logo_from_url,
            clear_instance_logo,
            // Download commands
            download_version,
            is_version_downloaded,
            // Launch commands
            launch_instance,
            kill_game,
            get_running_instances,
            check_java,
            // Settings commands
            set_java_path,
            get_java_path,
            get_settings,
            save_settings,
            download_java_for_instance,
            download_java_global,
            // Auth commands
            start_microsoft_login,
            poll_microsoft_login,
            logout,
            is_logged_in,
            get_current_uuid,
            get_saved_accounts,
            remove_saved_account,
            validate_account,
            refresh_account,
            switch_account,
            get_mc_profile_full,
            upload_skin,
            reset_skin,
            // User commands
            set_offline_user,
            get_current_user,
            get_data_directory,
            // Mod loader commands
            get_loader_versions,
            install_fabric,
            install_forge,
            install_neoforge,
            // Disk cleanup commands
            get_disk_usage,
            get_downloaded_versions,
            delete_version,
            clear_assets_cache,
            // Modrinth commands
            search_modrinth,
            get_modrinth_project,
            get_modrinth_versions,
            get_modpack_total_size,
            install_modpack,
            install_modrinth_file,
            // File management commands
            get_instance_mods,
            toggle_instance_mod,
            delete_instance_mod,
            get_instance_resourcepacks,
            delete_instance_resourcepack,
            get_instance_shaderpacks,
            delete_instance_shaderpack,
            get_instance_worlds,
            delete_instance_world,
            get_world_datapacks,
            delete_instance_datapack,
            get_instance_screenshots,
            delete_instance_screenshot,
            rename_instance_screenshot,
            open_instance_screenshot,
            get_instance_log,
            get_instance_servers,
            open_instance_folder,
            // Skin collection commands
            get_skin_collection,
            add_to_skin_collection,
            delete_skin_from_collection,
            get_skin_file_path,
            get_global_stats,
            log_event,
            exit_app_fully,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let processes = RUNNING_PROCESSES.lock().unwrap();
                if !processes.is_empty() {
                    api.prevent_close();
                    let _ = window.emit("show-exit-confirm", ());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
