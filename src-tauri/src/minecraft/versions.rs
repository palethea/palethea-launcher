use serde::{Deserialize, Serialize};
use std::error::Error;

const VERSION_MANIFEST_URL: &str = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VersionManifest {
    pub latest: LatestVersions,
    pub versions: Vec<VersionInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LatestVersions {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub url: String,
    pub time: String,
    pub release_time: String,
    #[serde(default)]
    pub sha1: String,
    #[serde(default)]
    pub compliance_level: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionDetails {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub main_class: String,
    pub minimum_launcher_version: Option<i32>,
    pub release_time: String,
    pub time: String,
    pub assets: Option<String>,
    pub asset_index: Option<AssetIndex>,
    pub downloads: Option<Downloads>,
    pub libraries: Vec<Library>,
    pub arguments: Option<Arguments>,
    #[serde(rename = "minecraftArguments")]
    pub minecraft_arguments: Option<String>,
    pub java_version: Option<JavaVersion>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssetIndex {
    pub id: String,
    pub sha1: String,
    pub size: i64,
    pub total_size: Option<i64>,
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Downloads {
    pub client: DownloadInfo,
    pub server: Option<DownloadInfo>,
    pub client_mappings: Option<DownloadInfo>,
    pub server_mappings: Option<DownloadInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadInfo {
    pub sha1: String,
    pub size: i64,
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Library {
    pub name: String,
    pub downloads: Option<LibraryDownloads>,
    #[serde(default)]
    pub url: Option<String>,
    pub rules: Option<Vec<Rule>>,
    pub natives: Option<std::collections::HashMap<String, String>>,
    pub extract: Option<ExtractInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LibraryDownloads {
    pub artifact: Option<Artifact>,
    pub classifiers: Option<std::collections::HashMap<String, Artifact>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Artifact {
    pub path: String,
    pub sha1: String,
    pub size: i64,
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Rule {
    pub action: String,
    pub os: Option<OsRule>,
    pub features: Option<std::collections::HashMap<String, bool>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OsRule {
    pub name: Option<String>,
    pub version: Option<String>,
    pub arch: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExtractInfo {
    pub exclude: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Arguments {
    pub game: Option<Vec<serde_json::Value>>,
    pub jvm: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JavaVersion {
    pub component: String,
    pub major_version: i32,
}

/// Fetches the version manifest from Mojang's API
pub async fn fetch_version_manifest() -> Result<VersionManifest, Box<dyn Error + Send + Sync>> {
    let client = reqwest::Client::builder()
        .user_agent("PaletheaLauncher/0.2.9")
        .build()?;
    let response = client.get(VERSION_MANIFEST_URL).send().await?;
    let manifest: VersionManifest = response.json().await?;
    Ok(manifest)
}

/// Fetches detailed version information for a specific version
pub async fn fetch_version_details(version_url: &str) -> Result<VersionDetails, Box<dyn Error + Send + Sync>> {
    let client = reqwest::Client::builder()
        .user_agent("PaletheaLauncher/0.2.9")
        .build()?;
    let response = client.get(version_url).send().await?;
    let details: VersionDetails = response.json().await?;
    Ok(details)
}

/// Load version details from a local file
pub fn load_version_details(path: &std::path::PathBuf) -> Result<VersionDetails, Box<dyn Error + Send + Sync>> {
    let content = std::fs::read_to_string(path)?;
    let details: VersionDetails = serde_json::from_str(&content)?;
    Ok(details)
}

/// Get the current OS name for library rules
pub fn get_os_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

/// Check if a library should be included based on its rules
pub fn should_use_library(library: &Library) -> bool {
    let os_name = get_os_name();
    
    match &library.rules {
        None => true,
        Some(rules) => {
            let mut dominated_result = false;
            
            for rule in rules {
                let rule_applies = match &rule.os {
                    None => true,
                    Some(os_rule) => {
                        match &os_rule.name {
                            None => true,
                            Some(name) => name == os_name,
                        }
                    }
                };
                
                if rule_applies {
                    dominated_result = rule.action == "allow";
                }
            }
            
            dominated_result
        }
    }
}

/// Convert library name (group:artifact:version) to path
pub fn library_name_to_path(name: &str) -> String {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return name.to_string();
    }
    
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    
    let mut path = format!("{}/{}/{}/{}-{}", group, artifact, version, artifact, version);
    
    if parts.len() > 3 {
        // Handle classifier
        path.push('-');
        path.push_str(parts[3]);
    }
    
    path.push_str(".jar");
    path
}
