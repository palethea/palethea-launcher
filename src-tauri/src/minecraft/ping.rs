use tokio::net::TcpStream;
use tokio::io::{AsyncWriteExt, AsyncReadExt};
use std::time::Instant;
use serde::{Serialize, Deserialize};
use serde_json::Value;
use trust_dns_resolver::TokioAsyncResolver;
use trust_dns_resolver::config::*;

#[derive(Debug, Serialize, Deserialize)]
pub struct PingResponse {
    pub latency_ms: u64,
    pub version_name: String,
    pub protocol_version: i32,
    pub max_players: i32,
    pub online_players: i32,
    pub motd: String,
    pub motd_html: Option<String>,
    pub favicon: Option<String>,
}

fn parse_data_url_favicon(icon: Option<&str>) -> Option<String> {
    let raw = icon?;
    if let Some(base64) = raw.strip_prefix("data:image/png;base64,") {
        return Some(base64.to_string());
    }
    None
}

async fn fetch_mcstatus_enrichment(address: &str) -> Option<PingResponse> {
    let encoded = urlencoding::encode(address);
    let url = format!("https://api.mcstatus.io/v2/status/java/{}", encoded);

    let response = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        super::http_client().get(url).send(),
    ).await.ok()?.ok()?;

    if !response.status().is_success() {
        return None;
    }

    let json: Value = response.json().await.ok()?;
    if !json.get("online").and_then(|v| v.as_bool()).unwrap_or(false) {
        return None;
    }

    let motd = json
        .pointer("/motd/raw")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string())
        .unwrap_or_default();

    if motd.is_empty() {
        return None;
    }

    let online_players = json
        .pointer("/players/online")
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i32;

    let max_players = json
        .pointer("/players/max")
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i32;

    let version_name = json
        .pointer("/version/name_raw")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown")
        .to_string();

    let protocol_version = json
        .pointer("/version/protocol")
        .and_then(|v| v.as_i64())
        .unwrap_or(-1) as i32;

    let favicon = parse_data_url_favicon(json.get("icon").and_then(|v| v.as_str()));
    let motd_html = json
        .pointer("/motd/html")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string());

    Some(PingResponse {
        latency_ms: 0,
        version_name,
        protocol_version,
        max_players,
        online_players,
        motd,
        motd_html,
        favicon,
    })
}

#[derive(Debug, Deserialize)]
struct StatusResponse {
    version: StatusVersion,
    players: StatusPlayers,
    description: serde_json::Value,
    favicon: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StatusVersion {
    name: String,
    protocol: i32,
}

#[derive(Debug, Deserialize)]
struct StatusPlayers {
    max: i32,
    online: i32,
}

async fn write_varint(buf: &mut Vec<u8>, mut val: i32) {
    loop {
        let mut b = (val & 0x7F) as u8;
        val >>= 7;
        if val != 0 {
            b |= 0x80;
        }
        buf.push(b);
        if val == 0 {
            break;
        }
    }
}

async fn write_string(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    write_varint(buf, bytes.len() as i32).await;
    buf.extend_from_slice(bytes);
}

async fn read_varint<R: AsyncReadExt + Unpin>(r: &mut R) -> tokio::io::Result<i32> {
    let mut val = 0;
    let mut shift = 0;
    loop {
        let b = r.read_u8().await?;
        val |= ((b & 0x7F) as i32) << shift;
        if b & 0x80 == 0 {
            break;
        }
        shift += 7;
        if shift >= 32 {
            return Err(tokio::io::Error::new(tokio::io::ErrorKind::InvalidData, "VarInt too big"));
        }
    }
    Ok(val)
}

fn parse_motd(description: &serde_json::Value) -> String {
    #[derive(Clone, Default)]
    struct MotdStyle {
        color: Option<String>,
        bold: bool,
        italic: bool,
        underlined: bool,
        strikethrough: bool,
        obfuscated: bool,
    }

    fn color_to_code(color: &str) -> Option<&'static str> {
        match color.to_ascii_lowercase().as_str() {
            "black" => Some("0"),
            "dark_blue" => Some("1"),
            "dark_green" => Some("2"),
            "dark_aqua" => Some("3"),
            "dark_red" => Some("4"),
            "dark_purple" => Some("5"),
            "gold" => Some("6"),
            "gray" => Some("7"),
            "dark_gray" => Some("8"),
            "blue" => Some("9"),
            "green" => Some("a"),
            "aqua" => Some("b"),
            "red" => Some("c"),
            "light_purple" => Some("d"),
            "yellow" => Some("e"),
            "white" => Some("f"),
            _ => None,
        }
    }

