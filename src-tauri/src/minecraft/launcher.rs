use crate::minecraft::downloader::{get_assets_dir, get_libraries_dir, get_versions_dir};
use crate::minecraft::instances::{Instance, ModLoader};
use crate::minecraft::versions::{self, should_use_library, VersionDetails};
use crate::minecraft::settings;
use crate::minecraft::fabric;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::Command;
use zip::ZipArchive;

/// Find Java installation
pub fn find_java() -> Option<PathBuf> {
    // Check JAVA_HOME first
    if let Ok(java_home) = std::env::var("JAVA_HOME") {
        let java_path = PathBuf::from(&java_home).join("bin").join(if cfg!(target_os = "windows") { "java.exe" } else { "java" });
        if java_path.exists() {
            return Some(java_path);
        }
    }
    
    // Try to find java in PATH
    let java_name = if cfg!(target_os = "windows") { "java.exe" } else { "java" };
    
    if let Ok(output) = Command::new(if cfg!(target_os = "windows") { "where" } else { "which" })
        .arg(java_name)
        .output()
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout);
            let first_line = path.lines().next().unwrap_or("").trim();
            if !first_line.is_empty() {
                return Some(PathBuf::from(first_line));
            }
        }
    }
    
    // Common Java installation paths
    let common_paths = if cfg!(target_os = "windows") {
        vec![
            "C:\\Program Files\\Java",
            "C:\\Program Files (x86)\\Java",
            "C:\\Program Files\\Eclipse Adoptium",
            "C:\\Program Files\\Microsoft\\jdk-17",
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            "/Library/Java/JavaVirtualMachines",
            "/usr/local/opt/openjdk/bin",
        ]
    } else {
        vec![
            "/usr/lib/jvm",
            "/usr/java",
        ]
    };
    
    for base_path in common_paths {
        let base = PathBuf::from(base_path);
        if base.exists() {
            if let Ok(entries) = fs::read_dir(&base) {
                for entry in entries.flatten() {
                    let java_path = entry.path().join("bin").join(java_name);
                    if java_path.exists() {
                        return Some(java_path);
                    }
                }
            }
        }
    }
    
    None
}

fn get_java_major(java_path: &PathBuf) -> Option<u32> {
    let output = Command::new(java_path)
        .arg("-version")
        .output()
        .ok()?;

    let mut combined = String::new();
    combined.push_str(&String::from_utf8_lossy(&output.stderr));
    combined.push_str(&String::from_utf8_lossy(&output.stdout));

    let version_line = combined.lines().next()?;
    let start = version_line.find('"')? + 1;
    let end = version_line[start..].find('"')? + start;
    let raw_version = &version_line[start..end];

    let major = if raw_version.starts_with("1.") {
        raw_version.split('.').nth(1)?.parse().ok()?
    } else {
        raw_version.split('.').next()?.parse().ok()?
    };

    Some(major)
}

