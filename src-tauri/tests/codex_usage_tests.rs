use codex_auth_switch_lib::core::{ProfileInput, ProfileManager};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use std::thread;
use std::time::Duration;
use tempfile::TempDir;

fn oauth_auth_json(
    email: &str,
    user_id: &str,
    account_id: &str,
    access_token: &str,
) -> String {
    let payload = json!({
        "email": email,
        "https://api.openai.com/auth": {
            "chatgpt_user_id": user_id,
            "chatgpt_account_id": account_id,
            "chatgpt_plan_type": "team"
        }
    });

    let encoded_payload = base64_fragment(&payload.to_string());

    json!({
        "auth_mode": "chatgpt",
        "OPENAI_API_KEY": null,
        "tokens": {
            "id_token": format!("header.{encoded_payload}.signature"),
            "access_token": access_token,
            "account_id": account_id
        }
    })
    .to_string()
}

fn api_key_auth_json(token: &str) -> String {
    format!(r#"{{"OPENAI_API_KEY":"{token}"}}"#)
}

fn base64_fragment(value: &str) -> String {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;

    URL_SAFE_NO_PAD.encode(value)
}

fn official_config_toml(model: &str) -> String {
    format!(
        r#"model = "{model}"
model_reasoning_effort = "medium"
"#
    )
}

fn temp_manager() -> (TempDir, TempDir, ProfileManager) {
    let app_dir = TempDir::new().expect("temp app dir");
    let target_dir = TempDir::new().expect("temp target dir");
    let manager = ProfileManager::new(
        app_dir.path().to_path_buf(),
        target_dir.path().to_path_buf(),
    )
    .expect("create manager");

    (app_dir, target_dir, manager)
}

struct TestServer {
    base_url: String,
    responses: Arc<Mutex<HashMap<String, (String, String)>>>,
    requests: Arc<Mutex<Vec<String>>>,
    shutdown: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl TestServer {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        listener
            .set_nonblocking(true)
            .expect("set listener nonblocking");
        let address = listener.local_addr().expect("resolve local addr");
        let responses = Arc::new(Mutex::new(HashMap::new()));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let shutdown = Arc::new(AtomicBool::new(false));
        let thread_responses = Arc::clone(&responses);
        let thread_requests = Arc::clone(&requests);
        let thread_shutdown = Arc::clone(&shutdown);

        let handle = thread::spawn(move || {
            while !thread_shutdown.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let mut buffer = [0_u8; 8192];
                        let bytes_read = stream.read(&mut buffer).unwrap_or(0);
                        if bytes_read == 0 {
                            continue;
                        }

                        let request = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();
                        thread_requests.lock().expect("lock requests").push(request.clone());

                        let path = request
                            .lines()
                            .next()
                            .and_then(|line| line.split_whitespace().nth(1))
                            .unwrap_or("/");

                        let response = thread_responses
                            .lock()
                            .expect("lock responses")
                            .get(path)
                            .cloned();

                        let (status, content_type, body) = match response {
                            Some((content_type, body)) => ("200 OK", content_type, body),
                            None => (
                                "404 Not Found",
                                "text/plain".to_string(),
                                "not found".to_string(),
                            ),
                        };

                        let payload = format!(
                            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: {content_type}\r\nConnection: close\r\n\r\n{body}",
                            body.len()
                        );
                        let _ = stream.write_all(payload.as_bytes());
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });

        Self {
            base_url: format!("http://127.0.0.1:{}", address.port()),
            responses,
            requests,
            shutdown,
            handle: Some(handle),
        }
    }

    fn set_json(&self, path: &str, body: serde_json::Value) {
        self.responses.lock().expect("lock responses").insert(
            path.to_string(),
            ("application/json".into(), body.to_string()),
        );
    }

    fn requests(&self) -> Vec<String> {
        self.requests.lock().expect("lock requests").clone()
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[test]
fn snapshot_reports_codex_usage_api_setting() {
    let (_app_dir, _target_dir, manager) = temp_manager();

    let snapshot = manager.snapshot().expect("snapshot");

    assert!(!snapshot.codex_usage_api_enabled);
}

#[test]
fn refresh_profile_codex_usage_requires_opt_in() {
    let (_app_dir, _target_dir, manager) = temp_manager();
    let profile = manager
        .import_profile(ProfileInput {
            name: "Official Team".into(),
            notes: "oauth".into(),
            auth_json: oauth_auth_json(
                "team@example.com",
                "user-test",
                "account-test",
                "access-token-test",
            ),
            config_toml: official_config_toml("gpt-5.4"),
        })
        .expect("import profile");

    let error = manager
        .refresh_profile_codex_usage(&profile.id)
        .expect_err("refresh should require opt-in");

    assert!(error.to_string().contains("enable"));
}

#[test]
fn refresh_profile_codex_usage_fetches_private_api_and_persists_snapshot() {
    let _guard = env_lock().lock().expect("lock env");
    let server = TestServer::start();
    server.set_json(
        "/backend-api/wham/usage",
        json!({
            "user_id": "user-test",
            "account_id": "account-test",
            "email": "team@example.com",
            "plan_type": "team",
            "rate_limit": {
                "allowed": true,
                "limit_reached": false,
                "primary_window": {
                    "used_percent": 24,
                    "limit_window_seconds": 18000,
                    "reset_at": 1773491460
                },
                "secondary_window": {
                    "used_percent": 7,
                    "limit_window_seconds": 604800,
                    "reset_at": 1773749620
                }
            },
            "credits": {
                "has_credits": false,
                "unlimited": false,
                "balance": null
            }
        }),
    );

    std::env::set_var(
        "CODEX_AUTH_SWITCH_CODEX_USAGE_ENDPOINT",
        format!("{}/backend-api/wham/usage", server.base_url),
    );

    let (_app_dir, _target_dir, mut manager) = temp_manager();
    let profile = manager
        .import_profile(ProfileInput {
            name: "Official Team".into(),
            notes: "oauth".into(),
            auth_json: oauth_auth_json(
                "team@example.com",
                "user-test",
                "account-test",
                "access-token-test",
            ),
            config_toml: official_config_toml("gpt-5.4"),
        })
        .expect("import profile");

    manager
        .set_codex_usage_api_enabled(true)
        .expect("enable usage api");

    let refreshed = manager
        .refresh_profile_codex_usage(&profile.id)
        .expect("refresh usage");

    let usage = refreshed.codex_usage.expect("usage snapshot");
    assert_eq!(usage.source, "api");
    assert_eq!(usage.plan_type.as_deref(), Some("team"));
    assert_eq!(
        usage.primary
            .as_ref()
            .and_then(|window| window.window_minutes),
        Some(300)
    );
    assert_eq!(
        usage.secondary
            .as_ref()
            .and_then(|window| window.window_minutes),
        Some(10080)
    );
    assert_eq!(
        usage.primary
            .as_ref()
            .map(|window| window.used_percent),
        Some(24.0)
    );

    let snapshot = manager.snapshot().expect("snapshot after refresh");
    assert!(snapshot.codex_usage_api_enabled);
    let stored = snapshot
        .profiles
        .into_iter()
        .find(|candidate| candidate.id == profile.id)
        .and_then(|candidate| candidate.codex_usage)
        .expect("stored usage");
    assert_eq!(stored.plan_type.as_deref(), Some("team"));

    let requests = server.requests();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].contains("GET /backend-api/wham/usage HTTP/1.1"));
    assert!(requests[0].contains("Authorization: Bearer access-token-test"));
    assert!(requests[0].contains("ChatGPT-Account-Id: account-test"));

    std::env::remove_var("CODEX_AUTH_SWITCH_CODEX_USAGE_ENDPOINT");
    let _ = fs::metadata("/tmp");
}

#[test]
fn update_profile_clears_stale_codex_usage_when_auth_changes() {
    let _guard = env_lock().lock().expect("lock env");
    let server = TestServer::start();
    server.set_json(
        "/backend-api/wham/usage",
        json!({
            "plan_type": "team",
            "rate_limit": {
                "primary_window": {
                    "used_percent": 24,
                    "limit_window_seconds": 18000,
                    "reset_at": 1773491460
                },
                "secondary_window": {
                    "used_percent": 7,
                    "limit_window_seconds": 604800,
                    "reset_at": 1773749620
                }
            }
        }),
    );
    std::env::set_var(
        "CODEX_AUTH_SWITCH_CODEX_USAGE_ENDPOINT",
        format!("{}/backend-api/wham/usage", server.base_url),
    );

    let (_app_dir, _target_dir, mut manager) = temp_manager();
    let profile = manager
        .import_profile(ProfileInput {
            name: "Official Team".into(),
            notes: "oauth".into(),
            auth_json: oauth_auth_json(
                "team@example.com",
                "user-test",
                "account-test",
                "access-token-test",
            ),
            config_toml: official_config_toml("gpt-5.4"),
        })
        .expect("import profile");
    manager
        .set_codex_usage_api_enabled(true)
        .expect("enable usage api");
    manager
        .refresh_profile_codex_usage(&profile.id)
        .expect("refresh usage");

    let updated = manager
        .update_profile(
            &profile.id,
            ProfileInput {
                name: "API Key Profile".into(),
                notes: "changed auth".into(),
                auth_json: api_key_auth_json("sk-new"),
                config_toml: official_config_toml("gpt-5.4"),
            },
        )
        .expect("update profile");

    assert!(updated.codex_usage.is_none());

    std::env::remove_var("CODEX_AUTH_SWITCH_CODEX_USAGE_ENDPOINT");
}