    fn style_prefix(style: &MotdStyle) -> String {
        let mut prefix = String::new();
        let has_any_style = style.color.is_some()
            || style.bold
            || style.italic
            || style.underlined
            || style.strikethrough
            || style.obfuscated;

        if !has_any_style {
            prefix.push_str("§r");
            return prefix;
        }

        if let Some(color) = &style.color {
            if let Some(code) = color_to_code(color) {
                prefix.push('§');
                prefix.push_str(code);
            }
        }
        if style.bold {
            prefix.push_str("§l");
        }
        if style.strikethrough {
            prefix.push_str("§m");
        }
        if style.underlined {
            prefix.push_str("§n");
        }
        if style.italic {
            prefix.push_str("§o");
        }
        if style.obfuscated {
            prefix.push_str("§k");
        }

        prefix
    }

    fn parse_component(component: &serde_json::Value, inherited_style: &MotdStyle) -> String {
        if let Some(text) = component.as_str() {
            if text.is_empty() {
                return String::new();
            }
            return format!("{}{}", style_prefix(inherited_style), text);
        }

        if let Some(array) = component.as_array() {
            return array
                .iter()
                .map(|part| parse_component(part, inherited_style))
                .collect::<String>();
        }

        if let Some(obj) = component.as_object() {
            let mut style = inherited_style.clone();

            if let Some(color) = obj.get("color").and_then(|v| v.as_str()) {
                if color.eq_ignore_ascii_case("reset") {
                    style = MotdStyle::default();
                } else {
                    style.color = Some(color.to_string());
                }
            }
            if let Some(bold) = obj.get("bold").and_then(|v| v.as_bool()) {
                style.bold = bold;
            }
            if let Some(italic) = obj.get("italic").and_then(|v| v.as_bool()) {
                style.italic = italic;
            }
            if let Some(underlined) = obj.get("underlined").and_then(|v| v.as_bool()) {
                style.underlined = underlined;
            }
            if let Some(strikethrough) = obj.get("strikethrough").and_then(|v| v.as_bool()) {
                style.strikethrough = strikethrough;
            }
            if let Some(obfuscated) = obj.get("obfuscated").and_then(|v| v.as_bool()) {
                style.obfuscated = obfuscated;
            }

            let mut output = String::new();

            if let Some(text) = obj.get("text").and_then(|v| v.as_str()) {
                if !text.is_empty() {
                    output.push_str(&style_prefix(&style));
                    output.push_str(text);
                }
            }

            if let Some(extra) = obj.get("extra").and_then(|v| v.as_array()) {
                for part in extra {
                    output.push_str(&parse_component(part, &style));
                }
            }

            return output;
        }

        String::new()
    }

    parse_component(description, &MotdStyle::default())
}

