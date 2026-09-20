use codex_auth_switch_lib::core::{
    discover_third_party_models, merge_standalone_model_config, normalize_third_party_base_url,
    ProfileInput, ProfileManager,
};
use serde_json::Value;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use tempfile::TempDir;

fn config() -> String {
    r#"openai_base_url = "http://127.0.0.1:8317/v1"
model_provider = "openai"
model = "grok-4.6"
model_reasoning_effort = "none"
supports_websockets = false
[codex_auth_switch]
version = 1
[[codex_auth_switch.models]]
id = "grok-4.6"
display_name = "Grok 4.6"
reasoning_effort = "none"
context_window = 32768
[[codex_auth_switch.models]]
id = "gemini-3.8-flash-high"
display_name = "Gemini Flash"
reasoning_effort = "none"
context_window = 65536
"#
    .into()
}

fn input(config_toml: String) -> ProfileInput {
    ProfileInput {
        name: "第三方模型".into(),
        notes: String::new(),
        auth_json: r#"{"OPENAI_API_KEY":"test-only"}"#.into(),
        config_toml,
    }
}

fn multi_effort_config() -> String {
    let mut table: toml::Value = toml::from_str(&config()).unwrap();
    table["model_reasoning_effort"] = "xhigh".into();
    let models = table["codex_auth_switch"]["models"].as_array_mut().unwrap();
    for (index, model) in models.iter_mut().enumerate() {
        model["reasoning_effort"] = if index == 0 { "xhigh" } else { "high" }.into();
        let levels = if index == 0 {
            vec!["low", "medium", "high", "xhigh"]
        } else {
            vec!["low", "medium", "high"]
        };
        model.as_table_mut().unwrap().insert(
            "supported_reasoning_efforts".into(),
            toml::Value::Array(levels.into_iter().map(Into::into).collect()),
        );
    }
    toml::to_string(&table).unwrap()
}

