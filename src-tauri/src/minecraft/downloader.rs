use crate::minecraft::versions::{self, VersionDetails, should_use_library};
use serde::{Deserialize, Serialize};
use sha1::{Sha1, Digest};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::error::Error;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use futures::stream::{self, StreamExt};
use crate::log_info;

// Number of concurrent downloads
const CONCURRENT_DOWNLOADS: usize = 32;

const DEFAULT_INSTANCE_LOGO: &[u8] = include_bytes!("../../resources/instance_logos/minecraft_logo.png");

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadProgress {
    pub stage: String,
    pub current: u32,
    pub total: u32,
    pub percentage: f32,
    pub total_bytes: Option<u64>,
    pub downloaded_bytes: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InstanceLaunchProgress {
    pub instance_id: String,
    #[serde(flatten)]
    pub progress: DownloadProgress,
}

pub fn emit_download_progress(handle: &AppHandle, progress: DownloadProgress, instance_id: Option<&str>) {
    let _ = handle.emit("download-progress", progress.clone());
    if let Some(id) = instance_id {
        let payload = InstanceLaunchProgress {
            instance_id: id.to_string(),
            progress,
        };
        let _ = handle.emit("launch-progress", payload);
    }
}

/// Get the Minecraft data directory
pub fn get_minecraft_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    
    if cfg!(target_os = "windows") {
        base.join("PaletheaLauncher")
    } else if cfg!(target_os = "macos") {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Library")
            .join("Application Support")
            .join("PaletheaLauncher")
    } else {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".palethealauncher")
    }
}

/// Get the instances directory
pub fn get_instances_dir() -> PathBuf {
    get_minecraft_dir().join("instances")
}

/// Get the libraries directory
pub fn get_libraries_dir() -> PathBuf {
    get_minecraft_dir().join("libraries")
}

/// Get the assets directory
pub fn get_assets_dir() -> PathBuf {
    get_minecraft_dir().join("assets")
}

/// Get the versions directory
pub fn get_versions_dir() -> PathBuf {
    get_minecraft_dir().join("versions")
}

/// Get the instance logos directory
pub fn get_instance_logos_dir() -> PathBuf {
    get_minecraft_dir().join("instance_logos")
}

/// Get the skin collection directory
pub fn get_skins_dir() -> PathBuf {
    get_minecraft_dir().join("skin_collection")
}

/// Ensure instance logos directory exists and default logo is present
pub fn ensure_instance_logos_dir() -> Result<(), String> {
    let logos_dir = get_instance_logos_dir();
    fs::create_dir_all(&logos_dir)
        .map_err(|e| format!("Failed to create instance logos directory: {}", e))?;

    let default_logo_path = logos_dir.join("minecraft_logo.png");
    // Always overwrite the default logo to ensure it stays up to date
    fs::write(&default_logo_path, DEFAULT_INSTANCE_LOGO)
        .map_err(|e| format!("Failed to write default instance logo: {}", e))?;

    Ok(())
}

/// Sync logos from resources to data directory
pub fn sync_logos(app_handle: &AppHandle) -> Result<(), String> {
    ensure_instance_logos_dir()?;
    let logos_dir = get_instance_logos_dir();

    // In Tauri v2, we can get the resource directory
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource directory: {}", e))?;
    
    let source_logos_dir = resource_dir.join("resources").join("instance_logos");
    
    if source_logos_dir.exists() && source_logos_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(source_logos_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().map_or(false, |ext| ext == "png") {
                    let dest_path = logos_dir.join(entry.file_name());
                    if !dest_path.exists() {
                        let _ = fs::copy(&path, &dest_path);
                    }
                }
            }
        }
    }

    Ok(())
}


/// Verify a file's SHA1 hash
pub fn verify_sha1(path: &PathBuf, expected: &str) -> bool {
    if !path.exists() {
        return false;
    }
    
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    
    let mut hasher = Sha1::new();
    let mut buffer = [0u8; 8192];
    
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => hasher.update(&buffer[..n]),
            Err(_) => return false,
        }
    }
    
    let result = hasher.finalize();
    let hash = format!("{:x}", result);
    hash == expected
}

