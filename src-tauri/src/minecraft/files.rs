use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use base64::{Engine as _, engine::general_purpose};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::io::Write;

use crate::minecraft::instances::Instance;

fn provider_from_project_id(project_id: &str) -> String {
    if !project_id.is_empty() && project_id.chars().all(|c| c.is_ascii_digit()) {
        "CurseForge".to_string()
    } else {
        "Modrinth".to_string()
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InstalledMod {
    pub filename: String,
    pub name: Option<String>,
    pub author: Option<String>,
    pub version: Option<String>,
    pub enabled: bool,
    pub project_id: Option<String>,
    #[serde(default)]
    pub version_id: Option<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub provider: String, // "Modrinth", "Manual", etc.
    // ----------
    // Categories
    // Description: Modrinth category tags for filtering
    // ----------
    #[serde(default)]
    pub categories: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModMeta {
    pub project_id: String,
    #[serde(default)]
    pub version_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub version_name: Option<String>,
    // ----------
    // Categories
    // Description: Stores Modrinth category tags for filtering installed items
    // ----------
    #[serde(default)]
    pub categories: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResourcePack {
    pub filename: String,
    pub name: Option<String>,
    pub author: Option<String>,
    pub version: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub version_id: Option<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub provider: String,
    // ----------
    // Categories
    // Description: Modrinth category tags for filtering
    // ----------
    #[serde(default)]
    pub categories: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShaderPack {
    pub filename: String,
    pub name: Option<String>,
    pub author: Option<String>,
    pub version: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub version_id: Option<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub provider: String,
    // ----------
    // Categories
    // Description: Modrinth category tags for filtering
    // ----------
    #[serde(default)]
    pub categories: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Datapack {
    pub filename: String,
    pub name: Option<String>,
    pub author: Option<String>,
    pub version: Option<String>,
    pub enabled: bool,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub version_id: Option<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub provider: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct World {
    pub folder_name: String,
    pub name: String,
    pub last_played: Option<i64>,
    pub game_mode: Option<i32>,
    pub icon: Option<String>,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Server {
    pub name: String,
    pub ip: String,
    pub icon: Option<String>,
    #[serde(default)]
    pub accept_textures: i8, // 0: prompt, 1: enabled, 2: disabled
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Screenshot {
    pub filename: String,
    pub path: String,
    pub date: Option<String>,
}

/// Get mods directory for an instance
pub fn get_mods_dir(instance: &Instance) -> PathBuf {
    instance.get_game_directory().join("mods")
}

/// Get resource packs directory for an instance
pub fn get_resourcepacks_dir(instance: &Instance) -> PathBuf {
    instance.get_game_directory().join("resourcepacks")
}

/// Get shader packs directory for an instance
pub fn get_shaderpacks_dir(instance: &Instance) -> PathBuf {
    instance.get_game_directory().join("shaderpacks")
}

/// Get saves directory for an instance
pub fn get_saves_dir(instance: &Instance) -> PathBuf {
    instance.get_game_directory().join("saves")
}

/// Get screenshots directory for an instance
pub fn get_screenshots_dir(instance: &Instance) -> PathBuf {
    instance.get_game_directory().join("screenshots")
}

/// Get logs directory for an instance
pub fn get_logs_dir(instance: &Instance) -> PathBuf {
    instance.get_game_directory().join("logs")
}

pub fn metadata_dir(parent_dir: &Path) -> PathBuf {
    parent_dir.join("metadata")
}

pub fn metadata_path(parent_dir: &Path, filename: &str) -> PathBuf {
    metadata_dir(parent_dir).join(format!("{}.meta.json", filename))
}

fn legacy_metadata_path(parent_dir: &Path, filename: &str) -> PathBuf {
    parent_dir.join(format!("{}.meta.json", filename))
}

pub fn write_meta_for_entry(parent_dir: &Path, filename: &str, meta: &ModMeta) -> Result<(), String> {
    let meta_path = metadata_path(parent_dir, filename);
    if let Some(meta_dir) = meta_path.parent() {
        fs::create_dir_all(meta_dir).map_err(|e| format!("Failed to create metadata directory: {}", e))?;
    }

    let json = serde_json::to_string(meta)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
    fs::write(&meta_path, json).map_err(|e| format!("Failed to write metadata: {}", e))?;

    let legacy_path = legacy_metadata_path(parent_dir, filename);
    if legacy_path.exists() {
        let _ = fs::remove_file(legacy_path);
    }

    Ok(())
}

pub fn write_meta_for_file(file_path: &Path, meta: &ModMeta) -> Result<(), String> {
    let parent_dir = file_path.parent()
        .ok_or_else(|| "Invalid destination path for metadata".to_string())?;
    let filename = file_path.file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid destination filename for metadata".to_string())?;

    write_meta_for_entry(parent_dir, filename, meta)
}

fn try_read_meta_file(path: &Path) -> Option<ModMeta> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<ModMeta>(&content).ok()
}

fn migrate_legacy_metadata_if_needed(parent_dir: &Path, filename: &str) {
    let new_path = metadata_path(parent_dir, filename);
    if new_path.exists() {
        return;
    }

    let legacy_path = legacy_metadata_path(parent_dir, filename);
    if !legacy_path.exists() {
        return;
    }

    if let Some(meta_dir) = new_path.parent() {
        if fs::create_dir_all(meta_dir).is_err() {
            return;
        }
    }

    if fs::rename(&legacy_path, &new_path).is_err() {
        if fs::copy(&legacy_path, &new_path).is_ok() {
            let _ = fs::remove_file(&legacy_path);
        }
    }
}

fn migrate_all_legacy_metadata(parent_dir: &Path) {
    let entries = match fs::read_dir(parent_dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    let meta_dir = metadata_dir(parent_dir);
    let mut ensured_meta_dir = false;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let filename = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name,
            None => continue,
        };

        if !filename.ends_with(".meta.json") {
            continue;
        }

        if !ensured_meta_dir {
            if fs::create_dir_all(&meta_dir).is_err() {
                return;
            }
            ensured_meta_dir = true;
        }

        let target = meta_dir.join(filename);
        if target.exists() {
            let _ = fs::remove_file(&path);
            continue;
        }

        if fs::rename(&path, &target).is_err() {
            if fs::copy(&path, &target).is_ok() {
                let _ = fs::remove_file(&path);
            }
        }
    }
}

fn read_meta_for_entry(parent_dir: &Path, filename: &str) -> Option<ModMeta> {
    migrate_legacy_metadata_if_needed(parent_dir, filename);

    let new_path = metadata_path(parent_dir, filename);
    if let Some(meta) = try_read_meta_file(&new_path) {
        return Some(meta);
    }

    let legacy_path = legacy_metadata_path(parent_dir, filename);
    try_read_meta_file(&legacy_path)
}

fn delete_meta_for_entry(parent_dir: &Path, filename: &str) {
    let new_path = metadata_path(parent_dir, filename);
    if new_path.exists() {
        let _ = fs::remove_file(new_path);
    }

    let legacy_path = legacy_metadata_path(parent_dir, filename);
    if legacy_path.exists() {
        let _ = fs::remove_file(legacy_path);
    }
}

fn should_skip_pack_entry(path: &Path, filename: &str) -> bool {
    if path.is_dir() && filename == "metadata" {
        return true;
    }

    // Prism/packwiz index artifacts (e.g. ".index", ".index.zip") should never be shown as packs.
    if filename.starts_with('.') {
        return true;
    }

    false
}

/// List installed mods
pub fn list_mods(instance: &Instance) -> Vec<InstalledMod> {
    let mods_dir = get_mods_dir(instance);
    let mut mods = Vec::new();
    
    if !mods_dir.exists() {
        return mods;
    }

    migrate_all_legacy_metadata(&mods_dir);
    
    if let Ok(entries) = fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let filename = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            
            if filename.ends_with(".jar") || filename.ends_with(".jar.disabled") {
                let enabled = !filename.ends_with(".disabled");
                let metadata = fs::metadata(&path).ok();
                let size = metadata.map(|m| m.len()).unwrap_or(0);
                
                // Try to read project_id and version_id from metadata file
                let base_filename = filename.trim_end_matches(".disabled");
                let mut project_id = None;
                let mut version_id = None;
                let mut name = Some(filename.trim_end_matches(".disabled").trim_end_matches(".jar").to_string());
                let mut author: Option<String> = None;
                let mut icon_url = None;
                let mut version = None;
                let mut provider = "Manual".to_string();
                let mut categories = None;
                
                if let Some(m) = read_meta_for_entry(&mods_dir, base_filename) {
                    project_id = Some(m.project_id.clone());
                    version_id = m.version_id;
                    if let Some(n) = m.name { name = Some(n); }
                    author = m.author;
                    icon_url = m.icon_url;
                    version = m.version_name;
                    categories = m.categories;
                    provider = provider_from_project_id(&m.project_id);
                }
                
                mods.push(InstalledMod {
                    filename: filename.clone(),
                    name,
                    author,
                    version,
                    enabled,
                    project_id,
                    version_id,
                    icon_url,
                    size,
                    provider,
                    categories,
                });
            }
        }
    }
    
    mods.sort_by(|a, b| a.filename.to_lowercase().cmp(&b.filename.to_lowercase()));
    mods
}

/// Toggle mod enabled/disabled
pub fn toggle_mod(instance: &Instance, filename: &str) -> Result<bool, String> {
    let mods_dir = get_mods_dir(instance);
    let current_path = mods_dir.join(filename);
    
    if !current_path.exists() {
        return Err("Mod file not found".to_string());
    }
    
    let new_path = if filename.ends_with(".disabled") {
        mods_dir.join(filename.trim_end_matches(".disabled"))
    } else {
        mods_dir.join(format!("{}.disabled", filename))
    };
    
    fs::rename(&current_path, &new_path).map_err(|e| e.to_string())?;
    
    Ok(!filename.ends_with(".disabled"))
}

/// Delete a mod
pub fn delete_mod(instance: &Instance, filename: &str) -> Result<(), String> {
    let mods_dir = get_mods_dir(instance);
    let path = mods_dir.join(filename);
    
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }

    // Also delete metadata if it exists
    let base_filename = filename.trim_end_matches(".disabled");
    delete_meta_for_entry(&mods_dir, base_filename);
    
    Ok(())
}

/// List resource packs
pub fn list_resourcepacks(instance: &Instance) -> Vec<ResourcePack> {
    let dir = get_resourcepacks_dir(instance);
    let mut packs = Vec::new();
    
    if !dir.exists() {
        return packs;
    }

    migrate_all_legacy_metadata(&dir);
    
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let filename = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            if should_skip_pack_entry(&path, &filename) {
                continue;
            }
            
            if filename.ends_with(".zip") || path.is_dir() {
                let metadata = fs::metadata(&path).ok();
                let size = metadata.map(|m| m.len()).unwrap_or(0);

                // Try to read metadata
                let mut project_id = None;
                let mut version_id = None;
                let mut icon_url = None;
                let mut author: Option<String> = None;
                let mut version = None;
                let mut name = Some(filename.trim_end_matches(".zip").to_string());
                let mut provider = "Manual".to_string();
                let mut categories: Option<Vec<String>> = None;
                
                if let Some(m) = read_meta_for_entry(&dir, &filename) {
                    project_id = Some(m.project_id.clone());
                    version_id = m.version_id;
                    if let Some(n) = m.name { name = Some(n); }
                    author = m.author;
                    icon_url = m.icon_url;
                    version = m.version_name;
                    categories = m.categories;
                    provider = provider_from_project_id(&m.project_id);
                }

                packs.push(ResourcePack {
                    filename: filename.clone(),
                    name,
                    author,
                    version,
                    project_id,
                    version_id,
                    icon_url,
                    size,
                    provider,
                    categories,
                });
            }
        }
    }
    
    packs
}

/// Delete a resource pack
pub fn delete_resourcepack(instance: &Instance, filename: &str) -> Result<(), String> {
    let dir = get_resourcepacks_dir(instance);
    let path = dir.join(filename);
    
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    } else if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }

    // Also delete metadata
    delete_meta_for_entry(&dir, filename);
    
    Ok(())
}

