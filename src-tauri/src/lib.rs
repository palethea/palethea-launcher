mod minecraft;

use minecraft::{versions, downloader, instances, launcher, settings, auth, modrinth, files, fabric, forge, java, logger, discord};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::sync::{Mutex, LazyLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{State, AppHandle, Emitter, Manager};

// Global state for tracking running game processes
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RunningProcessInfo {
    pub pid: u32,
    pub start_time: u64,
}

static RUNNING_PROCESSES: LazyLock<Mutex<HashMap<String, RunningProcessInfo>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static BOOTSTRAP_START: LazyLock<std::time::Instant> = LazyLock::new(std::time::Instant::now);

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
    pub most_played_playtime_seconds: u64,
    pub favorite_version: Option<String>,
    pub favorite_version_count: u32,
    pub last_played_instance: Option<String>,
    pub last_played_date: Option<String>,
    pub recent_instances: Vec<RecentInstance>,
    pub daily_activity_week: Vec<instances::DailyActivity>,
    pub daily_activity_month: Vec<instances::DailyActivity>,
    pub top_instances: Vec<TopInstance>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecentInstance {
    pub name: String,
    pub version_id: String,
    pub last_played: Option<String>,
    pub playtime_seconds: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TopInstance {
    pub name: String,
    pub version_id: String,
    pub mod_loader: instances::ModLoader,
    pub logo_filename: Option<String>,
    pub playtime_seconds: u64,
    pub total_launches: u64,
}

#[tauri::command]
fn get_global_stats() -> Result<GlobalStats, String> {
    let mut stats = GlobalStats::default();
    let instances = instances::load_instances()?;

    stats.instance_count = instances.len() as u32;

    let mut version_counts: HashMap<String, u32> = HashMap::new();
    let mut max_playtime = 0u64;
    let mut latest_played: Option<String> = None;
    let mut latest_played_name: Option<String> = None;

    for inst in &instances {
        stats.total_playtime_seconds += inst.playtime_seconds;
        stats.total_launches += inst.total_launches;

        // Track most played
        if inst.playtime_seconds > max_playtime {
            max_playtime = inst.playtime_seconds;
            stats.most_played_instance = Some(inst.name.clone());
            stats.most_played_playtime_seconds = inst.playtime_seconds;
        }

        // Track favorite version
        let count = version_counts.entry(inst.version_id.clone()).or_insert(0);
        *count += 1;

        // Track last played instance
        if let Some(ref lp) = inst.last_played {
            let is_newer = match &latest_played {
                Some(prev) => lp.as_str() > prev.as_str(),
                None => true,
            };
            if is_newer {
                latest_played = Some(lp.clone());
                latest_played_name = Some(inst.name.clone());
            }
        }
    }

    // Last played
    stats.last_played_date = latest_played;
    stats.last_played_instance = latest_played_name;

    // Find favorite version
    if let Some((version, count)) = version_counts
        .into_iter()
        .max_by_key(|&(_, count)| count)
    {
        stats.favorite_version = Some(version);
        stats.favorite_version_count = count;
    }

    // Recent instances: up to 5 most recently played
    let mut recent: Vec<_> = instances.iter()
        .filter(|i| i.last_played.is_some())
        .collect();
    recent.sort_by(|a, b| b.last_played.cmp(&a.last_played));
    stats.recent_instances = recent.into_iter().take(5).map(|i| RecentInstance {
        name: i.name.clone(),
        version_id: i.version_id.clone(),
        last_played: i.last_played.clone(),
        playtime_seconds: i.playtime_seconds,
    }).collect();

    // Top instances by playtime (top 5)
    let mut sorted_instances: Vec<_> = instances.iter()
        .filter(|i| i.playtime_seconds > 0)
        .collect();
    sorted_instances.sort_by(|a, b| b.playtime_seconds.cmp(&a.playtime_seconds));
    stats.top_instances = sorted_instances.into_iter().take(5).map(|i| TopInstance {
        name: i.name.clone(),
        version_id: i.version_id.clone(),
        mod_loader: i.mod_loader.clone(),
        logo_filename: i.logo_filename.clone(),
        playtime_seconds: i.playtime_seconds,
        total_launches: i.total_launches,
    }).collect();

    // Daily activity
    stats.daily_activity_week = instances::get_daily_activity(7);
    stats.daily_activity_month = instances::get_daily_activity(30);

    Ok(stats)
}

#[tauri::command]
fn get_bootstrap_time() -> f64 {
    BOOTSTRAP_START.elapsed().as_secs_f64()
}

#[tauri::command]
fn log_event(level: String, message: String, app_handle: AppHandle) {
    logger::emit_log(&app_handle, &level, &message);
}

// ============== VERSION COMMANDS ==============

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    open::that(url).map_err(|e| e.to_string())
}

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
async fn delete_instance(instance_id: String, app_handle: AppHandle) -> Result<(), String> {
    instances::delete_instance(&instance_id).await?;
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
async fn clone_instance(instance_id: String, new_name: String, app_handle: AppHandle) -> Result<instances::Instance, String> {
    // 1. Load source instance
    let source = instances::get_instance(&instance_id)?;
    
    // 2. Create new instance with same version
    let mut cloned = instances::create_instance(new_name, source.version_id.clone())?;
    
    // 3. Copy settings from source to cloned
    cloned.java_path = source.java_path.clone();
    cloned.jvm_args = source.jvm_args.clone();
    cloned.memory_min = source.memory_min;
    cloned.memory_max = source.memory_max;
    cloned.resolution_width = source.resolution_width;
    cloned.resolution_height = source.resolution_height;
    cloned.mod_loader = source.mod_loader.clone();
    cloned.mod_loader_version = source.mod_loader_version.clone();
    cloned.console_auto_update = source.console_auto_update;
    cloned.logo_filename = source.logo_filename.clone();
    cloned.color_accent = source.color_accent.clone();
    
    // Update the saved metadata
    instances::update_instance(cloned.clone())?;
    
    // 4. Copy game directory with progress
    let source_game_dir = source.get_game_directory();
    let new_game_dir = cloned.get_game_directory();
    
    if source_game_dir.exists() {
        let total_files = count_files_recursive(&source_game_dir);
        let mut current_count = 0;
        
        // Initial progress event
        let _ = app_handle.emit("download-progress", downloader::DownloadProgress {
            stage: format!("Preparing to clone {} files...", total_files),
            current: 0,
            total: total_files,
            percentage: 0.0,
            total_bytes: None,
            downloaded_bytes: None,
        });

        copy_dir_with_progress(
            &source_game_dir,
            &new_game_dir,
            &app_handle,
            total_files,
            &mut current_count
        )?;
    }

    // 5. Copy mod loader config files (stored at instance root, not in game directory)
    let source_dir = source.get_directory();
    let cloned_dir = cloned.get_directory();
    for loader_file in &["fabric.json", "forge.json", "neoforge.json"] {
        let src_path = source_dir.join(loader_file);
        if src_path.exists() {
            let dst_path = cloned_dir.join(loader_file);
            fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Failed to copy {}: {}", loader_file, e))?;
        }
    }

    let _ = app_handle.emit("refresh-instances", ());
    Ok(cloned)
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

#[tauri::command]
fn get_instance_options(instance_id: String) -> Result<String, String> {
    let instance = instances::get_instance(&instance_id)?;
    let options_path = instance.get_game_directory().join("options.txt");
    
    if !options_path.exists() {
        return Ok("".to_string());
    }
    
    fs::read_to_string(options_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_instance_options(instance_id: String, content: String) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    let game_dir = instance.get_game_directory();
    
    if !game_dir.exists() {
        fs::create_dir_all(&game_dir).map_err(|e| e.to_string())?;
    }
    
    let options_path = game_dir.join("options.txt");
    fs::write(options_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_instance_options_file(instance_id: String) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    let options_path = instance.get_game_directory().join("options.txt");
    
    if !options_path.exists() {
        return Err("options.txt does not exist yet. Launch the game once to generate it or save settings here first.".to_string());
    }
    
    open_path_native(&options_path)
}

#[tauri::command]
fn get_available_logos() -> Result<Vec<String>, String> {
    let logos_dir = downloader::get_instance_logos_dir();
    if !logos_dir.exists() {
        return Ok(Vec::new());
    }

    let mut logos = Vec::new();
    if let Ok(entries) = fs::read_dir(logos_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if ext.to_lowercase() == "png" {
                        if let Some(filename) = path.file_name().and_then(|f| f.to_str()) {
                            logos.push(filename.to_string());
                        }
                    }
                }
            }
        }
    }
    
    // Sort logos to keep them consistent
    logos.sort_by_key(|a| a.to_lowercase());
    
    Ok(logos)
}

#[tauri::command]
fn set_instance_logo_from_stock(instance_id: String, filename: String) -> Result<instances::Instance, String> {
    let mut instance = instances::get_instance(&instance_id)?;
    
    // Verify file exists
    let logo_path = downloader::get_instance_logos_dir().join(&filename);
    if !logo_path.exists() {
        return Err("Logo file not found".to_string());
    }

    // If it was a custom logo (starts with instance_id), we might want to clean it up, 
    // but stock logos should stay. Actually, for simplicity, we'll just switch filename.
    instance.logo_filename = Some(filename);
    instances::update_instance(instance.clone())?;
    Ok(instance)
}


// ----------
// export_instance_zip
// Description: Exports an instance as a .zip file for sharing with others.
//              Includes the instance metadata and all game files (mods, configs, worlds, etc.)
// ----------
fn count_files_recursive(dir: &std::path::Path) -> u32 {
    let mut count = 0;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                count += count_files_recursive(&path);
            } else {
                count += 1;
            }
        }
    }
    count
}