#[test]
fn all_reasoning_levels_survive_migration_without_the_original_catalog_file() {
    let first_app = TempDir::new().unwrap();
    let first_target = TempDir::new().unwrap();
    let first = ProfileManager::new(first_app.path().into(), first_target.path().into()).unwrap();
    let profile = first.import_profile(input(multi_effort_config())).unwrap();
    let original = first.get_profile_document(&profile.id).unwrap();
    let old_path = toml::from_str::<toml::Value>(&original.config_toml).unwrap()
        ["model_catalog_json"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(original
        .config_toml
        .starts_with("# codex-auth-switch-models: "));
    drop(first);
    first_app.close().unwrap();
    assert!(!std::path::Path::new(&old_path).exists());
    let second_app = TempDir::new().unwrap();
    let second_target = TempDir::new().unwrap();
    let mut second =
        ProfileManager::new(second_app.path().into(), second_target.path().into()).unwrap();
    let imported = second.import_profile(input(original.config_toml)).unwrap();
    second.switch_profile(&imported.id).unwrap();
    let reopened = second.get_profile_document(&imported.id).unwrap();
    let table: toml::Value = toml::from_str(&reopened.config_toml).unwrap();
    let new_path = table["model_catalog_json"].as_str().unwrap();
    assert_ne!(new_path, old_path);
    let catalog: Value = serde_json::from_str(&fs::read_to_string(new_path).unwrap()).unwrap();
    for (index, expected) in [
        vec!["low", "medium", "high", "xhigh"],
        vec!["low", "medium", "high"],
    ]
    .iter()
    .enumerate()
    {
        let actual: Vec<&str> = catalog["models"][index]["supported_reasoning_levels"]
            .as_array()
            .unwrap()
            .iter()
            .map(|level| level["effort"].as_str().unwrap())
            .collect();
        assert_eq!(&actual, expected);
        assert_eq!(
            reopened.third_party_draft.as_ref().unwrap()["models"][index]
                ["supported_reasoning_efforts"],
            serde_json::json!(expected)
        );
    }
    assert_eq!(catalog["models"][0]["default_reasoning_level"], "xhigh");
    assert_eq!(catalog["models"][1]["default_reasoning_level"], "high");
    if let Ok(export) = std::env::var("CODEX_AUTH_SWITCH_TEST_EXPORT_DIR") {
        fs::create_dir_all(&export).unwrap();
        fs::write(
            std::path::Path::new(&export).join("multi-reasoning-catalog.json"),
            serde_json::to_vec_pretty(&catalog).unwrap(),
        )
        .unwrap();
    }
}

#[test]
fn invalid_reasoning_menus_are_rejected_before_writing_profiles() {
    let app = TempDir::new().unwrap();
    let target = TempDir::new().unwrap();
    let manager = ProfileManager::new(app.path().into(), target.path().into()).unwrap();
    for levels in [
        vec![],
        vec!["high", "high"],
        vec!["high", "unknown"],
        vec!["low"],
    ] {
        let mut table: toml::Value = toml::from_str(&multi_effort_config()).unwrap();
        table["codex_auth_switch"]["models"][0]["supported_reasoning_efforts"] =
            toml::Value::Array(levels.into_iter().map(Into::into).collect());
        assert!(manager
            .import_profile(input(toml::to_string(&table).unwrap()))
            .is_err());
    }
    assert!(manager.list_profiles().unwrap().is_empty());
    let legacy = manager.import_profile(input(config())).unwrap();
    let document = manager.get_profile_document(&legacy.id).unwrap();
    let table: toml::Value = toml::from_str(&document.config_toml).unwrap();
    let catalog: Value = serde_json::from_str(
        &fs::read_to_string(table["model_catalog_json"].as_str().unwrap()).unwrap(),
    )
    .unwrap();
    assert_eq!(
        catalog["models"][0]["supported_reasoning_levels"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        catalog["models"][0]["supported_reasoning_levels"][0]["effort"],
        "none"
    );
}

#[test]
fn normalizes_lan_addresses_without_changing_custom_paths() {
    assert_eq!(
        normalize_third_party_base_url(" 10.12.0.20:8317 ").unwrap(),
        "http://10.12.0.20:8317/v1"
    );
    assert_eq!(
        normalize_third_party_base_url("https://api.example.com/").unwrap(),
        "https://api.example.com/v1"
    );
    assert_eq!(
        normalize_third_party_base_url("https://api.example.com/custom/v2/").unwrap(),
        "https://api.example.com/custom/v2"
    );
    for invalid in [
        "",
        "file:///tmp/file",
        "http://user:secret@host/v1",
        "http://host/v1?api_key=x",
        "http://host/#x",
    ] {
        assert!(normalize_third_party_base_url(invalid).is_err());
    }
}

fn server(
    status: u16,
    body: &str,
    extra_header: &str,
) -> (String, std::thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let body = body.to_string();
    let extra_header = extra_header.to_string();
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        let mut byte = [0; 1];
        while !request.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        write!(stream, "HTTP/1.1 {status} Result\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{extra_header}\r\n{body}", body.len()).unwrap();
        String::from_utf8(request).unwrap()
    });
    (format!("http://{address}/v1"), handle)
}

#[test]
fn discovers_deduplicated_models_with_bearer_auth() {
    let (url, thread) = server(
        200,
        r#"{"data":[{"id":"grok-4.6","name":"Grok"},{"id":"grok-4.6"},{"id":"gemini-3.8-flash-high"},{"id":""},{"object":"model"}]}"#,
        "",
    );
    let models = discover_third_party_models(&url, "test-only").unwrap();
    assert_eq!(models.len(), 2);
    assert_eq!(models[0].id, "gemini-3.8-flash-high");
    assert_eq!(models[1].display_name, "Grok");
    let request = thread.join().unwrap();
    assert!(request.starts_with("GET /v1/models HTTP/1.1"));
    assert!(request.contains("Authorization: Bearer test-only"));
}

