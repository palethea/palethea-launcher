// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // CRITICAL: Set WebView2 args BEFORE any Tauri initialization
  // This bypasses the 20-second Windows proxy auto-detection hang
  #[cfg(target_os = "windows")]
  {
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", 
      "--no-proxy-server --disable-features=WinrtGeolocationImplementation,msWebOOUI --disable-background-networking");
  }

  // Fix for blank screen on Wayland with WebKitGTK
  #[cfg(target_os = "linux")]
  std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
  
  app_lib::run();
}
