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
use std::time::{Duration, Instant};
use tempfile::TempDir;

fn oauth_auth_json(email: &str, user_id: &str, account_id: &str, access_token: &str) -> String {
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

fn oauth_auth_json_with_refresh(
    email: &str,
    user_id: &str,
    account_id: &str,
    access_token: &str,
    refresh_token: &str,
) -> String {
    let mut auth = serde_json::from_str::<serde_json::Value>(&oauth_auth_json(
        email,
        user_id,
        account_id,
        access_token,
    ))
    .expect("parse oauth auth");

    let tokens = auth
        .get_mut("tokens")
        .and_then(|value| value.as_object_mut())
        .expect("tokens object");
    tokens.insert(
        "refresh_token".into(),
        serde_json::Value::String(refresh_token.to_string()),
    );
    auth.as_object_mut().expect("auth object").insert(
        "last_refresh".into(),
        serde_json::Value::String("2026-04-05T09:59:00Z".into()),
    );

    auth.to_string()
}

fn oauth_refresh_response(
    email: &str,
    user_id: &str,
    account_id: &str,
    access_token: &str,
    refresh_token: &str,
) -> serde_json::Value {
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
        "access_token": access_token,
        "refresh_token": refresh_token,
        "id_token": format!("header.{encoded_payload}.signature"),
        "token_type": "Bearer",
        "expires_in": 3600,
        "scope": "openid profile email offline_access"
    })
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
    responses: Arc<Mutex<HashMap<String, (String, String, Duration)>>>,
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
                        thread_requests
                            .lock()
                            .expect("lock requests")
                            .push(request.clone());

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

                        let (status, content_type, body, delay) = match response {
                            Some((content_type, body, delay)) => {
                                ("200 OK", content_type, body, delay)
                            }
                            None => (
                                "404 Not Found",
                                "text/plain".to_string(),
                                "not found".to_string(),
                                Duration::from_millis(0),
                            ),
                        };

                        if !delay.is_zero() {
                            thread::sleep(delay);
                        }

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
            (
                "application/json".into(),
                body.to_string(),
                Duration::from_millis(0),
            ),
        );
    }

    fn set_json_with_delay(&self, path: &str, body: serde_json::Value, delay: Duration) {
        self.responses.lock().expect("lock responses").insert(
            path.to_string(),
            ("application/json".into(), body.to_string(), delay),
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
fn switch_profile_refreshes_oauth_tokens_before_writing_target_files() {
    let _guard = env_lock().lock().expect("lock env");
    let server = TestServer::start();
    server.set_json(
        "/oauth/token",
        oauth_refresh_response(
            "team@example.com",
            "user-test",
            "account-test",
            "access-token-fresh",
            "refresh-token-fresh",
        ),
    );
    std::env::set_var(
        "CODEX_REFRESH_TOKEN_URL_OVERRIDE",
        format!("{}/oauth/token", server.base_url),
    );

    let (_app_dir, target_dir, mut manager) = temp_manager();
    let profile = manager
        .import_profile(ProfileInput {
            name: "Official Team".into(),
            notes: "oauth".into(),
            auth_json: oauth_auth_json_with_refresh(
                "team@example.com",
                "user-test",
                "account-test",
                "access-token-stale",
                "refresh-token-stale",
            ),
            config_toml: official_config_toml("gpt-5.4"),
        })
        .expect("import profile");

    manager
        .switch_profile(&profile.id)
        .expect("switch profile should refresh auth");

    let requests = server.requests();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].contains("POST /oauth/token HTTP/1.1"));
    assert!(requests[0].contains("grant_type=refresh_token"));
    assert!(requests[0].contains("client_id=app_EMoamEEZ73f0CkXaXp7hrann"));
    assert!(requests[0].contains("refresh_token=refresh-token-stale"));

    let active_auth =
        fs::read_to_string(target_dir.path().join("auth.json")).expect("read refreshed auth");
    assert!(active_auth.contains("access-token-fresh"));
    assert!(active_auth.contains("refresh-token-fresh"));
    assert!(!active_auth.contains("access-token-stale"));

    let saved = manager
        .get_profile_document(&profile.id)
        .expect("load synced profile");
    assert!(saved.auth_json.contains("access-token-fresh"));
    assert!(saved.auth_json.contains("refresh-token-fresh"));

    std::env::remove_var("CODEX_REFRESH_TOKEN_URL_OVERRIDE");
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
        usage
            .primary
            .as_ref()
            .and_then(|window| window.window_minutes),
        Some(300)
    );
    assert_eq!(
        usage
            .secondary
            .as_ref()
            .and_then(|window| window.window_minutes),
        Some(10080)
    );
    assert_eq!(
        usage.primary.as_ref().map(|window| window.used_percent),
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
fn refresh_profile_codex_usage_refreshes_token_before_requesting_usage_api() {
    let _guard = env_lock().lock().expect("lock env");
    let server = TestServer::start();
    server.set_json(
        "/oauth/token",
        oauth_refresh_response(
            "team@example.com",
            "user-test",
            "account-test",
            "access-token-fresh",
            "refresh-token-fresh",
        ),
    );
    server.set_json(
        "/backend-api/wham/usage",
        json!({
            "user_id": "user-test",
            "account_id": "account-test",
            "email": "team@example.com",
            "plan_type": "team",
            "rate_limit": {
                "primary_window": {
                    "used_percent": 24,
                    "limit_window_seconds": 18000,
                    "reset_at": 1773491460
                }
            }
        }),
    );

    std::env::set_var(
        "CODEX_REFRESH_TOKEN_URL_OVERRIDE",
        format!("{}/oauth/token", server.base_url),
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
            auth_json: oauth_auth_json_with_refresh(
                "team@example.com",
                "user-test",
                "account-test",
                "access-token-stale",
                "refresh-token-stale",
            ),
            config_toml: official_config_toml("gpt-5.4"),
        })
        .expect("import profile");

    manager
        .set_codex_usage_api_enabled(true)
        .expect("enable usage api");

    manager
        .refresh_profile_codex_usage(&profile.id)
        .expect("refresh usage should refresh auth first");

    let requests = server.requests();
    assert_eq!(requests.len(), 2);
    assert!(requests[0].contains("POST /oauth/token HTTP/1.1"));
    assert!(requests[0].contains("refresh_token=refresh-token-stale"));
    assert!(requests[1].contains("GET /backend-api/wham/usage HTTP/1.1"));
    assert!(requests[1].contains("Authorization: Bearer access-token-fresh"));

    let saved = manager
        .get_profile_document(&profile.id)
        .expect("load synced profile");
    assert!(saved.auth_json.contains("access-token-fresh"));
    assert!(saved.auth_json.contains("refresh-token-fresh"));

    std::env::remove_var("CODEX_AUTH_SWITCH_CODEX_USAGE_ENDPOINT");
    std::env::remove_var("CODEX_REFRESH_TOKEN_URL_OVERRIDE");
}

