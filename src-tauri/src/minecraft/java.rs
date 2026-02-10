use std::error::Error;
use std::fs;
use std::path::PathBuf;

use crate::minecraft::downloader::get_minecraft_dir;

pub async fn download_java(version: u32) -> Result<PathBuf, Box<dyn Error + Send + Sync>> {
    let install_dir = get_minecraft_dir().join("java").join(format!("temurin-{}", version));
    
    // Check if already installed
    if let Some(binary) = find_java_binary(&install_dir) {
        return Ok(binary);
    }

    let os = if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "mac"
    } else {
        return Err("Unsupported OS for Java download".into());
    };

    let arch = if cfg!(target_arch = "x86_64") {
        "x64"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        return Err("Unsupported CPU architecture for Java download".into());
    };

    let url = format!(
        "https://api.adoptium.net/v3/binary/latest/{}/ga/{}/{}/jre/hotspot/normal/eclipse",
        version, os, arch
    );

    let client = super::http_client();
    let response = client
        .get(&url)
        .header("User-Agent", format!("PaletheaLauncher/{}", super::get_launcher_version()))
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(format!("Failed to download Java {}: {}", version, response.status()).into());
    }

    let bytes = response.bytes().await?;
    let temp_dir = std::env::temp_dir();
    let archive_name = if os == "windows" {
        format!("temurin-{}-{}.zip", version, os)
    } else {
        format!("temurin-{}-{}.tar.gz", version, os)
    };
    let archive_path = temp_dir.join(archive_name);
    fs::write(&archive_path, &bytes)?;

    let install_dir = get_minecraft_dir().join("java").join(format!("temurin-{}", version));
    if install_dir.exists() {
        let _ = fs::remove_dir_all(&install_dir);
    }
    fs::create_dir_all(&install_dir)?;

    if os == "windows" {
        let file = fs::File::open(&archive_path)?;
        let mut archive = zip::ZipArchive::new(file)?;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i)?;
            let out_path = install_dir.join(entry.name());
            if entry.is_dir() {
                fs::create_dir_all(&out_path)?;
            } else {
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                let mut out_file = fs::File::create(&out_path)?;
                std::io::copy(&mut entry, &mut out_file)?;
            }
        }
    } else {
        let file = fs::File::open(&archive_path)?;
        let decoder = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(decoder);
        archive.unpack(&install_dir)?;
    }

    let java_path = find_java_binary(&install_dir)
        .ok_or("Failed to locate java binary after extraction")?;

    let _ = fs::remove_file(&archive_path);

    Ok(java_path)
}

fn find_java_binary(install_dir: &PathBuf) -> Option<PathBuf> {
    let java_name = if cfg!(target_os = "windows") { "java.exe" } else { "java" };

    let direct = install_dir.join("bin").join(java_name);
    if direct.exists() {
        return Some(direct);
    }

    if let Ok(entries) = fs::read_dir(install_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let candidate = path.join("bin").join(java_name);
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
    }

    None
}
