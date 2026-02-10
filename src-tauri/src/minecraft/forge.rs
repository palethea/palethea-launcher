use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fs;
use std::process::{Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

use crate::minecraft::instances::Instance;
use crate::minecraft::launcher;

// ----------
// Windows console hiding
// Description: Hides CMD windows when running installers
// ----------
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ForgeVersionInfo {
    pub forge_version: String,
    pub minecraft_version: String,
    pub main_class: String,
    pub version_id: Option<String>,
    pub libraries: Vec<ForgeLibrary>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ForgeLibrary {
    pub name: String,
    pub url: Option<String>,
}

fn run_command_with_timeout(mut command: Command, timeout: Duration) -> Result<ExitStatus, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start installer process: {}", e))?;
    let start = Instant::now();

    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("Failed waiting for installer process: {}", e))?
        {
            return Ok(status);
        }

        if start.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "Installer timed out after {} seconds",
                timeout.as_secs()
            ));
        }

        std::thread::sleep(Duration::from_millis(250));
    }
}

/// Download Forge installer and run it
pub async fn install_forge(
    instance: &Instance,
    forge_version: &str,
) -> Result<ForgeVersionInfo, Box<dyn Error + Send + Sync>> {
    let mc_version = &instance.version_id;
    // Forge URL patterns are nightmare. Older versions (like 1.8.9) often use {mc}-{forge}-{mc}
    // while newer ones use {mc}-{forge}.
    
    let url_options = [
        format!(
            "https://maven.minecraftforge.net/net/minecraftforge/forge/{}-{}-{}/forge-{}-{}-{}-installer.jar",
            mc_version, forge_version, mc_version, mc_version, forge_version, mc_version
        ),
        format!(
            "https://maven.minecraftforge.net/net/minecraftforge/forge/{}-{}/forge-{}-{}-installer.jar",
            mc_version, forge_version, mc_version, forge_version
        ),
    ];
    
    let temp_dir = std::env::temp_dir();
    let installer_path = temp_dir.join(format!("forge-{}-{}-installer.jar", mc_version, forge_version));
    
    // Download installer
    let client = super::http_client();

    let mut response = None;
    let mut last_error = "No URLs tried".to_string();

    for url in &url_options {
        log::info!("Trying to download Forge installer from {}", url);
        match client.get(url).send().await {
            Ok(res) if res.status().is_success() => {
                response = Some(res);
                break;
            }
            Ok(res) => {
                last_error = format!("HTTP {}", res.status());
            }
            Err(e) => {
                last_error = e.to_string();
            }
        }
    }

    let response = response.ok_or_else(|| format!("Failed to download Forge installer: {}", last_error))?;
    
    let bytes = response.bytes().await?;
    log::info!("Downloaded Forge installer ({} bytes)", bytes.len());
    fs::write(&installer_path, &bytes)?;
    
    // Find Java
    let java_path = launcher::find_java()
        .ok_or("Java not found. Please install Java to install Forge.")?;
    
    let minecraft_dir = crate::minecraft::downloader::get_minecraft_dir();
    
    // Ensure launcher_profiles.json exists (Forge installer requirement)
    let profiles_path = minecraft_dir.join("launcher_profiles.json");
    if !profiles_path.exists() {
        let _ = fs::write(&profiles_path, "{\"profiles\":{}}");
    }
    
    // Run installer in client mode
    let forge_cmd_str = format!("\"{}\" -jar \"{}\" --installClient \"{}\"", java_path.display(), installer_path.display(), minecraft_dir.display());
    println!("\n[DEBUG] Running Forge installer:\n{}\n", forge_cmd_str);
    log::info!("Running Forge installer: {}", forge_cmd_str);
    
    // Some older Forge installers use different arguments or require a different display mode
    // but --installClient is standard for modern ones. 
    // For 1.8.9 specifically, it often needs the path to be the .minecraft root.
    
    let mut command = Command::new(&java_path);
    command.arg("-jar").arg(&installer_path);
    command.arg("--installClient").arg(&minecraft_dir);
    
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    
    let installer_timeout = Duration::from_secs(600);
    let output_status = tokio::task::spawn_blocking(move || run_command_with_timeout(command, installer_timeout))
        .await
        .map_err(|e| format!("Failed to join Forge installer task: {}", e))??;
    
    if !output_status.success() {
        // Fallback for older installers (like 1.8.9) that don't support --installClient
        log::info!("Standard Forge installer failed, attempting manual extraction for legacy version...");
        let version_id = handle_legacy_forge_installer(&installer_path, mc_version, forge_version)?;
        
        // Create forge info for the instance
        let forge_info = ForgeVersionInfo {
            forge_version: forge_version.to_string(),
            minecraft_version: mc_version.to_string(),
            main_class: String::new(), 
            version_id: Some(version_id),
            libraries: Vec::new(), 
        };
        
        // Save forge info to instance
        let instance_dir = instance.get_directory();
        let forge_json_path = instance_dir.join("forge.json");
        let forge_json = serde_json::to_string_pretty(&forge_info)?;
        fs::write(&forge_json_path, forge_json)?;
        
        // Clean up installer
        let _ = fs::remove_file(&installer_path);
        
        return Ok(forge_info);
    } else {
        log::info!("Forge installer completed successfully.");
    }
    
    // Clean up installer
    let _ = fs::remove_file(&installer_path);
    
    // Create forge info for the instance
    let forge_info = ForgeVersionInfo {
        forge_version: forge_version.to_string(),
        minecraft_version: mc_version.to_string(),
        main_class: String::new(), 
        version_id: None,
        libraries: Vec::new(), 
    };
    
    // Save forge info to instance
    let instance_dir = instance.get_directory();
    let forge_json_path = instance_dir.join("forge.json");
    let forge_json = serde_json::to_string_pretty(&forge_info)?;
    fs::write(&forge_json_path, forge_json)?;
    
    Ok(forge_info)
}