#[test]
fn refresh_profile_codex_usage_uses_active_target_auth_and_syncs_profile() {
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
                "primary_window": {
                    "used_percent": 24,
                    "limit_window_seconds": 18000,
                    "reset_at": 1773491460
                }
            }
        }),
    );

    std::env::set_var(
        "CODEX_AUTH_SWITCH_CODEX_USAGE_ENDPOINT",
        format!("{}/backend-api/wham/usage", server.base_url),
    );

    let (_app_dir, target_dir, mut manager) = temp_manager();
    let profile = manager
        .import_profile(ProfileInput {
            name: "Official Team".into(),
            notes: "oauth".into(),
            auth_json: oauth_auth_json(
                "team@example.com",
                "user-test",
                "account-test",
                "access-token-stale",
            ),
            config_toml: official_config_toml("gpt-5.4"),
        })
        .expect("import profile");

    manager
        .switch_profile(&profile.id)
        .expect("switch active profile");

    fs::write(
        target_dir.path().join("auth.json"),
        oauth_auth_json(
            "team@example.com",
            "user-test",
            "account-test",
            "access-token-fresh",
        ),
    )
    .expect("rewrite target auth");

    manager
        .set_codex_usage_api_enabled(true)
        .expect("enable usage api");

    manager
        .refresh_profile_codex_usage(&profile.id)
        .expect("refresh usage");

    let requests = server.requests();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].contains("Authorization: Bearer access-token-fresh"));

    let saved = manager
        .get_profile_document(&profile.id)
        .expect("load synced profile");
    assert!(saved.auth_json.contains("access-token-fresh"));

    std::env::remove_var("CODEX_AUTH_SWITCH_CODEX_USAGE_ENDPOINT");
}