#[test]
fn discovery_handles_errors_without_echoing_keys_and_does_not_follow_redirects() {
    for (status, body, extra) in [
        (401, "test-only-secret", ""),
        (404, "", ""),
        (200, "not json", ""),
        (302, "", "Location: http://127.0.0.1:1/stolen\r\n"),
    ] {
        let (url, thread) = server(status, body, extra);
        let error = discover_third_party_models(&url, "test-only-secret")
            .unwrap_err()
            .to_string();
        thread.join().unwrap();
        assert!(!error.contains("test-only-secret"));
    }
}

#[test]
fn catalog_survives_portable_import_and_official_switch_restores_local_settings() {
    let app = TempDir::new().unwrap();
    let target = TempDir::new().unwrap();
    let mut manager = ProfileManager::new(app.path().into(), target.path().into()).unwrap();
    let original = "model = \"official-test\"\napproval_policy = \"on-request\"\nsandbox_mode = \"workspace-write\"\n[mcp_servers.test]\ncommand = \"test-tool\"\n";
    fs::write(
        target.path().join("auth.json"),
        r#"{"auth_mode":"chatgpt"}"#,
    )
    .unwrap();
    fs::write(target.path().join("config.toml"), original).unwrap();
    let official = manager
        .import_profile_from_target_dir("官方".into(), String::new())
        .unwrap();
    let profile = manager.import_profile(input(config())).unwrap();
    let document = manager.get_profile_document(&profile.id).unwrap();
    let table: toml::Value = toml::from_str(&document.config_toml).unwrap();
    let path = table["model_catalog_json"].as_str().unwrap();
    let catalog: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(catalog["models"].as_array().unwrap().len(), 2);
    assert_eq!(catalog["models"][0]["slug"], "grok-4.6");
    assert_eq!(catalog["models"][1]["context_window"], 65536);
    assert!(document.third_party_draft.is_some());
    fs::remove_file(path).unwrap();
    manager.switch_profile(&profile.id).unwrap();
    assert!(
        std::path::Path::new(path).exists(),
        "missing generated catalog is repaired before switching"
    );
    assert_eq!(
        manager.detect_active_profile().unwrap().unwrap().id,
        profile.id
    );
    manager.switch_profile(&official.id).unwrap();
    let restored = fs::read_to_string(target.path().join("config.toml")).unwrap();
    assert!(!restored.contains("model_catalog_json"));
    assert!(!restored.contains("codex_auth_switch"));
    assert!(!restored.contains("openai_base_url"));
    assert!(restored.contains("test-tool"));
    assert!(restored.contains("workspace-write"));
    assert!(restored.contains("on-request"));
    let second_app = TempDir::new().unwrap();
    let second_target = TempDir::new().unwrap();
    let second =
        ProfileManager::new(second_app.path().into(), second_target.path().into()).unwrap();
    let imported = second.import_profile(input(document.config_toml)).unwrap();
    let imported = second.get_profile_document(&imported.id).unwrap();
    let table: toml::Value = toml::from_str(&imported.config_toml).unwrap();
    let new_path = table["model_catalog_json"].as_str().unwrap();
    assert_ne!(new_path, path);
    assert!(std::path::Path::new(new_path).exists());
    // Optional local compatibility fixture; never writes real auth/config.
    if let Ok(export) = std::env::var("CODEX_AUTH_SWITCH_TEST_EXPORT_DIR") {
        fs::create_dir_all(&export).unwrap();
        fs::write(
            std::path::Path::new(&export).join("catalog.json"),
            serde_json::to_vec_pretty(&catalog).unwrap(),
        )
        .unwrap();
        fs::write(
            std::path::Path::new(&export).join("config.toml"),
            &imported.config_toml,
        )
        .unwrap();
    }
}