/// List shader packs
pub fn list_shaderpacks(instance: &Instance) -> Vec<ShaderPack> {
    let dir = get_shaderpacks_dir(instance);
    let mut packs = Vec::new();
    
    if !dir.exists() {
        return packs;
    }

    migrate_all_legacy_metadata(&dir);
    
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let filename = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            if should_skip_pack_entry(&path, &filename) {
                continue;
            }
            
            if filename.ends_with(".zip") || path.is_dir() {
                let metadata = fs::metadata(&path).ok();
                let size = metadata.map(|m| m.len()).unwrap_or(0);

                // Try to read metadata
                let mut project_id = None;
                let mut version_id = None;
                let mut icon_url = None;
                let mut author: Option<String> = None;
                let mut version = None;
                let mut name = Some(filename.trim_end_matches(".zip").to_string());
                let mut provider = "Manual".to_string();
                let mut categories: Option<Vec<String>> = None;
                
                if let Some(m) = read_meta_for_entry(&dir, &filename) {
                    project_id = Some(m.project_id.clone());
                    version_id = m.version_id;
                    if let Some(n) = m.name { name = Some(n); }
                    author = m.author;
                    icon_url = m.icon_url;
                    version = m.version_name;
                    categories = m.categories;
                    provider = provider_from_project_id(&m.project_id);
                }

                packs.push(ShaderPack {
                    filename: filename.clone(),
                    name,
                    author,
                    version,
                    project_id,
                    version_id,
                    icon_url,
                    size,
                    provider,
                    categories,
                });
            }
        }
    }
    
    packs
}