#[test]
fn refresh_profile_codex_usage_keeps_non_active_profile_on_saved_auth() {
    let _guard = env_lock().lock().expect("lock env");
    let server = TestServer::start();
    server.set_json(
        "/backend-api/wham/usage",
        json!({
            "user_id": "user-other",
            "account_id": "account-other",
            "email": "other@example.com",
            "plan_type": "team",
            "rate_limit": {
                "primary_window": {
                    "used_percent": 9,
                    "limit_window_seconds": 18000,
                    "reset_at": 1773491460
                }
            }
        }),
    );

    std::env::set_var(
        "CODEX_AUTH_SWITCH_CODEX_USAGE_ENDPOINT",
        format!("{}/backend-api/wham/usage", server.base_url),
    );

    let (_app_dir, target_dir, mut manager) = temp_manager();
    let active = manager
        .import_profile(ProfileInput {
            name: "Active".into(),
            notes: "oauth".into(),
            auth_json: oauth_auth_json(
                "team@example.com",
                "user-test",
                "account-test",
                "access-token-active-stale",
            ),
            config_toml: official_config_toml("gpt-5.4"),
        })
        .expect("import active profile");
    let other = manager
        .import_profile(ProfileInput {
            name: "Other".into(),
            notes: "oauth".into(),
            auth_json: oauth_auth_json(
                "other@example.com",
                "user-other",
                "account-other",
                "access-token-other",
            ),
            config_toml: official_config_toml("gpt-5.4"),
        })
        .expect("import other profile");

    manager
        .switch_profile(&active.id)
        .expect("switch active profile");

    fs::write(
        target_dir.path().join("auth.json"),
        oauth_auth_json(
            "team@example.com",
            "user-test",
            "account-test",
            "access-token-active-fresh",
        ),
    )
    .expect("rewrite target auth");

    manager
        .set_codex_usage_api_enabled(true)
        .expect("enable usage api");

    manager
        .refresh_profile_codex_usage(&other.id)
        .expect("refresh usage");

    let requests = server.requests();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].contains("Authorization: Bearer access-token-other"));

    std::env::remove_var("CODEX_AUTH_SWITCH_CODEX_USAGE_ENDPOINT");
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

#[test]
fn refresh_profile_codex_usage_times_out_for_slow_upstream() {
    let _guard = env_lock().lock().expect("lock env");
    let server = TestServer::start();
    server.set_json_with_delay(
        "/backend-api/wham/usage",
        json!({
            "user_id": "user-test",
            "account_id": "account-test",
            "email": "team@example.com",
            "plan_type": "team",
            "rate_limit": {
                "primary_window": {
                    "used_percent": 24,
                    "limit_window_seconds": 18000,
                    "reset_at": 1773491460
                }
            }
        }),
        Duration::from_millis(1200),
    );

    std::env::set_var(
        "CODEX_AUTH_SWITCH_CODEX_USAGE_ENDPOINT",
        format!("{}/backend-api/wham/usage", server.base_url),
    );
    std::env::set_var("CODEX_AUTH_SWITCH_CODEX_USAGE_TIMEOUT_MS", "100");

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

    let started = Instant::now();
    let error = manager
        .refresh_profile_codex_usage(&profile.id)
        .expect_err("refresh usage should time out");
    let elapsed = started.elapsed();

    assert!(
        elapsed < Duration::from_millis(700),
        "request should fail fast when upstream is slow, elapsed: {elapsed:?}"
    );
    assert!(
        error.to_string().contains("timeout") || error.to_string().contains("超时"),
        "expected timeout error, got: {error}"
    );

    std::env::remove_var("CODEX_AUTH_SWITCH_CODEX_USAGE_TIMEOUT_MS");
    std::env::remove_var("CODEX_AUTH_SWITCH_CODEX_USAGE_ENDPOINT");
}