pub async fn ping_server(address: &str) -> Result<PingResponse, String> {
    let address = address.trim();
    let parts: Vec<&str> = address.split(':').collect();
    let original_host = parts[0];
    let mut host = original_host.to_string();
    let mut port = if parts.len() > 1 {
        parts[1].parse::<u16>().map_err(|_| "Invalid port")?
    } else {
        25565
    };

    // Try SRV lookup with a more robust configuration
    if parts.len() == 1 {
        // Use Cloudflare as a reliable DNS provider
        let resolver = TokioAsyncResolver::tokio(ResolverConfig::cloudflare(), ResolverOpts::default());
        let srv_query = format!("_minecraft._tcp.{}", original_host);
        if let Ok(srv_lookup) = resolver.srv_lookup(srv_query).await {
            if let Some(srv) = srv_lookup.iter().next() {
                host = srv.target().to_string().trim_end_matches('.').to_string();
                port = srv.port();
            }
        }
    }

    let start = Instant::now();
    
    // Wrap connection and status exchange in a combined timeout
    let ping_future = async {
        let mut stream = TcpStream::connect(format!("{}:{}", host, port)).await
            .map_err(|e| format!("Connection failed: {}", e))?;
        
        // Measure real network latency as just the connection time
        let network_latency = start.elapsed().as_millis() as u64;

        // 1. Handshake
        let mut handshake = Vec::new();
        write_varint(&mut handshake, 0x00).await; // Packet ID
        write_varint(&mut handshake, 47).await;   // Protocol Version (1.8.x)
        write_string(&mut handshake, original_host).await;
        handshake.extend_from_slice(&port.to_be_bytes());
        write_varint(&mut handshake, 1).await; // Next state (1 = status)

        let mut packet = Vec::new();
        write_varint(&mut packet, handshake.len() as i32).await;
        packet.extend_from_slice(&handshake);
        stream.write_all(&packet).await.map_err(|e| format!("Handshake write failed: {}", e))?;

        // 2. Status Request
        let mut status_request = Vec::new();
        write_varint(&mut status_request, 0x00).await; // Packet ID
        
        let mut packet = Vec::new();
        write_varint(&mut packet, status_request.len() as i32).await;
        packet.extend_from_slice(&status_request);
        stream.write_all(&packet).await.map_err(|e| format!("Status request failed: {}", e))?;

        // 3. Read Status Response
        let _len = read_varint(&mut stream).await.map_err(|e| format!("Read length failed: {}", e))?;
        let id = read_varint(&mut stream).await.map_err(|e| format!("Read ID failed: {}", e))?;
        if id != 0x00 {
            return Err(format!("Unexpected packet ID: {}", id));
        }

        let json_len = read_varint(&mut stream).await.map_err(|e| format!("Read JSON length failed: {}", e))? as usize;
        let mut json_bytes = vec![0u8; json_len];
        stream.read_exact(&mut json_bytes).await.map_err(|e| format!("Read JSON data failed: {}", e))?;

        let response: StatusResponse = serde_json::from_slice(&json_bytes).map_err(|e| format!("JSON decode failed: {}", e))?;
        
        // Use the connection latency for the main display, as it's the most stable metric
        Ok(PingResponse {
            latency_ms: network_latency,
            version_name: response.version.name,
            protocol_version: response.version.protocol,
            max_players: response.players.max,
            online_players: response.players.online,
            motd: parse_motd(&response.description),
            motd_html: None,
            favicon: response.favicon,
        })
    };

    match tokio::time::timeout(std::time::Duration::from_secs(10), ping_future).await {
        Ok(res) => {
            let mut base = res?;

            if let Some(enriched) = fetch_mcstatus_enrichment(address).await {
                base.motd = enriched.motd;
                if enriched.online_players >= 0 {
                    base.online_players = enriched.online_players;
                }
                if enriched.max_players >= 0 {
                    base.max_players = enriched.max_players;
                }
                if !enriched.version_name.is_empty() && enriched.version_name != "Unknown" {
                    base.version_name = enriched.version_name;
                }
                if enriched.motd_html.is_some() {
                    base.motd_html = enriched.motd_html;
                }
                if base.favicon.is_none() {
                    base.favicon = enriched.favicon;
                }
            }

            Ok(base)
        }
        Err(_) => Err(format!("Ping timed out (tried {}:{})", host, port)),
    }
}
