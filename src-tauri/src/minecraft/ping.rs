use tokio::net::TcpStream;
use tokio::io::{AsyncWriteExt, AsyncReadExt};
use std::time::Instant;
use serde::{Serialize, Deserialize};
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
    pub favicon: Option<String>,
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
    if let Some(text) = description.as_str() {
        return text.to_string();
    }
    if let Some(obj) = description.as_object() {
        if let Some(text) = obj.get("text") {
            let mut result = text.as_str().unwrap_or("").to_string();
            if let Some(extra) = obj.get("extra").and_then(|e| e.as_array()) {
                for part in extra {
                    result.push_str(&parse_motd(part));
                }
            }
            return result;
        }
    }
    "".to_string()
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
            favicon: response.favicon,
        })
    };

    match tokio::time::timeout(std::time::Duration::from_secs(10), ping_future).await {
        Ok(res) => res,
        Err(_) => Err(format!("Ping timed out (tried {}:{})", host, port)),
    }
}
