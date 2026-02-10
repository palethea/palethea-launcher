use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fs;
use std::path::PathBuf;
use crate::minecraft::downloader::get_minecraft_dir;

// Microsoft's public Xbox Live client ID (used by many third-party launchers)
const MICROSOFT_CLIENT_ID: &str = "000000004C12AE6F";
fn create_client() -> reqwest::Client {
    super::http_client()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MicrosoftAccount {
    pub username: String,
    pub uuid: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SavedAccount {
    pub username: String,
    pub uuid: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub is_microsoft: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AccountsData {
    pub accounts: Vec<SavedAccount>,
    pub active_account: Option<String>, // username of active account
}

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    #[serde(default)]
    _expires_in: Option<u32>,
    #[serde(default)]
    interval: Option<u32>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub _error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct XboxAuthResponse {
    #[serde(rename = "Token")]
    token: String,
    #[serde(rename = "DisplayClaims")]
    display_claims: XboxDisplayClaims,
}

#[derive(Debug, Deserialize)]
struct XboxDisplayClaims {
    xui: Vec<XboxUserInfo>,
}

#[derive(Debug, Deserialize)]
struct XboxUserInfo {
    uhs: String,
}

#[derive(Debug, Deserialize)]
struct MinecraftAuthResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct MinecraftProfileResponse {
    id: String,
    name: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct DeviceCodeInfo {
    pub user_code: String,
    pub verification_uri: String,
    pub device_code: String,
    pub interval: u32,
}

/// Step 1: Start device code flow
pub async fn start_device_code_flow() -> Result<DeviceCodeInfo, Box<dyn Error + Send + Sync>> {
    let client = create_client();
    
    let response = client
        .post("https://login.live.com/oauth20_connect.srf")
        .form(&[
            ("client_id", MICROSOFT_CLIENT_ID),
            ("scope", "service::user.auth.xboxlive.com::MBI_SSL"),
            ("response_type", "device_code"),
        ])
        .send()
        .await?;
    
    let text = response.text().await?;
    let device_code: DeviceCodeResponse = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse device code response: {} - Body: {}", e, text))?;
    
    if let Some(error) = device_code.error {
        return Err(format!("{}: {}", error, device_code.error_description.unwrap_or_default()).into());
    }
    
    Ok(DeviceCodeInfo {
        user_code: device_code.user_code,
        verification_uri: device_code.verification_uri,
        device_code: device_code.device_code,
        interval: device_code.interval.unwrap_or(5),
    })
}

/// Step 2: Poll for token after user authenticates
pub async fn poll_for_token(device_code: &str) -> Result<TokenResponse, Box<dyn Error + Send + Sync>> {
    let client = create_client();
    
    let response = client
        .post("https://login.live.com/oauth20_token.srf")
        .form(&[
            ("client_id", MICROSOFT_CLIENT_ID),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("device_code", device_code),
        ])
        .send()
        .await?;
    
    let token: TokenResponse = response.json().await?;
    
    if let Some(error) = &token.error {
        return Err(error.clone().into());
    }
    
    Ok(token)
}

/// Step 3: Authenticate with Xbox Live
async fn authenticate_xbox(ms_token: &str) -> Result<(String, String), Box<dyn Error + Send + Sync>> {
    let client = create_client();
    
    // Xbox Live authentication
    let xbox_response = client
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": ms_token
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        }))
        .send()
        .await?;
    
    let xbox_auth: XboxAuthResponse = xbox_response.json().await?;
    let user_hash = xbox_auth.display_claims.xui.first()
        .ok_or("No Xbox user info")?
        .uhs.clone();
    
    // XSTS token
    let xsts_response = client
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "Properties": {
                "SandboxId": "RETAIL",
                "UserTokens": [xbox_auth.token]
            },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT"
        }))
        .send()
        .await?;
    
    let xsts_auth: XboxAuthResponse = xsts_response.json().await?;
    
    Ok((xsts_auth.token, user_hash))
}

/// Step 4: Authenticate with Minecraft
async fn authenticate_minecraft(xsts_token: &str, user_hash: &str) -> Result<String, Box<dyn Error + Send + Sync>> {
    let client = create_client();
    
    let response = client
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "identityToken": format!("XBL3.0 x={};{}", user_hash, xsts_token)
        }))
        .send()
        .await?;
    
    let mc_auth: MinecraftAuthResponse = response.json().await?;
    Ok(mc_auth.access_token)
}

/// Step 5: Get Minecraft profile
async fn get_minecraft_profile(mc_token: &str) -> Result<(String, String), Box<dyn Error + Send + Sync>> {
    let client = create_client();
    
    let response = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .header("Authorization", format!("Bearer {}", mc_token))
        .send()
        .await?;
    
    if !response.status().is_success() {
        return Err("Account does not own Minecraft".into());
    }
    
    let profile: MinecraftProfileResponse = response.json().await?;
    Ok((profile.id, profile.name))
}

/// Complete authentication flow after device code is authorized
pub async fn complete_authentication(ms_token: &str, refresh_token: Option<String>) -> Result<MicrosoftAccount, Box<dyn Error + Send + Sync>> {
    // Xbox Live auth
    let (xsts_token, user_hash) = authenticate_xbox(ms_token).await?;
    
    // Minecraft auth
    let mc_token = authenticate_minecraft(&xsts_token, &user_hash).await?;
    
    // Get profile
    let (uuid, username) = get_minecraft_profile(&mc_token).await?;
    
    Ok(MicrosoftAccount {
        username,
        uuid,
        access_token: mc_token,
        refresh_token,
    })
}