fn find_java8() -> Option<PathBuf> {
    if let Ok(java_home) = std::env::var("JAVA_HOME") {
        let java_path = PathBuf::from(&java_home).join("bin").join(if cfg!(target_os = "windows") { "java.exe" } else { "java" });
        if java_path.exists() {
            if let Some(major) = get_java_major(&java_path) {
                if major <= 8 {
                    return Some(java_path);
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let candidates = ["/usr/lib/jvm", "/usr/java", "/opt/java"];
        for base in candidates {
            if let Ok(entries) = fs::read_dir(base) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
                    if !name.contains("1.8") && !name.contains("java-8") && !name.contains("jdk8") {
                        continue;
                    }
                    let java_path = path.join("bin").join("java");
                    if java_path.exists() {
                        if let Some(major) = get_java_major(&java_path) {
                            if major <= 8 {
                                return Some(java_path);
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

/// Find a Java installation with a specific major version
fn find_java_by_version(required_major: u32) -> Option<PathBuf> {
    let java_name = if cfg!(target_os = "windows") { "java.exe" } else { "java" };
    
    // Common Java installation paths
    let common_paths = if cfg!(target_os = "windows") {
        vec![
            "C:\\Program Files\\Java",
            "C:\\Program Files (x86)\\Java",
            "C:\\Program Files\\Eclipse Adoptium",
            "C:\\Program Files\\Microsoft",
            "C:\\Program Files\\Zulu",
            "C:\\Program Files\\BellSoft",
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            "/Library/Java/JavaVirtualMachines",
            "/usr/local/opt/openjdk/bin",
            "/opt/homebrew/opt/openjdk",
        ]
    } else {
        vec![
            "/usr/lib/jvm",
            "/usr/java",
            "/opt/java",
        ]
    };
    
    let mut candidates: Vec<(PathBuf, u32)> = Vec::new();
    
    // Check JAVA_HOME first
    if let Ok(java_home) = std::env::var("JAVA_HOME") {
        let java_path = PathBuf::from(&java_home).join("bin").join(java_name);
        if java_path.exists() {
            if let Some(major) = get_java_major(&java_path) {
                candidates.push((java_path, major));
            }
        }
    }
    
    // Search common paths
    for base_path in common_paths {
        let base = PathBuf::from(base_path);
        if base.exists() {
            if let Ok(entries) = fs::read_dir(&base) {
                for entry in entries.flatten() {
                    // Check both direct bin/java and JDK structure (e.g., jdk-21/Contents/Home/bin/java on macOS)
                    let paths_to_check = vec![
                        entry.path().join("bin").join(java_name),
                        entry.path().join("Contents/Home/bin").join(java_name),
                    ];
                    
                    for java_path in paths_to_check {
                        if java_path.exists() {
                            if let Some(major) = get_java_major(&java_path) {
                                candidates.push((java_path, major));
                            }
                        }
                    }
                }
            }
        }
    }
    
    // First try to find exact match
    for (path, major) in &candidates {
        if *major == required_major {
            return Some(path.clone());
        }
    }
    
    // Then find any version >= required
    for (path, major) in &candidates {
        if *major >= required_major {
            return Some(path.clone());
        }
    }
    
    None
}

fn select_java_for_launch(instance: &Instance, version_details: &VersionDetails) -> Result<PathBuf, String> {
    // If instance has a specific Java path set, use that
    if let Some(java_path) = &instance.java_path {
        let path = PathBuf::from(java_path);
        if path.exists() {
            return Ok(path);
        }
    }
    
    // Check if version requires a specific Java version
    if let Some(java_version) = &version_details.java_version {
        let required_major = java_version.major_version as u32;
        
        // First check global settings Java
        if let Some(settings_java) = settings::get_java_path() {
            let settings_path = PathBuf::from(&settings_java);
            if settings_path.exists() {
                if let Some(major) = get_java_major(&settings_path) {
                    if major >= required_major {
                        return Ok(settings_path);
                    }
                    // Settings Java exists but wrong version, try to find correct one
                    log::info!("Settings Java is version {}, but {} requires Java {}", major, version_details.id, required_major);
                }
            }
        }
        
        // Try to find a Java that meets the requirement
        if let Some(java_path) = find_java_by_version(required_major) {
            log::info!("Found Java {} for Minecraft {}", required_major, version_details.id);
            return Ok(java_path);
        }
        
        // Fall back to any Java if we can't find the right version
        if let Some(java_path) = find_java() {
            if let Some(major) = get_java_major(&java_path) {
                if major < required_major {
                    return Err(format!(
                        "Minecraft {} requires Java {} or newer, but only Java {} was found. Please install Java {}.",
                        version_details.id, required_major, major, required_major
                    ));
                }
            }
            return Ok(java_path);
        }
        
        return Err(format!(
            "Java {} not found. Minecraft {} requires Java {} or newer. Please install it.",
            required_major, version_details.id, required_major
        ));
    }
    
    // Fallback for versions without java_version info (legacy)
    let requested = settings::get_java_path()
        .map(PathBuf::from)
        .or_else(find_java)
        .ok_or("Java not found. Please install Java or specify the path in settings.")?;

    let is_legacy_launcher = version_details.main_class == "net.minecraft.launchwrapper.Launch";
    if is_legacy_launcher {
        if let Some(major) = get_java_major(&requested) {
            if major > 8 {
                if let Some(java8) = find_java8() {
                    return Ok(java8);
                }
                return Err("Legacy Forge versions (e.g., 1.8.9) require Java 8. Please set a Java 8 path in Settings.".to_string());
            }
        }
    }

    Ok(requested)
}

/// Extract identity (group:artifact[:classifier]) from maven name for deduplication
/// We exclude version so that different versions of the same library are deduplicated,
/// but we include classifier so that native JARs are preserved.
fn get_lib_identity(name: &str) -> String {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() >= 4 {
        // group:artifact:version:classifier -> group:artifact:classifier
        format!("{}:{}:{}", parts[0], parts[1], parts[3])
    } else if parts.len() >= 2 {
        // group:artifact:version -> group:artifact
        format!("{}:{}", parts[0], parts[1])
    } else {
        name.to_string()
    }
}

/// Build the classpath for launching Minecraft
pub fn build_classpath(version_details: &VersionDetails) -> String {
    let libraries_dir = get_libraries_dir();
    let versions_dir = get_versions_dir();
    
    let separator = if cfg!(target_os = "windows") { ";" } else { ":" };
    let mut classpath_parts: Vec<String> = Vec::new();
    
    // Add libraries
    for library in &version_details.libraries {
        if !should_use_library(library) {
            continue;
        }
        
        if let Some(downloads) = &library.downloads {
            if let Some(artifact) = &downloads.artifact {
                let lib_path = libraries_dir.join(&artifact.path);
                if lib_path.exists() {
                    classpath_parts.push(lib_path.to_string_lossy().to_string());
                }
            }
            
            // Also include native classifier JARs if they exist for this OS
            if let Some(natives) = &library.natives {
                let os_name = versions::get_os_name();
                if let Some(classifier_key) = natives.get(os_name) {
                    // Replace ${arch} placeholder for the key if present
                    let arch = if cfg!(target_arch = "x86_64") { "64" } else { "32" };
                    let actual_key = classifier_key.replace("${arch}", arch);
                    
                    if let Some(classifiers) = &downloads.classifiers {
                        if let Some(native_artifact) = classifiers.get(&actual_key) {
                            let lib_path = libraries_dir.join(&native_artifact.path);
                            if lib_path.exists() {
                                classpath_parts.push(lib_path.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
        } else {
            // Fallback for libraries without explicit download info (common in Forge/Fabric)
            let lib_path = libraries_dir.join(versions::library_name_to_path(&library.name));
            if lib_path.exists() {
                classpath_parts.push(lib_path.to_string_lossy().to_string());
            }
        }
    }

    // Add client JAR
    let client_jar = versions_dir
        .join(&version_details.id)
        .join(format!("{}.jar", &version_details.id));
    classpath_parts.push(client_jar.to_string_lossy().to_string());
    
    classpath_parts.join(separator)
}

/// Build game arguments
pub fn build_game_args(
    version_details: &VersionDetails,
    instance: &Instance,
    username: &str,
    access_token: &str,
    uuid: &str,
) -> Vec<String> {
    let game_dir = instance.get_game_directory();
    let assets_dir = get_assets_dir();
    let asset_index = version_details.asset_index.as_ref().map(|a| a.id.clone()).unwrap_or_else(|| "legacy".to_string());
    
    // Check if custom resolution is configured
    let has_custom_resolution = instance.resolution_width.is_some() && instance.resolution_height.is_some();
    let resolution_width = instance.resolution_width.unwrap_or(854).to_string();
    let resolution_height = instance.resolution_height.unwrap_or(480).to_string();
    
    // Handle legacy minecraftArguments format
    if let Some(legacy_args) = &version_details.minecraft_arguments {
        let mut args: Vec<String> = legacy_args
            .split_whitespace()
            .map(|arg| {
                arg.replace("${auth_player_name}", username)
                    .replace("${version_name}", &version_details.id)
                    .replace("${game_directory}", &game_dir.to_string_lossy())
                    .replace("${assets_root}", &assets_dir.to_string_lossy())
                    .replace("${assets_index_name}", &asset_index)
                    .replace("${auth_uuid}", uuid)
                    .replace("${auth_access_token}", access_token)
                    .replace("${user_type}", "msa")
                    .replace("${version_type}", &version_details.version_type)
                    .replace("${user_properties}", "{}")
            })
            .collect();
        
        // Add resolution arguments for legacy versions if configured
        if has_custom_resolution {
            args.push("--width".to_string());
            args.push(resolution_width);
            args.push("--height".to_string());
            args.push(resolution_height);
        }
        
        return args;
    }
    
    // Handle modern arguments format
    let mut args = Vec::new();
    let os_name = versions::get_os_name();
    
    if let Some(arguments) = &version_details.arguments {
        if let Some(game_args) = &arguments.game {
            for arg in game_args {
                // Handle simple string arguments
                if let Some(s) = arg.as_str() {
                    let processed = process_arg_string(s, username, &version_details.id, &game_dir, &assets_dir, &asset_index, uuid, access_token, &version_details.version_type, &resolution_width, &resolution_height, None, None, None);
                    args.push(processed);
                }
                // Handle complex arguments with rules
                else if let Some(obj) = arg.as_object() {
                    if check_argument_rules(obj, os_name, has_custom_resolution) {
                        if let Some(value) = obj.get("value") {
                            if let Some(s) = value.as_str() {
                                let processed = process_arg_string(s, username, &version_details.id, &game_dir, &assets_dir, &asset_index, uuid, access_token, &version_details.version_type, &resolution_width, &resolution_height, None, None, None);
                                args.push(processed);
                            } else if let Some(arr) = value.as_array() {
                                for v in arr {
                                    if let Some(s) = v.as_str() {
                                        let processed = process_arg_string(s, username, &version_details.id, &game_dir, &assets_dir, &asset_index, uuid, access_token, &version_details.version_type, &resolution_width, &resolution_height, None, None, None);
                                        args.push(processed);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    args
}

/// Process argument string with variable replacements
fn process_arg_string(
    s: &str,
    username: &str,
    version_id: &str,
    game_dir: &PathBuf,
    assets_dir: &PathBuf,
    asset_index: &str,
    uuid: &str,
    access_token: &str,
    version_type: &str,
    resolution_width: &str,
    resolution_height: &str,
    classpath: Option<&str>,
    natives_dir: Option<&str>,
    library_dir: Option<&str>,
) -> String {
    let mut res = s.replace("${auth_player_name}", username)
        .replace("${version_name}", version_id)
        .replace("${game_directory}", &game_dir.to_string_lossy())
        .replace("${assets_root}", &assets_dir.to_string_lossy())
        .replace("${assets_index_name}", asset_index)
        .replace("${auth_uuid}", uuid)
        .replace("${auth_access_token}", access_token)
        .replace("${user_type}", "msa")
        .replace("${version_type}", version_type)
        .replace("${clientid}", "")
        .replace("${auth_xuid}", "")
        .replace("${resolution_width}", resolution_width)
        .replace("${resolution_height}", resolution_height)
        .replace("${launcher_name}", "PaletheaLauncher")
        .replace("${launcher_version}", "0.1.0");

    if let Some(cp) = classpath {
        res = res.replace("${classpath}", cp);
    }
    if let Some(nd) = natives_dir {
        res = res.replace("${natives_directory}", nd);
    }
    if let Some(ld) = library_dir {
        res = res.replace("${library_directory}", ld);
    }
    
    res
}

/// Check if an argument's rules allow it to be used
fn check_argument_rules(obj: &serde_json::Map<String, serde_json::Value>, os_name: &str, has_custom_resolution: bool) -> bool {
    if let Some(rules) = obj.get("rules") {
        if let Some(rules_arr) = rules.as_array() {
            let mut result = false;
            for rule in rules_arr {
                if let Some(rule_obj) = rule.as_object() {
                    let action = rule_obj.get("action").and_then(|a| a.as_str()).unwrap_or("allow");
                    let mut applies = true;
                    
                    // Check OS rule
                    if let Some(os) = rule_obj.get("os") {
                        if let Some(os_obj) = os.as_object() {
                            if let Some(name) = os_obj.get("name").and_then(|n| n.as_str()) {
                                applies = name == os_name;
                            }
                        }
                    }
                    
                    // Check features
                    if let Some(features) = rule_obj.get("features") {
                        if let Some(features_obj) = features.as_object() {
                            // Skip demo mode arguments
                            if features_obj.get("is_demo_user").is_some() {
                                applies = false;
                            }
                            // Include custom resolution arguments only if resolution is set
                            if features_obj.get("has_custom_resolution").is_some() {
                                applies = has_custom_resolution;
                            }
                            // Skip all quick play arguments - we don't support quick play
                            if features_obj.get("is_quick_play_singleplayer").is_some() ||
                               features_obj.get("is_quick_play_multiplayer").is_some() ||
                               features_obj.get("is_quick_play_realms").is_some() ||
                               features_obj.get("has_quick_plays_support").is_some() {
                                applies = false;
                            }
                        }
                    }
                    
                    if applies {
                        result = action == "allow";
                    }
                }
            }
            return result;
        }
    }
    true
}

/// Build JVM arguments
pub fn build_jvm_args(
    version_details: &VersionDetails,
    instance: &Instance,
    classpath: &str,
) -> Vec<String> {
    let mut args = Vec::new();
    let natives_dir = instance.get_directory().join("natives");
    let library_dir = crate::minecraft::downloader::get_libraries_dir();
    let game_dir = instance.get_game_directory();
    let assets_dir = crate::minecraft::downloader::get_assets_dir();
    let asset_index = version_details.asset_index.as_ref().map(|a| a.id.clone()).unwrap_or_else(|| "legacy".to_string());
    let os_name = versions::get_os_name();

    // Memory settings
    let min_mem = instance.memory_min.unwrap_or(512);
    let max_mem = instance.memory_max.unwrap_or(2048);
    args.push(format!("-Xms{}M", min_mem));
    args.push(format!("-Xmx{}M", max_mem));
    
    // Process JVM arguments from version JSON
    if let Some(arguments) = &version_details.arguments {
        if let Some(jvm_args) = &arguments.jvm {
            for arg in jvm_args {
                if let Some(s) = arg.as_str() {
                    let processed = process_arg_string(s, "", &version_details.id, &game_dir, &assets_dir, &asset_index, "", "", &version_details.version_type, "854", "480", Some(classpath), Some(&natives_dir.to_string_lossy()), Some(&library_dir.to_string_lossy()));
                    args.push(processed);
                } else if let Some(obj) = arg.as_object() {
                    if check_argument_rules(obj, os_name, false) {
                        if let Some(value) = obj.get("value") {
                            if let Some(s) = value.as_str() {
                                let processed = process_arg_string(s, "", &version_details.id, &game_dir, &assets_dir, &asset_index, "", "", &version_details.version_type, "854", "480", Some(classpath), Some(&natives_dir.to_string_lossy()), Some(&library_dir.to_string_lossy()));
                                args.push(processed);
                            } else if let Some(arr) = value.as_array() {
                                for v in arr {
                                    if let Some(s) = v.as_str() {
                                        let processed = process_arg_string(s, "", &version_details.id, &game_dir, &assets_dir, &asset_index, "", "", &version_details.version_type, "854", "480", Some(classpath), Some(&natives_dir.to_string_lossy()), Some(&library_dir.to_string_lossy()));
                                        args.push(processed);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    } else {
        // Fallback for older versions that don't have jvm args in JSON
        args.push(format!("-Djava.library.path={}", natives_dir.to_string_lossy()));
        args.push("-cp".to_string());
        args.push(classpath.to_string());
    }
    
    // Custom JVM args from instance
    if let Some(custom_args) = &instance.jvm_args {
        for arg in custom_args.split_whitespace() {
            args.push(arg.to_string());
        }
    }
    
    args
}

/// Launch Minecraft
pub async fn launch_game(
    instance: &Instance,
    version_details: &VersionDetails,
    username: &str,
    access_token: &str,
    uuid: &str,
) -> Result<std::process::Child, String> {
    // Determine the actual version details to use (may be overridden by mod loader)
    let mut actual_version_details = version_details.clone();
    
    // Handle Forge / NeoForge by loading their custom version.json if available
    if (instance.mod_loader == ModLoader::Forge || instance.mod_loader == ModLoader::NeoForge) && instance.mod_loader_version.is_some() {
        let loader_version = instance.mod_loader_version.as_ref().unwrap();
        let mc_version = &instance.version_id;
        
        // Potential IDs for Forge/NeoForge
        let mut possible_ids = Vec::new();
        
        // Check for specific version ID from our metadata
        let forge_json_path = instance.get_directory().join("forge.json");
        if forge_json_path.exists() {
            if let Ok(content) = fs::read_to_string(&forge_json_path) {
                if let Ok(forge_info) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(vid) = forge_info.get("version_id").and_then(|v| v.as_str()) {
                        possible_ids.push(vid.to_string());
                    }
                }
            }
        }

        if instance.mod_loader == ModLoader::Forge {
            possible_ids.push(format!("{}-forge-{}", mc_version, loader_version));
            possible_ids.push(format!("{}-forge{}", mc_version, loader_version));
        } else {
            possible_ids.push(format!("neoforge-{}", loader_version));
            possible_ids.push(loader_version.clone());
            possible_ids.push(format!("{}-neoforge-{}", mc_version, loader_version));
        }
        
        for id in possible_ids {
            let json_path = get_versions_dir().join(&id).join(format!("{}.json", id));
            if json_path.exists() {
                if let Ok(details) = versions::load_version_details(&json_path) {
                    // Update main info
                    actual_version_details.id = details.id.clone();
                    actual_version_details.main_class = details.main_class.clone();

                    if details.minecraft_arguments.is_some() {
                        actual_version_details.minecraft_arguments = details.minecraft_arguments.clone();
                        // If mod loader has legacy arguments, clear modern ones to avoid conflicts
                        actual_version_details.arguments = None;
                    }

                    if details.asset_index.is_some() {
                        actual_version_details.asset_index = details.asset_index.clone();
                    }
                    if details.java_version.is_some() {
                        actual_version_details.java_version = details.java_version.clone();
                    }
                    
                    // Prepended Forge libraries so they take priority, deduplicating by identity (group:artifact)
                    let mut combined_libs = details.libraries.clone();
                    for lib in &actual_version_details.libraries {
                        let identity = get_lib_identity(&lib.name);
                        if !combined_libs.iter().any(|l| get_lib_identity(&l.name) == identity) {
                            combined_libs.push(lib.clone());
                        }
                    }
                    actual_version_details.libraries = combined_libs;
                    
                    // Merge arguments if present
                    if let Some(mod_args) = details.arguments {
                        // If mod loader has modern arguments, clear legacy ones to avoid conflicts
                        actual_version_details.minecraft_arguments = None;

                        if let Some(base_args) = actual_version_details.arguments.as_mut() {
                            if let Some(mod_game) = mod_args.game {
                                if let Some(base_game) = base_args.game.as_mut() {
                                    base_game.extend(mod_game);
                                } else {
                                    base_args.game = Some(mod_game);
                                }
                            }
                            if let Some(mod_jvm) = mod_args.jvm {
                                if let Some(base_jvm) = base_args.jvm.as_mut() {
                                    base_jvm.extend(mod_jvm);
                                } else {
                                    base_args.jvm = Some(mod_jvm);
                                }
                            }
                        } else {
                            actual_version_details.arguments = Some(mod_args);
                        }
                    }
                    
                    log::info!("Successfully merged mod loader version JSON: {}", json_path.display());
                    break;
                }
            }
        }
    }

    // Ensure client JAR is present and valid (avoid corrupt vanilla jar)
    log::info!("Checking for missing client JAR...");
    let _ = crate::minecraft::downloader::download_client(&actual_version_details).await
        .map_err(|e| format!("Failed to download client JAR: {}", e))?;

    // Ensure all libraries (including mod loader dependencies) are downloaded
    log::info!("Checking for missing libraries...");
    let _ = crate::minecraft::downloader::download_libraries(&actual_version_details, None).await
        .map_err(|e| format!("Failed to download missing libraries: {}", e))?;

    // Find Java: instance setting > global setting > auto-detect (with legacy Forge handling)
    let java_path = select_java_for_launch(instance, &actual_version_details)?;
    
    // Build classpath - handle deduplication to avoid "duplicate ASM classes" error
    let mut classpath_elements: Vec<(String, String)> = Vec::new();
    
    // Determine main class
    let mut main_class = actual_version_details.main_class.clone();
    
    // 1. Handle Fabric mod loader additions (takes priority)
    if instance.mod_loader == ModLoader::Fabric {
        if let Some(fabric_info) = fabric::load_fabric_info(instance) {
            classpath_elements.extend(fabric::get_fabric_classpath(&fabric_info));
            main_class = fabric_info.launcher_meta.main_class.get_client_class().to_string();
        }
    }
    
    // 2. Add vanilla / Forge merged libraries
    let libraries_dir = get_libraries_dir();
    for library in &actual_version_details.libraries {
        if !versions::should_use_library(library) {
            continue;
        }
        
        // Add main artifact
        if let Some(downloads) = &library.downloads {
            if let Some(artifact) = &downloads.artifact {
                let lib_path = libraries_dir.join(&artifact.path);
                if lib_path.exists() {
                    classpath_elements.push((library.name.clone(), lib_path.to_string_lossy().to_string()));
                }
            }
            
            // Add native classifiers if they exist for this OS
            if let Some(natives) = &library.natives {
                let os_name = versions::get_os_name();
                if let Some(classifier_key) = natives.get(os_name) {
                    let arch = if cfg!(target_arch = "x86_64") { "64" } else { "32" };
                    let actual_key = classifier_key.replace("${arch}", arch);
                    
                    if let Some(classifiers) = &downloads.classifiers {
                        if let Some(native_artifact) = classifiers.get(&actual_key) {
                            let lib_path = libraries_dir.join(&native_artifact.path);
                            if lib_path.exists() {
                                // For natives, we use the original name plus the key for deduplication
                                let name_with_classifier = format!("{}:{}", library.name, actual_key);
                                classpath_elements.push((name_with_classifier, lib_path.to_string_lossy().to_string()));
                            }
                        }
                    }
                }
            }
        } else {
            // Fallback for libraries without explicit download info
            let lib_path = libraries_dir.join(versions::library_name_to_path(&library.name));
            if lib_path.exists() {
                classpath_elements.push((library.name.clone(), lib_path.to_string_lossy().to_string()));
            }
        }
    }

    // 3. Deduplicate elements by maven identity (group:artifact:classifier)
    // This solves the "duplicate ASM classes found on classpath" error by preferring 
    // the first version found (which will be Fabric's version if using Fabric)
    let mut final_paths = Vec::new();
    let mut seen_identities = std::collections::HashSet::new();
    
    for (name, path) in classpath_elements {
        let identity = get_lib_identity(&name);
        if !seen_identities.contains(&identity) {
            seen_identities.insert(identity);
            final_paths.push(path);
        }
    }

    // 4. Add the actual game JAR
    let versions_dir = get_versions_dir();
    let client_jar = versions_dir.join(&actual_version_details.id).join(format!("{}.jar", &actual_version_details.id));
    final_paths.push(client_jar.to_string_lossy().to_string());

    let separator = if cfg!(target_os = "windows") { ";" } else { ":" };
    let classpath = final_paths.join(separator);
    
    // Build arguments
    let jvm_args = build_jvm_args(&actual_version_details, instance, &classpath);
    let game_args = build_game_args(&actual_version_details, instance, username, access_token, uuid);
    
    // Create game directory if it doesn't exist
    let game_dir = instance.get_game_directory();
    fs::create_dir_all(&game_dir)
        .map_err(|e| format!("Failed to create game directory: {}", e))?;
    
    // Create natives directory
    let natives_dir = instance.get_directory().join("natives");
    fs::create_dir_all(&natives_dir)
        .map_err(|e| format!("Failed to create natives directory: {}", e))?;
    
    // Extract natives from library JARs
    extract_natives(&actual_version_details, &natives_dir)?;
    
    // Log the arguments for debugging
    log::info!("Game args: {:?}", game_args);
    
    // Build command
    let mut command = Command::new(&java_path);
    command.current_dir(&game_dir);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW is 0x08000000 - this prevents the Java console from appearing
        command.creation_flags(0x08000000);

        let total_len: usize = jvm_args.iter().map(|a| a.len() + 3).sum::<usize>() 
            + main_class.len() + 3
            + game_args.iter().map(|a| a.len() + 3).sum::<usize>();

        if total_len > 8000 {
            if let Some(major) = get_java_major(&java_path) {
                if major >= 9 {
                    log::info!("Command line too long ({} chars), using @argfile", total_len);
                    let mut arg_content = String::new();
                    // In Java argfiles, you can just put one arg per line. 
                    // Backslashes must be doubled, and spaces handled by quotes.
                    for a in &jvm_args {
                        arg_content.push_str(&format!("\"{}\"\n", a.replace("\\", "\\\\").replace("\"", "\\\"")));
                    }
                    arg_content.push_str(&format!("\"{}\"\n", main_class.replace("\\", "\\\\").replace("\"", "\\\"")));
                    for a in &game_args {
                        arg_content.push_str(&format!("\"{}\"\n", a.replace("\\", "\\\\").replace("\"", "\\\"")));
                    }

                    let arg_file = game_dir.join("launch_args.txt");
                    if fs::write(&arg_file, arg_content).is_ok() {
                        command.arg(format!("@{}", arg_file.to_string_lossy()));
                    } else {
                        command.args(&jvm_args).arg(&main_class).args(&game_args);
                    }
                } else {
                    log::warn!("Command line too long ({} chars) and Java is too old (< 9) to use @argfile.", total_len);
                    command.args(&jvm_args).arg(&main_class).args(&game_args);
                }
            } else {
                command.args(&jvm_args).arg(&main_class).args(&game_args);
            }
        } else {
            command.args(&jvm_args).arg(&main_class).args(&game_args);
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        command.args(&jvm_args).arg(&main_class).args(&game_args);
    }
    
    // Launch the game
    let child = command.spawn()
        .map_err(|e| format!("Failed to launch Minecraft: {}", e))?;
    
    Ok(child)
}

/// Extract native libraries from JARs
fn extract_natives(version_details: &VersionDetails, natives_dir: &PathBuf) -> Result<(), String> {
    let libraries_dir = get_libraries_dir();
    let os_name = versions::get_os_name();
    
    for library in &version_details.libraries {
        if !should_use_library(library) {
            continue;
        }
        
        // Check if this library has natives for our OS
        if let Some(natives) = &library.natives {
            if let Some(classifier_key) = natives.get(os_name) {
                // Replace ${arch} placeholder
                let arch = if cfg!(target_arch = "x86_64") { "64" } else { "32" };
                let classifier_key = classifier_key.replace("${arch}", arch);
                
                // Find the native JAR in classifiers
                if let Some(downloads) = &library.downloads {
                    if let Some(classifiers) = &downloads.classifiers {
                        if let Some(native_artifact) = classifiers.get(&classifier_key) {
                            let native_jar_path = libraries_dir.join(&native_artifact.path);
                            
                            if native_jar_path.exists() {
                                // Get exclusions
                                let exclusions: Vec<&str> = library.extract
                                    .as_ref()
                                    .and_then(|e| e.exclude.as_ref())
                                    .map(|v| v.iter().map(|s| s.as_str()).collect())
                                    .unwrap_or_default();
                                
                                // Extract the JAR
                                extract_jar(&native_jar_path, natives_dir, &exclusions)?;
                            }
                        }
                    }
                }
            }
        }
    }
    
    Ok(())
}

/// Extract a JAR file to a directory, excluding specified paths
fn extract_jar(jar_path: &PathBuf, dest_dir: &PathBuf, exclusions: &[&str]) -> Result<(), String> {
    let file = File::open(jar_path)
        .map_err(|e| format!("Failed to open JAR {}: {}", jar_path.display(), e))?;
    
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("Failed to read JAR {}: {}", jar_path.display(), e))?;
    
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)
            .map_err(|e| format!("Failed to read entry: {}", e))?;
        
        let name = entry.name().to_string();
        
        // Check exclusions
        let excluded = exclusions.iter().any(|ex| name.starts_with(ex));
        if excluded {
            continue;
        }
        
        // Skip directories and META-INF
        if entry.is_dir() || name.starts_with("META-INF") {
            continue;
        }
        
        let dest_path = dest_dir.join(&name);
        
        // Create parent directories if needed
        if let Some(parent) = dest_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        
        // Only extract if file doesn't exist (avoid re-extracting on each launch)
        if !dest_path.exists() {
            let mut contents = Vec::new();
            entry.read_to_end(&mut contents)
                .map_err(|e| format!("Failed to read {}: {}", name, e))?;
            
            let mut out_file = File::create(&dest_path)
                .map_err(|e| format!("Failed to create {}: {}", dest_path.display(), e))?;
            out_file.write_all(&contents)
                .map_err(|e| format!("Failed to write {}: {}", dest_path.display(), e))?;
        }
    }
    
    Ok(())
}