/// Delete a shader pack
pub fn delete_shaderpack(instance: &Instance, filename: &str) -> Result<(), String> {
    let dir = get_shaderpacks_dir(instance);
    let path = dir.join(filename);
    
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    } else if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }

    // Also delete metadata
    delete_meta_for_entry(&dir, filename);
    
    Ok(())
}

/// List worlds
pub fn list_worlds(instance: &Instance) -> Vec<World> {
    let saves_dir = get_saves_dir(instance);
    let mut worlds = Vec::new();
    
    if !saves_dir.exists() {
        return worlds;
    }
    
    if let Ok(entries) = fs::read_dir(&saves_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            
            let folder_name = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            
            let level_dat = path.join("level.dat");
            if level_dat.exists() {
                let mut world_name = folder_name.clone();
                let mut last_played = None;
                let mut game_mode = None;
                let mut icon = None;
                
                // Try to parse level.dat for actual world name and meta
                if let Ok(data) = fs::read(&level_dat) {
                    // level.dat is Gzip-compressed NBT
                    let mut decoder = GzDecoder::new(&data[..]);
                    let mut decoded = Vec::new();
                    if decoder.read_to_end(&mut decoded).is_ok() {
                        if let Ok(nbt) = fastnbt::from_bytes::<LevelDatNbt>(&decoded) {
                            if let Some(data_tag) = nbt.data {
                                if let Some(level_name) = data_tag.level_name {
                                    world_name = level_name;
                                }
                                last_played = data_tag.last_played;
                                game_mode = data_tag.game_type;
                            }
                        }
                    } else {
                        // If not gzipped (rare but possible in some formats/backups), try raw
                        if let Ok(nbt) = fastnbt::from_bytes::<LevelDatNbt>(&data) {
                            if let Some(data_tag) = nbt.data {
                                if let Some(level_name) = data_tag.level_name {
                                    world_name = level_name;
                                }
                                last_played = data_tag.last_played;
                                game_mode = data_tag.game_type;
                            }
                        }
                    }
                }

                // Check for icon
                let icon_path = path.join("icon.png");
                if icon_path.exists() {
                    if let Ok(icon_data) = fs::read(icon_path) {
                        icon = Some(general_purpose::STANDARD.encode(icon_data));
                    }
                }

                // Calculate size
                let size = get_dir_size(&path).unwrap_or(0);
                
                worlds.push(World {
                    folder_name: folder_name.clone(),
                    name: world_name,
                    last_played,
                    game_mode,
                    icon,
                    size,
                });
            }
        }
    }
    
    worlds
}

