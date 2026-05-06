use codex_auth_switch_lib::core::{ProfileInput, ProfileManager};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use std::thread;
use std::time::Duration;
use tempfile::TempDir;

fn api_key_auth_json(token: &str) -> String {
    format!(r#"{{"OPENAI_API_KEY":"{token}"}}"#)
}

fn third_party_config_toml(model: &str, wire_api: &str, base_url: &str) -> String {
    format!(
        r#"model_provider = "OpenAI"
model = "{model}"
review_model = "{model}"
model_reasoning_effort = "medium"

[model_providers.OpenAI]
name = "OpenAI"
base_url = "{base_url}"
wire_api = "{wire_api}"
requires_openai_auth = true
"#
    )
}

fn ylscode_config_toml(model: &str) -> String {
    format!(
        r#"model_provider = "ylscode"
model = "{model}"
review_model = "{model}"
model_reasoning_effort = "medium"

[model_providers.ylscode]
name = "ylscode"
base_url = "https://code.ylsagi.com/v1"
wire_api = "responses"
requires_openai_auth = true
"#
    )
}

fn standard_openai_base_url_config_toml_with_provider(
    model: &str,
    provider: &str,
    base_url: &str,
) -> String {
    format!(
        r#"openai_base_url = "{base_url}"
model_provider = "{provider}"
model = "{model}"
review_model = "{model}"
model_reasoning_effort = "high"
disable_response_storage = true
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

fn ylscode_usage_endpoint_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
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

    fn set_sse(&self, path: &str, body: &str) {
        self.responses.lock().expect("lock responses").insert(
            path.to_string(),
            ("text/event-stream".into(), body.to_string()),
        );
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

#[test]
fn refresh_profile_third_party_usage_fetches_ylscode_usage() {
    let _endpoint_guard = ylscode_usage_endpoint_lock()
        .lock()
        .expect("lock ylscode usage endpoint env");
    let server = TestServer::start();
    server.set_json(
        "/codex/info",
        json!({
            "state": {
                "package": {
                    "weeklyQuota": 500
                },
                "userPackgeUsage_week": {
                    "total_cost": 300.49,
                    "total_quota": 500,
                    "remaining_quota": 199.51,
                    "used_percentage": "60%"
                },
                "userPackgeUsage": {
                    "total_cost": 100.03,
                    "total_quota": 100,
                    "remaining_quota": -0.03,
                    "used_percentage": "100%"
                }
            }
        }),
    );
    std::env::set_var(
        "CODEX_AUTH_SWITCH_YLSCODE_USAGE_ENDPOINT",
        format!("{}/codex/info", server.base_url),
    );

    let (_app_dir, _target_dir, manager) = temp_manager();
    let profile = manager
        .import_profile(ProfileInput {
            name: "ylscode profile".into(),
            notes: "third-party usage".into(),
            auth_json: api_key_auth_json("sk-ylscode"),
            config_toml: ylscode_config_toml("gpt-5.4"),
        })
        .expect("import profile");

    let refreshed = manager
        .refresh_profile_third_party_usage(&profile.id)
        .expect("refresh third-party usage");
    std::env::remove_var("CODEX_AUTH_SWITCH_YLSCODE_USAGE_ENDPOINT");

    let usage = refreshed
        .third_party_usage
        .expect("third-party usage snapshot");
    assert_eq!(usage.provider.as_deref(), Some("ylscode"));
    assert_eq!(usage.remaining.as_deref(), Some("-0.03"));
    assert_eq!(usage.unit.as_deref(), Some("USD"));
    let daily = usage.daily.expect("daily usage");
    assert_eq!(daily.used.as_deref(), Some("100.03"));
    assert_eq!(daily.total.as_deref(), Some("100"));
    assert_eq!(daily.remaining.as_deref(), Some("-0.03"));
    assert_eq!(daily.used_percent, Some(100.0));
    let weekly = usage.weekly.expect("weekly usage");
    assert_eq!(weekly.used.as_deref(), Some("300.49"));
    assert_eq!(weekly.total.as_deref(), Some("500"));
    assert_eq!(weekly.remaining.as_deref(), Some("199.51"));
    assert_eq!(weekly.used_percent, Some(60.0));
    assert!(usage.error.is_none());

    let request = server
        .requests()
        .into_iter()
        .find(|item| item.contains("GET /codex/info HTTP/1.1"))
        .expect("ylscode usage request");
    assert!(request.contains("Authorization: Bearer sk-ylscode"));
    assert!(request.contains("User-Agent: cc-switch/1.0"));
}

#[test]
fn refresh_profile_third_party_usage_supports_openai_base_url_without_model_providers() {
    let _endpoint_guard = ylscode_usage_endpoint_lock()
        .lock()
        .expect("lock ylscode usage endpoint env");
    let server = TestServer::start();
    server.set_json(
        "/codex/info",
        json!({
            "state": {
                "userPackgeUsage": {
                    "total_cost": 12,
                    "total_quota": 100,
                    "remaining_quota": 88,
                    "used_percentage": "12%"
                }
            }
        }),
    );
    std::env::set_var(
        "CODEX_AUTH_SWITCH_YLSCODE_USAGE_ENDPOINT",
        format!("{}/codex/info", server.base_url),
    );

    let (_app_dir, _target_dir, manager) = temp_manager();
    let profile = manager
        .import_profile(ProfileInput {
            name: "standard ylscode profile".into(),
            notes: "third-party usage".into(),
            auth_json: api_key_auth_json("sk-standard-ylscode"),
            config_toml: standard_openai_base_url_config_toml_with_provider(
                "gpt-5.5",
                "custom-provider-name",
                "https://code.ylsagi.com/v1",
            ),
        })
        .expect("import profile");

    let refreshed = manager
        .refresh_profile_third_party_usage(&profile.id)
        .expect("refresh third-party usage");
    std::env::remove_var("CODEX_AUTH_SWITCH_YLSCODE_USAGE_ENDPOINT");

    let usage = refreshed
        .third_party_usage
        .expect("third-party usage snapshot");
    assert_eq!(usage.provider.as_deref(), Some("ylscode"));
    assert_eq!(usage.remaining.as_deref(), Some("88"));
    assert!(usage.error.is_none());

    let request = server
        .requests()
        .into_iter()
        .find(|item| item.contains("GET /codex/info HTTP/1.1"))
        .expect("ylscode usage request");
    assert!(request.contains("Authorization: Bearer sk-standard-ylscode"));
}

#[test]
fn refresh_profile_latency_probe_persists_responses_snapshot() {
    let server = TestServer::start();
    server.set_sse(
        "/v1/responses",
        "event: response.created\n\
data: {\"type\":\"response.created\"}\n\n\
event: response.output_text.delta\n\
data: {\"type\":\"response.output_text.delta\",\"delta\":\"ok\"}\n\n\
data: [DONE]\n\n",
    );

    let (_app_dir, _target_dir, manager) = temp_manager();
    let profile = manager
        .import_profile(ProfileInput {
            name: "responses profile".into(),
            notes: "third-party".into(),
            auth_json: api_key_auth_json("sk-responses"),
            config_toml: third_party_config_toml(
                "gpt-5.4",
                "responses",
                &format!("{}/v1", server.base_url),
            ),
        })
        .expect("import profile");

    let refreshed = manager
        .refresh_profile_latency_probe(&profile.id)
        .expect("refresh latency probe");

    let probe = refreshed.third_party_latency.expect("latency snapshot");
    assert_eq!(probe.wire_api.as_deref(), Some("responses"));
    assert_eq!(probe.model.as_deref(), Some("gpt-5.4"));
    assert_eq!(probe.status_code, Some(200));
    assert!(probe.ttft_ms.is_some());
    assert!(probe.total_ms.is_some());
    assert!(probe.error.is_none());

    let request = server
        .requests()
        .into_iter()
        .find(|item| item.contains("POST /v1/responses HTTP/1.1"))
        .expect("responses request");
    assert!(request.contains("Authorization: Bearer sk-responses"));
    assert!(request.contains("\"stream\":true"));
    assert!(request.contains("Reply with exactly: ok"));
}

#[test]
fn refresh_profile_latency_probe_persists_chat_completions_snapshot() {
    let server = TestServer::start();
    server.set_sse(
        "/v1/chat/completions",
        "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n\
data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n\
data: [DONE]\n\n",
    );

    let (_app_dir, _target_dir, manager) = temp_manager();
    let profile = manager
        .import_profile(ProfileInput {
            name: "chat profile".into(),
            notes: "third-party".into(),
            auth_json: api_key_auth_json("sk-chat"),
            config_toml: third_party_config_toml(
                "gpt-4.1",
                "chat_completions",
                &format!("{}/v1", server.base_url),
            ),
        })
        .expect("import profile");

    let refreshed = manager
        .refresh_profile_latency_probe(&profile.id)
        .expect("refresh latency probe");

    let probe = refreshed.third_party_latency.expect("latency snapshot");
    assert_eq!(probe.wire_api.as_deref(), Some("chat_completions"));
    assert_eq!(probe.model.as_deref(), Some("gpt-4.1"));
    assert_eq!(probe.status_code, Some(200));
    assert!(probe.ttft_ms.is_some());
    assert!(probe.total_ms.is_some());
    assert!(probe.error.is_none());

    let request = server
        .requests()
        .into_iter()
        .find(|item| item.contains("POST /v1/chat/completions HTTP/1.1"))
        .expect("chat completions request");
    assert!(request.contains("Authorization: Bearer sk-chat"));
    assert!(request.contains("\"stream\":true"));
    assert!(request.contains("\"messages\""));
    assert!(request.contains("Reply with exactly: ok"));
}

#[test]
fn update_profile_clears_stale_third_party_latency_when_config_changes() {
    let server = TestServer::start();
    server.set_sse(
        "/v1/responses",
        "event: response.output_text.delta\n\
data: {\"type\":\"response.output_text.delta\",\"delta\":\"ok\"}\n\n\
data: [DONE]\n\n",
    );

    let (_app_dir, _target_dir, manager) = temp_manager();
    let profile = manager
        .import_profile(ProfileInput {
            name: "third-party".into(),
            notes: "before".into(),
            auth_json: api_key_auth_json("sk-third"),
            config_toml: third_party_config_toml(
                "gpt-5.4",
                "responses",
                &format!("{}/v1", server.base_url),
            ),
        })
        .expect("import profile");

    manager
        .refresh_profile_latency_probe(&profile.id)
        .expect("refresh latency");

    let updated = manager
        .update_profile(
            &profile.id,
            ProfileInput {
                name: "third-party".into(),
                notes: "after".into(),
                auth_json: api_key_auth_json("sk-third"),
                config_toml: third_party_config_toml(
                    "gpt-4.1",
                    "chat_completions",
                    &format!("{}/v1", server.base_url),
                ),
            },
        )
        .expect("update profile");

    assert!(updated.third_party_latency.is_none());
}
