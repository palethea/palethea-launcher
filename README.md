# Palethea Launcher

A custom Minecraft launcher built with Tauri and React. Lightweight, fast, and cross-platform.

![Palethea Launcher](https://img.shields.io/badge/Tauri-2.0-blue) ![React](https://img.shields.io/badge/React-19-61dafb)

## Features

-  **Instance Management** - Create and manage multiple Minecraft instances
-  **Version Browser** - Browse and download any Minecraft version
-  **Fast & Lightweight** - Built with Tauri for a small footprint
-  **Cross-Platform** - Works on Windows and Linux
-  **Offline Mode** - Play without a Minecraft account

## Prerequisites

Before running the launcher, you need to install:

### 1. Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```
After installation, restart your terminal or run:
```bash
source ~/.cargo/env
```

### 2. System Dependencies (Linux)

**Arch Linux:**
```bash
sudo pacman -S webkit2gtk-4.1 base-devel curl wget openssl appmenu-gtk-module gtk3 librsvg libvips
```

**Ubuntu/Debian:**
```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

### 4. Java
Minecraft requires Java to run. Install Java 17+ (recommended):
```bash
# Arch Linux
sudo pacman -S jdk17-openjdk

# Ubuntu/Debian
sudo apt install openjdk-17-jdk
```

## License

MIT
