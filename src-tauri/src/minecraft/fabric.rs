use serde::{Deserialize, Serialize};
use sha1::{Sha1, Digest};
use std::error::Error;
use std::fs;
use std::path::PathBuf;

use crate::minecraft::downloader::get_libraries_dir;
use crate::minecraft::instances::Instance;

const FABRIC_META_API: &str = "https://meta.fabricmc.net/v2";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FabricLoaderVersion {
    pub loader: FabricLoader,
    #[serde(rename = "intermediary")]
    pub intermediary: FabricIntermediary,
    #[serde(rename = "launcherMeta")]
    pub launcher_meta: FabricLauncherMeta,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FabricLoader {
    pub separator: String,
    pub build: u32,
    pub maven: String,
    pub version: String,
    pub stable: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FabricIntermediary {
    pub maven: String,
    pub version: String,
    pub stable: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FabricLauncherMeta {
    pub version: u32,
    pub libraries: FabricLibraries,
    #[serde(rename = "mainClass")]
    pub main_class: FabricMainClass,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FabricLibraries {
    pub client: Vec<FabricLibrary>,
    pub common: Vec<FabricLibrary>,
    #[serde(default)]
    pub server: Vec<FabricLibrary>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FabricLibrary {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum FabricMainClass {
    Simple(String),
    Complex {
        client: String,
        server: Option<String>,
    },
}

impl FabricMainClass {
    pub fn get_client_class(&self) -> &str {
        match self {
            FabricMainClass::Simple(s) => s,
            FabricMainClass::Complex { client, .. } => client,
        }
    }
}

/// Fetch Fabric loader info for a game version and loader version
pub async fn get_fabric_loader_info(
    game_version: &str,
    loader_version: &str,
) -> Result<FabricLoaderVersion, Box<dyn Error + Send + Sync>> {
    let client = super::http_client();
    let url = format!(
        "{}/versions/loader/{}/{}",
        FABRIC_META_API, game_version, loader_version
    );

    let response = client
        .get(&url)
        .header("User-Agent", format!("PaletheaLauncher/{}", super::get_launcher_version()))
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(format!("Failed to fetch Fabric info: {}", response.status()).into());
    }

    let info: FabricLoaderVersion = response.json().await?;
    Ok(info)
}

/// Convert maven coordinate to file path
/// Convert a maven coordinate (group:artifact:version) to a file path
pub fn maven_to_path(maven: &str) -> String {
    let parts: Vec<&str> = maven.split(':').collect();
    if parts.len() < 3 {
        return maven.to_string();
    }

    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];

    format!(
        "{}/{}/{}/{}-{}.jar",
        group, artifact, version, artifact, version
    )
}

/// Download a library from a maven repository with optional SHA1 verification
async fn download_library(
    url_base: &str,
    maven: &str,
    libraries_dir: &PathBuf,
) -> Result<PathBuf, Box<dyn Error + Send + Sync>> {
    download_library_with_sha1(url_base, maven, libraries_dir, None).await
}

/// Download a library from a maven repository with SHA1 verification
async fn download_library_with_sha1(
    url_base: &str,
    maven: &str,
    libraries_dir: &PathBuf,
    expected_sha1: Option<&str>,
) -> Result<PathBuf, Box<dyn Error + Send + Sync>> {
    let path = maven_to_path(maven);
    let dest = libraries_dir.join(&path);

    // If file exists and we have a SHA1, verify it
    if dest.exists() {
        if let Some(expected) = expected_sha1 {
            let content = fs::read(&dest)?;
            let mut hasher = Sha1::new();
            hasher.update(&content);
            let hash = format!("{:x}", hasher.finalize());
            if hash == expected {
                return Ok(dest);
            }
            // Hash mismatch, re-download
            log::warn!("SHA1 mismatch for {}, re-downloading", maven);
        } else {
            return Ok(dest);
        }
    }

    // Create parent directories
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }

    let url = format!("{}{}", url_base, path);
    let client = super::http_client();
    let response = client
        .get(&url)
        .header("User-Agent", format!("PaletheaLauncher/{}", super::get_launcher_version()))
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(format!("Failed to download library from {}: {}", url, response.status()).into());
    }

    let bytes = response.bytes().await?;
    
    // Verify SHA1 if provided
    if let Some(expected) = expected_sha1 {
        let mut hasher = Sha1::new();
        hasher.update(&bytes);
        let hash = format!("{:x}", hasher.finalize());
        if hash != expected {
            return Err(format!("SHA1 verification failed for {}: expected {}, got {}", maven, expected, hash).into());
        }
    }
    
    fs::write(&dest, bytes)?;

    Ok(dest)
}

/// Install Fabric for an instance
pub async fn install_fabric(
    instance: &Instance,
    loader_version: &str,
) -> Result<FabricLoaderVersion, Box<dyn Error + Send + Sync>> {
    let fabric_info = get_fabric_loader_info(&instance.version_id, loader_version).await?;
    let libraries_dir = get_libraries_dir();

    // Download loader library
    download_library(
        "https://maven.fabricmc.net/",
        &fabric_info.loader.maven,
        &libraries_dir,
    )
    .await?;

    // Download intermediary library
    download_library(
        "https://maven.fabricmc.net/",
        &fabric_info.intermediary.maven,
        &libraries_dir,
    )
    .await?;

    // Download common libraries with SHA1 verification
    for lib in &fabric_info.launcher_meta.libraries.common {
        download_library_with_sha1(&lib.url, &lib.name, &libraries_dir, lib.sha1.as_deref()).await?;
    }

    // Download client libraries with SHA1 verification
    for lib in &fabric_info.launcher_meta.libraries.client {
        download_library_with_sha1(&lib.url, &lib.name, &libraries_dir, lib.sha1.as_deref()).await?;
    }

    // Save Fabric info to instance folder for later use
    let instance_dir = instance.get_directory();
    let fabric_json_path = instance_dir.join("fabric.json");
    let fabric_json = serde_json::to_string_pretty(&fabric_info)?;
    fs::write(&fabric_json_path, fabric_json)?;

    Ok(fabric_info)
}

/// Load saved Fabric info from instance
pub fn load_fabric_info(instance: &Instance) -> Option<FabricLoaderVersion> {
    let fabric_json_path = instance.get_directory().join("fabric.json");
    if !fabric_json_path.exists() {
        return None;
    }

    let content = fs::read_to_string(&fabric_json_path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Get Fabric classpath additions as (maven_name, absolute_path) pairs
pub fn get_fabric_classpath(fabric_info: &FabricLoaderVersion) -> Vec<(String, String)> {
    let libraries_dir = get_libraries_dir();
    let mut classpath = Vec::new();

    // Add loader
    let loader_path = libraries_dir.join(maven_to_path(&fabric_info.loader.maven));
    if loader_path.exists() {
        classpath.push((fabric_info.loader.maven.clone(), loader_path.to_string_lossy().to_string()));
    }

    // Add intermediary
    let intermediary_path = libraries_dir.join(maven_to_path(&fabric_info.intermediary.maven));
    if intermediary_path.exists() {
        classpath.push((fabric_info.intermediary.maven.clone(), intermediary_path.to_string_lossy().to_string()));
    }

    // Add common libraries
    for lib in &fabric_info.launcher_meta.libraries.common {
        let lib_path = libraries_dir.join(maven_to_path(&lib.name));
        if lib_path.exists() {
            classpath.push((lib.name.clone(), lib_path.to_string_lossy().to_string()));
        }
    }

    // Add client libraries
    for lib in &fabric_info.launcher_meta.libraries.client {
        let lib_path = libraries_dir.join(maven_to_path(&lib.name));
        if lib_path.exists() {
            classpath.push((lib.name.clone(), lib_path.to_string_lossy().to_string()));
        }
    }

    classpath
}
