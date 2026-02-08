use std::sync::{mpsc, LazyLock, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DISCORD_APP_ID: &str = "1470118432929484963";

enum DiscordCommand {
    UpdatePresence { running_count: usize },
    Shutdown,
}

static DISCORD_SENDER: LazyLock<Mutex<Option<mpsc::Sender<DiscordCommand>>>> =
    LazyLock::new(|| Mutex::new(None));

pub fn init() {
    let (tx, rx) = mpsc::channel();

    if let Ok(mut sender) = DISCORD_SENDER.lock() {
        *sender = Some(tx);
    }

    std::thread::spawn(move || {
        discord_thread(rx);
    });
}

fn discord_thread(rx: mpsc::Receiver<DiscordCommand>) {
    use discord_rich_presence::{DiscordIpc, DiscordIpcClient};

    let start_time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let mut last_running_count: usize = 0;

    // Try to create and connect the client
    let mut client: Option<DiscordIpcClient> = try_connect();

    if let Some(ref mut c) = client {
        let _ = apply_presence(c, 0, start_time);
        log::info!("Discord Rich Presence connected");
    } else {
        log::info!("Discord not available, will retry in background");
    }

    loop {
        match rx.recv_timeout(Duration::from_secs(15)) {
            Ok(DiscordCommand::UpdatePresence { running_count }) => {
                last_running_count = running_count;
                println!("[Discord] UpdatePresence received: running_count={}", running_count);
                if let Some(ref mut c) = client {
                    match apply_presence(c, running_count, start_time) {
                        Ok(_) => println!("[Discord] Presence applied successfully"),
                        Err(e) => {
                            println!("[Discord] apply_presence failed: {}", e);
                            let _ = c.close();
                            client = None;
                        }
                    }
                } else {
                    println!("[Discord] Client not connected, trying to connect now");
                    client = try_connect();
                    if let Some(ref mut c) = client {
                        let _ = apply_presence(c, running_count, start_time);
                        println!("[Discord] Reconnected and applied presence");
                    }
                }
            }
            Ok(DiscordCommand::Shutdown) => {
                if let Some(ref mut c) = client {
                    let _ = c.close();
                }
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Some(ref mut c) = client {
                    // Probe the connection by re-setting presence; detects Discord restarts
                    if apply_presence(c, last_running_count, start_time).is_err() {
                        let _ = c.close();
                        client = None;
                        log::info!("Discord connection lost, will retry");
                    }
                }
                if client.is_none() {
                    client = try_connect();
                    if let Some(ref mut c) = client {
                        let _ = apply_presence(c, last_running_count, start_time);
                        log::info!("Discord Rich Presence reconnected");
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                if let Some(ref mut c) = client {
                    let _ = c.close();
                }
                break;
            }
        }
    }
}

fn try_connect() -> Option<discord_rich_presence::DiscordIpcClient> {
    use discord_rich_presence::{DiscordIpc, DiscordIpcClient};

    let mut c = DiscordIpcClient::new(DISCORD_APP_ID).ok()?;
    c.connect().ok()?;
    Some(c)
}

fn apply_presence(
    client: &mut discord_rich_presence::DiscordIpcClient,
    running_count: usize,
    start_time: i64,
) -> Result<(), Box<dyn std::error::Error>> {
    use discord_rich_presence::{activity, DiscordIpc};

    let details = if running_count == 0 {
        "No instances running".to_string()
    } else {
        format!(
            "Currently playing {} instance{}",
            running_count,
            if running_count == 1 { "" } else { "s" }
        )
    };

    client.set_activity(
        activity::Activity::new()
            .details(&details)
            .timestamps(activity::Timestamps::new().start(start_time))
            .assets(
                activity::Assets::new()
                    .large_image("palethea")
                    .large_text("Palethea Launcher"),
            ),
    )?;

    Ok(())
}

pub fn update_presence(running_count: usize) {
    if let Ok(sender) = DISCORD_SENDER.lock() {
        if let Some(tx) = sender.as_ref() {
            let _ = tx.send(DiscordCommand::UpdatePresence { running_count });
        }
    }
}

pub fn shutdown() {
    if let Ok(sender) = DISCORD_SENDER.lock() {
        if let Some(tx) = sender.as_ref() {
            let _ = tx.send(DiscordCommand::Shutdown);
        }
    }
}
