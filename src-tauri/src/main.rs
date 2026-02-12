// Prevents additional console window on Windows (debug + release), DO NOT REMOVE!!
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

#[cfg(debug_assertions)]
fn load_env_file(path: &std::path::Path) {
  let content = match std::fs::read_to_string(path) {
    Ok(content) => content,
    Err(_) => return,
  };

  for raw_line in content.lines() {
    let line = raw_line.trim();
    if line.is_empty() || line.starts_with('#') {
      continue;
    }

    let normalized = line.strip_prefix("export ").unwrap_or(line).trim();
    let Some((key_raw, value_raw)) = normalized.split_once('=') else {
      continue;
    };

    let key = key_raw.trim();
    if key.is_empty() || std::env::var_os(key).is_some() {
      continue;
    }

    let mut value = value_raw.trim().to_string();
    let quoted = (value.starts_with('"') && value.ends_with('"'))
      || (value.starts_with('\'') && value.ends_with('\''));
    if quoted && value.len() >= 2 {
      value = value[1..value.len() - 1].to_string();
    }

    std::env::set_var(key, value);
  }
}

#[cfg(debug_assertions)]
fn load_local_dev_env() {
  let Ok(cwd) = std::env::current_dir() else {
    return;
  };

  let mut candidates = vec![
    cwd.join(".env.local"),
    cwd.join(".env"),
    cwd.join("src-tauri").join(".env.local"),
    cwd.join("src-tauri").join(".env"),
  ];

  if let Some(parent) = cwd.parent() {
    candidates.push(parent.join(".env.local"));
    candidates.push(parent.join(".env"));
    candidates.push(parent.join("src-tauri").join(".env.local"));
    candidates.push(parent.join("src-tauri").join(".env"));
  }

  candidates.sort();
  candidates.dedup();

  for candidate in candidates {
    load_env_file(&candidate);
  }
}

fn main() {
  #[cfg(debug_assertions)]
  load_local_dev_env();

  // CRITICAL: Set WebView2 args BEFORE any Tauri initialization
  // This bypasses the 20-second Windows proxy auto-detection hang
  #[cfg(target_os = "windows")]
  {
    // Force a stable taskbar identity so shortcut-specific icons do not replace
    // the app's taskbar icon when launched via instance shortcuts.
    let _ = unsafe {
      windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(
        windows::core::w!("com.palethea.launcher")
      )
    };

    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", 
      "--no-proxy-server --disable-features=WinrtGeolocationImplementation,msWebOOUI --disable-background-networking");
  }

  // Fix for blank screen on Wayland with WebKitGTK
  #[cfg(target_os = "linux")]
  std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
  
  app_lib::run();
}