fn copy_dir_with_progress(
    src: &std::path::Path,
    dst: &std::path::Path,
    app_handle: &AppHandle,
    total_files: u32,
    current_count: &mut u32,
) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;

    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_with_progress(&src_path, &dst_path, app_handle, total_files, current_count)?;
        } else {
            *current_count += 1;
            let file_name = entry.file_name().to_string_lossy().to_string();
            let percentage = if total_files > 0 { (*current_count as f32 / total_files as f32) * 100.0 } else { 100.0 };

            if *current_count % 50 == 0 || *current_count == total_files {
                let _ = app_handle.emit("download-progress", downloader::DownloadProgress {
                    stage: format!("Cloning: {} ({}/{})", file_name, current_count, total_files),
                    current: *current_count,
                    total: total_files,
                    percentage,
                    total_bytes: None,
                    downloaded_bytes: None,
                });
            }

            if file_type.is_symlink() {
                let target = fs::read_link(&src_path).map_err(|e| e.to_string())?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::symlink;
                    let _ = symlink(&target, &dst_path);
                }
                #[cfg(windows)]
                {
                    if target.is_dir() {
                        let _ = std::os::windows::fs::symlink_dir(&target, &dst_path);
                    } else {
                        let _ = std::os::windows::fs::symlink_file(&target, &dst_path);
                    }
                }
            } else {
                fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn export_instance_zip(instance_id: String, destination_path: String, app_handle: AppHandle) -> Result<String, String> {
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    
    logger::emit_log(&app_handle, "info", &format!("Exporting instance {} to {}", instance_id, destination_path));
    
    let instance = instances::get_instance(&instance_id)?;
    let game_dir = instance.get_game_directory();
    
    if !game_dir.exists() {
        return Err("Instance game directory not found".to_string());
    }

    let _ = app_handle.emit("download-progress", downloader::DownloadProgress {
        stage: "Counting files...".to_string(),
        current: 0,
        total: 0,
        percentage: 0.0,
        total_bytes: None,
        downloaded_bytes: None,
    });

    let total_files = count_files_recursive(&game_dir);
    let mut current_count = 0;
    
    // Create the zip file
    let zip_path = std::path::PathBuf::from(&destination_path);
    let file = fs::File::create(&zip_path)
        .map_err(|e| format!("Failed to create zip file: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(6));
    
    // Write instance metadata as palethea_instance.json
    let metadata = serde_json::json!({
        "name": instance.name,
        "version_id": instance.version_id,
        "mod_loader": instance.mod_loader,
        "mod_loader_version": instance.mod_loader_version,
        "memory_min": instance.memory_min,
        "memory_max": instance.memory_max,
        "jvm_args": instance.jvm_args,
        "resolution_width": instance.resolution_width,
        "resolution_height": instance.resolution_height,
        "color_accent": instance.color_accent,
        "exported_at": SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        "palethea_version": "1.0"
    });
    
    zip.start_file("palethea_instance.json", options)
        .map_err(|e| format!("Failed to add metadata: {}", e))?;
    zip.write_all(serde_json::to_string_pretty(&metadata).unwrap().as_bytes())
        .map_err(|e| format!("Failed to write metadata: {}", e))?;
    
    // Recursively add all files from game directory
    fn add_dir_to_zip<W: Write + std::io::Seek>(
        zip: &mut zip::ZipWriter<W>,
        base_path: &std::path::Path,
        current_path: &std::path::Path,
        options: SimpleFileOptions,
        app_handle: &AppHandle,
        total_files: u32,
        current_count: &mut u32,
    ) -> Result<(), String> {
        for entry in fs::read_dir(current_path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let relative = path.strip_prefix(base_path).map_err(|e| e.to_string())?;
            let name = format!("minecraft/{}", relative.to_string_lossy().replace("\\", "/"));
            
            if path.is_dir() {
                zip.add_directory(&name, options)
                    .map_err(|e| format!("Failed to add directory {}: {}", name, e))?;
                add_dir_to_zip(zip, base_path, &path, options, app_handle, total_files, current_count)?;
            } else {
                *current_count += 1;
                let file_name = path.file_name().unwrap_or_default().to_string_lossy();
                let percentage = (*current_count as f32 / total_files as f32) * 100.0;
                
                // Only emit every 50 files or so to avoid overwhelming the frontend
                if *current_count % 50 == 0 || *current_count == total_files {
                    let _ = app_handle.emit("download-progress", downloader::DownloadProgress {
                        stage: format!("Zipping: {} ({}/{})", file_name, current_count, total_files),
                        current: *current_count,
                        total: total_files,
                        percentage,
                        total_bytes: None,
                        downloaded_bytes: None,
                    });
                }

                zip.start_file(&name, options)
                    .map_err(|e| format!("Failed to start file {}: {}", name, e))?;
                let mut file = fs::File::open(&path).map_err(|e| e.to_string())?;
                std::io::copy(&mut file, zip).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
    
    add_dir_to_zip(&mut zip, &game_dir, &game_dir, options, &app_handle, total_files, &mut current_count)?;
    
    zip.finish().map_err(|e| format!("Failed to finalize zip: {}", e))?;
    
    logger::emit_log(&app_handle, "info", &format!("Successfully exported instance to {}", destination_path));
    
    Ok(destination_path)
}

// ----------
// peek_instance_zip
// Description: Peeks into a zip file to see if it's a valid Palethea instance export
//              and returns the metadata if it is.
// ----------
#[tauri::command]
async fn peek_instance_zip(zip_path: String) -> Result<serde_json::Value, String> {
    use std::io::Read;
    
    let zip_file = fs::File::open(&zip_path)
        .map_err(|e| format!("Failed to open zip file: {}", e))?;
    let mut archive = zip::ZipArchive::new(zip_file)
        .map_err(|e| format!("Failed to read zip archive: {}", e))?;
    
    let mut metadata_file = archive.by_name("palethea_instance.json")
        .map_err(|_| "This doesn't appear to be a valid Palethea instance export (missing palethea_instance.json)")?;
    let mut contents = String::new();
    metadata_file.read_to_string(&mut contents)
        .map_err(|e| format!("Failed to read metadata: {}", e))?;
    let metadata: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse metadata: {}", e))?;
        
    Ok(metadata)
}

// ----------
// import_instance_zip
// Description: Imports an instance from a .zip file created by export_instance_zip.
//              Creates a new instance with the imported settings and files.
// ----------
#[tauri::command]
async fn import_instance_zip(zip_path: String, custom_name: Option<String>, app_handle: AppHandle) -> Result<instances::Instance, String> {
    use std::io::Read;
    
    logger::emit_log(&app_handle, "info", &format!("Importing instance from {}", zip_path));
    
    let zip_file = fs::File::open(&zip_path)
        .map_err(|e| format!("Failed to open zip file: {}", e))?;
    let mut archive = zip::ZipArchive::new(zip_file)
        .map_err(|e| format!("Failed to read zip archive: {}", e))?;
    
    // Read the metadata file
    let metadata: serde_json::Value = {
        let mut metadata_file = archive.by_name("palethea_instance.json")
            .map_err(|_| "This doesn't appear to be a valid Palethea instance export (missing palethea_instance.json)")?;
        let mut contents = String::new();
        metadata_file.read_to_string(&mut contents)
            .map_err(|e| format!("Failed to read metadata: {}", e))?;
        serde_json::from_str(&contents)
            .map_err(|e| format!("Failed to parse metadata: {}", e))?
    };
    
    // Extract instance info from metadata
    let original_name = metadata["name"].as_str().unwrap_or("Imported Instance").to_string();
    let version_id = metadata["version_id"].as_str().unwrap_or("1.21").to_string();
    let mod_loader_str = metadata["mod_loader"].as_str().unwrap_or("Vanilla");
    let mod_loader_version = metadata["mod_loader_version"].as_str().map(|s| s.to_string());
    
    // Use custom name if provided, otherwise use original name
    let instance_name = custom_name.unwrap_or_else(|| format!("{} (Imported)", original_name));
    
    // Create new instance
    let mut new_instance = instances::create_instance(instance_name.clone(), version_id.clone())?;
    
    // Set mod loader
    new_instance.mod_loader = match mod_loader_str {
        "Fabric" => instances::ModLoader::Fabric,
        "Forge" => instances::ModLoader::Forge,
        "NeoForge" => instances::ModLoader::NeoForge,
        _ => instances::ModLoader::Vanilla,
    };
    new_instance.mod_loader_version = mod_loader_version;
    
    // Copy other settings from metadata
    if let Some(mem_min) = metadata["memory_min"].as_u64() {
        new_instance.memory_min = Some(mem_min as u32);
    }
    if let Some(mem_max) = metadata["memory_max"].as_u64() {
        new_instance.memory_max = Some(mem_max as u32);
    }
    if let Some(jvm_args) = metadata["jvm_args"].as_str() {
        new_instance.jvm_args = Some(jvm_args.to_string());
    }
    if let Some(width) = metadata["resolution_width"].as_u64() {
        new_instance.resolution_width = Some(width as u32);
    }
    if let Some(height) = metadata["resolution_height"].as_u64() {
        new_instance.resolution_height = Some(height as u32);
    }
    if let Some(color) = metadata["color_accent"].as_str() {
        new_instance.color_accent = Some(color.to_string());
    }
    
    // Extract game files to the new instance's minecraft directory
    let game_dir = new_instance.get_game_directory();
    fs::create_dir_all(&game_dir).map_err(|e| format!("Failed to create game directory: {}", e))?;
    
    // Re-open archive to extract files (we consumed it reading metadata)
    let zip_file = fs::File::open(&zip_path)
        .map_err(|e| format!("Failed to reopen zip file: {}", e))?;
    let mut archive = zip::ZipArchive::new(zip_file)
        .map_err(|e| format!("Failed to read zip archive: {}", e))?;
    
    let total_files = archive.len() as u32;
    let mut current_count = 0;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();

        current_count += 1;
        
        // Skip the metadata file
        if name == "palethea_instance.json" {
            continue;
        }

        let percentage = (current_count as f32 / total_files as f32) * 100.0;
        let file_name = std::path::Path::new(&name).file_name().unwrap_or_default().to_string_lossy().to_string();

        if current_count % 50 == 0 || current_count == total_files {
            let _ = app_handle.emit("download-progress", downloader::DownloadProgress {
                stage: format!("Extracting: {} ({}/{})", file_name, current_count, total_files),
                current: current_count,
                total: total_files,
                percentage,
                total_bytes: None,
                downloaded_bytes: None,
            });
        }
        
        // Extract files that are in the minecraft/ directory
        if name.starts_with("minecraft/") {
            let relative_path = name.strip_prefix("minecraft/").unwrap_or(&name);
            if relative_path.is_empty() {
                continue;
            }
            
            let dest_path = game_dir.join(relative_path);
            
            if file.is_dir() {
                fs::create_dir_all(&dest_path).map_err(|e| e.to_string())?;
            } else {
                // Ensure parent directory exists
                if let Some(parent) = dest_path.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let mut out_file = fs::File::create(&dest_path)
                    .map_err(|e| format!("Failed to create file {}: {}", dest_path.display(), e))?;
                std::io::copy(&mut file, &mut out_file)
                    .map_err(|e| format!("Failed to extract file {}: {}", name, e))?;
            }
        }
    }
    
    // ----------
    // Install mod loader if specified
    // Description: Mod loader version files are stored globally, not in the instance folder,
    //              so we need to install the mod loader after importing
    // ----------
    if let Some(ref loader_version) = new_instance.mod_loader_version {
        let loader_version_clone = loader_version.clone();
        match new_instance.mod_loader {
            instances::ModLoader::Fabric => {
                logger::emit_log(&app_handle, "info", &format!("Installing Fabric {} for imported instance", loader_version_clone));
                fabric::install_fabric(&new_instance, &loader_version_clone)
                    .await
                    .map_err(|e| format!("Failed to install Fabric: {}", e))?;
            }
            instances::ModLoader::Forge => {
                logger::emit_log(&app_handle, "info", &format!("Installing Forge {} for imported instance", loader_version_clone));
                forge::install_forge(&new_instance, &loader_version_clone)
                    .await
                    .map_err(|e| format!("Failed to install Forge: {}", e))?;
            }
            instances::ModLoader::NeoForge => {
                logger::emit_log(&app_handle, "info", &format!("Installing NeoForge {} for imported instance", loader_version_clone));
                forge::install_neoforge(&new_instance, &loader_version_clone)
                    .await
                    .map_err(|e| format!("Failed to install NeoForge: {}", e))?;
            }
            instances::ModLoader::Vanilla => {
                // No mod loader to install
            }
        }
    }
    
    // Update the instance in the config
    instances::update_instance(new_instance.clone())?;
    
    logger::emit_log(&app_handle, "info", &format!("Successfully imported instance: {}", instance_name));
    
    let _ = app_handle.emit("refresh-instances", ());
    
    Ok(new_instance)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InstanceShareCode {
    pub name: String,
    pub version: String,
    pub loader: String,
    pub loader_version: Option<String>,
    pub mods: Vec<ShareItem>,
    pub resourcepacks: Vec<ShareItem>,
    pub shaders: Vec<ShareItem>,
    pub datapacks: Vec<ShareItem>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ShareItem {
    pub project_id: String,
    pub version_id: Option<String>,
    pub filename: Option<String>,
    pub name: Option<String>,
    pub icon_url: Option<String>,
    pub version_name: Option<String>,
}

#[tauri::command]
fn get_instance_share_code(instance_id: String) -> Result<String, String> {
    let instance = instances::get_instance(&instance_id)?;
    
    let mods = files::list_mods(&instance)
        .into_iter()
        .filter(|m| m.project_id.is_some())
        .map(|m| ShareItem {
            project_id: m.project_id.unwrap(),
            version_id: m.version_id,
            filename: Some(m.filename),
            name: m.name,
            icon_url: m.icon_url,
            version_name: m.version,
        })
        .collect();
        
    let resourcepacks = files::list_resourcepacks(&instance)
        .into_iter()
        .filter(|p| p.project_id.is_some())
        .map(|p| ShareItem {
            project_id: p.project_id.unwrap(),
            version_id: p.version_id,
            filename: Some(p.filename),
            name: p.name,
            icon_url: p.icon_url,
            version_name: p.version,
        })
        .collect();
        
    let shaders = files::list_shaderpacks(&instance)
        .into_iter()
        .filter(|s| s.project_id.is_some())
        .map(|s| ShareItem {
            project_id: s.project_id.unwrap(),
            version_id: s.version_id,
            filename: Some(s.filename),
            name: s.name,
            icon_url: s.icon_url,
            version_name: s.version,
        })
        .collect();

    let mut datapacks = Vec::new();
    let saves_dir = files::get_saves_dir(&instance);
    if saves_dir.exists() {
        if let Ok(entries) = fs::read_dir(saves_dir) {
            for world_entry in entries.flatten() {
                if world_entry.path().is_dir() {
                    let world_name = world_entry.file_name().to_string_lossy().to_string();
                    let world_dps = files::list_datapacks(&instance, &world_name);
                    for d in world_dps {
                        if let Some(pid) = d.project_id {
                            // Only add if not already in list
                            if !datapacks.iter().any(|existing: &ShareItem| existing.project_id == pid) {
                                datapacks.push(ShareItem { 
                                    project_id: pid,
                                    version_id: d.version_id,
                                    filename: Some(d.filename),
                                    name: d.name,
                                    icon_url: d.icon_url,
                                    version_name: d.version,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    let share_data = InstanceShareCode {
        name: instance.name,
        version: instance.version_id,
        loader: match instance.mod_loader {
            instances::ModLoader::Vanilla => "vanilla".to_string(),
            instances::ModLoader::Fabric => "fabric".to_string(),
            instances::ModLoader::Forge => "forge".to_string(),
            instances::ModLoader::NeoForge => "neoforge".to_string(),
        },
        loader_version: instance.mod_loader_version,
        mods,
        resourcepacks,
        shaders,
        datapacks,
    };
    
    let json = serde_json::to_string(&share_data).map_err(|e| e.to_string())?;
    
    // Simple Base64 encoding using general_purpose engine (which we already imported in files.rs)
    // Actually base64 engine is in files.rs, let's use it here too.
    use base64::{Engine as _, engine::general_purpose};
    let code = general_purpose::STANDARD_NO_PAD.encode(json);
    
    Ok(code)
}

#[tauri::command]
fn get_instance_mods_share_code(instance_id: String) -> Result<String, String> {
    let instance = instances::get_instance(&instance_id)?;
    
    let mods = files::list_mods(&instance)
        .into_iter()
        .filter(|m| m.project_id.is_some())
        .map(|m| ShareItem {
            project_id: m.project_id.unwrap(),
            version_id: m.version_id,
            filename: Some(m.filename),
            name: m.name,
            icon_url: m.icon_url,
            version_name: m.version,
        })
        .collect();
        
    let share_data = InstanceShareCode {
        name: instance.name,
        version: instance.version_id,
        loader: match instance.mod_loader {
            instances::ModLoader::Vanilla => "vanilla".to_string(),
            instances::ModLoader::Fabric => "fabric".to_string(),
            instances::ModLoader::Forge => "forge".to_string(),
            instances::ModLoader::NeoForge => "neoforge".to_string(),
        },
        loader_version: instance.mod_loader_version,
        mods,
        resourcepacks: Vec::new(),
        shaders: Vec::new(),
        datapacks: Vec::new(),
    };
    
    let json = serde_json::to_string(&share_data).map_err(|e| e.to_string())?;
    
    use base64::{Engine as _, engine::general_purpose};
    let code = general_purpose::STANDARD_NO_PAD.encode(json);
    
    Ok(code)
}

#[tauri::command]
fn decode_instance_share_code(code: String) -> Result<InstanceShareCode, String> {
    use base64::{Engine as _, engine::general_purpose};
    let json_bytes = general_purpose::STANDARD_NO_PAD.decode(code.trim()).map_err(|e| e.to_string())?;
    let share_data: InstanceShareCode = serde_json::from_slice(&json_bytes).map_err(|e| e.to_string())?;
    Ok(share_data)
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
    println!("Launching instance: {}", instance.name);
    
    // Check if this instance is already running
    {
        let processes = RUNNING_PROCESSES.lock().map_err(|_| "Process state corrupted")?;
        if processes.contains_key(&instance_id) {
            log_warn!(&app_handle, "Instance {} is already running", instance.name);
            return Err("This instance is already running".to_string());
        }
    }

    let _ = app_handle.emit("download-progress", downloader::DownloadProgress {
        stage: format!("Preparing to launch {}...", instance.name),
        percentage: 10.0,
        total_bytes: None,
        downloaded_bytes: None,
        current: 0,
        total: 0,
    });
    
    // Check if version is downloaded
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
    
    let _ = app_handle.emit("download-progress", downloader::DownloadProgress {
        stage: format!("Preparing to launch {}...", instance.name),
        percentage: 0.0,
        total_bytes: None,
        downloaded_bytes: None,
        current: 0,
        total: 0,
    });
    
    // Launch the game
    let mut child = launcher::launch_game(&instance, &version_details, &username, &access_token, &uuid, &app_handle).await?;
    
    // Store the process ID
    let process_id = child.id();
    
    // Write session file for crash recovery (include PID)
    let _ = instances::write_active_session(&instance_id, start_time, Some(process_id));
    
    {
        let mut processes = RUNNING_PROCESSES.lock().map_err(|_| "Process state corrupted")?;
        processes.insert(instance_id.clone(), RunningProcessInfo {
            pid: process_id,
            start_time,
        });
        discord::update_presence(processes.len());
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

            // Log session for activity tracking
            instances::log_session(&instance_id_clone, &instance_name, end_time, session_duration);
            instances::clear_active_session();
            
            // Remove from running processes
            if let Ok(mut processes) = RUNNING_PROCESSES.lock() {
                processes.remove(&instance_id_clone);
                discord::update_presence(processes.len());
            }

            log_info!(&app_handle_clone, "Instance {} exited with status: {:?}, session duration: {}s", instance_name, status, session_duration);
        }
    });
    
    Ok(format!("Launched {} with version {}", instance.name, instance.version_id))
}

#[tauri::command]
fn kill_game(
    instance_id: String,
) -> Result<String, String> {
    let process_info = {
        let processes = RUNNING_PROCESSES.lock().map_err(|_| "Process state corrupted")?;
        processes.get(&instance_id).cloned()
    };
    
    match process_info {
        Some(info) => {
            let pid = info.pid;
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
                discord::update_presence(processes.len());
            }
            instances::clear_active_session();
            
            Ok(format!("Killed game for instance {}", instance_id))
        }
        None => Err("Instance is not running".to_string())
    }
}

#[tauri::command]
fn get_running_instances() -> Result<HashMap<String, RunningProcessInfo>, String> {
    let processes = RUNNING_PROCESSES.lock().map_err(|_| "Process state corrupted")?;
    Ok(processes.clone())
}

#[tauri::command]
async fn check_java() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
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
    }).await.map_err(|e| e.to_string())?
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

#[tauri::command]
async fn is_java_version_installed(version: u32) -> Result<bool, String> {
    let mc_dir = minecraft::downloader::get_minecraft_dir();
    let install_dir = mc_dir.join("java").join(format!("temurin-{}", version));
    Ok(install_dir.exists())
}

// ----------
// GitHub Release Info
// Description: Struct to hold release information from GitHub API
// ----------
#[derive(Debug, Serialize, Deserialize)]
pub struct GitHubRelease {
    pub tag_name: String,
    pub name: Option<String>,
    pub body: Option<String>,
    pub prerelease: bool,
    pub published_at: Option<String>,
    pub html_url: String,
}

// ----------
// get_github_releases
// Description: Fetches releases from GitHub API, returns both stable and prerelease versions
// ----------
#[tauri::command]
async fn get_github_releases(include_prerelease: bool) -> Result<Vec<GitHubRelease>, String> {
    let client = reqwest::Client::new();
    let url = "https://api.github.com/repos/mwsk75996/palethea-launcher/releases";
    
    let response = client
        .get(url)
        .header("User-Agent", "PaletheaLauncher/0.1.0")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch releases: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("GitHub API returned status: {}", response.status()));
    }
    
    let releases: Vec<GitHubRelease> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse releases: {}", e))?;
    
    // Filter based on include_prerelease flag
    let filtered: Vec<GitHubRelease> = if include_prerelease {
        releases
    } else {
        releases.into_iter().filter(|r| !r.prerelease).collect()
    };
    
    Ok(filtered)
}

// ----------
// compare_versions
// Description: Compares two semver versions, returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
//              Properly handles prerelease versions (e.g., 0.2.9-1 > 0.2.9)
// ----------
#[tauri::command]
fn compare_versions(v1: String, v2: String) -> i32 {
    // Helper to parse version components
    fn parse_version(version: &str) -> (Vec<u32>, Option<u32>) {
        // Remove 'v' prefix if present
        let ver = version.strip_prefix('v').unwrap_or(version);
        
        // Split by '-' to separate main version from prerelease suffix
        let parts: Vec<&str> = ver.splitn(2, '-').collect();
        let main_version = parts[0];
        let prerelease: Option<u32> = parts.get(1).and_then(|p| p.parse().ok());
        
        // Parse main version components
        let components: Vec<u32> = main_version
            .split('.')
            .filter_map(|s| s.parse().ok())
            .collect();
        
        (components, prerelease)
    }
    
    let (v1_main, v1_pre) = parse_version(&v1);
    let (v2_main, v2_pre) = parse_version(&v2);
    
    // Compare main version components
    let max_len = v1_main.len().max(v2_main.len());
    for i in 0..max_len {
        let c1 = v1_main.get(i).copied().unwrap_or(0);
        let c2 = v2_main.get(i).copied().unwrap_or(0);
        if c1 > c2 {
            return 1;
        }
        if c1 < c2 {
            return -1;
        }
    }
    
    // Main versions are equal - check prerelease
    // Standard SemVer: A prerelease version (with -suffix) is OLDER than the base version
    match (v1_pre, v2_pre) {
        (Some(p1), Some(p2)) => {
            // Both have prerelease, compare numerically
            if p1 > p2 { 1 } else if p1 < p2 { -1 } else { 0 }
        }
        (Some(_), None) => {
            // v1 has prerelease (0.2.13-1), v2 doesn't (0.2.13) -> v1 is OLDER
            -1
        }
        (None, Some(_)) => {
            // v1 doesn't (0.2.13), v2 has prerelease (0.2.13-1) -> v1 is NEWER
            1
        }
        (None, None) => {
            // Neither has prerelease, versions are equal
            0
        }
    }
}

// ----------
// is_prerelease_version
// Description: Checks if a version string is a prerelease (contains a hyphen suffix like -1, -2, etc.)
// ----------
#[tauri::command]
fn is_prerelease_version(version: String) -> bool {
    let ver = version.strip_prefix('v').unwrap_or(&version);
    ver.contains('-')
}

// ----------
// download_and_run_installer
// Description: Downloads a release installer from GitHub and runs it directly.
//              Used for pre-releases when Tauri's built-in updater doesn't work.
// ----------
#[tauri::command]
async fn download_and_run_installer(version: String, window: tauri::Window) -> Result<(), String> {
    use std::env;
    use tokio::io::AsyncWriteExt;
    use futures::StreamExt;
    
    // Determine the correct asset name based on the platform
    let asset_name = if cfg!(target_os = "windows") {
        format!("PaletheaLauncher_{}_x64-setup.exe", version)
    } else if cfg!(target_os = "macos") {
        format!("PaletheaLauncher_{}_x64.dmg", version)
    } else {
        // Linux - use AppImage
        format!("PaletheaLauncher_{}_amd64.AppImage", version)
    };
    
    let download_url = format!(
        "https://github.com/mwsk75996/palethea-launcher/releases/download/v{}/{}",
        version, asset_name
    );
    
    println!("[INFO] Downloading installer from: {}", download_url);
    
    // Create temp directory for download
    let temp_dir = env::temp_dir();
    let installer_path = temp_dir.join(&asset_name);
    
    // Download the installer
    let client = reqwest::Client::new();
    let response = client
        .get(&download_url)
        .header("User-Agent", "PaletheaLauncher/0.1.0")
        .send()
        .await
        .map_err(|e| format!("Failed to download installer: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }
    
    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    
    let mut file = tokio::fs::File::create(&installer_path)
        .await
        .map_err(|e| format!("Failed to create installer file: {}", e))?;
    
    let mut stream = response.bytes_stream();
    
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write installer: {}", e))?;
        
        downloaded += chunk.len() as u64;
        if total_size > 0 {
            let progress = ((downloaded as f64 / total_size as f64) * 100.0) as u32;
            let _ = window.emit("installer-download-progress", progress);
        }
    }
    
    file.flush().await.map_err(|e| format!("Failed to flush file: {}", e))?;
    drop(file);
    
    println!("[INFO] Installer downloaded to: {:?}", installer_path);
    
    // Run the installer
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new(&installer_path)
            .spawn()
            .map_err(|e| format!("Failed to run installer: {}", e))?;
    }
    
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        // Open the DMG
        Command::new("open")
            .arg(&installer_path)
            .spawn()
            .map_err(|e| format!("Failed to open installer: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        use std::os::unix::fs::PermissionsExt;
        // Make AppImage executable
        let mut perms = std::fs::metadata(&installer_path)
            .map_err(|e| format!("Failed to get file metadata: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&installer_path, perms)
            .map_err(|e| format!("Failed to set permissions: {}", e))?;
        
        Command::new(&installer_path)
            .spawn()
            .map_err(|e| format!("Failed to run installer: {}", e))?;
    }
    
    // Exit the current app so the installer can replace it
    std::process::exit(0);
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
async fn get_disk_usage() -> Result<DiskUsageInfo, String> {
    tokio::task::spawn_blocking(|| {
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
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_downloaded_versions() -> Result<Vec<DownloadedVersion>, String> {
    tokio::task::spawn_blocking(|| {
        let versions_dir = downloader::get_versions_dir();
        let mut versions = Vec::new();
        
        // 1. Scan the versions directory (Vanilla versions)
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

        // 2. Scan instances for active mod loaders
        if let Ok(all_instances) = instances::load_instances() {
            for inst in all_instances {
                if inst.mod_loader != instances::ModLoader::Vanilla {
                    if let Some(ref loader_ver) = inst.mod_loader_version {
                        let loader_name = match inst.mod_loader {
                            instances::ModLoader::Fabric => "Fabric",
                            instances::ModLoader::Forge => "Forge",
                            instances::ModLoader::NeoForge => "NeoForge",
                            _ => "ModLoader",
                        };
                        
                        let id = format!("{} {} ({})", loader_name, loader_ver, inst.version_id);
                        if !versions.iter().any(|v| v.id == id) {
                            let mut size = 0;

                            // Calculate specific size for Fabric if possible
                            if inst.mod_loader == instances::ModLoader::Fabric {
                                if let Some(fabric_info) = fabric::load_fabric_info(&inst) {
                                    let lib_dir = downloader::get_libraries_dir();
                                    
                                    // Check loader jar
                                    let loader_jar = lib_dir.join(fabric::maven_to_path(&fabric_info.loader.maven));
                                    if let Ok(m) = fs::metadata(loader_jar) {
                                        size += m.len();
                                    }
                                    
                                    // Check intermediary jar
                                    let int_jar = lib_dir.join(fabric::maven_to_path(&fabric_info.intermediary.maven));
                                    if let Ok(m) = fs::metadata(int_jar) {
                                        size += m.len();
                                    }
                                }
                            }

                            versions.push(DownloadedVersion {
                                id,
                                size,
                            });
                        }
                    }
                }
            }
        }
        
        // Sort by ID to keep it clean
        versions.sort_by(|a, b| a.id.cmp(&b.id));
        
        Ok(versions)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn delete_version(version_id: String) -> Result<String, String> {
    // Check if this is a synthesized mod loader version
    if version_id.contains("Fabric") || version_id.contains("Forge") || version_id.contains("NeoForge") {
        return Err("Mod loader versions cannot be deleted from here. Modify or delete the instance that uses it instead.".to_string());
    }

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
            .map_err(|e| format!("Failed to delete version index: {}", e))?;
    }
    
    Ok(format!("Deleted version index for {}", version_id))
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
                .map_err(|e| format!("Network error connecting to Fabric API: {}", e))?;
            
            if !response.status().is_success() {
                let status = response.status();
                if status == reqwest::StatusCode::NOT_FOUND {
                    return Err(format!("Fabric does not yet support Minecraft version {}. It might be too new or invalid.", game_version));
                }
                return Err(format!("Fabric API returned error status: {} ({})", status.as_u16(), status.canonical_reason().unwrap_or("Unknown")));
            }
            
            #[derive(Deserialize)]
            struct FabricLoaderVersion {
                loader: FabricLoader,
            }
            
            #[derive(Deserialize)]
            struct FabricLoader {
                version: String,
                #[serde(rename = "stable")]
                _stable: bool,
            }
            
            let versions: Vec<FabricLoaderVersion> = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse Fabric API response: {}. The version '{}' might not have loader support yet.", e, game_version))?;
            
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
    categories: Option<Vec<String>>,
    limit: u32,
    offset: u32,
    index: Option<String>,
) -> Result<modrinth::ModrinthSearchResult, String> {
    modrinth::search_projects(
        &query,
        &project_type,
        game_version.as_deref(),
        loader.as_deref(),
        categories,
        limit,
        offset,
        index.as_deref(),
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
async fn get_modrinth_projects(project_ids: Vec<String>) -> Result<Vec<modrinth::ModrinthProject>, String> {
    modrinth::get_projects(project_ids)
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
async fn get_modrinth_version(
    version_id: String,
) -> Result<modrinth::ModrinthVersion, String> {
    modrinth::get_version(&version_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn install_modrinth_file(
    app_handle: AppHandle,
    instance_id: String,
    file_url: String,
    filename: String,
    file_type: String, // "mod", "resourcepack", "shader", "datapack"
    project_id: Option<String>,
    version_id: Option<String>,
    world_name: Option<String>,
    name: Option<String>,
    author: Option<String>,
    icon_url: Option<String>,
    version_name: Option<String>,
    // ----------
    // Categories parameter
    // Description: Modrinth category tags for filtering installed items
    // ----------
    categories: Option<Vec<String>>,
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
    
    // Download the file with progress
    let client = reqwest::Client::new();
    let response = client
        .get(&file_url)
        .header("User-Agent", format!("PaletheaLauncher/{}", minecraft::get_launcher_version()))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?
        .error_for_status()
        .map_err(|e| format!("HTTP error: {}", e))?;
    
    let total_size = response.content_length();
    
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    let mut file = std::fs::File::create(&dest_path).map_err(|e| format!("Failed to create file: {}", e))?;
    let mut downloaded: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    
    let mut stream = response.bytes_stream();
    use futures::StreamExt;
    
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("Download error: {}", e))?;
        std::io::Write::write_all(&mut file, &chunk).map_err(|e| format!("Write error: {}", e))?;
        downloaded += chunk.len() as u64;
        
        // Emit progress every 100ms or so
        if last_emit.elapsed().as_millis() > 100 || total_size.map_or(false, |ts| downloaded == ts) {
            let percentage = total_size.map_or(0.0, |ts| (downloaded as f32 / ts as f32) * 100.0);
            let _ = app_handle.emit("download-progress", downloader::DownloadProgress {
                stage: format!("Downloading {}...", name.as_ref().unwrap_or(&filename)),
                percentage,
                current: 1,
                total: 1,
                total_bytes: total_size,
                downloaded_bytes: Some(downloaded),
            });
            last_emit = std::time::Instant::now();
        }
    }
    
    // Save metadata with project_id if provided
    if let Some(pid) = project_id {
        let meta = files::ModMeta { 
            project_id: pid,
            version_id,
            name,
            author,
            icon_url,
            version_name,
            categories,
        };
        let meta_path = dest_dir.join(format!("{}.meta.json", filename));
        if let Ok(json) = serde_json::to_string(&meta) {
            let _ = std::fs::write(meta_path, json);
        }
    }
    
    Ok(())
}

#[tauri::command]
async fn save_remote_file(url: String, path: String) -> Result<(), String> {
    let dest_path = std::path::PathBuf::from(path);
    
    // Create parent directories if they don't exist
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("User-Agent", format!("PaletheaLauncher/{}", minecraft::get_launcher_version()))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }

    let mut file = std::fs::File::create(&dest_path).map_err(|e| format!("Failed to create file: {}", e))?;
    let content = response.bytes().await.map_err(|e| format!("Failed to read body: {}", e))?;
    std::io::Write::write_all(&mut file, &content).map_err(|e| format!("Write error: {}", e))?;
    
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
fn delete_instance_world(instance_id: String, world_name: String) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    files::delete_world(&instance, &world_name)
}

#[tauri::command]
fn rename_instance_world(instance_id: String, folder_name: String, new_name: String) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    files::rename_world(&instance, &folder_name, &new_name)
}

#[tauri::command]
fn open_instance_world_folder(_app: AppHandle, instance_id: String, folder_name: String) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    let path = files::get_saves_dir(&instance).join(folder_name);
    
    if !path.exists() {
        return Err("World folder not found".to_string());
    }

    open_path_native(&path)
}

#[tauri::command]
fn open_instance_datapacks_folder(_app: AppHandle, instance_id: String, world_name: String) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    let path = files::get_saves_dir(&instance).join(world_name).join("datapacks");
    
    // Ensure directory exists
    if !path.exists() {
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }

    open_path_native(&path)
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
fn clear_instance_log(instance_id: String) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    files::clear_latest_log(&instance)
}

#[tauri::command]
fn get_instance_servers(instance_id: String) -> Result<Vec<files::Server>, String> {
    let instance = instances::get_instance(&instance_id)?;
    Ok(files::list_servers(&instance))
}

#[tauri::command]
fn add_instance_server(instance_id: String, name: String, ip: String, icon: Option<String>) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    let mut servers = files::list_servers(&instance);
    
    // Minecraft icon in servers.dat is raw base64 without the prefix
    let processed_icon = icon.map(|i| {
        if i.starts_with("data:image/png;base64,") {
            i.replace("data:image/png;base64,", "")
        } else {
            i
        }
    });

    servers.push(files::Server {
        name,
        ip,
        icon: processed_icon,
        accept_textures: 0,
    });
    
    files::save_servers(&instance, servers)
}

#[tauri::command]
fn delete_instance_server(instance_id: String, index: usize) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    let mut servers = files::list_servers(&instance);
    
    if index >= servers.len() {
        return Err("Server index out of bounds".to_string());
    }
    
    servers.remove(index);
    files::save_servers(&instance, servers)
}

#[tauri::command]
fn update_instance_server(
    instance_id: String, 
    index: usize, 
    name: String, 
    ip: String, 
    accept_textures: i8
) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    let mut servers = files::list_servers(&instance);
    
    if index >= servers.len() {
        return Err("Server index out of bounds".to_string());
    }
    
    servers[index].name = name;
    servers[index].ip = ip;
    servers[index].accept_textures = accept_textures;
    
    files::save_servers(&instance, servers)
}

#[tauri::command]
fn set_server_resource_packs(instance_id: String, index: usize, mode: i8) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    let mut servers = files::list_servers(&instance);
    
    if index >= servers.len() {
        return Err("Server index out of bounds".to_string());
    }
    
    servers[index].accept_textures = mode;
    files::save_servers(&instance, servers)
}

#[tauri::command]
async fn ping_server(address: String) -> Result<minecraft::ping::PingResponse, String> {
    minecraft::ping::ping_server(&address).await
}

#[tauri::command]
fn import_instance_file(instance_id: String, source_path: String, folder_type: String, world_name: Option<String>) -> Result<(), String> {
    let instance = instances::get_instance(&instance_id)?;
    let dest_dir = match folder_type.as_str() {
        "mods" => files::get_mods_dir(&instance),
        "resourcepacks" => files::get_resourcepacks_dir(&instance),
        "shaderpacks" => files::get_shaderpacks_dir(&instance),
        "datapacks" => {
            if let Some(wn) = world_name {
                files::get_saves_dir(&instance).join(wn).join("datapacks")
            } else {
                return Err("World name required for datapacks".to_string())
            }
        },
        _ => return Err("Invalid folder type".to_string()),
    };

    if !dest_dir.exists() {
        fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    }

    let source = std::path::Path::new(&source_path);
    if !source.exists() {
        return Err("Source file not found".to_string());
    }

    let filename = source.file_name().ok_or("Invalid filename")?;
    let dest_path = dest_dir.join(filename);

    fs::copy(source, dest_path).map_err(|e| e.to_string())?;
    Ok(())
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
                // When running from an AppImage, we need to clear certain environment variables
                // so the host's xdg-open can find the correct libraries and programs.
                match Command::new(xdg_path)
                    .arg(path)
                    .env_remove("LD_LIBRARY_PATH")
                    .env_remove("LD_PRELOAD")
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
        
        // Fallback: try gio open with cleared env
        if let Ok(_) = Command::new("gio")
            .args(["open", &path.to_string_lossy()])
            .env_remove("LD_LIBRARY_PATH")
            .env_remove("LD_PRELOAD")
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
        // Use 'start' via cmd to open folders. This is much faster as it signals the existing
        // explorer process instead of spawning a new heavy explorer.exe process.
        // The empty string "" is for the 'title' argument of start which is required if the path has spaces.
        Command::new("cmd")
            .args(["/c", "start", "", &path.to_string_lossy()])
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
    for (_instance_id, info) in processes.drain() {
        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("taskkill")
                .args(&["/F", "/PID", &info.pid.to_string()])
                .spawn();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = std::process::Command::new("kill")
                .args(&["-9", &info.pid.to_string()])
                .spawn();
        }
    }
    // Clear session file
    instances::clear_active_session();
    discord::shutdown();
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let bootstrap_start = *BOOTSTRAP_START;

    // Note: WebView2 args are set in main.rs (must be before any Tauri init)

    #[cfg(debug_assertions)]
    {
        println!("\n==========================================");
        println!("[PALETHEA] Starting launcher in DEV MODE...");
        println!("[DEBUG] Workspace: palethea-launcher");
        println!("[DEBUG] App Version: {}", env!("CARGO_PKG_VERSION"));
        println!("[DEBUG] Backend started at: {:?}", std::time::SystemTime::now());
        println!("==========================================\n");
    }

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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let processes = RUNNING_PROCESSES.lock().unwrap();
                    if !processes.is_empty() {
                        api.prevent_close();
                        let _ = window.emit("show-exit-confirm", ());
                    } else {
                        // Kill the whole process group to avoid "Terminate batch job" lingering
                        window.app_handle().exit(0);
                    }
                }
            }
        })
        .on_page_load(|webview, _payload| {
            // Set transparent background on every webview (main + popout editors) for rounded corners
            let _ = webview.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)));
        })
        .setup(move |app| {
            let version = app.package_info().version.to_string();
            minecraft::set_launcher_version(version);

            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info })
                    .level_for("reqwest", log::LevelFilter::Off)
                    .level_for("hyper", log::LevelFilter::Off)
                    .build()
            )?;

            if let Err(err) = downloader::sync_logos(app.handle()) {
                log::warn!("Failed to sync instance logos: {}", err);
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
                        processes.insert(instance_id.clone(), RunningProcessInfo {
                            pid: pid_val,
                            start_time,
                        });
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
                            let inst_name = inst.name.clone();
                            inst.playtime_seconds = current_playtime + session_duration;
                            let _ = instances::update_instance(inst);

                            // Log session for activity tracking
                            instances::log_session(&instance_id_clone, &inst_name, end_time, session_duration);
                        }
                        
                        instances::clear_active_session();
                        
                        if let Ok(mut processes) = RUNNING_PROCESSES.lock() {
                            processes.remove(&instance_id_clone);
                            discord::update_presence(processes.len());
                        }

                        let _ = handle_clone.emit("refresh-instances", ());
                    });

                    log::info!("Re-registered running instance {} with PID {}", instance_id, pid_val);
                } else {
                    log::info!("Recovered orphaned session for instance {}: {}s credited", instance_id, current_playtime);
                }
            }

            // Initialize Discord Rich Presence
            discord::init();

            // Update Discord presence with any recovered running instances
            {
                let processes = RUNNING_PROCESSES.lock().expect("Process state corrupted");
                discord::update_presence(processes.len());
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_url,
            get_bootstrap_time,
            // Version commands
            get_versions,
            get_latest_release,
            // Instance commands
            get_instances,
            create_instance,
            delete_instance,
            update_instance,
            clone_instance,
            get_instance_options,
            save_instance_options,
            open_instance_options_file,
            get_instance_details,
            get_available_logos,
            set_instance_logo,
            set_instance_logo_from_stock,
            set_instance_logo_from_url,
            clear_instance_logo,
            export_instance_zip,
            import_instance_zip,
            peek_instance_zip,
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
            is_java_version_installed,
            // Update/version comparison commands
            get_github_releases,
            compare_versions,
            is_prerelease_version,
            download_and_run_installer,
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
            get_modrinth_projects,
            get_modrinth_versions,
            get_modrinth_version,
            get_modpack_total_size,
            install_modpack,
            install_modrinth_file,
            save_remote_file,
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
            rename_instance_world,
            open_instance_world_folder,
            import_instance_file,
            open_instance_datapacks_folder,
            get_world_datapacks,
            delete_instance_datapack,
            get_instance_screenshots,
            delete_instance_screenshot,
            rename_instance_screenshot,
            open_instance_screenshot,
            get_instance_log,
            clear_instance_log,
            get_instance_servers,
            add_instance_server,
            delete_instance_server,
            update_instance_server,
            set_server_resource_packs,
            ping_server,
            open_instance_folder,
            get_instance_share_code,
            get_instance_mods_share_code,
            decode_instance_share_code,
            // Skin collection commands
            get_skin_collection,
            add_to_skin_collection,
            delete_skin_from_collection,
            get_skin_file_path,
            get_global_stats,
            log_event,
            get_bootstrap_time,
            exit_app_fully,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