#[derive(Debug, Deserialize)]
struct LevelDatNbt {
    #[serde(rename = "Data")]
    data: Option<LevelDataTag>,
}

#[derive(Debug, Deserialize)]
struct LevelDataTag {
    #[serde(rename = "LevelName")]
    level_name: Option<String>,
    #[serde(rename = "LastPlayed")]
    last_played: Option<i64>,
    #[serde(rename = "GameType")]
    game_type: Option<i32>,
}

fn get_dir_size(path: &Path) -> std::io::Result<u64> {
    let mut size = 0;
    if path.is_dir() {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                size += get_dir_size(&path)?;
            } else {
                size += fs::metadata(path)?.len();
            }
        }
    }
    Ok(size)
}

/// Delete a world
pub fn delete_world(instance: &Instance, folder_name: &str) -> Result<(), String> {
    let saves_dir = get_saves_dir(instance);
    let path = saves_dir.join(folder_name);
    
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

/// Rename a world folder
pub fn rename_world(instance: &Instance, old_name: &str, new_name: &str) -> Result<(), String> {
    let saves_dir = get_saves_dir(instance);
    let old_path = saves_dir.join(old_name);
    let new_path = saves_dir.join(new_name);
    
    if !old_path.exists() {
        return Err("World folder not found".to_string());
    }
    
    if new_path.exists() {
        return Err("A world with that folder name already exists".to_string());
    }
    
    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())?;
    
    // Also try to update level.dat internal name
    let _ = update_world_level_name(&new_path, new_name);
    
    Ok(())
}

