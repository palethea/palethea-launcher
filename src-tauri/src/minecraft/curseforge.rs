use futures::stream::{self, StreamExt};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::error::Error;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

use crate::minecraft::downloader::DownloadProgress;
use crate::minecraft::{fabric, forge, instances};

const CURSEFORGE_API_BASE: &str = "https://api.curseforge.com/v1";
const CURSEFORGE_MINECRAFT_GAME_ID: u32 = 432;
const CURSEFORGE_MOD_CLASS_ID: u32 = 6;
const CURSEFORGE_RESOURCEPACK_CLASS_ID: u32 = 12;
const CURSEFORGE_MODPACK_CLASS_ID: u32 = 4471;
const CURSEFORGE_SHADER_CLASS_ID: u32 = 6552;
const CURSEFORGE_DATAPACK_CLASS_ID: u32 = 6945;
const CURSEFORGE_CUSTOMIZATION_CLASS_ID: u32 = 4546;
const CURSEFORGE_SORT_FIELD_TOTAL_DOWNLOADS: u32 = 6;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CurseForgeModpack {
    pub project_id: String,
    #[serde(default)]
    pub project_type: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub author: String,
    #[serde(default)]
    pub downloads: u64,
    pub icon_url: Option<String>,
    pub website_url: Option<String>,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub gallery: Vec<CurseForgeGalleryImage>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CurseForgeGalleryImage {
    pub url: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub thumbnail_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CurseForgeSearchResult {
    pub hits: Vec<CurseForgeModpack>,
    pub offset: u32,
    pub limit: u32,
    pub total_hits: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CurseForgeVersionFile {
    pub url: String,
    pub filename: String,
    pub primary: bool,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CurseForgeModpackVersion {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub version_number: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub files: Vec<CurseForgeVersionFile>,
    pub date_published: String,
    pub version_type: String,
}

#[derive(Debug, Deserialize)]
struct CurseForgeApiResponse<T> {
    data: T,
}

#[derive(Debug, Deserialize)]
struct CurseForgeStringResponse {
    data: String,
}

#[derive(Debug, Deserialize)]
struct CurseForgeSearchApiResponse {
    data: Vec<CurseForgeProject>,
    pagination: CurseForgePagination,
}

#[derive(Debug, Deserialize)]
struct CurseForgeFilesApiResponse {
    data: Vec<CurseForgeFile>,
    pagination: CurseForgePagination,
}

#[derive(Debug, Deserialize)]
struct CurseForgePagination {
    index: u32,
    #[serde(rename = "pageSize")]
    page_size: u32,
    #[serde(rename = "resultCount", default)]
    result_count: u32,
    #[serde(rename = "totalCount")]
    total_count: u32,
}

#[derive(Debug, Deserialize)]
struct CurseForgeProject {
    id: u64,
    #[serde(default, rename = "classId")]
    class_id: u64,
    name: String,
    #[serde(default)]
    summary: String,
    #[serde(default, rename = "downloadCount")]
    download_count: f64,
    #[serde(default)]
    authors: Vec<CurseForgeAuthor>,
    #[serde(default)]
    logo: Option<CurseForgeLogo>,
    #[serde(default)]
    links: Option<CurseForgeLinks>,
    #[serde(default)]
    categories: Vec<CurseForgeCategory>,
    #[serde(default)]
    screenshots: Vec<CurseForgeAsset>,
}

#[derive(Debug, Deserialize)]
struct CurseForgeAuthor {
    name: String,
}

#[derive(Debug, Deserialize)]
struct CurseForgeLogo {
    #[serde(default, rename = "thumbnailUrl")]
    thumbnail_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CurseForgeLinks {
    #[serde(default, rename = "websiteUrl")]
    website_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CurseForgeAsset {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default, rename = "thumbnailUrl")]
    thumbnail_url: Option<String>,
    #[serde(default)]
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CurseForgeCategory {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    slug: String,
}

#[derive(Debug, Deserialize)]
struct CurseForgeCategoryLookup {
    id: u64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    slug: String,
}

#[derive(Debug, Deserialize, Clone)]
struct CurseForgeFile {
    id: u64,
    #[serde(default, rename = "displayName")]
    display_name: String,
    #[serde(rename = "fileName")]
    file_name: String,
    #[serde(rename = "fileDate")]
    file_date: String,
    #[serde(default, rename = "fileLength")]
    file_length: u64,
    #[serde(default, rename = "downloadUrl")]
    download_url: Option<String>,
    #[serde(default, rename = "gameVersions")]
    game_versions: Vec<String>,
    #[serde(default, rename = "releaseType")]
    release_type: u32,
}

#[derive(Debug, Deserialize)]
struct CurseForgeManifest {
    minecraft: CurseForgeManifestMinecraft,
    #[serde(default)]
    files: Vec<CurseForgeManifestFile>,
    #[serde(default)]
    overrides: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CurseForgeManifestMinecraft {
    version: String,
    #[serde(default, rename = "modLoaders")]
    mod_loaders: Vec<CurseForgeManifestLoader>,
}

#[derive(Debug, Deserialize)]
struct CurseForgeManifestLoader {
    id: String,
    #[serde(default)]
    primary: bool,
}

#[derive(Debug, Deserialize, Clone)]
struct CurseForgeManifestFile {
    #[serde(rename = "projectID")]
    project_id: u64,
    #[serde(rename = "fileID")]
    file_id: u64,
    #[serde(default = "default_true")]
    required: bool,
}

#[derive(Debug, Serialize)]
struct CurseForgeFileIdsRequest {
    #[serde(rename = "fileIds")]
    file_ids: Vec<u64>,
}

#[derive(Debug, Serialize)]
struct CurseForgeModIdsRequest {
    #[serde(rename = "modIds")]
    mod_ids: Vec<u64>,
}

#[derive(Debug, Clone)]
struct DownloadedCurseForgeModMeta {
    dest: PathBuf,
    project_id: u64,
    file_id: u64,
    version_name: String,
}

fn default_true() -> bool { true }

fn parse_u64_id(value: &str, label: &str) -> Result<u64, Box<dyn Error + Send + Sync>> {
    value.trim().parse::<u64>().map_err(|_| format!("Invalid {} '{}'", label, value).into())
}

fn curseforge_api_key() -> Result<String, Box<dyn Error + Send + Sync>> {
    super::secrets::get_curseforge_api_key().ok_or_else(|| {
        "CurseForge API key is not configured. Set CURSEFORGE_API_KEY for backend runtime.".to_string().into()
    })
}

fn user_agent() -> String {
    format!("PaletheaLauncher/{} (github.com/PaletheaLauncher)", super::get_launcher_version())
}

fn release_type_label(release_type: u32) -> String {
    match release_type {
        2 => "beta",
        3 => "alpha",
        _ => "release",
    }.to_string()
}

fn is_mc_version_tag(tag: &str) -> bool {
    let trimmed = tag.trim();
    if !trimmed.starts_with('1') {
        return false;
    }
    trimmed.chars().all(|c| c.is_ascii_digit() || c == '.')
}

fn classify_game_versions_and_loaders(tags: &[String]) -> (Vec<String>, Vec<String>) {
    let mut mc_versions = Vec::new();
    let mut loaders = Vec::new();

    for tag in tags {
        let trimmed = tag.trim();
        let lower = trimmed.to_ascii_lowercase();

        if is_mc_version_tag(trimmed) {
            mc_versions.push(trimmed.to_string());
            continue;
        }

        if lower.contains("neoforge") {
            loaders.push("neoforge".to_string());
        } else if lower.contains("fabric") {
            loaders.push("fabric".to_string());
        } else if lower == "forge" || lower.starts_with("forge") || lower.contains(" forge") {
            loaders.push("forge".to_string());
        } else if lower.contains("quilt") {
            loaders.push("quilt".to_string());
        }
    }

    mc_versions.sort();
    mc_versions.dedup();
    mc_versions.reverse();

    loaders.sort();
    loaders.dedup();

    (mc_versions, loaders)
}

fn normalize_author(project: &CurseForgeProject) -> String {
    project.authors.first().map(|a| a.name.clone()).unwrap_or_else(|| "Unknown".to_string())
}

fn normalize_categories(project: &CurseForgeProject) -> Vec<String> {
    project
        .categories
        .iter()
        .map(|category| {
            if !category.name.trim().is_empty() {
                category.name.trim().to_string()
            } else if !category.slug.trim().is_empty() {
                category.slug.trim().to_string()
            } else {
                category.id.to_string()
            }
        })
        .collect()
}

fn normalize_gallery(project: &CurseForgeProject) -> Vec<CurseForgeGalleryImage> {
    project
        .screenshots
        .iter()
        .filter_map(|asset| {
            let url = asset.url.clone().or_else(|| asset.thumbnail_url.clone())?;
            Some(CurseForgeGalleryImage {
                url,
                title: asset.title.clone(),
                description: asset.description.clone(),
                thumbnail_url: asset.thumbnail_url.clone(),
            })
        })
        .collect()
}

fn to_embed_video_from_url(raw_url: &str) -> Option<(String, Option<String>)> {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized = if trimmed.starts_with("//") {
        format!("https:{}", trimmed)
    } else {
        trimmed.to_string()
    };

    let parsed = Url::parse(&normalized).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();

    let path_segments = parsed
        .path_segments()
        .map(|segments| segments.filter(|s| !s.is_empty()).collect::<Vec<_>>())
        .unwrap_or_default();

    if host == "img.youtube.com" || host == "i.ytimg.com" {
        if let Some(idx) = path_segments
            .iter()
            .position(|segment| *segment == "vi" || *segment == "vi_webp")
        {
            if let Some(video_id) = path_segments.get(idx + 1) {
                let embed = format!("https://www.youtube.com/embed/{}", video_id);
                let thumb = format!("https://img.youtube.com/vi/{}/hqdefault.jpg", video_id);
                return Some((embed, Some(thumb)));
            }
        }
    }

    if host == "youtube.com"
        || host == "www.youtube.com"
        || host == "m.youtube.com"
        || host == "youtube-nocookie.com"
        || host == "www.youtube-nocookie.com"
    {
        let video_id = if parsed.path() == "/watch" {
            parsed
                .query_pairs()
                .find_map(|(key, value)| if key == "v" { Some(value.to_string()) } else { None })
        } else if path_segments.first().copied() == Some("embed") || path_segments.first().copied() == Some("shorts") {
            path_segments.get(1).map(|id| (*id).to_string())
        } else {
            None
        }?;

        if !video_id.is_empty() {
            let embed = format!("https://www.youtube.com/embed/{}", video_id);
            let thumb = format!("https://img.youtube.com/vi/{}/hqdefault.jpg", video_id);
            return Some((embed, Some(thumb)));
        }
    }

    if host == "youtu.be" {
        if let Some(video_id) = path_segments.first() {
            if !video_id.is_empty() {
                let embed = format!("https://www.youtube.com/embed/{}", video_id);
                let thumb = format!("https://img.youtube.com/vi/{}/hqdefault.jpg", video_id);
                return Some((embed, Some(thumb)));
            }
        }
    }

    if host == "player.vimeo.com" {
        if path_segments.first().copied() == Some("video") {
            if let Some(video_id) = path_segments.get(1) {
                if video_id.chars().all(|c| c.is_ascii_digit()) {
                    return Some((format!("https://player.vimeo.com/video/{}", video_id), None));
                }
            }
        }
    }

    if host == "vimeo.com" || host == "www.vimeo.com" {
        if let Some(video_id) = path_segments.first() {
            if video_id.chars().all(|c| c.is_ascii_digit()) {
                return Some((format!("https://player.vimeo.com/video/{}", video_id), None));
            }
        }
    }

    None
}

fn extract_video_gallery_from_description(description_html: &str) -> Vec<CurseForgeGalleryImage> {
    let mut items = Vec::new();
    let mut seen = HashSet::<String>::new();

    for token in description_html.split(|c: char| {
        c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>' | '(' | ')' | '[' | ']')
    }) {
        let candidate = token
            .trim()
            .trim_end_matches(|c: char| matches!(c, '.' | ',' | ';' | ':' | '!' | '?' | '\\'))
            .replace("\\/", "/")
            .replace("&amp;", "&");

        if candidate.is_empty() {
            continue;
        }

        let normalized_candidate = if candidate.starts_with("http://")
            || candidate.starts_with("https://")
            || candidate.starts_with("//")
        {
            candidate
        } else if candidate.contains("youtube.com/")
            || candidate.contains("youtu.be/")
            || candidate.contains("ytimg.com/")
            || candidate.contains("vimeo.com/")
        {
            format!("https://{}", candidate.trim_start_matches('/'))
        } else {
            continue;
        };

        if let Some((embed_url, thumbnail_url)) = to_embed_video_from_url(&normalized_candidate) {
            let key = embed_url.to_ascii_lowercase();
            if seen.insert(key) {
                items.push(CurseForgeGalleryImage {
                    url: embed_url,
                    title: Some("Video".to_string()),
                    description: None,
                    thumbnail_url,
                });
            }
        }
    }

    items
}

fn normalize_project_type(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "mod" | "mods" | "mc-mods" => "mod".to_string(),
        "modpack" | "modpacks" => "modpack".to_string(),
        "resourcepack" | "resourcepacks" | "resource-pack" | "resource-packs" | "texture-pack" | "texture-packs" => "resourcepack".to_string(),
        "shader" | "shaders" => "shader".to_string(),
        "datapack" | "datapacks" | "data-pack" | "data-packs" => "datapack".to_string(),
        _ => "mod".to_string(),
    }
}

fn project_type_from_class_id(class_id: u64) -> String {
    match class_id as u32 {
        CURSEFORGE_MODPACK_CLASS_ID => "modpack".to_string(),
        CURSEFORGE_RESOURCEPACK_CLASS_ID => "resourcepack".to_string(),
        CURSEFORGE_SHADER_CLASS_ID => "shader".to_string(),
        CURSEFORGE_DATAPACK_CLASS_ID => "datapack".to_string(),
        CURSEFORGE_MOD_CLASS_ID => "mod".to_string(),
        _ => "mod".to_string(),
    }
}

fn class_id_candidates_for_project_type(project_type: &str) -> Vec<u32> {
    match normalize_project_type(project_type).as_str() {
        "modpack" => vec![CURSEFORGE_MODPACK_CLASS_ID],
        "resourcepack" => vec![CURSEFORGE_RESOURCEPACK_CLASS_ID],
        "shader" => vec![
            CURSEFORGE_SHADER_CLASS_ID,
            CURSEFORGE_CUSTOMIZATION_CLASS_ID,
            CURSEFORGE_MOD_CLASS_ID,
        ],
        "datapack" => vec![
            CURSEFORGE_DATAPACK_CLASS_ID,
            CURSEFORGE_CUSTOMIZATION_CLASS_ID,
            CURSEFORGE_MOD_CLASS_ID,
        ],
        _ => vec![CURSEFORGE_MOD_CLASS_ID],
    }
}

fn to_modpack_summary(
    project: CurseForgeProject,
    body: Option<String>,
    project_type_hint: Option<&str>,
) -> CurseForgeModpack {
    let author = normalize_author(&project);
    let categories = normalize_categories(&project);
    let description_html = body.unwrap_or_default();
    let mut gallery = normalize_gallery(&project);
    let mut existing = gallery
        .iter()
        .map(|item| item.url.trim().to_ascii_lowercase())
        .collect::<HashSet<_>>();

    for video_item in extract_video_gallery_from_description(&description_html) {
        let key = video_item.url.trim().to_ascii_lowercase();
        if existing.insert(key) {
            gallery.push(video_item);
        }
    }

    let resolved_project_type = if let Some(hint) = project_type_hint {
        normalize_project_type(hint)
    } else {
        project_type_from_class_id(project.class_id)
    };

    CurseForgeModpack {
        project_id: project.id.to_string(),
        project_type: resolved_project_type,
        title: project.name,
        description: project.summary,
        author,
        downloads: if project.download_count.is_finite() && project.download_count > 0.0 {
            project.download_count.floor() as u64
        } else {
            0
        },
        icon_url: project.logo.and_then(|logo| logo.thumbnail_url),
        website_url: project.links.and_then(|links| links.website_url),
        categories,
        body: description_html,
        gallery,
    }
}

fn to_modpack_version(project_id: u64, file: CurseForgeFile) -> CurseForgeModpackVersion {
    let (game_versions, loaders) = classify_game_versions_and_loaders(&file.game_versions);
    let display_name = if file.display_name.trim().is_empty() { file.file_name.clone() } else { file.display_name.clone() };

    CurseForgeModpackVersion {
        id: file.id.to_string(),
        project_id: project_id.to_string(),
        name: display_name,
        version_number: if file.display_name.trim().is_empty() { file.file_name.clone() } else { file.display_name.clone() },
        game_versions,
        loaders,
        files: vec![CurseForgeVersionFile {
            url: file.download_url.unwrap_or_default(),
            filename: file.file_name,
            primary: true,
            size: file.file_length,
        }],
        date_published: file.file_date,
        version_type: release_type_label(file.release_type),
    }
}

async fn get_file_download_url(mod_id: u64, file_id: u64) -> Result<String, Box<dyn Error + Send + Sync>> {
    let api_key = curseforge_api_key()?;
    let response = super::http_client()
        .get(format!("{}/mods/{}/files/{}/download-url", CURSEFORGE_API_BASE, mod_id, file_id))
        .header("x-api-key", api_key)
        .header("User-Agent", user_agent())
        .send()
        .await?
        .error_for_status()?
        .json::<CurseForgeApiResponse<String>>()
        .await?;

    Ok(response.data)
}

fn normalize_download_url(url: Option<String>) -> Option<String> {
    url.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

async fn resolve_file_download_url(
    mod_id: u64,
    file_id: u64,
    known_url: Option<String>,
) -> Result<String, Box<dyn Error + Send + Sync>> {
    if let Some(url) = normalize_download_url(known_url) {
        return Ok(url);
    }

    let endpoint_err = match get_file_download_url(mod_id, file_id).await {
        Ok(url) => {
            if let Some(resolved) = normalize_download_url(Some(url)) {
                return Ok(resolved);
            }
            "download-url endpoint returned an empty URL".to_string()
        }
        Err(err) => {
            err.to_string()
        }
    };

    let detail_err = match get_modpack_file_detail(mod_id, file_id).await {
        Ok(file) => {
            if let Some(resolved) = normalize_download_url(file.download_url) {
                return Ok(resolved);
            }
            "file metadata did not contain a download URL".to_string()
        }
        Err(err) => {
            err.to_string()
        }
    };

    Err(format!(
        "CurseForge did not provide a downloadable URL for project {} file {}. \
This usually means third-party distribution is disabled for that file. \
download-url error: {}; file-detail error: {}",
        mod_id, file_id, endpoint_err, detail_err
    )
    .into())
}

pub async fn get_file_download_url_for_ids(
    project_id: &str,
    file_id: &str,
) -> Result<String, Box<dyn Error + Send + Sync>> {
    let mod_id = parse_u64_id(project_id, "project_id")?;
    let parsed_file_id = parse_u64_id(file_id, "file_id")?;
    resolve_file_download_url(mod_id, parsed_file_id, None).await
}

async fn get_modpack_file_detail(project_id: u64, file_id: u64) -> Result<CurseForgeFile, Box<dyn Error + Send + Sync>> {
    let api_key = curseforge_api_key()?;
    let response = super::http_client()
        .get(format!("{}/mods/{}/files/{}", CURSEFORGE_API_BASE, project_id, file_id))
        .header("x-api-key", api_key)
        .header("User-Agent", user_agent())
        .send()
        .await?
        .error_for_status()?
        .json::<CurseForgeApiResponse<CurseForgeFile>>()
        .await?;
    Ok(response.data)
}

async fn get_mods_bulk(mod_ids: &[u64]) -> Result<HashMap<u64, CurseForgeProject>, Box<dyn Error + Send + Sync>> {
    if mod_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let api_key = curseforge_api_key()?;
    let mut map = HashMap::new();
    let unique: Vec<u64> = mod_ids.iter().copied().collect::<HashSet<u64>>().into_iter().collect();

    for chunk in unique.chunks(100) {
        let body = CurseForgeModIdsRequest { mod_ids: chunk.to_vec() };
        let response = super::http_client()
            .post(format!("{}/mods", CURSEFORGE_API_BASE))
            .header("x-api-key", &api_key)
            .header("User-Agent", user_agent())
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json::<CurseForgeApiResponse<Vec<CurseForgeProject>>>()
            .await?;

        for project in response.data {
            map.insert(project.id, project);
        }
    }

    Ok(map)
}

async fn get_files_bulk(file_ids: &[u64]) -> Result<HashMap<u64, CurseForgeFile>, Box<dyn Error + Send + Sync>> {
    if file_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let api_key = curseforge_api_key()?;
    let mut map = HashMap::new();
    let unique: Vec<u64> = file_ids.iter().copied().collect::<HashSet<u64>>().into_iter().collect();

    for chunk in unique.chunks(100) {
        let body = CurseForgeFileIdsRequest { file_ids: chunk.to_vec() };
        let response = super::http_client()
            .post(format!("{}/mods/files", CURSEFORGE_API_BASE))
            .header("x-api-key", &api_key)
            .header("User-Agent", user_agent())
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json::<CurseForgeApiResponse<Vec<CurseForgeFile>>>()
            .await?;

        for file in response.data {
            map.insert(file.id, file);
        }
    }

    Ok(map)
}

fn parse_manifest(archive_path: &Path) -> Result<CurseForgeManifest, Box<dyn Error + Send + Sync>> {
    let file = File::open(archive_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    let mut manifest_file = archive.by_name("manifest.json")?;
    let mut manifest_content = String::new();
    manifest_file.read_to_string(&mut manifest_content)?;
    Ok(serde_json::from_str::<CurseForgeManifest>(&manifest_content)?)
}

async fn download_with_progress(
    url: &str,
    destination: &Path,
    app_handle: Option<&AppHandle>,
    stage: Option<&str>,
    base_progress: f32,
    progress_span: f32,
) -> Result<u64, Box<dyn Error + Send + Sync>> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }

    let response = super::http_client()
        .get(url)
        .header("User-Agent", user_agent())
        .send()
        .await?
        .error_for_status()?;

    let total_size = response.content_length().unwrap_or(0);
    let mut out_file = File::create(destination)?;
    let mut downloaded: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut stream = response.bytes_stream();

    while let Some(item) = stream.next().await {
        let chunk = item?;
        out_file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;

        if let (Some(handle), Some(stage_name)) = (app_handle, stage) {
            if last_emit.elapsed().as_millis() > 100 || (total_size > 0 && downloaded == total_size) {
                let ratio = if total_size > 0 { (downloaded as f32 / total_size as f32).clamp(0.0, 1.0) } else { 0.0 };
                let _ = handle.emit("download-progress", DownloadProgress {
                    stage: stage_name.to_string(),
                    percentage: base_progress + (ratio * progress_span),
                    current: 5,
                    total: 100,
                    total_bytes: if total_size > 0 { Some(total_size) } else { None },
                    downloaded_bytes: Some(downloaded),
                });
                last_emit = std::time::Instant::now();
            }
        }
    }

    Ok(if downloaded > 0 { downloaded } else { total_size })
}

fn parse_loader_from_manifest(manifest: &CurseForgeManifest) -> (instances::ModLoader, Option<String>) {
    let preferred = manifest.minecraft.mod_loaders.iter().find(|loader| loader.primary)
        .or_else(|| manifest.minecraft.mod_loaders.first());

    let Some(loader) = preferred else {
        return (instances::ModLoader::Vanilla, None);
    };

    let id = loader.id.trim().to_ascii_lowercase();
    if let Some(version) = id.strip_prefix("fabric-") {
        return (instances::ModLoader::Fabric, Some(version.to_string()));
    }
    if let Some(version) = id.strip_prefix("forge-") {
        return (instances::ModLoader::Forge, Some(version.to_string()));
    }
    if let Some(version) = id.strip_prefix("neoforge-") {
        return (instances::ModLoader::NeoForge, Some(version.to_string()));
    }

    (instances::ModLoader::Vanilla, None)
}

async fn resolve_category_ids(
    requested_categories: &[String],
    class_id: u32,
) -> Result<Vec<u64>, Box<dyn Error + Send + Sync>> {
    let normalized_requested: Vec<String> = requested_categories
        .iter()
        .map(|c| c.trim().to_ascii_lowercase())
        .filter(|c| !c.is_empty() && c != "all")
        .collect();

    if normalized_requested.is_empty() {
        return Ok(Vec::new());
    }

    let api_key = curseforge_api_key()?;
    let response = super::http_client()
        .get(format!("{}/categories", CURSEFORGE_API_BASE))
        .header("x-api-key", api_key)
        .header("User-Agent", user_agent())
        .query(&[
            ("gameId", CURSEFORGE_MINECRAFT_GAME_ID.to_string()),
            ("classId", class_id.to_string()),
        ])
        .send()
        .await?
        .error_for_status()?
        .json::<CurseForgeApiResponse<Vec<CurseForgeCategoryLookup>>>()
        .await?;

    let mut category_ids = Vec::new();
    for requested in normalized_requested {
        let matched = response.data.iter().find(|item| {
            let name = item.name.trim().to_ascii_lowercase();
            let slug = item.slug.trim().to_ascii_lowercase();
            let compact_name = name.replace([' ', '/', '+'], "");
            let compact_req = requested.replace([' ', '/', '+'], "");
            requested == name || requested == slug || compact_req == compact_name
        });

        if let Some(category) = matched {
            category_ids.push(category.id);
        }
    }

    category_ids.sort_unstable();
    category_ids.dedup();
    Ok(category_ids)
}

pub async fn search_modpacks(
    query: &str,
    categories: Option<Vec<String>>,
    limit: u32,
    offset: u32,
) -> Result<CurseForgeSearchResult, Box<dyn Error + Send + Sync>> {
    search_projects("modpack", query, categories, limit, offset).await
}

fn forced_categories_for_project_type(project_type: &str) -> Vec<String> {
    match normalize_project_type(project_type).as_str() {
        "shader" => vec!["shaders".to_string()],
        "datapack" => vec!["data-packs".to_string(), "datapacks".to_string()],
        _ => Vec::new(),
    }
}

pub async fn search_projects(
    project_type: &str,
    query: &str,
    categories: Option<Vec<String>>,
    limit: u32,
    offset: u32,
) -> Result<CurseForgeSearchResult, Box<dyn Error + Send + Sync>> {
    let api_key = curseforge_api_key()?;
    let page_size = limit.clamp(1, 50);
    let trimmed_query = query.trim();
    let normalized_project_type = normalize_project_type(project_type);
    let candidate_classes = class_id_candidates_for_project_type(&normalized_project_type);
    let requested_categories = categories.unwrap_or_default();
    let forced_categories = forced_categories_for_project_type(&normalized_project_type);

    let mut last_error: Option<Box<dyn Error + Send + Sync>> = None;
    let mut fallback_result: Option<CurseForgeSearchResult> = None;

    for class_id in candidate_classes {
        let mut category_ids = match resolve_category_ids(&requested_categories, class_id).await {
            Ok(ids) => ids,
            Err(err) => {
                last_error = Some(err);
                continue;
            }
        };
        if !forced_categories.is_empty() {
            let forced_ids = match resolve_category_ids(&forced_categories, class_id).await {
                Ok(ids) => ids,
                Err(err) => {
                    last_error = Some(err);
                    continue;
                }
            };
            for cat_id in forced_ids {
                if !category_ids.contains(&cat_id) {
                    category_ids.push(cat_id);
                }
            }
        }

        let mut request = super::http_client()
            .get(format!("{}/mods/search", CURSEFORGE_API_BASE))
            .header("x-api-key", &api_key)
            .header("User-Agent", user_agent())
            .query(&[
                ("gameId", CURSEFORGE_MINECRAFT_GAME_ID.to_string()),
                ("classId", class_id.to_string()),
                ("pageSize", page_size.to_string()),
                ("index", offset.to_string()),
                ("sortField", CURSEFORGE_SORT_FIELD_TOTAL_DOWNLOADS.to_string()),
                ("sortOrder", "desc".to_string()),
            ]);

        if !trimmed_query.is_empty() {
            request = request.query(&[("searchFilter", trimmed_query.to_string())]);
        }

        if !category_ids.is_empty() {
            let ids_json = format!(
                "[{}]",
                category_ids
                    .iter()
                    .map(|id| id.to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            );
            request = request.query(&[("categoryIds", ids_json)]);
        }

        let response = match request.send().await {
            Ok(value) => value,
            Err(err) => {
                last_error = Some(Box::new(err));
                continue;
            }
        };

        let response = match response.error_for_status() {
            Ok(value) => value,
            Err(err) => {
                last_error = Some(Box::new(err));
                continue;
            }
        };

        match response.json::<CurseForgeSearchApiResponse>().await {
            Ok(response) => {
                let hits = response
                    .data
                    .into_iter()
                    .map(|project| to_modpack_summary(project, None, Some(&normalized_project_type)))
                    .collect::<Vec<_>>();

                let result = CurseForgeSearchResult {
                    hits,
                    offset: response.pagination.index,
                    limit: response.pagination.page_size,
                    total_hits: response.pagination.total_count,
                };

                if !result.hits.is_empty() {
                    return Ok(result);
                }

                if fallback_result.is_none() {
                    fallback_result = Some(result);
                }
            }
            Err(err) => {
                last_error = Some(Box::new(err));
            }
        }
    }

    if let Some(result) = fallback_result {
        return Ok(result);
    }

    if let Some(error) = last_error {
        return Err(error);
    }

    Ok(CurseForgeSearchResult {
        hits: Vec::new(),
        offset,
        limit: page_size,
        total_hits: 0,
    })
}

pub async fn get_modpack(
    project_id: &str,
) -> Result<CurseForgeModpack, Box<dyn Error + Send + Sync>> {
    let mod_id = parse_u64_id(project_id, "project_id")?;
    let api_key = curseforge_api_key()?;
    let project_response = super::http_client()
        .get(format!("{}/mods/{}", CURSEFORGE_API_BASE, mod_id))
        .header("x-api-key", &api_key)
        .header("User-Agent", user_agent())
        .send()
        .await?
        .error_for_status()?
        .json::<CurseForgeApiResponse<CurseForgeProject>>()
        .await?;

    let description_response = super::http_client()
        .get(format!("{}/mods/{}/description", CURSEFORGE_API_BASE, mod_id))
        .header("x-api-key", &api_key)
        .header("User-Agent", user_agent())
        .send()
        .await?
        .error_for_status()?
        .json::<CurseForgeStringResponse>()
        .await;

    let description_html = description_response
        .map(|payload| payload.data)
        .unwrap_or_default();

    Ok(to_modpack_summary(project_response.data, Some(description_html), None))
}

pub async fn get_modpack_versions(
    project_id: &str,
) -> Result<Vec<CurseForgeModpackVersion>, Box<dyn Error + Send + Sync>> {
    let mod_id = parse_u64_id(project_id, "project_id")?;
    let api_key = curseforge_api_key()?;
    let mut versions = Vec::new();
    let mut index: u32 = 0;

    loop {
        let response = super::http_client()
            .get(format!("{}/mods/{}/files", CURSEFORGE_API_BASE, mod_id))
            .header("x-api-key", &api_key)
            .header("User-Agent", user_agent())
            .query(&[("pageSize", "50".to_string()), ("index", index.to_string())])
            .send()
            .await?
            .error_for_status()?
            .json::<CurseForgeFilesApiResponse>()
            .await?;

        let files = response.data;
        let page_count = if response.pagination.result_count > 0 {
            response.pagination.result_count
        } else {
            files.len() as u32
        };

        for file in files {
            versions.push(to_modpack_version(mod_id, file));
        }

        if page_count == 0 {
            break;
        }
        index = index.saturating_add(page_count);
        if index >= response.pagination.total_count {
            break;
        }
    }

    versions.sort_by(|a, b| b.date_published.cmp(&a.date_published));
    Ok(versions)
}

pub async fn get_modpack_total_size(
    project_id: &str,
    file_id: &str,
) -> Result<u64, Box<dyn Error + Send + Sync>> {
    let mod_id = parse_u64_id(project_id, "project_id")?;
    let pack_file_id = parse_u64_id(file_id, "file_id")?;
    let mut file = get_modpack_file_detail(mod_id, pack_file_id).await?;
    file.download_url = Some(resolve_file_download_url(mod_id, pack_file_id, file.download_url.take()).await?);

    let temp_dir = std::env::temp_dir().join("palethea_curseforge_size_check");
    let _ = fs::create_dir_all(&temp_dir);
    let archive_path = temp_dir.join(format!("{}.zip", pack_file_id));

    let download_url = file.download_url
        .as_deref()
        .ok_or_else(|| "CurseForge file has no download URL".to_string())?;

    let _ = download_with_progress(download_url, &archive_path, None, None, 0.0, 0.0).await?;
    let manifest = parse_manifest(&archive_path)?;

    let required_ids: Vec<u64> = manifest.files.into_iter()
        .filter(|entry| entry.required)
        .map(|entry| entry.file_id)
        .collect();

    let file_map = get_files_bulk(&required_ids).await?;
    let total_size: u64 = required_ids.iter()
        .filter_map(|id| file_map.get(id))
        .map(|f| f.file_length)
        .sum();

    let _ = fs::remove_file(&archive_path);
    let _ = fs::remove_dir_all(&temp_dir);

    Ok(total_size)
}

pub async fn install_modpack(
    app_handle: &AppHandle,
    instance_id: &str,
    project_id: &str,
    file_id: &str,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let mod_id = parse_u64_id(project_id, "project_id")?;
    let pack_file_id = parse_u64_id(file_id, "file_id")?;

    let _ = app_handle.emit("download-progress", DownloadProgress {
        stage: "Fetching CurseForge modpack info...".to_string(),
        percentage: 0.0,
        current: 0,
        total: 100,
        total_bytes: None,
        downloaded_bytes: None,
    });

    let mut modpack_file = get_modpack_file_detail(mod_id, pack_file_id).await?;
    modpack_file.download_url = Some(resolve_file_download_url(mod_id, pack_file_id, modpack_file.download_url.take()).await?);

    let pack_download_url = modpack_file.download_url
        .as_deref()
        .ok_or_else(|| "CurseForge modpack file has no download URL".to_string())?
        .to_string();

    let temp_dir = std::env::temp_dir().join("palethea_curseforge_modpack");
    let _ = fs::create_dir_all(&temp_dir);
    let archive_path = temp_dir.join("modpack.zip");

    let _ = app_handle.emit("download-progress", DownloadProgress {
        stage: format!("Downloading modpack file: {}...", modpack_file.file_name),
        percentage: 10.0,
        current: 5,
        total: 100,
        total_bytes: Some(modpack_file.file_length),
        downloaded_bytes: Some(0),
    });

    let _ = download_with_progress(
        &pack_download_url,
        &archive_path,
        Some(app_handle),
        Some(&format!("Downloading modpack file: {}...", modpack_file.file_name)),
        10.0,
        10.0,
    ).await?;

    let _ = app_handle.emit("download-progress", DownloadProgress {
        stage: "Extracting modpack...".to_string(),
        percentage: 22.0,
        current: 10,
        total: 100,
        total_bytes: None,
        downloaded_bytes: None,
    });

    let manifest = parse_manifest(&archive_path)?;
    let required_entries: Vec<CurseForgeManifestFile> = manifest
        .files
        .iter()
        .filter(|entry| entry.required)
        .cloned()
        .collect();
    let required_file_ids: Vec<u64> = required_entries.iter().map(|f| f.file_id).collect();
    let file_map = get_files_bulk(&required_file_ids).await?;
    let total_mods_size: u64 = required_file_ids
        .iter()
        .filter_map(|id| file_map.get(id))
        .map(|f| f.file_length)
        .sum();

    let (mod_loader, loader_version) = parse_loader_from_manifest(&manifest);

    let mut instance = instances::get_instance(instance_id)?;
    instance.version_id = manifest.minecraft.version.clone();
    instance.mod_loader = mod_loader.clone();
    instance.mod_loader_version = loader_version.clone();
    instances::update_instance(instance.clone())?;

    if mod_loader != instances::ModLoader::Vanilla {
        if let Some(loader_ver) = &loader_version {
            let _ = app_handle.emit("download-progress", DownloadProgress {
                stage: format!("Installing {} Loader...", mod_loader),
                percentage: 25.0,
                current: 15,
                total: 100,
                total_bytes: None,
                downloaded_bytes: None,
            });

            match mod_loader {
                instances::ModLoader::Fabric => {
                    if let Err(e) = fabric::install_fabric(&instance, loader_ver).await {
                        crate::log_error!(app_handle, "Failed to install Fabric loader: {}", e);
                    }
                }
                instances::ModLoader::Forge => {
                    if let Err(e) = forge::install_forge(&instance, loader_ver).await {
                        crate::log_error!(app_handle, "Failed to install Forge loader: {}", e);
                    }
                }
                instances::ModLoader::NeoForge => {
                    if let Err(e) = forge::install_neoforge(&instance, loader_ver).await {
                        crate::log_error!(app_handle, "Failed to install NeoForge loader: {}", e);
                    }
                }
                instances::ModLoader::Vanilla => {}
            }
        }
    }

    let total_files = required_entries.len();
    let downloaded_bytes_counter = Arc::new(AtomicU64::new(0));
    let completed_count = Arc::new(AtomicU32::new(0));
    let last_progress_emit_ms = Arc::new(AtomicU64::new(0));
    let downloaded_meta = Arc::new(Mutex::new(Vec::<DownloadedCurseForgeModMeta>::new()));
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

    stream::iter(required_entries.into_iter())
        .for_each_concurrent(12, |entry| {
            let app_handle = app_handle.clone();
            let downloaded_bytes_counter = downloaded_bytes_counter.clone();
            let completed_count = completed_count.clone();
            let last_progress_emit_ms = last_progress_emit_ms.clone();
            let downloaded_meta = downloaded_meta.clone();
            let game_dir = game_dir.clone();
            let client = client.clone();
            let file_map = file_map.clone();

            async move {
                let details = match file_map.get(&entry.file_id) {
                    Some(details) => details.clone(),
                    None => {
                        crate::log_warn!(&app_handle, "Missing CurseForge file metadata for fileID={}", entry.file_id);
                        completed_count.fetch_add(1, Ordering::SeqCst);
                        return;
                    }
                };

                let download_url = match resolve_file_download_url(
                    entry.project_id,
                    entry.file_id,
                    details.download_url.clone(),
                )
                .await
                {
                    Ok(url) => url,
                    Err(_) => {
                        crate::log_warn!(&app_handle, "No download URL for CurseForge file {} (project {})", entry.file_id, entry.project_id);
                        completed_count.fetch_add(1, Ordering::SeqCst);
                        return;
                    }
                };

                let dest = game_dir.join("mods").join(&details.file_name);
                if let Some(parent) = dest.parent() {
                    let _ = fs::create_dir_all(parent);
                }

                let response = match client.get(&download_url).header("User-Agent", user_agent()).send().await {
                    Ok(resp) => match resp.error_for_status() {
                        Ok(ok) => ok,
                        Err(_) => {
                            completed_count.fetch_add(1, Ordering::SeqCst);
                            return;
                        }
                    },
                    Err(_) => {
                        completed_count.fetch_add(1, Ordering::SeqCst);
                        return;
                    }
                };

                let mut file = match File::create(&dest) {
                    Ok(file) => file,
                    Err(_) => {
                        completed_count.fetch_add(1, Ordering::SeqCst);
                        return;
                    }
                };

                let mut stream = response.bytes_stream();
                let mut downloaded_for_this = 0u64;
                let mut ok = true;

                while let Some(item) = stream.next().await {
                    match item {
                        Ok(chunk) => {
                            if file.write_all(&chunk).is_err() {
                                ok = false;
                                break;
                            }

                            let len = chunk.len() as u64;
                            downloaded_for_this += len;
                            let total_downloaded = downloaded_bytes_counter.fetch_add(len, Ordering::SeqCst) + len;

                            let now_ms = SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .map(|d| d.as_millis() as u64)
                                .unwrap_or(0);
                            let last_ms = last_progress_emit_ms.load(Ordering::Relaxed);

                            if now_ms.saturating_sub(last_ms) >= 120
                                && last_progress_emit_ms.compare_exchange(last_ms, now_ms, Ordering::SeqCst, Ordering::Relaxed).is_ok()
                            {
                                let completed_so_far = completed_count.load(Ordering::SeqCst);
                                let ratio = if total_mods_size > 0 {
                                    (total_downloaded as f32 / total_mods_size as f32).clamp(0.0, 1.0)
                                } else if total_files > 0 {
                                    (completed_so_far as f32 / total_files as f32).clamp(0.0, 1.0)
                                } else {
                                    1.0
                                };

                                let _ = app_handle.emit("download-progress", DownloadProgress {
                                    stage: format!("Downloading mods {}/{}...", completed_so_far, total_files),
                                    percentage: 30.0 + (ratio * 60.0),
                                    current: completed_so_far,
                                    total: total_files as u32,
                                    total_bytes: Some(total_mods_size),
                                    downloaded_bytes: Some(total_downloaded),
                                });
                            }
                        }
                        Err(_) => {
                            ok = false;
                            break;
                        }
                    }
                }

                if !ok {
                    if downloaded_for_this > 0 {
                        downloaded_bytes_counter.fetch_sub(downloaded_for_this, Ordering::SeqCst);
                    }
                    let _ = fs::remove_file(&dest);
                } else if let Ok(mut meta) = downloaded_meta.lock() {
                    meta.push(DownloadedCurseForgeModMeta {
                        dest,
                        project_id: entry.project_id,
                        file_id: entry.file_id,
                        version_name: if details.display_name.is_empty() { details.file_name } else { details.display_name },
                    });
                }

                let completed = completed_count.fetch_add(1, Ordering::SeqCst) + 1;
                let total_downloaded = downloaded_bytes_counter.load(Ordering::SeqCst);
                let ratio = if total_mods_size > 0 {
                    (total_downloaded as f32 / total_mods_size as f32).clamp(0.0, 1.0)
                } else if total_files > 0 {
                    (completed as f32 / total_files as f32).clamp(0.0, 1.0)
                } else {
                    1.0
                };

                let _ = app_handle.emit("download-progress", DownloadProgress {
                    stage: format!("Downloading mods {}/{}...", completed, total_files),
                    percentage: 30.0 + (ratio * 60.0),
                    current: completed,
                    total: total_files as u32,
                    total_bytes: Some(total_mods_size),
                    downloaded_bytes: Some(total_downloaded),
                });
            }
        })
        .await;

    let downloaded_meta_entries = downloaded_meta.lock().map(|m| m.clone()).unwrap_or_default();
    if !downloaded_meta_entries.is_empty() {
        let _ = app_handle.emit("download-progress", DownloadProgress {
            stage: "Fetching mod metadata...".to_string(),
            percentage: 95.0,
            current: total_files as u32,
            total: total_files as u32,
            total_bytes: Some(total_mods_size),
            downloaded_bytes: Some(total_mods_size),
        });

        let project_ids: Vec<u64> = downloaded_meta_entries.iter().map(|m| m.project_id).collect();
        let projects = get_mods_bulk(&project_ids).await.unwrap_or_default();

        for entry in downloaded_meta_entries {
            let project = projects.get(&entry.project_id);
            let author = project.and_then(|p| p.authors.first()).map(|a| a.name.clone());
            let icon_url = project.and_then(|p| p.logo.as_ref()).and_then(|logo| logo.thumbnail_url.clone());
            let categories = project.map(|p| {
                p.categories.iter().map(|c| {
                    if c.slug.trim().is_empty() { c.name.clone() } else { c.slug.clone() }
                }).filter(|c| !c.trim().is_empty()).collect::<Vec<_>>()
            });

            let meta = crate::minecraft::files::ModMeta {
                project_id: entry.project_id.to_string(),
                version_id: Some(entry.file_id.to_string()),
                name: project.map(|p| p.name.clone()),
                author,
                icon_url,
                version_name: Some(entry.version_name.clone()),
                categories,
            };

            let _ = crate::minecraft::files::write_meta_for_file(&entry.dest, &meta);
        }
    }

    let overrides_dir = manifest.overrides.as_deref().filter(|value| !value.trim().is_empty()).unwrap_or("overrides").to_string();

    let _ = app_handle.emit("download-progress", DownloadProgress {
        stage: "Applying overrides...".to_string(),
        percentage: 97.0,
        current: 97,
        total: 100,
        total_bytes: None,
        downloaded_bytes: None,
    });

    {
        let file = File::open(&archive_path)?;
        let mut archive = zip::ZipArchive::new(file)?;

        for i in 0..archive.len() {
            let mut zipped = archive.by_index(i)?;
            let name = zipped.name().to_string();

            let target_rel = if let Some(stripped) = name.strip_prefix(&format!("{}/", overrides_dir)) {
                Some(stripped.to_string())
            } else if let Some(stripped) = name.strip_prefix("client-overrides/") {
                Some(stripped.to_string())
            } else {
                None
            };

            let Some(rel_path) = target_rel else { continue; };
            if rel_path.is_empty() { continue; }

            let dest = instance.get_game_directory().join(rel_path);
            if zipped.is_dir() {
                let _ = fs::create_dir_all(dest);
            } else {
                if let Some(parent) = dest.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                if let Ok(mut out) = File::create(dest) {
                    let _ = std::io::copy(&mut zipped, &mut out);
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

    let _ = fs::remove_file(&archive_path);
    let _ = fs::remove_dir_all(&temp_dir);
    Ok(())
}
