use codex_auth_switch_lib::core::{ProfileInput, ProfileManager};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::Duration;
use tempfile::TempDir;

fn api_key_auth_json(token: &str) -> String {
    format!(r#"{{"OPENAI_API_KEY":"{token}"}}"#)
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

fn read_request_path(stream: &mut TcpStream) -> Option<String> {
    stream.set_nonblocking(false).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let path = line.split_whitespace().nth(1)?.to_string();
    loop {
        line.clear();
        if reader.read_line(&mut line).ok()? == 0 {
            return None;
        }
        if line == "\r\n" || line == "\n" {
            return Some(path);
        }
    }
}

struct TestServer {
    base_url: String,
    responses: Arc<Mutex<HashMap<String, (String, String)>>>,
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
        let shutdown = Arc::new(AtomicBool::new(false));
        let thread_responses = Arc::clone(&responses);
        let thread_shutdown = Arc::clone(&shutdown);

        let handle = thread::spawn(move || {
            while !thread_shutdown.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let Some(path) = read_request_path(&mut stream) else {
                            continue;
                        };

                        let response = thread_responses
                            .lock()
                            .expect("lock responses")
                            .get(&path)
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

    fn set_text(&self, path: &str, body: &str) {
        self.responses
            .lock()
            .expect("lock responses")
            .insert(path.to_string(), ("text/plain".into(), body.to_string()));
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
fn sync_remote_profiles_imports_and_updates_existing_remote_profiles() {
    let (_app_dir, target_dir, mut manager) = temp_manager();
    let server = TestServer::start();

    server.set_json(
        "/profiles",
        json!([{
            "id": "remote-1",
            "name": "Tapcash Main",
            "description": "first version",
            "createdAt": "2026-03-24T00:00:00Z",
            "files": ["auth.json", "config.toml"]
        }]),
    );
    server.set_json(
        "/profiles/remote-1",
        json!({
            "id": "remote-1",
            "name": "Tapcash Main",
            "description": "first version",
            "createdAt": "2026-03-24T00:00:00Z",
            "updatedAt": "2026-03-24T00:05:00Z",
            "contentVersion": 1,
            "contentHash": "hash-v1",
            "contentUpdatedAt": "2026-03-24T00:05:00Z",
            "files": ["auth.json", "config.toml"]
        }),
    );
    server.set_text(
        "/profiles/remote-1/auth.json",
        &api_key_auth_json("sk-remote-1"),
    );
    server.set_text(
        "/profiles/remote-1/config.toml",
        &official_config_toml("gpt-5.4"),
    );

    let first_sync = manager
        .sync_remote_profiles(&format!("{}/profiles", server.base_url))
        .expect("first sync");
    assert_eq!(first_sync.imported, 1);
    assert_eq!(first_sync.updated, 0);
    assert_eq!(first_sync.profiles.len(), 1);
    assert_eq!(
        first_sync.profiles[0].remote_profile_id.as_deref(),
        Some("remote-1")
    );
    assert_eq!(first_sync.profiles[0].remote_content_version, Some(1));
    assert_eq!(
        first_sync.profiles[0].remote_content_hash.as_deref(),
        Some("hash-v1")
    );
    assert!(first_sync.profiles[0].remote_updated_at.is_some());

    let imported = manager.list_profiles().expect("list profiles");
    assert_eq!(imported.len(), 1);
    let imported_document = manager
        .get_profile_document(&imported[0].id)
        .expect("load imported document");
    assert_eq!(imported_document.name, "Tapcash Main");
    assert_eq!(imported_document.notes, "first version");
    assert_eq!(
        imported_document.remote_profile_id.as_deref(),
        Some("remote-1")
    );
    assert_eq!(imported_document.remote_content_version, Some(1));
    assert_eq!(
        imported_document.remote_content_hash.as_deref(),
        Some("hash-v1")
    );
    assert!(imported_document.remote_updated_at.is_some());
    assert!(imported_document.auth_json.contains("sk-remote-1"));

    manager
        .switch_profile(&imported[0].id)
        .expect("activate imported remote profile");
    fs::write(
        target_dir.path().join("config.toml"),
        format!(
            "{}\n[mcp_servers.local-only]\ncommand = \"local-mcp\"\n",
            official_config_toml("gpt-5.4")
        ),
    )
    .expect("add local runtime MCP config");

    server.set_json(
        "/profiles/remote-1",
        json!({
            "id": "remote-1",
            "name": "Tapcash Main Updated",
            "description": "second version",
            "createdAt": "2026-03-24T00:00:00Z",
            "updatedAt": "2026-03-24T01:00:00Z",
            "contentVersion": 2,
            "contentHash": "hash-v2",
            "contentUpdatedAt": "2026-03-24T01:00:00Z",
            "files": ["auth.json", "config.toml"]
        }),
    );
    server.set_text(
        "/profiles/remote-1/auth.json",
        &api_key_auth_json("sk-remote-2"),
    );
    server.set_text(
        "/profiles/remote-1/config.toml",
        &official_config_toml("gpt-5.5"),
    );

    let second_sync = manager
        .sync_remote_profiles(&format!("{}/profiles", server.base_url))
        .expect("second sync");
    assert_eq!(second_sync.imported, 0);
    assert_eq!(second_sync.updated, 1);

    let updated_profiles = manager.list_profiles().expect("list profiles after update");
    assert_eq!(updated_profiles.len(), 1);
    assert_eq!(
        updated_profiles[0].remote_profile_id.as_deref(),
        Some("remote-1")
    );
    assert_eq!(updated_profiles[0].remote_content_version, Some(2));
    assert_eq!(
        updated_profiles[0].remote_content_hash.as_deref(),
        Some("hash-v2")
    );
    assert!(updated_profiles[0].remote_updated_at.is_some());
    let updated_document = manager
        .get_profile_document(&updated_profiles[0].id)
        .expect("load updated document");
    assert_eq!(updated_document.name, "Tapcash Main Updated");
    assert_eq!(updated_document.notes, "second version");
    assert_eq!(
        updated_document.remote_profile_id.as_deref(),
        Some("remote-1")
    );
    assert_eq!(updated_document.remote_content_version, Some(2));
    assert_eq!(
        updated_document.remote_content_hash.as_deref(),
        Some("hash-v2")
    );
    assert!(updated_document.auth_json.contains("sk-remote-1"));
    let archived = _app_dir
        .path()
        .join("profiles")
        .join(&updated_profiles[0].id);
    assert!(fs::read_to_string(archived.join("auth.json"))
        .unwrap()
        .contains("sk-remote-2"));
    let config_path = target_dir.path().join("config.toml");
    assert!(fs::read_to_string(&config_path)
        .unwrap()
        .contains("gpt-5.4"));

    server.set_json(
        "/profiles/remote-1",
        json!({
            "id": "remote-1", "name": "Older remote",
            "files": ["auth.json", "config.toml"], "contentVersion": 1
        }),
    );
    let stale = manager
        .sync_remote_profiles(&format!("{}/profiles", server.base_url))
        .unwrap();
    assert_eq!(stale.synced, 0);

    manager.switch_profile(&updated_profiles[0].id).unwrap();
    let active_config = fs::read_to_string(config_path).unwrap();
    assert!(active_config.contains("gpt-5.5"));
    assert!(active_config.contains("[mcp_servers.local-only]"));
}

#[test]
fn restores_oauth_for_an_existing_shared_revision_and_applies_it_without_a_local_login() {
    let (_app_dir, target_dir, mut manager) = temp_manager();
    let server = TestServer::start();
    let profiles_url = format!("{}/profiles", server.base_url);
    let profile = json!({
        "id": "oauth-shared",
        "name": "Shared OAuth",
        "contentVersion": 101,
        "contentHash": "unchanged-raw-file-hash",
        "files": ["auth.json", "config.toml"],
    });
    server.set_json("/profiles", json!([profile]));
    let mut bundle = profile;
    bundle["configContent"] = official_config_toml("gpt-5.5").into();
    bundle["authContent"] = r#"{"auth_mode":"chatgpt"}"#.into();
    server.set_json("/profiles/oauth-shared?bundle=1", bundle.clone());

    let first = manager.sync_remote_profiles(&profiles_url).unwrap();
    assert_eq!(first.imported, 1);
    let profile_id = first.profiles[0].id.clone();
    let authorization = json!({
        "auth_mode": "chatgpt",
        "tokens": { "id_token": "fixture-id", "access_token": "fixture-access" },
    });
    bundle["authContent"] = authorization.to_string().into();
    server.set_json("/profiles/oauth-shared?bundle=1", bundle);

    let updated = manager.sync_remote_profiles(&profiles_url).unwrap();
    assert_eq!(updated.updated, 1);
    assert_eq!(updated.profiles[0].id, profile_id);
    assert!(!target_dir.path().join("auth.json").exists());
    manager.switch_profile(&profile_id).unwrap();
    let applied: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(target_dir.path().join("auth.json")).unwrap())
            .unwrap();
    assert_eq!(applied, authorization);
}

#[test]
fn resolve_profile_selector_supports_profile_id_and_exact_name() {
    let (_app_dir, _target_dir, manager) = temp_manager();

    let profile = manager
        .import_profile(ProfileInput {
            name: "Tapcash Main".into(),
            notes: String::new(),
            auth_json: api_key_auth_json("sk-selector"),
            config_toml: official_config_toml("gpt-5"),
        })
        .expect("import profile");

    let by_id = manager
        .resolve_profile_selector(&profile.id)
        .expect("resolve by id");
    assert_eq!(by_id.id, profile.id);

    let by_name = manager
        .resolve_profile_selector("Tapcash Main")
        .expect("resolve by name");
    assert_eq!(by_name.id, profile.id);
}

#[test]
fn mock_server_reads_split_http_request_headers_before_responding() {
    let server = TestServer::start();
    server.set_text("/profiles", "fixture");
    let address = server.base_url.trim_start_matches("http://");
    let mut client = TcpStream::connect(address).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    client.write_all(b"GET /profiles HTTP/1.1\r\n").unwrap();
    client
        .set_read_timeout(Some(Duration::from_millis(50)))
        .unwrap();
    let error = client.peek(&mut [0]).unwrap_err();
    assert!(matches!(
        error.kind(),
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
    ));
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    client
        .write_all(b"Host: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .unwrap();

    let mut response = String::new();
    client.read_to_string(&mut response).unwrap();
    assert!(response.starts_with("HTTP/1.1 200 OK\r\n"), "{response:?}");
    assert!(response.ends_with("\r\n\r\nfixture"));
}