/// Update world's internal name in level.dat
pub fn update_world_level_name(world_path: &Path, new_name: &str) -> Result<(), String> {
    let level_dat = world_path.join("level.dat");
    if !level_dat.exists() {
        return Ok(());
    }

    let data = fs::read(&level_dat).map_err(|e| e.to_string())?;
    
    // Try to decode
    let mut decoder = GzDecoder::new(&data[..]);
    let mut decoded = Vec::new();
    if decoder.read_to_end(&mut decoded).is_err() {
        // If not gzipped, try raw
        decoded = data;
    }

    let mut nbt: fastnbt::Value = fastnbt::from_bytes(&decoded).map_err(|e| e.to_string())?;

    // NBT structure: Root Compound -> "Data" Compound -> "LevelName" String
    if let fastnbt::Value::Compound(root) = &mut nbt {
        if let Some(fastnbt::Value::Compound(data_tag)) = root.get_mut("Data") {
            data_tag.insert("LevelName".to_string(), fastnbt::Value::String(new_name.to_string()));
        } else if let Some(fastnbt::Value::Compound(data_tag)) = root.get_mut("") {
            // Some versions/parsers might have an empty string root
             if let Some(fastnbt::Value::Compound(inner_data)) = data_tag.get_mut("Data") {
                inner_data.insert("LevelName".to_string(), fastnbt::Value::String(new_name.to_string()));
             }
        }
    }

    let new_nbt_bytes = fastnbt::to_bytes(&nbt).map_err(|e| e.to_string())?;

    // Re-compress
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&new_nbt_bytes).map_err(|e| e.to_string())?;
    let compressed = encoder.finish().map_err(|e| e.to_string())?;

    fs::write(level_dat, compressed).map_err(|e| e.to_string())?;

    Ok(())
}