/// Download a file with progress tracking
pub async fn download_file(
    url: &str,
    path: &PathBuf,
    expected_sha1: Option<&str>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    // Check if file exists and has correct hash
    if let Some(sha1) = expected_sha1 {
        if !sha1.is_empty() {
            if verify_sha1(path, sha1) {
                return Ok(());
            }
        } else if path.exists() {
            // Empty hash but file exists
            return Ok(());
        }
    } else if path.exists() {
        // If no hash is provided, assume file is correct if it exists
        return Ok(());
    }
    
    // Create parent directories
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    
    // Download the file
    let client = super::http_client();
        
    let response = client
        .get(url)
        .header("User-Agent", format!("PaletheaLauncher/{}", super::get_launcher_version()))
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(format!("Download failed ({}): {}", response.status(), url).into());
    }
    let bytes = response.bytes().await?;
    
    let mut file = File::create(path)?;
    file.write_all(&bytes)?;
    
    // Verify hash if provided
    if let Some(sha1) = expected_sha1 {
        if !sha1.is_empty() && !verify_sha1(path, sha1) {
            fs::remove_file(path)?;
            return Err("SHA1 verification failed".into());
        }
    }
    
    Ok(())
}

/// Download the client JAR for a version
pub async fn download_client(version_details: &VersionDetails) -> Result<PathBuf, Box<dyn Error + Send + Sync>> {
    let versions_dir = get_versions_dir();
    let version_dir = versions_dir.join(&version_details.id);
    let client_path = version_dir.join(format!("{}.jar", &version_details.id));
    
    if let Some(downloads) = &version_details.downloads {
        let download_info = &downloads.client;
        download_file(&download_info.url, &client_path, Some(&download_info.sha1)).await?;
    }
    
    // Also save the version JSON
    let json_path = version_dir.join(format!("{}.json", &version_details.id));
    let json_content = serde_json::to_string_pretty(version_details)?;
    fs::write(&json_path, json_content)?;
    
    Ok(client_path)
}

/// Download all libraries for a version
pub async fn download_libraries(
    version_details: &VersionDetails,
    app_handle: Option<&AppHandle>,
    launch_instance_id: Option<&str>,
) -> Result<Vec<PathBuf>, Box<dyn Error + Send + Sync>> {
    let libraries_dir = get_libraries_dir();
    
    // Collect all download tasks
    struct LibDownload {
        url: String,
        path: PathBuf,
        sha1: String,
        size: u64,
    }
    
    let mut downloads: Vec<LibDownload> = Vec::new();
    let mut total_bytes = 0u64;
    
    for library in &version_details.libraries {
        if !should_use_library(library) {
            continue;
        }
        
        if let Some(lib_downloads) = &library.downloads {
            if let Some(artifact) = &lib_downloads.artifact {
                let size = artifact.size as u64;
                total_bytes += size;
                downloads.push(LibDownload {
                    url: artifact.url.clone(),
                    path: libraries_dir.join(&artifact.path),
                    sha1: artifact.sha1.clone(),
                    size,
                });
            }
            
            // Handle natives
            if let Some(natives) = &library.natives {
                let os_name = versions::get_os_name();
                if let Some(classifier_key) = natives.get(os_name) {
                    if let Some(classifiers) = &lib_downloads.classifiers {
                        let arch = if cfg!(target_arch = "x86_64") { "64" } else { "32" };
                        let classifier_key = classifier_key.replace("${arch}", arch);
                        
                        if let Some(native_artifact) = classifiers.get(&classifier_key) {
                            let size = native_artifact.size as u64;
                            total_bytes += size;
                            downloads.push(LibDownload {
                                url: native_artifact.url.clone(),
                                path: libraries_dir.join(&native_artifact.path),
                                sha1: native_artifact.sha1.clone(),
                                size,
                            });
                        }
                    }
                }
            }
        } else if let Some(base_url) = &library.url {
            // Handle legacy library format
            let path_str = versions::library_name_to_path(&library.name);
            let url = if base_url.ends_with('/') {
                format!("{}{}", base_url, path_str)
            } else {
                format!("{}/{}", base_url, path_str)
            };
            
            downloads.push(LibDownload {
                url,
                path: libraries_dir.join(&path_str),
                sha1: String::new(), // No SHA1 for legacy libraries easily available
                size: 0,
            });
        } else {
            // Default to Mojang libraries for any library without download info or custom URL
            let path_str = versions::library_name_to_path(&library.name);
            let url = format!("https://libraries.minecraft.net/{}", path_str);
            
            downloads.push(LibDownload {
                url,
                path: libraries_dir.join(&path_str),
                sha1: String::new(),
                size: 0,
            });
        }
    }
    
    let total = downloads.len() as u32;
    let completed = Arc::new(AtomicU32::new(0));
    let downloaded_bytes = Arc::new(std::sync::atomic::AtomicU64::new(0));
    
    // Emit initial progress
    if let Some(handle) = app_handle {
        emit_download_progress(handle, DownloadProgress {
            stage: format!("Downloading libraries (0/{})", total),
            current: 0,
            total,
            percentage: 10.0,
            total_bytes: Some(total_bytes),
            downloaded_bytes: Some(0),
        }, launch_instance_id);
    }
    
    // Download concurrently
    let results: Vec<Result<PathBuf, Box<dyn Error + Send + Sync>>> = stream::iter(downloads)
        .map(|dl| {
            let completed = Arc::clone(&completed);
            let downloaded_bytes = Arc::clone(&downloaded_bytes);
            let app_handle = app_handle.cloned();
            let total = total;
            let total_bytes_val = total_bytes;
            async move {
                download_file(&dl.url, &dl.path, Some(&dl.sha1)).await?;
                
                let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
                let current_bytes = downloaded_bytes.fetch_add(dl.size, Ordering::SeqCst) + dl.size;
                
                // Emit progress every 5 downloads
                if done % 5 == 0 || done == total {
                    if let Some(handle) = &app_handle {
                        let percentage = 10.0 + ((done as f32 * 25.0) / total as f32);
                        emit_download_progress(handle, DownloadProgress {
                            stage: format!("Downloading libraries ({}/{})", done, total),
                            current: done,
                            total,
                            percentage,
                            total_bytes: Some(total_bytes_val),
                            downloaded_bytes: Some(current_bytes),
                        }, launch_instance_id);
                    }
                }
                
                Ok(dl.path)
            }
        })
        .buffer_unordered(CONCURRENT_DOWNLOADS)
        .collect()
        .await;
    
    // Collect successful paths
    let mut library_paths = Vec::new();
    for result in results {
        library_paths.push(result?);
    }
    
    Ok(library_paths)
}

