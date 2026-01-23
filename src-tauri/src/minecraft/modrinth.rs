use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::LazyLock;
use tokio::sync::Semaphore;
use tauri::{AppHandle, Emitter};

use crate::minecraft::downloader::DownloadProgress;
use crate::minecraft::{instances, fabric, forge};

const MODRINTH_API_BASE: &str = "https://api.modrinth.com/v2";
fn get_user_agent() -> String {
    format!("PaletheaLauncher/{} (github.com/PaletheaLauncher)", super::get_launcher_version())
}

// Rate limiter: Modrinth allows ~300 requests/min, we'll be conservative with 10 concurrent
static MODRINTH_SEMAPHORE: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(10));

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModrinthProject {
    pub slug: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub project_type: String,
    #[serde(default)]
    pub downloads: u64,
    pub icon_url: Option<String>,
    #[serde(alias = "id")]
    pub project_id: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub categories: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModrinthSearchResult {
    pub hits: Vec<ModrinthProject>,
    pub offset: u32,
    pub limit: u32,
    pub total_hits: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModrinthVersion {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub version_number: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub files: Vec<ModrinthFile>,
    pub dependencies: Vec<ModrinthDependency>,
    pub date_published: String,
    pub version_type: String, // "release", "beta", "alpha"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModrinthFile {
    pub url: String,
    pub filename: String,
    pub primary: bool,
    pub size: u64,
    pub hashes: ModrinthHashes,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModrinthHashes {
    pub sha1: Option<String>,
    pub sha512: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModrinthDependency {
    pub version_id: Option<String>,
    pub project_id: Option<String>,
    pub dependency_type: String,
}

#[derive(Debug, Deserialize)]
pub struct ModpackIndex {
    #[serde(rename = "formatVersion")]
    pub _format_version: u32,
    pub _game: String,
    #[serde(rename = "versionId")]
    pub _version_id: String,
    pub _name: String,
    pub dependencies: std::collections::HashMap<String, String>,
    pub files: Vec<ModpackFile>,
}

#[derive(Debug, Deserialize)]
pub struct ModpackFile {
    pub path: String,
    pub _hashes: std::collections::HashMap<String, String>,
    pub _env: Option<ModpackEnv>,
    pub downloads: Vec<String>,
    #[serde(rename = "fileSize")]
    pub file_size: u64,
}

#[derive(Debug, Deserialize)]
pub struct ModpackEnv {
    pub _client: String,
    pub _server: String,
}

/// Search for projects on Modrinth
pub async fn search_projects(
    query: &str,
    project_type: &str, // "mod", "resourcepack", "shader"
    game_version: Option<&str>,
    loader: Option<&str>,
    limit: u32,
    offset: u32,
) -> Result<ModrinthSearchResult, Box<dyn Error + Send + Sync>> {
    // Acquire rate limit permit
    let _permit = MODRINTH_SEMAPHORE.acquire().await?;
    
    let client = reqwest::Client::new();
    
    let mut facets = vec![format!("[\"project_type:{}\"]", project_type)];
    
    if let Some(version) = game_version {
        facets.push(format!("[\"versions:{}\"]", version));
    }
    
    if let Some(loader) = loader {
        facets.push(format!("[\"categories:{}\"]", loader));
    }
    
    let facets_str = format!("[{}]", facets.join(","));
    
    let url = format!(
        "{}/search?query={}&facets={}&limit={}&offset={}",
        MODRINTH_API_BASE,
        urlencoding::encode(query),
        urlencoding::encode(&facets_str),
        limit,
        offset
    );
    
    let response = client
        .get(&url)
        .header("User-Agent", get_user_agent())
        .send()
        .await?;
    
    let result: ModrinthSearchResult = response.json().await?;
    Ok(result)
}

/// Get versions for a project
pub async fn get_project_versions(
    project_id: &str,
    game_version: Option<&str>,
    loader: Option<&str>,
) -> Result<Vec<ModrinthVersion>, Box<dyn Error + Send + Sync>> {
    // Acquire rate limit permit
    let _permit = MODRINTH_SEMAPHORE.acquire().await?;
    
    let client = reqwest::Client::new();
    
    let mut url = format!("{}/project/{}/version", MODRINTH_API_BASE, project_id);
    
    let mut params = Vec::new();
    if let Some(version) = game_version {
        params.push(format!("game_versions=[\"{}\"]", version));
    }
    if let Some(loader) = loader {
        params.push(format!("loaders=[\"{}\"]", loader));
    }
    
    if !params.is_empty() {
        url = format!("{}?{}", url, params.join("&"));
    }
    
    let response = client
        .get(&url)
        .header("User-Agent", get_user_agent())
        .send()
        .await?;
    
    let versions: Vec<ModrinthVersion> = response.json().await?;
    Ok(versions)
}

/// Get specific version info
pub async fn get_version(version_id: &str) -> Result<ModrinthVersion, Box<dyn Error + Send + Sync>> {
    let _permit = MODRINTH_SEMAPHORE.acquire().await?;
    let client = reqwest::Client::new();
    let url = format!("{}/version/{}", MODRINTH_API_BASE, version_id);
    let response = client.get(&url).header("User-Agent", get_user_agent()).send().await?;
    let version: ModrinthVersion = response.json().await?;
    Ok(version)
}

/// Download a file from Modrinth
pub async fn download_mod_file(
    file: &ModrinthFile,
    destination: &PathBuf,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    // Acquire rate limit permit
    let _permit = MODRINTH_SEMAPHORE.acquire().await?;
    
    let client = reqwest::Client::new();
    
    // Create parent directories
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    
    let response = client
        .get(&file.url)
        .header("User-Agent", get_user_agent())
        .send()
        .await?;
    
    let bytes = response.bytes().await?;
    let mut out_file = File::create(destination)?;
    out_file.write_all(&bytes)?;
    
    Ok(())
}

/// Get project details
pub async fn get_project(project_id: &str) -> Result<ModrinthProject, Box<dyn Error + Send + Sync>> {
    // Acquire rate limit permit
    let _permit = MODRINTH_SEMAPHORE.acquire().await?;
    
    let client = reqwest::Client::new();
    
    let url = format!("{}/project/{}", MODRINTH_API_BASE, project_id);
    
    let response = client
        .get(&url)
        .header("User-Agent", get_user_agent())
        .send()
        .await?;
    
    let status = response.status();
    let body = response.text().await?;
    
    if !status.is_success() {
        return Err(format!("Modrinth API error ({}): {}", status, body).into());
    }

    match serde_json::from_str::<ModrinthProject>(&body) {
        Ok(project) => Ok(project),
        Err(e) => {
            println!("Failed to decode Modrinth project JSON: {}", e);
            println!("Body: {}", body);
            Err(format!("Failed to decode project data: {}", e).into())
        }
    }
}

/// Get multiple projects at once
pub async fn get_projects(project_ids: Vec<String>) -> Result<Vec<ModrinthProject>, Box<dyn Error + Send + Sync>> {
    if project_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Acquire rate limit permit
    let _permit = MODRINTH_SEMAPHORE.acquire().await?;
    
    let client = reqwest::Client::new();
    
    // Modrinth allows bulk projects via /projects?ids=["id1","id2"]
    let ids_json = serde_json::to_string(&project_ids).unwrap();
    let url = format!("{}/projects?ids={}", MODRINTH_API_BASE, urlencoding::encode(&ids_json));
    
    let response = client
        .get(&url)
        .header("User-Agent", get_user_agent())
        .send()
        .await?;
    
    let status = response.status();
    let body = response.text().await?;
    
    if !status.is_success() {
        return Err(format!("Modrinth API error ({}): {}", status, body).into());
    }
    
    let projects: Vec<ModrinthProject> = serde_json::from_str(&body)?;
    Ok(projects)
}

/// Calculate total download size for a modpack
pub async fn get_modpack_total_size(version_id: &str) -> Result<u64, Box<dyn Error + Send + Sync>> {
    println!("Calculating total size for modpack version: {}", version_id);
    
    // 1. Get version details
    let version = get_version(version_id).await?;
    let primary_file = version.files.iter().find(|f| f.primary).unwrap_or(&version.files[0]);
    
    println!("Found primary file: {} ({} bytes)", primary_file.filename, primary_file.size);

    // 2. Download the .mrpack (it's small)
    let temp_dir = std::env::temp_dir().join("palethea_modpack_size_check");
    let _ = fs::create_dir_all(&temp_dir);
    let mrpack_path = temp_dir.join(format!("{}.mrpack", version_id));
    
    download_mod_file(primary_file, &mrpack_path).await?;
    
    // 3. Extract and parse index.json
    let index: ModpackIndex = {
        let file = File::open(&mrpack_path)?;
        let mut archive = zip::ZipArchive::new(file)?;
        let mut index_file = archive.by_name("modrinth.index.json")?;
        let mut index_content = String::new();
        index_file.read_to_string(&mut index_content)?;
        serde_json::from_str(&index_content)?
    };
    
    let total_size: u64 = index.files.iter().map(|f| f.file_size).sum();
    println!("Calculated total size: {} bytes across {} files", total_size, index.files.len());
    
    // Cleanup
    let _ = fs::remove_file(&mrpack_path);
    
    Ok(total_size)
}

pub async fn install_modpack(
    app_handle: &AppHandle,
    instance_id: &str,
    mr_version_id: &str,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let _ = app_handle.emit("download-progress", DownloadProgress { 
        stage: "Fetching modpack info...".to_string(), 
        percentage: 0.0,
        current: 0,
        total: 100,
        total_bytes: None,
        downloaded_bytes: None,
    });
    
    // 1. Get version details
    let version = get_version(mr_version_id).await?;
    let primary_file = version.files.iter().find(|f| f.primary).unwrap_or(&version.files[0]);
    let modpack_size = primary_file.size;
    
    // 2. Download .mrpack
    let temp_dir = std::env::temp_dir().join("palethea_modpack");
    let _ = fs::create_dir_all(&temp_dir);
    let mrpack_path = temp_dir.join("modpack.mrpack");
    
    let _ = app_handle.emit("download-progress", DownloadProgress { 
        stage: "Downloading modpack file...".to_string(), 
        percentage: 10.0,
        current: 5,
        total: 100,
        total_bytes: Some(modpack_size),
        downloaded_bytes: Some(0),
    });
    download_mod_file(primary_file, &mrpack_path).await?;
    
    // 3. Extract and read index.json
    let _ = app_handle.emit("download-progress", DownloadProgress { 
        stage: "Extracting modpack...".to_string(), 
        percentage: 20.0,
        current: 10,
        total: 100,
        total_bytes: Some(modpack_size),
        downloaded_bytes: Some(modpack_size),
    });
    
    let index: ModpackIndex = {
        let file = File::open(&mrpack_path)?;
        let mut archive = zip::ZipArchive::new(file)?;
        let mut index_file = archive.by_name("modrinth.index.json")?;
        let mut index_content = String::new();
        index_file.read_to_string(&mut index_content)?;
        serde_json::from_str(&index_content)?
    };

    // Calculate total mod sizes
    let total_mods_size: u64 = index.files.iter().map(|f| f.file_size).sum();

    // 4. Update instance configuration
    let mc_version = index.dependencies.get("minecraft").ok_or("No Minecraft version in modpack")?;
    
    let mut mod_loader = instances::ModLoader::Vanilla;
    let mut loader_version = None;
    
    if let Some(fabric) = index.dependencies.get("fabric-loader") {
        mod_loader = instances::ModLoader::Fabric;
        loader_version = Some(fabric.clone());
    } else if let Some(forge) = index.dependencies.get("forge") {
        mod_loader = instances::ModLoader::Forge;
        loader_version = Some(forge.clone());
    } else if let Some(neoforge) = index.dependencies.get("neoforge") {
        mod_loader = instances::ModLoader::NeoForge;
        loader_version = Some(neoforge.clone());
    }

    let mut instance = instances::get_instance(instance_id)?;
    instance.version_id = mc_version.clone();
    instance.mod_loader = mod_loader.clone();
    instance.mod_loader_version = loader_version.clone();
    instances::update_instance(instance.clone())?;
    
    // 4.5 Install mod loader metadata and libraries
    if mod_loader != instances::ModLoader::Vanilla {
        if let Some(loader_ver) = &loader_version {
            match mod_loader {
                instances::ModLoader::Fabric => {
                    let _ = app_handle.emit("download-progress", DownloadProgress { 
                        stage: "Installing Fabric Loader...".to_string(), 
                        percentage: 25.0,
                        current: 15,
                        total: 100,
                        total_bytes: None,
                        downloaded_bytes: None,
                    });
                    if let Err(e) = fabric::install_fabric(&instance, loader_ver).await {
                        crate::log_error!(app_handle, "Failed to install Fabric loader: {}", e);
                    }
                },
                instances::ModLoader::Forge => {
                    let _ = app_handle.emit("download-progress", DownloadProgress { 
                        stage: "Installing Forge Loader...".to_string(), 
                        percentage: 25.0,
                        current: 15,
                        total: 100,
                        total_bytes: None,
                        downloaded_bytes: None,
                    });
                    if let Err(e) = forge::install_forge(&instance, loader_ver).await {
                        crate::log_error!(app_handle, "Failed to install Forge loader: {}", e);
                    }
                },
                instances::ModLoader::NeoForge => {
                    let _ = app_handle.emit("download-progress", DownloadProgress { 
                        stage: "Installing NeoForge Loader...".to_string(), 
                        percentage: 25.0,
                        current: 15,
                        total: 100,
                        total_bytes: None,
                        downloaded_bytes: None,
                    });
                    if let Err(e) = forge::install_neoforge(&instance, loader_ver).await {
                        crate::log_error!(app_handle, "Failed to install NeoForge loader: {}", e);
                    }
                },
                _ => {}
            }
        }
    }
    
    // 5. Download mods
    let total_files = index.files.len();
    let mut downloaded_bytes = 0u64;
    for (i, mp_file) in index.files.iter().enumerate() {
        let progress = 30.0 + (i as f32 / total_files as f32) * 60.0;
        let _ = app_handle.emit("download-progress", DownloadProgress { 
            stage: format!("Downloading mod {}/{}...", i + 1, total_files), 
            percentage: progress,
            current: i as u32,
            total: total_files as u32,
            total_bytes: Some(total_mods_size),
            downloaded_bytes: Some(downloaded_bytes),
        });
        
        let dest = instance.get_game_directory().join(&mp_file.path);
        
        // Try each download URL
        let mut downloaded = false;
        for url in &mp_file.downloads {
            let client = reqwest::Client::new();
            if let Ok(resp) = client.get(url).header("User-Agent", get_user_agent()).send().await {
                if let Ok(bytes) = resp.bytes().await {
                    if let Some(parent) = dest.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    if let Ok(mut f) = File::create(&dest) {
                        if f.write_all(&bytes).is_ok() {
                            downloaded = true;
                            downloaded_bytes += mp_file.file_size;
                            break;
                        }
                    }
                }
            }
        }
        
        if !downloaded {
            crate::log_warn!(app_handle, "Failed to download file: {}", mp_file.path);
        } else {
            // Try to extract project and version IDs from the successful download URL for metadata
            // Modrinth URLs patterns:
            // 1. https://api.modrinth.com/v2/project/PID/version/VID/file/FILENAME
            // 2. https://cdn.modrinth.com/data/PID/versions/VID/FILENAME
            
            let mut project_id = None;
            let mut version_id = None;
            
            for url in &mp_file.downloads {
                if url.contains("cdn.modrinth.com/data/") {
                    let parts: Vec<&str> = url.split("/data/").collect();
                    if parts.len() > 1 {
                        let sub_parts: Vec<&str> = parts[1].split('/').collect();
                        if sub_parts.len() >= 3 {
                            project_id = Some(sub_parts[0].to_string());
                            version_id = Some(sub_parts[2].to_string());
                            break;
                        }
                    }
                } else if url.contains("/project/") && url.contains("/version/") {
                    // Try to parse api.modrinth.com style
                    if let Some(p_idx) = url.find("/project/") {
                        let after_p = &url[p_idx + 9..];
                        if let Some(slash_idx) = after_p.find('/') {
                            project_id = Some(after_p[..slash_idx].to_string());
                            
                            if let Some(v_idx) = url.find("/version/") {
                                let after_v = &url[v_idx + 9..];
                                if let Some(slash_idx_v) = after_v.find('/') {
                                    version_id = Some(after_v[..slash_idx_v].to_string());
                                }
                            }
                            break;
                        }
                    }
                }
            }
            
            if let Some(pid) = project_id {
                let meta = crate::minecraft::files::ModMeta {
                    project_id: pid,
                    version_id,
                    name: None,
                    icon_url: None,
                    version_name: None,
                };
                // Actually, our list_mods expects filename.meta.json
                let meta_path = PathBuf::from(format!("{}.meta.json", dest.to_string_lossy()));
                
                if let Ok(json) = serde_json::to_string(&meta) {
                    let _ = std::fs::write(meta_path, json);
                }
            }
        }
    }
    
    // 6. Copy overrides
    let _ = app_handle.emit("download-progress", DownloadProgress { 
        stage: "Applying overrides...".to_string(), 
        percentage: 95.0,
        current: 95,
        total: 100,
        total_bytes: None,
        downloaded_bytes: None,
    });
    
    {
        // We need to re-open the archive to iterate over files
        let file = File::open(&mrpack_path)?;
        let mut archive = zip::ZipArchive::new(file)?;
        
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)?;
            let name = file.name().to_string();
            
            let target_rel = if name.starts_with("overrides/") {
                Some(&name[10..])
            } else if name.starts_with("client-overrides/") {
                Some(&name[17..])
            } else {
                None
            };
            
            if let Some(rel_path) = target_rel {
                if !rel_path.is_empty() {
                    let dest = instance.get_game_directory().join(rel_path);
                    if file.is_dir() {
                        let _ = fs::create_dir_all(dest);
                    } else {
                        if let Some(parent) = dest.parent() {
                            let _ = fs::create_dir_all(parent);
                        }
                        if let Ok(mut out) = File::create(dest) {
                            let _ = std::io::copy(&mut file, &mut out);
                        }
                    }
                }
            }
        }
    }
    
    let _ = app_handle.emit("download-progress", DownloadProgress { 
        stage: "Modpack installed!".to_string(), 
        percentage: 100.0,
        current: 100,
        total: 100,
        total_bytes: None,
        downloaded_bytes: None,
    });
    let _ = fs::remove_dir_all(&temp_dir);
    
    Ok(())
}