/// List datapacks for a world
pub fn list_datapacks(instance: &Instance, world_name: &str) -> Vec<Datapack> {
    let datapacks_dir = get_saves_dir(instance).join(world_name).join("datapacks");
    let mut datapacks = Vec::new();
    
    if !datapacks_dir.exists() {
        return datapacks;
    }

    migrate_all_legacy_metadata(&datapacks_dir);
    
    if let Ok(entries) = fs::read_dir(&datapacks_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let filename = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            if should_skip_pack_entry(&path, &filename) {
                continue;
            }
            
            // Allow .zip, .jar (some hybrid datapacks), and directories
            if filename.ends_with(".zip") || filename.ends_with(".jar") || path.is_dir() {
                let metadata = fs::metadata(&path).ok();
                let size = metadata.map(|m| m.len()).unwrap_or(0);

                // Try to read metadata
                let mut project_id = None;
                let mut version_id = None;
                let mut icon_url = None;
                let mut author: Option<String> = None;
                let mut version = None;
                let mut name = Some(filename.trim_end_matches(".zip").trim_end_matches(".jar").to_string());
                let mut provider = "Manual".to_string();
                
                if let Some(m) = read_meta_for_entry(&datapacks_dir, &filename) {
                    project_id = Some(m.project_id.clone());
                    version_id = m.version_id;
                    if let Some(n) = m.name { name = Some(n); }
                    author = m.author;
                    icon_url = m.icon_url;
                    version = m.version_name;
                    provider = provider_from_project_id(&m.project_id);
                }

                datapacks.push(Datapack {
                    filename: filename.clone(),
                    name,
                    author,
                    version,
                    project_id,
                    version_id,
                    icon_url,
                    size,
                    provider,
                    enabled: true,
                });
            }
        }
    }
    
    datapacks
}

/// Delete a datapack from a world
pub fn delete_datapack(instance: &Instance, world_name: &str, filename: &str) -> Result<(), String> {
    let datapacks_dir = get_saves_dir(instance).join(world_name).join("datapacks");
    let path = datapacks_dir.join(filename);
    
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    } else if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }

    // Also delete metadata
    delete_meta_for_entry(&datapacks_dir, filename);
    
    Ok(())
}

/// List screenshots
pub fn list_screenshots(instance: &Instance) -> Vec<Screenshot> {
    let dir = get_screenshots_dir(instance);
    let mut screenshots = Vec::new();
    
    if !dir.exists() {
        return screenshots;
    }
    
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let filename = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            
            if filename.ends_with(".png") {
                let date = fs::metadata(&path)
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .map(|t| {
                        let datetime: chrono::DateTime<chrono::Local> = t.into();
                        datetime.to_rfc3339()
                    });

                screenshots.push(Screenshot {
                    filename: filename.clone(),
                    path: path.to_string_lossy().to_string(),
                    date,
                });
            }
        }
    }
    
    screenshots.sort_by(|a, b| b.filename.cmp(&a.filename)); // Newest first
    screenshots
}

