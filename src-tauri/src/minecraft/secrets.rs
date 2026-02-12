const CURSEFORGE_API_KEY_ENV: &str = "CURSEFORGE_API_KEY";
const CURSEFORGE_API_KEY_BUILD_TIME: Option<&str> = option_env!("CURSEFORGE_API_KEY");

fn sanitize_api_key(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn get_curseforge_api_key() -> Option<String> {
    let runtime_key = std::env::var(CURSEFORGE_API_KEY_ENV)
        .ok()
        .as_deref()
        .and_then(sanitize_api_key);

    if runtime_key.is_some() {
        runtime_key
    } else {
        CURSEFORGE_API_KEY_BUILD_TIME.and_then(sanitize_api_key)
    }
}

pub fn has_curseforge_api_key() -> bool {
    get_curseforge_api_key().is_some()
}
