use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::LazyLock;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Semaphore;
use tauri::{AppHandle, Emitter};
use futures::stream::{self, StreamExt};

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
    pub body: String,
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
    #[serde(default)]
    pub game_versions: Vec<String>,
    #[serde(default)]
    pub loaders: Vec<String>,
    #[serde(default, deserialize_with = "deserialize_gallery")]
    pub gallery: Vec<ModrinthGalleryImage>,
}

// Custom deserializer to handle gallery being either strings (search API) or objects (project API)
fn deserialize_gallery<'de, D>(deserializer: D) -> Result<Vec<ModrinthGalleryImage>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{SeqAccess, Visitor};
    
    struct GalleryVisitor;
    
    impl<'de> Visitor<'de> for GalleryVisitor {
        type Value = Vec<ModrinthGalleryImage>;
        
        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a sequence of strings or gallery image objects")
        }
        
        fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
        where
            A: SeqAccess<'de>,
        {
            let mut images = Vec::new();
            
            while let Some(value) = seq.next_element::<serde_json::Value>()? {
                match value {
                    serde_json::Value::String(url) => {
                        images.push(ModrinthGalleryImage {
                            url: url.clone(),
                            raw_url: Some(url),
                            featured: false,
                            title: None,
                            description: None,
                            created: String::new(),
                        });
                    }
                    serde_json::Value::Object(_) => {
                        if let Ok(img) = serde_json::from_value::<ModrinthGalleryImage>(value) {
                            images.push(img);
                        }
                    }
                    _ => {}
                }
            }
            
            Ok(images)
        }
    }
    
    deserializer.deserialize_seq(GalleryVisitor)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModrinthGalleryImage {
    pub url: String,
    #[serde(default)]
    pub raw_url: Option<String>,
    pub featured: bool,
    pub title: Option<String>,
    pub description: Option<String>,
    pub created: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModrinthMember {
    pub team_id: String,
    pub user: ModrinthUser,
    pub role: String,
    pub accepted: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModrinthUser {
    pub id: String,
    pub username: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
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

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct ModpackIndex {
    #[serde(rename = "formatVersion")]
    pub format_version: u32,
    pub game: String,
    #[serde(rename = "versionId")]
    pub version_id: String,
    pub name: String,
    pub dependencies: std::collections::HashMap<String, String>,
    pub files: Vec<ModpackFile>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct ModpackFile {
    pub path: String,
    pub hashes: std::collections::HashMap<String, String>,
    pub env: Option<ModpackEnv>,
    pub downloads: Vec<String>,
    #[serde(rename = "fileSize")]
    pub file_size: u64,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct ModpackEnv {
    pub client: String,
    pub server: String,
}

/// Search for projects on Modrinth
pub async fn search_projects(
    query: &str,
    project_type: &str, // "mod", "resourcepack", "shader"
    game_version: Option<&str>,
    loader: Option<&str>,
    categories: Option<Vec<String>>,
    limit: u32,
    offset: u32,
    index: Option<&str>,
) -> Result<ModrinthSearchResult, Box<dyn Error + Send + Sync>> {
    // Acquire rate limit permit
    let _permit = MODRINTH_SEMAPHORE.acquire().await?;
    
    let mut facet_groups: Vec<Vec<String>> = Vec::new();
    
    // Base filter: project type
    facet_groups.push(vec![format!("project_type:{}", project_type)]);
    
    if let Some(version) = game_version {
        if !version.is_empty() {
            facet_groups.push(vec![format!("versions:{}", version)]);
        }
    }
    
    if let Some(loader_val) = loader {
        if !loader_val.is_empty() {
            facet_groups.push(vec![format!("categories:{}", loader_val)]);
        }
    }

    if let Some(cats) = categories {
        for cat in cats {
            if !cat.is_empty() {
                // Each category in its own inner array = AND logic
                facet_groups.push(vec![format!("categories:{}", cat)]);
            }
        }
    }
    
    let facets_str = serde_json::to_string(&facet_groups)?;
    
    // Use reqwest's query building for reliable parameter encoding
    let url = format!("{}/search", MODRINTH_API_BASE);
    
    let mut params = vec![
        ("query", query.to_string()),
        ("facets", facets_str),
        ("limit", limit.to_string()),
        ("offset", offset.to_string()),
    ];

    if let Some(idx) = index {
        if !idx.is_empty() {
            params.push(("index", idx.to_string()));
        }
    }
    
    let response = super::http_client()
        .get(&url)
        .query(&params)
        .header("User-Agent", get_user_agent())
        .send()
        .await?;
    
    let status = response.status();
    let body_text = response.text().await?;
    
    if !status.is_success() {
        return Err(format!("Modrinth API error ({}): {}", status, body_text).into());
    }
    
    let result: ModrinthSearchResult = serde_json::from_str(&body_text)
        .map_err(|e| format!("Failed to parse Modrinth response: {}. Body preview: {}", e, &body_text[..body_text.len().min(500)]))?;
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
    
    let client = super::http_client();
    
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
        .await?
        .error_for_status()?;
    
    let versions: Vec<ModrinthVersion> = response.json().await?;
    Ok(versions)
}

/// Get specific version info
pub async fn get_version(version_id: &str) -> Result<ModrinthVersion, Box<dyn Error + Send + Sync>> {
    let _permit = MODRINTH_SEMAPHORE.acquire().await?;
    let client = super::http_client();
    let url = format!("{}/version/{}", MODRINTH_API_BASE, version_id);
    let response = client
        .get(&url)
        .header("User-Agent", get_user_agent())
        .send()
        .await?
        .error_for_status()?;
    let version: ModrinthVersion = response.json().await?;
    Ok(version)
}

/// Get multiple versions at once
pub async fn get_versions_bulk(version_ids: Vec<String>) -> Result<Vec<ModrinthVersion>, Box<dyn Error + Send + Sync>> {
    if version_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut all_versions = Vec::new();
    let client = super::http_client();

    // Modrinth allows bulk versions via /versions?ids=["id1","id2"]
    // Chunk requests into groups of 50 to avoid URL length limits
    for chunk in version_ids.chunks(50) {
        let _permit = MODRINTH_SEMAPHORE.acquire().await?;
        let ids_json = serde_json::to_string(chunk)?;
        let url = format!("{}/versions?ids={}", MODRINTH_API_BASE, urlencoding::encode(&ids_json));
        
        let response = client
            .get(&url)
            .header("User-Agent", get_user_agent())
            .send()
            .await?;
        
        let response = response.error_for_status()?;
        let mut versions: Vec<ModrinthVersion> = response.json().await?;
        all_versions.append(&mut versions);
    }
    
    Ok(all_versions)
}

/// Download a file from Modrinth with optional progress reporting
pub async fn download_mod_file(
    file: &ModrinthFile,
    destination: &PathBuf,
    app_handle: Option<&AppHandle>,
    stage: Option<&str>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    // Acquire rate limit permit
    let _permit = MODRINTH_SEMAPHORE.acquire().await?;
    
    let client = super::http_client();
    
    // Create parent directories
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    
    let response = client
        .get(&file.url)
        .header("User-Agent", get_user_agent())
        .send()
        .await?
        .error_for_status()?;

    let total_size = response.content_length().unwrap_or(file.size);
    let mut out_file = File::create(destination)?;
    let mut downloaded: u64 = 0;
    let mut last_emit = std::time::Instant::now();

    let mut stream = response.bytes_stream();
    use futures::StreamExt;

    while let Some(item) = stream.next().await {
        let chunk = item?;
        out_file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;

        // Emit progress every 100ms or so to avoid flooding
        if let (Some(handle), Some(stage_name)) = (app_handle, stage) {
            if last_emit.elapsed().as_millis() > 100 || downloaded == total_size {
                let percentage = (downloaded as f32 / total_size as f32) * 100.0;
                let _ = handle.emit("download-progress", crate::minecraft::downloader::DownloadProgress {
                    stage: stage_name.to_string(),
                    percentage: 10.0 + (percentage * 0.1), // Keep it within the 10-20% range for modpack file
                    current: 5,
                    total: 100,
                    total_bytes: Some(total_size),
                    downloaded_bytes: Some(downloaded),
                });
                last_emit = std::time::Instant::now();
            }
        }
    }
    
    Ok(())
}

/// Get project details
pub async fn get_project(project_id: &str) -> Result<ModrinthProject, Box<dyn Error + Send + Sync>> {
    // Acquire rate limit permit
    let _permit = MODRINTH_SEMAPHORE.acquire().await?;
    
    let client = super::http_client();
    
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

    let mut project: ModrinthProject = serde_json::from_str(&body)?;
    
    // If author is missing (which it will be from the /project/ endpoint), fetch members
    if project.author.is_empty() {
        let members_url = format!("{}/project/{}/members", MODRINTH_API_BASE, project_id);
        if let Ok(members_res) = client
            .get(&members_url)
            .header("User-Agent", get_user_agent())
            .send()
            .await 
        {
            if let Ok(members) = members_res.json::<Vec<ModrinthMember>>().await {
                // Find owner or first member
                let author_name = members.iter()
                    .find(|m| m.role.to_lowercase() == "owner")
                    .map(|m| m.user.username.clone())
                    .or_else(|| members.first().map(|m| m.user.username.clone()));
                
                if let Some(name) = author_name {
                    project.author = name;
                }
            }
        }
    }

    Ok(project)
}

/// Get multiple projects at once
pub async fn get_projects(project_ids: Vec<String>) -> Result<Vec<ModrinthProject>, Box<dyn Error + Send + Sync>> {
    if project_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut all_projects = Vec::new();
    let client = super::http_client();
    
    // Modrinth allows bulk projects via /projects?ids=["id1","id2"]
    // Chunk requests into groups of 50 to avoid URL length limits
    for chunk in project_ids.chunks(50) {
        let _permit = MODRINTH_SEMAPHORE.acquire().await?;
        let ids_json = serde_json::to_string(chunk)?;
        let url = format!("{}/projects?ids={}", MODRINTH_API_BASE, urlencoding::encode(&ids_json));
        
        let response = client
            .get(&url)
            .header("User-Agent", get_user_agent())
            .send()
            .await?;
        
        let response = response.error_for_status()?;
        let mut projects: Vec<ModrinthProject> = response.json().await?;
        
        // Fetch authors if missing (bulk response doesn't include them)
        for project in &mut projects {
            if project.author.is_empty() {
                let members_url = format!("{}/project/{}/members", MODRINTH_API_BASE, project.project_id);
                if let Ok(members_res) = client
                    .get(&members_url)
                    .header("User-Agent", get_user_agent())
                    .send()
                    .await 
                {
                    if let Ok(members) = members_res.json::<Vec<ModrinthMember>>().await {
                        let author_name = members.iter()
                            .find(|m| m.role.to_lowercase() == "owner")
                            .map(|m| m.user.username.clone())
                            .or_else(|| members.first().map(|m| m.user.username.clone()));
                        
                        if let Some(name) = author_name {
                            project.author = name;
                        }
                    }
                }
            }
        }
        
        all_projects.append(&mut projects);
    }
    
    Ok(all_projects)
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
    
    download_mod_file(primary_file, &mrpack_path, None, None).await?;
    
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
        stage: format!("Downloading modpack file: {}...", primary_file.filename), 
        percentage: 10.0,
        current: 5,
        total: 100,
        total_bytes: Some(modpack_size),
        downloaded_bytes: Some(0),
    });
    download_mod_file(
        primary_file, 
        &mrpack_path, 
        Some(app_handle), 
        Some(&format!("Downloading modpack file: {}...", primary_file.filename))
    ).await?;
    
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
    
    // 5. Download mods in parallel
    let total_files = index.files.len();
    let downloaded_bytes_counter = Arc::new(AtomicU64::new(0));
    let completed_count = Arc::new(AtomicU32::new(0));
    let last_progress_emit_ms = Arc::new(AtomicU64::new(0));
    let mods_metadata = Arc::new(Mutex::new(Vec::new()));
    let game_dir = instance.get_game_directory();
    let client = super::http_client();

    let _ = app_handle.emit("download-progress", DownloadProgress {
        stage: format!("Downloading mods 0/{}...", total_files),
        percentage: 30.0,
        current: 0,
        total: total_files as u32,
        total_bytes: Some(total_mods_size),
        downloaded_bytes: Some(0),
    });

    stream::iter(index.files.into_iter())
        .for_each_concurrent(15, |mp_file| {
            let app_handle = app_handle.clone();
            let downloaded_bytes_counter = downloaded_bytes_counter.clone();
            let completed_count = completed_count.clone();
            let last_progress_emit_ms = last_progress_emit_ms.clone();
            let mods_metadata = mods_metadata.clone();
            let game_dir = game_dir.clone();
            let total_mods_size = total_mods_size;
            let client = client.clone();

            async move {
                let dest = game_dir.join(&mp_file.path);
                
                // Try each download URL
                let mut downloaded = false;
                for url in &mp_file.downloads {
                    // Acquire rate limit permit
                    let _permit = MODRINTH_SEMAPHORE.acquire().await.ok();
                    
                    if let Ok(resp) = client.get(url).header("User-Agent", get_user_agent()).send().await {
                        if !resp.status().is_success() {
                            continue;
                        }
                        if let Some(parent) = dest.parent() {
                            let _ = fs::create_dir_all(parent);
                        }
                        if let Ok(mut f) = File::create(&dest) {
                            let mut stream = resp.bytes_stream();
                            let mut downloaded_for_attempt = 0u64;
                            let mut attempt_ok = true;

                            while let Some(item) = stream.next().await {
                                match item {
                                    Ok(chunk) => {
                                        if f.write_all(&chunk).is_err() {
                                            attempt_ok = false;
                                            break;
                                        }

                                        let chunk_len = chunk.len() as u64;
                                        downloaded_for_attempt += chunk_len;
                                        let current_downloaded = downloaded_bytes_counter.fetch_add(chunk_len, Ordering::SeqCst) + chunk_len;

                                        let now_ms = SystemTime::now()
                                            .duration_since(UNIX_EPOCH)
                                            .map(|d| d.as_millis() as u64)
                                            .unwrap_or(0);
                                        let last_ms = last_progress_emit_ms.load(Ordering::Relaxed);
                                        if now_ms.saturating_sub(last_ms) >= 120
                                            && last_progress_emit_ms
                                                .compare_exchange(last_ms, now_ms, Ordering::SeqCst, Ordering::Relaxed)
                                                .is_ok()
                                        {
                                            let completed_so_far = completed_count.load(Ordering::SeqCst);
                                            let byte_ratio = if total_mods_size > 0 {
                                                (current_downloaded as f32 / total_mods_size as f32).clamp(0.0, 1.0)
                                            } else if total_files > 0 {
                                                (completed_so_far as f32 / total_files as f32).clamp(0.0, 1.0)
                                            } else {
                                                1.0
                                            };
                                            let progress = 30.0 + (byte_ratio * 60.0);
                                            let _ = app_handle.emit("download-progress", DownloadProgress {
                                                stage: format!("Downloading mods {}/{}...", completed_so_far, total_files),
                                                percentage: progress,
                                                current: completed_so_far,
                                                total: total_files as u32,
                                                total_bytes: Some(total_mods_size),
                                                downloaded_bytes: Some(current_downloaded),
                                            });
                                        }
                                    }
                                    Err(_) => {
                                        attempt_ok = false;
                                        break;
                                    }
                                }
                            }

                            if attempt_ok {
                                downloaded = true;
                                break;
                            }

                            if downloaded_for_attempt > 0 {
                                downloaded_bytes_counter.fetch_sub(downloaded_for_attempt, Ordering::SeqCst);
                            }
                            let _ = fs::remove_file(&dest);
                        }
                    }
                }
                
                let current_completed = completed_count.fetch_add(1, Ordering::SeqCst) + 1;
                let current_downloaded = downloaded_bytes_counter.load(Ordering::SeqCst);
                
                let byte_ratio = if total_mods_size > 0 {
                    (current_downloaded as f32 / total_mods_size as f32).clamp(0.0, 1.0)
                } else if total_files > 0 {
                    (current_completed as f32 / total_files as f32).clamp(0.0, 1.0)
                } else {
                    1.0
                };
                let progress = 30.0 + (byte_ratio * 60.0);
                let _ = app_handle.emit("download-progress", DownloadProgress { 
                    stage: format!("Downloading mods {}/{}...", current_completed, total_files), 
                    percentage: progress,
                    current: current_completed,
                    total: total_files as u32,
                    total_bytes: Some(total_mods_size),
                    downloaded_bytes: Some(current_downloaded),
                });

                if !downloaded {
                    crate::log_warn!(&app_handle, "Failed to download file: {}", mp_file.path);
                } else {
                    // Try to extract project and version IDs from the successful download URL for metadata
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
                        } else if url.contains("api.modrinth.com/v2/project/") {
                             let parts: Vec<&str> = url.split("/project/").collect();
                             if parts.len() > 1 {
                                 let sub_parts: Vec<&str> = parts[1].split('/').collect();
                                 if sub_parts.len() >= 3 && sub_parts[1] == "version" {
                                     project_id = Some(sub_parts[0].to_string());
                                     version_id = Some(sub_parts[2].to_string());
                                     break;
                                 }
                             }
                        } else if url.contains("/project/") && url.contains("/version/") {
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
                        if let Ok(mut meta) = mods_metadata.lock() {
                            meta.push((dest, pid, version_id));
                        }
                    }
                }
            }
        })
        .await;

    // 6. Fetch and write metadata for all mods
    let mods_metadata_vec = mods_metadata
        .lock()
        .map(|m| m.clone())
        .unwrap_or_default();
    if !mods_metadata_vec.is_empty() {
        let _ = app_handle.emit("download-progress", DownloadProgress { 
            stage: "Fetching mod metadata...".to_string(), 
            percentage: 95.0,
            current: total_files as u32,
            total: total_files as u32,
            total_bytes: Some(total_mods_size),
            downloaded_bytes: Some(total_mods_size),
        });

        let mut unique_p_ids: Vec<String> = mods_metadata_vec.iter().map(|(_, p, _)| p.clone()).collect();
        unique_p_ids.sort();
        unique_p_ids.dedup();
        
        let v_ids: Vec<String> = mods_metadata_vec.iter().filter_map(|(_, _, v)| v.clone()).collect();

        let projects = get_projects(unique_p_ids).await.unwrap_or_default();
        let versions = get_versions_bulk(v_ids).await.unwrap_or_default();

        for (dest, p_id, v_id) in mods_metadata_vec {
            let project = projects.iter().find(|p| p.project_id == p_id);
            let version = v_id.as_ref().and_then(|vid| versions.iter().find(|v| &v.id == vid));

            let meta = crate::minecraft::files::ModMeta {
                project_id: p_id,
                version_id: v_id,
                name: project.map(|p| p.title.clone()),
                author: project.map(|p| p.author.clone()),
                icon_url: project.and_then(|p| p.icon_url.clone()),
                version_name: version.map(|v| v.version_number.clone()),
                categories: project.map(|p| p.categories.clone()),
            };

            let _ = crate::minecraft::files::write_meta_for_file(&dest, &meta);
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
            
            let target_rel = if let Some(stripped) = name.strip_prefix("overrides/") {
                Some(stripped)
            } else if let Some(stripped) = name.strip_prefix("client-overrides/") {
                Some(stripped)
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