#[test]
fn rejects_invalid_catalog_before_saving_and_edit_preserves_unrelated_settings() {
    let app = TempDir::new().unwrap();
    let target = TempDir::new().unwrap();
    let manager = ProfileManager::new(app.path().into(), target.path().into()).unwrap();
    assert!(manager
        .import_profile(input(
            config().replace("model = \"grok-4.6\"", "model = \"missing\"")
        ))
        .is_err());
    assert!(manager
        .import_profile(input(
            config().replace("context_window = 32768", "context_window = 0")
        ))
        .is_err());
    let existing = "model_context_window = 1000000\nplan_mode_reasoning_effort = \"xhigh\"\nsandbox_mode = \"workspace-write\"\n[mcp_servers.test]\ncommand = \"test-tool\"";
    let merged = merge_standalone_model_config(existing, &config()).unwrap();
    assert!(!merged.contains("1000000"));
    assert!(!merged.contains("plan_mode_reasoning_effort"));
    assert!(merged.contains("workspace-write"));
    assert!(merged.contains("test-tool"));
}

/// Opt-in smoke test: credentials stay in a temporary profile and are never printed.
#[test]
#[ignore = "requires a user-provided gateway and key file"]
fn live_gateway_models_and_responses() {
    let url = std::env::var("CODEX_AUTH_SWITCH_TEST_GATEWAY").expect("gateway URL required");
    let key_file = std::env::var("CODEX_AUTH_SWITCH_TEST_KEY_FILE").expect("key file required");
    let key = fs::read_to_string(key_file).unwrap();
    let models = discover_third_party_models(&url, key.trim()).expect("discover gateway models");
    let app = TempDir::new().unwrap();
    let target = TempDir::new().unwrap();
    let manager = ProfileManager::new(app.path().into(), target.path().into()).unwrap();
    for id in ["grok-4.6", "gemini-3.8-flash-high"] {
        assert!(
            models.iter().any(|model| model.id == id),
            "requested model not advertised: {id}"
        );
        let mut draft = input(
            config()
                .replace("http://127.0.0.1:8317/v1", &url)
                .replace("model = \"grok-4.6\"", &format!("model = \"{id}\"")),
        );
        draft.auth_json = serde_json::json!({"OPENAI_API_KEY":key.trim()}).to_string();
        let saved = manager.import_profile(draft).unwrap();
        let result = manager
            .refresh_profile_latency_probe(&saved.id)
            .unwrap()
            .third_party_latency
            .unwrap();
        assert_eq!(result.status_code, Some(200), "response status for {id}");
        assert!(result.ttft_ms.is_some(), "no response text for {id}");
        assert!(result.error.is_none(), "response probe failed for {id}");
        println!("{id}: model discovery and Responses stream passed");
    }
}

#[test]
fn restores_an_official_custom_catalog_and_keeps_old_generated_catalogs_for_backups() {
    let app = TempDir::new().unwrap();
    let target = TempDir::new().unwrap();
    let mut manager = ProfileManager::new(app.path().into(), target.path().into()).unwrap();
    let official_catalog = target.path().join("official-catalog.json");
    fs::write(&official_catalog, r#"{"models":[]}"#).unwrap();
    let official = manager
        .import_profile(ProfileInput {
            name: "官方自定义目录".into(),
            notes: String::new(),
            auth_json: r#"{"auth_mode":"chatgpt"}"#.into(),
            config_toml: format!(
                "model = \"official-test\"\nmodel_catalog_json = {}",
                serde_json::to_string(&official_catalog).unwrap()
            ),
        })
        .unwrap();
    let third = manager.import_profile(input(config())).unwrap();
    let before = manager.get_profile_document(&third.id).unwrap();
    let before_table: toml::Value = toml::from_str(&before.config_toml).unwrap();
    let old_path = before_table["model_catalog_json"].as_str().unwrap();
    manager
        .update_profile(&third.id, input(config().replace("32768", "49152")))
        .unwrap();
    assert!(std::path::Path::new(old_path).exists());
    manager.switch_profile(&third.id).unwrap();
    manager.switch_profile(&official.id).unwrap();
    let restored: toml::Value =
        toml::from_str(&fs::read_to_string(target.path().join("config.toml")).unwrap()).unwrap();
    assert_eq!(
        restored["model_catalog_json"].as_str().unwrap(),
        official_catalog.to_str().unwrap()
    );
}