/// Download assets for a version
pub async fn download_assets(
    version_details: &VersionDetails,
    app_handle: Option<&AppHandle>,
    launch_instance_id: Option<&str>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let asset_index = match &version_details.asset_index {
        Some(index) => index,
        None => return Ok(()),
    };
    
    let assets_dir = get_assets_dir();
    let indexes_dir = assets_dir.join("indexes");
    let objects_dir = assets_dir.join("objects");
    
    fs::create_dir_all(&indexes_dir)?;
    fs::create_dir_all(&objects_dir)?;
    
    // Download asset index
    let index_path = indexes_dir.join(format!("{}.json", &asset_index.id));
    download_file(&asset_index.url, &index_path, Some(&asset_index.sha1)).await?;
    
    // Parse asset index and collect download tasks
    let index_content = fs::read_to_string(&index_path)?;
    let index_json: serde_json::Value = serde_json::from_str(&index_content)?;
    
    struct AssetDownload {
        url: String,
        path: PathBuf,
        hash: String,
        size: u64,
    }
    
    let mut downloads: Vec<AssetDownload> = Vec::new();
    let mut total_bytes = 0u64;
    
    if let Some(objects) = index_json.get("objects").and_then(|o| o.as_object()) {
        for (_name, info) in objects {
            if let Some(hash) = info.get("hash").and_then(|h| h.as_str()) {
                let size = info.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
                let prefix = &hash[..2];
                let object_path = objects_dir.join(prefix).join(hash);
                let url = format!("https://resources.download.minecraft.net/{}/{}", prefix, hash);
                
                total_bytes += size;
                downloads.push(AssetDownload {
                    url,
                    path: object_path,
                    hash: hash.to_string(),
                    size,
                });
            }
        }
    }
    
    let total = downloads.len() as u32;
    let completed = Arc::new(AtomicU32::new(0));
    let downloaded_bytes = Arc::new(std::sync::atomic::AtomicU64::new(0));
    
    // Emit initial progress
    if let Some(handle) = app_handle {
        emit_download_progress(handle, DownloadProgress {
            stage: format!("Downloading assets (0/{})", total),
            current: 0,
            total,
            percentage: 35.0,
            total_bytes: Some(total_bytes),
            downloaded_bytes: Some(0),
        }, launch_instance_id);
    }
    
    // Download concurrently
    let results: Vec<Result<(), Box<dyn Error + Send + Sync>>> = stream::iter(downloads)
        .map(|dl| {
            let completed = Arc::clone(&completed);
            let downloaded_bytes = Arc::clone(&downloaded_bytes);
            let app_handle = app_handle.cloned();
            let total = total;
            let total_bytes_val = total_bytes;
            async move {
                download_file(&dl.url, &dl.path, Some(&dl.hash)).await?;
                
                let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
                let current_bytes = downloaded_bytes.fetch_add(dl.size, Ordering::SeqCst) + dl.size;
                
                // Emit progress every 100 assets to avoid spam
                if done % 100 == 0 || done == total {
                    if let Some(handle) = &app_handle {
                        let percentage = 35.0 + ((done as f32 * 65.0) / total as f32);
                        emit_download_progress(handle, DownloadProgress {
                            stage: format!("Downloading assets ({}/{})", done, total),
                            current: done,
                            total,
                            percentage,
                            total_bytes: Some(total_bytes_val),
                            downloaded_bytes: Some(current_bytes),
                        }, launch_instance_id);
                    }
                }
                
                Ok(())
            }
        })
        .buffer_unordered(CONCURRENT_DOWNLOADS)
        .collect()
        .await;
    
    // Check for errors
    for result in results {
        result?;
    }
    
    Ok(())
}

