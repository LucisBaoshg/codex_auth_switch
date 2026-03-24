use codex_auth_switch_lib::core::{ProfileInput, ProfileManager};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
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
                        let mut buffer = [0_u8; 4096];
                        let bytes_read = stream.read(&mut buffer).unwrap_or(0);
                        if bytes_read == 0 {
                            continue;
                        }

                        let request = String::from_utf8_lossy(&buffer[..bytes_read]);
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
    let (_app_dir, _target_dir, manager) = temp_manager();
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

    let imported = manager.list_profiles().expect("list profiles");
    assert_eq!(imported.len(), 1);
    let imported_document = manager
        .get_profile_document(&imported[0].id)
        .expect("load imported document");
    assert_eq!(imported_document.name, "Tapcash Main");
    assert_eq!(imported_document.notes, "first version");
    assert!(imported_document.auth_json.contains("sk-remote-1"));

    server.set_json(
        "/profiles/remote-1",
        json!({
            "id": "remote-1",
            "name": "Tapcash Main Updated",
            "description": "second version",
            "createdAt": "2026-03-24T00:00:00Z",
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
    let updated_document = manager
        .get_profile_document(&updated_profiles[0].id)
        .expect("load updated document");
    assert_eq!(updated_document.name, "Tapcash Main Updated");
    assert_eq!(updated_document.notes, "second version");
    assert!(updated_document.auth_json.contains("sk-remote-2"));
    assert!(updated_document.config_toml.contains("gpt-5.5"));
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