/// Delete a screenshot
pub fn delete_screenshot(instance: &Instance, filename: &str) -> Result<(), String> {
    let dir = get_screenshots_dir(instance);
    let path = dir.join(filename);
    
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

/// Get latest log content
pub fn get_latest_log(instance: &Instance) -> Result<String, String> {
    let logs_dir = get_logs_dir(instance);
    let latest_log = logs_dir.join("latest.log");
    
    if !latest_log.exists() {
        return Ok("No log file found.".to_string());
    }
    
    let mut file = File::open(&latest_log).map_err(|e| e.to_string())?;
    let mut content = String::new();
    file.read_to_string(&mut content).map_err(|e| e.to_string())?;
    
    // Return last 5000 lines max
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(5000);
    Ok(lines[start..].join("\n"))
}

/// Truncate the latest log file (clear it)
pub fn clear_latest_log(instance: &Instance) -> Result<(), String> {
    let logs_dir = get_logs_dir(instance);
    let latest_log = logs_dir.join("latest.log");
    
    if latest_log.exists() {
        // Truncate the file to 0 bytes
        fs::File::create(&latest_log).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Read servers.dat NBT file
pub fn list_servers(instance: &Instance) -> Vec<Server> {
    let servers_dat = instance.get_game_directory().join("servers.dat");
    
    if !servers_dat.exists() {
        return vec![];
    }
    
    // Try to parse NBT
    match std::fs::read(&servers_dat) {
        Ok(data) => {
            // servers.dat is uncompressed NBT
            match fastnbt::from_bytes::<ServersNbt>(&data) {
                Ok(nbt) => {
                    nbt.servers.into_iter().map(|s| Server {
                        name: s.name.unwrap_or_else(|| "Unnamed Server".to_string()),
                        ip: s.ip,
                        icon: s.icon,
                        accept_textures: s.accept_textures.unwrap_or(0),
                    }).collect()
                }
                Err(e) => {
                    log::warn!("Failed to parse servers.dat: {}", e);
                    vec![]
                }
            }
        }
        Err(e) => {
            log::warn!("Failed to read servers.dat: {}", e);
            vec![]
        }
    }
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct ServersNbt {
    servers: Vec<ServerEntry>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct ServerEntry {
    name: Option<String>,
    ip: String,
    icon: Option<String>,
    #[serde(rename = "acceptTextures")]
    accept_textures: Option<i8>,
}

/// Save servers to servers.dat
pub fn save_servers(instance: &Instance, servers: Vec<Server>) -> Result<(), String> {
    let servers_dat = instance.get_game_directory().join("servers.dat");
    
    let entries: Vec<ServerEntry> = servers.into_iter().map(|s| ServerEntry {
        name: Some(s.name),
        ip: s.ip,
        icon: s.icon,
        accept_textures: Some(s.accept_textures),
    }).collect();
    
    let nbt = ServersNbt { servers: entries };
    
    match fastnbt::to_bytes(&nbt) {
        Ok(data) => {
            std::fs::write(&servers_dat, data).map_err(|e| format!("Failed to write servers.dat: {}", e))
        }
        Err(e) => Err(format!("Failed to encode servers NBT: {}", e))
    }
}

/// Rename a screenshot
pub fn rename_screenshot(instance: &Instance, old_filename: &str, new_filename: &str) -> Result<(), String> {
    let dir = get_screenshots_dir(instance);
    let old_path = dir.join(old_filename);
    
    // Ensure new filename has .png
    let mut new_filename = new_filename.to_string();
    if !new_filename.ends_with(".png") {
        new_filename.push_str(".png");
    }
    let new_path = dir.join(new_filename);
    
    if !old_path.exists() {
        return Err("Screenshot not found".to_string());
    }
    
    if new_path.exists() {
        return Err("A screenshot with that name already exists".to_string());
    }
    
    fs::rename(old_path, new_path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Open path (file or folder) in system default handler
#[allow(dead_code)]
pub fn open_path(path: &PathBuf) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    #[cfg(target_os = "windows")]
    {
        // Use powershell to open the file to avoid issues with some file types
        std::process::Command::new("powershell")
            .arg("-Command")
            .arg(format!("Start-Process '{}'", path.to_string_lossy()))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}