/// Download everything needed for a version
pub async fn download_version(
    version_id: &str,
    app_handle: Option<&AppHandle>,
    launch_instance_id: Option<&str>,
) -> Result<VersionDetails, Box<dyn Error + Send + Sync>> {
    // Emit initial progress
    if let Some(handle) = app_handle {
        log_info!(handle, "Starting download for version: {}", version_id);
        emit_download_progress(handle, DownloadProgress {
            stage: "Fetching version info...".to_string(),
            current: 0,
            total: 100,
            percentage: 0.0,
            total_bytes: None,
            downloaded_bytes: None,
        }, launch_instance_id);
    }
    
    // Get version manifest
    let manifest = versions::fetch_version_manifest().await?;
    
    // Find the version
    let version_info = manifest.versions
        .iter()
        .find(|v| v.id == version_id)
        .ok_or("Version not found")?;
    
    // Get version details
    let version_details = versions::fetch_version_details(&version_info.url).await?;
    
    // Download client (5%)
    if let Some(handle) = app_handle {
        log_info!(handle, "Downloading client JAR...");
        let size = version_details.downloads.as_ref().map(|d| d.client.size).unwrap_or(0) as u64;
        emit_download_progress(handle, DownloadProgress {
            stage: "Downloading client JAR...".to_string(),
            current: 5,
            total: 100,
            percentage: 5.0,
            total_bytes: Some(size),
            downloaded_bytes: Some(0),
        }, launch_instance_id);
    }
    download_client(&version_details).await?;
    
    // Download libraries (5-35%)
    if let Some(handle) = app_handle {
        log_info!(handle, "Downloading libraries...");
        emit_download_progress(handle, DownloadProgress {
            stage: "Downloading libraries...".to_string(),
            current: 10,
            total: 100,
            percentage: 10.0,
            total_bytes: None,
            downloaded_bytes: None,
        }, launch_instance_id);
    }
    download_libraries(&version_details, app_handle, launch_instance_id).await?;
    
    // Download assets (35-100%)
    if let Some(handle) = app_handle {
        log_info!(handle, "Downloading assets...");
        emit_download_progress(handle, DownloadProgress {
            stage: "Downloading assets...".to_string(),
            current: 35,
            total: 100,
            percentage: 35.0,
            total_bytes: None,
            downloaded_bytes: None,
        }, launch_instance_id);
    }
    download_assets(&version_details, app_handle, launch_instance_id).await?;
    
    // Complete
    if let Some(handle) = app_handle {
        log_info!(handle, "Download complete for version: {}", version_id);
        emit_download_progress(handle, DownloadProgress {
            stage: "Complete!".to_string(),
            current: 100,
            total: 100,
            percentage: 100.0,
            total_bytes: None,
            downloaded_bytes: None,
        }, launch_instance_id);
    }
    
    Ok(version_details)
}