/// Refresh the access token using Xbox Live flow
pub async fn refresh_token(refresh_tok: &str) -> Result<TokenResponse, Box<dyn Error + Send + Sync>> {
    let client = create_client();
    
    let response = client
        .post("https://login.live.com/oauth20_token.srf")
        .form(&[
            ("client_id", MICROSOFT_CLIENT_ID),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_tok),
            ("scope", "service::user.auth.xboxlive.com::MBI_SSL"),
        ])
        .send()
        .await?;
    
    let token: TokenResponse = response.json().await?;
    
    if let Some(error) = &token.error {
        return Err(error.clone().into());
    }
    
    Ok(token)
}

/// Get the accounts file path
fn get_accounts_file() -> PathBuf {
    get_minecraft_dir().join("accounts.json")
}

/// Load saved accounts from disk
pub fn load_accounts() -> AccountsData {
    let path = get_accounts_file();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(data) = serde_json::from_str(&content) {
                return data;
            }
        }
    }
    AccountsData::default()
}

/// Save accounts to disk
pub fn save_accounts(data: &AccountsData) -> Result<(), String> {
    let path = get_accounts_file();
    
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    
    let content = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    
    Ok(())
}

/// Add or update an account
pub fn add_account(account: SavedAccount) -> Result<(), String> {
    let mut data = load_accounts();
    
    // Check if account already exists (by uuid for microsoft, by username for offline)
    let existing_index = if account.is_microsoft {
        data.accounts.iter().position(|a| a.uuid == account.uuid && a.is_microsoft)
    } else {
        data.accounts.iter().position(|a| a.username == account.username && !a.is_microsoft)
    };
    
    if let Some(idx) = existing_index {
        data.accounts[idx] = account.clone();
    } else {
        data.accounts.push(account.clone());
    }
    
    // Set as active if it's the only account
    if data.accounts.len() == 1 || data.active_account.is_none() {
        data.active_account = Some(account.username);
    }
    
    save_accounts(&data)
}

/// Remove an account
pub fn remove_account(username: &str) -> Result<(), String> {
    let mut data = load_accounts();
    
    data.accounts.retain(|a| a.username != username);
    
    // Clear active account if it was removed
    if data.active_account.as_deref() == Some(username) {
        data.active_account = data.accounts.first().map(|a| a.username.clone());
    }
    
    save_accounts(&data)
}

/// Set active account
pub fn set_active_account(username: &str) -> Result<(), String> {
    let mut data = load_accounts();
    
    if data.accounts.iter().any(|a| a.username == username) {
        data.active_account = Some(username.to_string());
        save_accounts(&data)
    } else {
        Err("Account not found".to_string())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FullProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub skins: Vec<SkinInfo>,
    #[serde(default)]
    pub capes: Vec<CapeInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkinInfo {
    pub id: String,
    pub state: String,
    pub url: String,
    pub variant: String,
    #[serde(default)]
    pub alias: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CapeInfo {
    pub id: String,
    pub state: String,
    pub url: String,
    pub alias: String,
}

/// Get full Minecraft profile including skins and capes
pub async fn get_full_profile(mc_token: &str) -> Result<FullProfile, Box<dyn Error + Send + Sync>> {
    let client = create_client();
    
    let response = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .header("Authorization", format!("Bearer {}", mc_token))
        .send()
        .await?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_body = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Failed to fetch profile (Status {}): {}", status, error_body).into());
    }
    
    let profile: FullProfile = response.json().await?;
    Ok(profile)
}

/// Upload a skin to Minecraft
pub async fn upload_mc_skin(mc_token: &str, file_path: &str, variant: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = create_client();
    let file_bytes = fs::read(file_path)?;
    
    let part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name("skin.png")
        .mime_str("image/png")?;
    
    let form = reqwest::multipart::Form::new()
        .text("variant", if variant.to_lowercase() == "slim" { "slim" } else { "classic" })
        .part("file", part);
    
    let response = client
        .post("https://api.minecraftservices.com/minecraft/profile/skins")
        .header("Authorization", format!("Bearer {}", mc_token))
        .multipart(form)
        .send()
        .await?;
    
    if !response.status().is_success() {
        let text = response.text().await?;
        return Err(format!("Failed to upload skin: {}", text).into());
    }
    
    Ok(())
}

/// Reset skin to default Steve
pub async fn reset_mc_skin(mc_token: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = create_client();
    
    // Upload the default Steve skin via URL
    // This is the official Mojang Steve texture URL
    let response = client
        .post("https://api.minecraftservices.com/minecraft/profile/skins")
        .header("Authorization", format!("Bearer {}", mc_token))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "variant": "classic",
            "url": "http://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb"
        }))
        .send()
        .await?;
        
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Failed to reset skin (Status {}): {}", status, body).into());
    }
    
    Ok(())
}

/// Validate a Microsoft account by checking if the token still works
pub async fn validate_token(access_token: &str) -> bool {
    let client = create_client();
    
    let response = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await;
    
    match response {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}