/// Handle older Forge installers by manually extracting metadata and JARs
fn handle_legacy_forge_installer(
    installer_path: &std::path::PathBuf,
    _mc_version: &str,
    _forge_version: &str,
) -> Result<String, Box<dyn Error + Send + Sync>> {
    use std::io::Read;
    let file = fs::File::open(installer_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    
    // 1. Extract and parse install_profile.json
    let mut profile_content = String::new();
    {
        let mut profile_entry = archive.by_name("install_profile.json")
            .map_err(|_| "Could not find install_profile.json in Forge installer")?;
        profile_entry.read_to_string(&mut profile_content)?;
    }
    
    let profile: serde_json::Value = serde_json::from_str(&profile_content)?;
    let install_data = profile.get("install").ok_or("Invalid install_profile.json: missing 'install'")?;
    let version_info = profile.get("versionInfo").ok_or("Invalid install_profile.json: missing 'versionInfo'")?;
    
    let version_id = version_info.get("id").and_then(|v| v.as_str()).unwrap_or("legacy-forge-session");
    
    // 2. Save the version JSON to the versions directory
    let versions_dir = crate::minecraft::downloader::get_versions_dir();
    let version_dir = versions_dir.join(version_id);
    fs::create_dir_all(&version_dir)?;
    
    let json_path = version_dir.join(format!("{}.json", version_id));
    fs::write(&json_path, serde_json::to_string_pretty(version_info)?)?;
    
    // 3. Extract the universal JAR and save it to the libraries directory
    let universal_filename = install_data.get("filePath").and_then(|v| v.as_str())
        .ok_or("installer_profile.json missing filePath for universal jar")?;
    
    let forge_lib_name = install_data.get("path").and_then(|v| v.as_str())
        .ok_or("installer_profile.json missing path for forge library")?;
    
    let mut universal_entry = archive.by_name(universal_filename)
        .map_err(|_| format!("Could not find {} in Forge installer", universal_filename))?;
    
    let libraries_dir = crate::minecraft::downloader::get_libraries_dir();
    let forge_lib_path = libraries_dir.join(crate::minecraft::versions::library_name_to_path(forge_lib_name));
    
    if let Some(parent) = forge_lib_path.parent() {
        fs::create_dir_all(parent)?;
    }
    
    let mut out_file = fs::File::create(&forge_lib_path)?;
    std::io::copy(&mut universal_entry, &mut out_file)?;
    
    log::info!("Manually extracted legacy Forge components to {} and {}", json_path.display(), forge_lib_path.display());
    
    Ok(version_id.to_string())
}

/// Download NeoForge installer and run it
pub async fn install_neoforge(
    instance: &Instance,
    neoforge_version: &str,
) -> Result<ForgeVersionInfo, Box<dyn Error + Send + Sync>> {
    let installer_url = format!(
        "https://maven.neoforged.net/releases/net/neoforged/neoforge/{}/neoforge-{}-installer.jar",
        neoforge_version, neoforge_version
    );
    
    // We'll download to a temp file
    let temp_dir = std::env::temp_dir();
    let installer_path = temp_dir.join(format!("neoforge-{}-installer.jar", neoforge_version));
    
    // Download installer
    log::info!("Downloading NeoForge installer from {}", installer_url);
    let client = super::http_client();
    let response = client
        .get(&installer_url)
        .header("User-Agent", format!("PaletheaLauncher/{}", super::get_launcher_version()))
        .send()
        .await?;
    
    if !response.status().is_success() {
        return Err(format!("Failed to download NeoForge installer: {}. URL: {}", response.status(), installer_url).into());
    }
    
    let bytes = response.bytes().await?;
    fs::write(&installer_path, &bytes)?;
    
    // Find Java
    let java_path = launcher::find_java()
        .ok_or("Java not found. Please install Java to install NeoForge.")?;
    
    let minecraft_dir = crate::minecraft::downloader::get_minecraft_dir();
    
    // Ensure launcher_profiles.json exists (NeoForge installer requirement)
    let profiles_path = minecraft_dir.join("launcher_profiles.json");
    if !profiles_path.exists() {
        let _ = fs::write(&profiles_path, "{\"profiles\":{}}");
    }
    
    // Run installer in client mode
    let neoforge_cmd_str = format!("\"{}\" -jar \"{}\" --installClient \"{}\"", java_path.display(), installer_path.display(), minecraft_dir.display());
    println!("\n[DEBUG] Running NeoForge installer:\n{}\n", neoforge_cmd_str);
    log::info!("Running NeoForge installer: {}", neoforge_cmd_str);
    
    let mut neoforge_cmd = Command::new(&java_path);
    neoforge_cmd.args(&[
        "-jar", 
        installer_path.to_str().ok_or("Invalid path")?, 
        "--installClient", 
        minecraft_dir.to_str().ok_or("Invalid path")?
    ]);
    
    #[cfg(target_os = "windows")]
    neoforge_cmd.creation_flags(CREATE_NO_WINDOW);
    
    let installer_timeout = Duration::from_secs(600);
    let output_status = tokio::task::spawn_blocking(move || run_command_with_timeout(neoforge_cmd, installer_timeout))
        .await
        .map_err(|e| format!("Failed to join NeoForge installer task: {}", e))??;
    
    if !output_status.success() {
        return Err("NeoForge installer failed. See logs for details.".to_string().into());
    }
    
    // Clean up installer
    let _ = fs::remove_file(&installer_path);
    
    // Create neoforge info for the instance
    let neoforge_info = ForgeVersionInfo {
        forge_version: neoforge_version.to_string(),
        minecraft_version: instance.version_id.to_string(),
        main_class: String::new(),
        version_id: None,
        libraries: Vec::new(),
    };
    
    // Save neoforge info to instance
    let instance_dir = instance.get_directory();
    let neoforge_json_path = instance_dir.join("neoforge.json");
    let neoforge_json = serde_json::to_string_pretty(&neoforge_info)?;
    fs::write(&neoforge_json_path, neoforge_json)?;
    
    Ok(neoforge_info)
}

/// Load saved Forge info from instance
#[allow(dead_code)]
pub fn load_forge_info(instance: &Instance) -> Option<ForgeVersionInfo> {
    let forge_json_path = instance.get_directory().join("forge.json");
    if !forge_json_path.exists() {
        return None;
    }
    
    let content = fs::read_to_string(&forge_json_path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Load saved NeoForge info from instance
#[allow(dead_code)]
pub fn load_neoforge_info(instance: &Instance) -> Option<ForgeVersionInfo> {
    let neoforge_json_path = instance.get_directory().join("neoforge.json");
    if !neoforge_json_path.exists() {
        return None;
    }
    
    let content = fs::read_to_string(&neoforge_json_path).ok()?;
    serde_json::from_str(&content).ok()
}
