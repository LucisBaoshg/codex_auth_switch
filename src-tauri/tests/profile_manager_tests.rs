use codex_auth_switch_lib::core::{restart_codex_script, ProfileInput, ProfileManager};
use rusqlite::Connection;
use serde_json::json;
use std::env;
use std::fs;
use tempfile::TempDir;

fn api_key_auth_json(token: &str) -> String {
    format!(r#"{{"OPENAI_API_KEY":"{token}"}}"#)
}

fn oauth_auth_json(email: &str, user_id: &str, account_id: &str) -> String {
    let payload = json!({
        "email": email,
        "https://api.openai.com/auth": {
            "chatgpt_user_id": user_id,
            "chatgpt_account_id": account_id
        }
    });

    let encoded_payload = base64_email_fragment(&payload.to_string());

    json!({
        "auth_mode": "chatgpt",
        "OPENAI_API_KEY": null,
        "tokens": {
            "id_token": format!("header.{encoded_payload}.signature")
        }
    })
    .to_string()
}

fn base64_email_fragment(email: &str) -> String {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;

    URL_SAFE_NO_PAD.encode(email)
}

fn local_sections() -> &'static str {
    r#"
[projects."/tmp/demo"]
trust_level = "trusted"

[mcp_servers.playwright]
command = "npx"
args = ["@playwright/mcp@latest"]

[features]
multi_agent = true
"#
}

fn runtime_growth_sections() -> &'static str {
    r#"
windows_wsl_setup_acknowledged = true

[projects."/tmp/runtime-growth"]
trust_level = "trusted"
"#
}

fn official_config_toml(model: &str) -> String {
    format!(
        r#"model = "{model}"
model_reasoning_effort = "medium"
{}"#,
        local_sections()
    )
}

fn third_party_config_toml(model: &str) -> String {
    format!(
        r#"model_provider = "OpenAI"
model = "{model}"
review_model = "{model}"
model_reasoning_effort = "xhigh"
disable_response_storage = true
network_access = "enabled"
model_context_window = 1000000
model_auto_compact_token_limit = 900000

[model_providers.OpenAI]
name = "OpenAI"
base_url = "http://sub2api.ite.tapcash.com"
wire_api = "responses"
requires_openai_auth = true
{}"#,
        local_sections()
    )
}

fn stale_official_config_toml(model: &str) -> String {
    format!(
        r#"model_provider = "OpenAI"
model = "{model}"
review_model = "{model}"
model_reasoning_effort = "medium"
disable_response_storage = true
network_access = "enabled"
model_context_window = 1000000
model_auto_compact_token_limit = 900000

[model_providers.OpenAI]
name = "OpenAI"
base_url = "https://api.intellectgrowth.com/v1"
wire_api = "responses"
requires_openai_auth = true
{}"#,
        local_sections()
    )
}

fn config_with_shared_growth(config_toml: &str) -> String {
    format!("{config_toml}\n{}", runtime_growth_sections())
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

#[test]
fn import_profile_persists_valid_profile_files_and_metadata() {
    let (_app_dir, _target_dir, manager) = temp_manager();

    let profile = manager
        .import_profile(ProfileInput {
            name: "Work Account".into(),
            notes: "primary profile".into(),
            auth_json: api_key_auth_json("sk-work"),
            config_toml: official_config_toml("gpt-5"),
        })
        .expect("import should succeed");

    let profiles = manager.list_profiles().expect("list profiles");
    assert_eq!(profiles.len(), 1);
    assert_eq!(profiles[0].id, profile.id);
    assert_eq!(profiles[0].name, "Work Account");
}

#[test]
fn import_profile_rejects_invalid_auth_json() {
    let (_app_dir, _target_dir, manager) = temp_manager();

    let error = manager
        .import_profile(ProfileInput {
            name: "Broken Auth".into(),
            notes: String::new(),
            auth_json: "{broken".into(),
            config_toml: official_config_toml("gpt-5"),
        })
        .expect_err("invalid auth should fail");

    assert!(error.to_string().contains("auth.json"));
}

#[test]
fn import_profile_rejects_invalid_config_toml() {
    let (_app_dir, _target_dir, manager) = temp_manager();

    let error = manager
        .import_profile(ProfileInput {
            name: "Broken Config".into(),
            notes: String::new(),
            auth_json: api_key_auth_json("sk-broken"),
            config_toml: "default_model = ".into(),
        })
        .expect_err("invalid config should fail");

    assert!(error.to_string().contains("config.toml"));
}

#[test]
fn import_profile_from_target_dir_reads_hidden_codex_files_without_picker() {
    let (_app_dir, target_dir, manager) = temp_manager();

    fs::write(
        target_dir.path().join("auth.json"),
        api_key_auth_json("sk-current"),
    )
    .expect("seed auth");
    fs::write(
        target_dir.path().join("config.toml"),
        official_config_toml("gpt-5"),
    )
    .expect("seed config");

    let imported = manager
        .import_profile_from_target_dir("Imported Current".into(), "from current codex".into())
        .expect("import from target dir");

    assert_eq!(imported.name, "Imported Current");

    let profiles = manager.list_profiles().expect("list profiles");
    assert_eq!(profiles.len(), 1);
    assert_eq!(profiles[0].name, "Imported Current");
}

#[test]
fn import_profile_from_target_dir_fails_when_target_files_are_missing() {
    let (_app_dir, _target_dir, manager) = temp_manager();

    let error = manager
        .import_profile_from_target_dir("Missing".into(), String::new())
        .expect_err("missing files should fail");

    assert!(error.to_string().contains("target"));
}

#[test]
fn get_target_profile_input_reads_current_codex_files_for_save_as_profile() {
    let (_app_dir, target_dir, manager) = temp_manager();

    fs::write(
        target_dir.path().join("auth.json"),
        api_key_auth_json("sk-current-target"),
    )
    .expect("seed auth");
    fs::write(
        target_dir.path().join("config.toml"),
        official_config_toml("gpt-5"),
    )
    .expect("seed config");

    let input = manager
        .get_target_profile_input()
        .expect("load current target input");

    assert!(input.auth_json.contains("sk-current-target"));
    assert!(input.config_toml.contains("model = \"gpt-5\""));
}

#[test]
fn get_profile_document_returns_saved_auth_and_config_contents() {
    let (_app_dir, _target_dir, manager) = temp_manager();

    let profile = manager
        .import_profile(ProfileInput {
            name: "Browse Me".into(),
            notes: "inspect contents".into(),
            auth_json: api_key_auth_json("sk-browse"),
            config_toml: third_party_config_toml("gpt-5"),
        })
        .expect("import");

    let document = manager
        .get_profile_document(&profile.id)
        .expect("load document");

    assert_eq!(document.id, profile.id);
    assert!(document.auth_json.contains("sk-browse"));
    assert!(document
        .config_toml
        .contains("base_url = \"http://sub2api.ite.tapcash.com\""));
    assert_eq!(document.auth_type_label, "第三方 API");
}

#[test]
fn get_profile_document_for_active_profile_reads_live_target_config_contents() {
    let (_app_dir, target_dir, mut manager) = temp_manager();

    let profile = manager
        .import_profile(ProfileInput {
            name: "Live Config".into(),
            notes: "active profile".into(),
            auth_json: oauth_auth_json("live@example.com", "user-live", "acct-live"),
            config_toml: official_config_toml("gpt-5"),
        })
        .expect("import");

    manager
        .switch_profile(&profile.id)
        .expect("switch active profile");

    fs::write(
        target_dir.path().join("config.toml"),
        official_config_toml("gpt-5.4"),
    )
    .expect("rewrite target config");

    let document = manager
        .get_profile_document(&profile.id)
        .expect("load active document");

    assert_eq!(document.id, profile.id);
    assert_eq!(document.name, "Live Config");
    assert!(document.config_toml.contains("model = \"gpt-5.4\""));
}

#[test]
fn update_profile_rewrites_saved_contents_and_metadata() {
    let (_app_dir, _target_dir, manager) = temp_manager();

    let profile = manager
        .import_profile(ProfileInput {
            name: "Editable".into(),
            notes: "before edit".into(),
            auth_json: api_key_auth_json("sk-before"),
            config_toml: official_config_toml("gpt-4.1"),
        })
        .expect("import");

    let updated = manager
        .update_profile(
            &profile.id,
            ProfileInput {
                name: "Editable Updated".into(),
                notes: "after edit".into(),
                auth_json: oauth_auth_json("after@example.com", "user-1", "acct-1"),
                config_toml: official_config_toml("gpt-5"),
            },
        )
        .expect("update profile");

    assert_eq!(updated.name, "Editable Updated");
    assert_eq!(updated.notes, "after edit");
    assert_ne!(updated.auth_hash, profile.auth_hash);

    let document = manager
        .get_profile_document(&profile.id)
        .expect("reload document");
    let auth_value: serde_json::Value =
        serde_json::from_str(&document.auth_json).expect("parse auth json");
    assert_eq!(
        auth_value
            .get("auth_mode")
            .and_then(|value| value.as_str())
            .expect("auth mode"),
        "chatgpt"
    );
    assert!(document.config_toml.contains("model = \"gpt-5\""));
    assert_eq!(updated.auth_type_label, "官方 OAuth");
}

#[test]
fn switch_profile_creates_backup_and_updates_target_files() {
    let (app_dir, target_dir, mut manager) = temp_manager();

    fs::write(
        target_dir.path().join("auth.json"),
        api_key_auth_json("sk-existing"),
    )
    .expect("seed auth");
    fs::write(
        target_dir.path().join("config.toml"),
        format!(
            r#"model = "gpt-4.1"
model_reasoning_effort = "medium"
approval_policy = "never"
windows_wsl_setup_acknowledged = true
{}"#,
            local_sections()
        ),
    )
    .expect("seed config");

    let profile = manager
        .import_profile(ProfileInput {
            name: "Alt Account".into(),
            notes: String::new(),
            auth_json: api_key_auth_json("sk-alt"),
            config_toml: third_party_config_toml("gpt-5"),
        })
        .expect("import");

    let result = manager.switch_profile(&profile.id).expect("switch profile");

    let active_auth =
        fs::read_to_string(target_dir.path().join("auth.json")).expect("read switched auth");
    let active_config =
        fs::read_to_string(target_dir.path().join("config.toml")).expect("read switched config");

    assert!(active_auth.contains("sk-alt"));
    assert!(active_config.contains("gpt-5"));
    assert!(active_config.contains("base_url = \"http://sub2api.ite.tapcash.com\""));
    assert!(active_config.contains("[projects.\"/tmp/demo\"]"));
    assert!(active_config.contains("approval_policy = \"never\""));

    let backup_dir = app_dir.path().join("backups").join(result.backup_id);
    let backup_auth = fs::read_to_string(backup_dir.join("auth.json")).expect("read backup auth");
    let backup_config =
        fs::read_to_string(backup_dir.join("config.toml")).expect("read backup config");

    assert!(backup_auth.contains("sk-existing"));
    assert!(backup_config.contains("gpt-4.1"));
}

#[test]
fn detect_active_profile_matches_target_file_contents() {
    let (_app_dir, _target_dir, mut manager) = temp_manager();

    let profile = manager
        .import_profile(ProfileInput {
            name: "Detect Me".into(),
            notes: String::new(),
            auth_json: api_key_auth_json("sk-detect"),
            config_toml: official_config_toml("gpt-5"),
        })
        .expect("import");

    manager
        .switch_profile(&profile.id)
        .expect("switch active profile");

    let active_profile = manager
        .detect_active_profile()
        .expect("detect active profile")
        .expect("an active profile should be detected");

    assert_eq!(active_profile.id, profile.id);
}

#[test]
fn snapshot_auto_imports_current_target_profile_and_creates_marker() {
    let (app_dir, target_dir, manager) = temp_manager();

    fs::write(
        target_dir.path().join("auth.json"),
        oauth_auth_json("owner@example.com", "user-1", "tapcash-main-001"),
    )
    .expect("seed auth");
    fs::write(
        target_dir.path().join("config.toml"),
        official_config_toml("gpt-5"),
    )
    .expect("seed config");

    let snapshot = manager.snapshot().expect("snapshot");

    assert_eq!(snapshot.profiles.len(), 1);
    assert_eq!(snapshot.profiles[0].name, "tapcash");
    assert_eq!(
        snapshot.active_profile_id.as_deref(),
        Some(snapshot.profiles[0].id.as_str())
    );

    let marker_path = target_dir.path().join("codex-auth-switch.json");
    assert!(marker_path.exists());

    let marker: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(marker_path).expect("read marker"))
            .expect("parse marker");
    assert_eq!(
        marker.get("profileId").and_then(|value| value.as_str()),
        Some(snapshot.profiles[0].id.as_str())
    );

    let reloaded = ProfileManager::load_or_default(app_dir.path().to_path_buf()).expect("reload");
    let profiles = reloaded.list_profiles().expect("list profiles");
    assert_eq!(profiles.len(), 1);
}

#[test]
fn snapshot_reuses_existing_profile_instead_of_importing_duplicate() {
    let (_app_dir, target_dir, manager) = temp_manager();

    let profile = manager
        .import_profile(ProfileInput {
            name: "Existing".into(),
            notes: String::new(),
            auth_json: oauth_auth_json("owner@example.com", "user-1", "tapcash-main-001"),
            config_toml: official_config_toml("gpt-5"),
        })
        .expect("import");

    fs::write(
        target_dir.path().join("auth.json"),
        oauth_auth_json("owner@example.com", "user-1", "tapcash-main-001"),
    )
    .expect("seed auth");
    fs::write(
        target_dir.path().join("config.toml"),
        official_config_toml("gpt-5"),
    )
    .expect("seed config");

    let snapshot = manager.snapshot().expect("snapshot");

    assert_eq!(snapshot.profiles.len(), 1);
    assert_eq!(
        snapshot.active_profile_id.as_deref(),
        Some(profile.id.as_str())
    );
}

#[test]
fn switch_profile_syncs_current_auth_and_managed_config_back_to_previous_profile() {
    let (app_dir, target_dir, mut manager) = temp_manager();

    let profile_a = manager
        .import_profile(ProfileInput {
            name: "Official".into(),
            notes: String::new(),
            auth_json: oauth_auth_json("one@example.com", "user-a", "acct-a"),
            config_toml: official_config_toml("gpt-5.4"),
        })
        .expect("import a");
    let profile_b = manager
        .import_profile(ProfileInput {
            name: "Third Party".into(),
            notes: String::new(),
            auth_json: api_key_auth_json("sk-third"),
            config_toml: third_party_config_toml("gpt-5.4"),
        })
        .expect("import b");

    manager
        .switch_profile(&profile_a.id)
        .expect("switch to first profile");

    let mut manager = ProfileManager::load_or_default(app_dir.path().to_path_buf())
        .expect("reload manager with updated state");

    fs::write(
        target_dir.path().join("auth.json"),
        oauth_auth_json("one@example.com", "user-a", "acct-a"),
    )
    .expect("rewrite auth");
    fs::write(
        target_dir.path().join("config.toml"),
        config_with_shared_growth(&stale_official_config_toml("gpt-5.4-turbo")),
    )
    .expect("rewrite config");

    manager
        .switch_profile(&profile_b.id)
        .expect("switch away from first profile");

    let synced = manager
        .get_profile_document(&profile_a.id)
        .expect("load synced profile");
    assert!(synced.config_toml.contains("model = \"gpt-5.4-turbo\""));
    assert!(synced
        .config_toml
        .contains("windows_wsl_setup_acknowledged = true"));
    assert!(synced
        .config_toml
        .contains("[projects.\"/tmp/runtime-growth\"]"));
    assert!(!synced.config_toml.contains("model_provider ="));
    assert!(!synced.config_toml.contains("[model_providers."));
    assert!(!synced.config_toml.contains("base_url ="));
}

#[test]
fn switch_profile_merges_shared_runtime_config_without_polluting_official_profile() {
    let (_app_dir, target_dir, mut manager) = temp_manager();

    let official = manager
        .import_profile(ProfileInput {
            name: "Official".into(),
            notes: String::new(),
            auth_json: oauth_auth_json("one@example.com", "user-a", "acct-a"),
            config_toml: official_config_toml("gpt-5.4"),
        })
        .expect("import official");
    let third_party = manager
        .import_profile(ProfileInput {
            name: "Third Party".into(),
            notes: String::new(),
            auth_json: api_key_auth_json("sk-third"),
            config_toml: third_party_config_toml("gpt-5.4"),
        })
        .expect("import third party");

    manager
        .switch_profile(&third_party.id)
        .expect("switch to third party");

    fs::write(
        target_dir.path().join("config.toml"),
        config_with_shared_growth(&third_party_config_toml("gpt-5.4")),
    )
    .expect("seed runtime growth");

    manager
        .switch_profile(&official.id)
        .expect("switch to official");

    let switched =
        fs::read_to_string(target_dir.path().join("config.toml")).expect("read switched config");
    assert!(switched.contains("model = \"gpt-5.4\""));
    assert!(switched.contains("model_reasoning_effort = \"medium\""));
    assert!(switched.contains("windows_wsl_setup_acknowledged = true"));
    assert!(switched.contains("[projects.\"/tmp/runtime-growth\"]"));
    assert!(!switched.contains("model_provider ="));
    assert!(!switched.contains("review_model ="));
    assert!(!switched.contains("disable_response_storage ="));
    assert!(!switched.contains("network_access ="));
    assert!(!switched.contains("model_context_window ="));
    assert!(!switched.contains("model_auto_compact_token_limit ="));
    assert!(!switched.contains("[model_providers."));
    assert!(!switched.contains("base_url ="));
}

#[test]
fn switch_profile_updates_selected_profile_document_with_effective_merged_config() {
    let (_app_dir, target_dir, mut manager) = temp_manager();

    let official = manager
        .import_profile(ProfileInput {
            name: "Official".into(),
            notes: String::new(),
            auth_json: oauth_auth_json("one@example.com", "user-a", "acct-a"),
            config_toml: official_config_toml("gpt-5.4"),
        })
        .expect("import official");
    let third_party = manager
        .import_profile(ProfileInput {
            name: "Third Party".into(),
            notes: String::new(),
            auth_json: api_key_auth_json("sk-third"),
            config_toml: third_party_config_toml("gpt-5.4"),
        })
        .expect("import third party");

    manager
        .switch_profile(&third_party.id)
        .expect("switch to third party");

    fs::write(
        target_dir.path().join("config.toml"),
        config_with_shared_growth(&third_party_config_toml("gpt-5.4")),
    )
    .expect("seed runtime growth");

    manager
        .switch_profile(&official.id)
        .expect("switch to official");

    let saved = manager
        .get_profile_document(&official.id)
        .expect("load updated official profile");
    assert!(saved.config_toml.contains("model = \"gpt-5.4\""));
    assert!(saved
        .config_toml
        .contains("model_reasoning_effort = \"medium\""));
    assert!(saved
        .config_toml
        .contains("windows_wsl_setup_acknowledged = true"));
    assert!(saved
        .config_toml
        .contains("[projects.\"/tmp/runtime-growth\"]"));
    assert!(saved.config_toml.contains("[mcp_servers.playwright]"));
    assert!(saved.config_toml.contains("[features]"));
    assert!(!saved.config_toml.contains("model_provider ="));
    assert!(!saved.config_toml.contains("[model_providers."));
}

#[test]
fn switch_profile_keeps_shared_sections_when_target_config_is_missing() {
    let (_app_dir, target_dir, mut manager) = temp_manager();

    let official = manager
        .import_profile(ProfileInput {
            name: "Official".into(),
            notes: String::new(),
            auth_json: oauth_auth_json("one@example.com", "user-a", "acct-a"),
            config_toml: config_with_shared_growth(&official_config_toml("gpt-5.4")),
        })
        .expect("import official");

    manager
        .switch_profile(&official.id)
        .expect("switch with empty target");

    let switched =
        fs::read_to_string(target_dir.path().join("config.toml")).expect("read switched config");
    assert!(switched.contains("model = \"gpt-5.4\""));
    assert!(switched.contains("model_reasoning_effort = \"medium\""));
    assert!(switched.contains("windows_wsl_setup_acknowledged = true"));
    assert!(switched.contains("[projects.\"/tmp/demo\"]"));
    assert!(switched.contains("[projects.\"/tmp/runtime-growth\"]"));
    assert!(switched.contains("[mcp_servers.playwright]"));
    assert!(switched.contains("[features]"));
}

#[test]
fn fix_session_database_updates_sqlite_and_jsonl_without_shell_tools() {
    let home_dir = TempDir::new().expect("temp home");
    let app_dir = TempDir::new().expect("temp app");
    let codex_dir = home_dir.path().join(".codex");
    fs::create_dir_all(&codex_dir).expect("create codex dir");

    fs::write(
        codex_dir.join("config.toml"),
        r#"model_provider = "openai_custom""#,
    )
    .expect("seed config");

    let db_path = codex_dir.join("state_1.sqlite");
    let conn = Connection::open(&db_path).expect("open sqlite");
    conn.execute("CREATE TABLE threads (model_provider TEXT)", [])
        .expect("create table");
    conn.execute("INSERT INTO threads (model_provider) VALUES ('openai')", [])
        .expect("seed row");
    drop(conn);

    let sessions_dir = codex_dir.join("sessions");
    let archived_dir = codex_dir.join("archived_sessions");
    fs::create_dir_all(&sessions_dir).expect("create sessions dir");
    fs::create_dir_all(&archived_dir).expect("create archived sessions dir");
    fs::write(
        sessions_dir.join("one.jsonl"),
        r#"{"session_meta":{"payload":{"model_provider":"openai"}}}"#,
    )
    .expect("seed sessions");
    fs::write(
        archived_dir.join("two.jsonl"),
        r#"{"session_meta":{"payload":{"model_provider":"openai"}}}"#,
    )
    .expect("seed archived sessions");

    let old_home = env::var("HOME").ok();
    let old_userprofile = env::var("USERPROFILE").ok();
    let old_path = env::var("PATH").ok();
    env::set_var("HOME", home_dir.path());
    env::set_var("USERPROFILE", home_dir.path());
    env::set_var("PATH", "");

    let manager =
        ProfileManager::load_or_default(app_dir.path().to_path_buf()).expect("load manager");
    manager
        .fix_session_database_and_configs()
        .expect("fix sessions");

    if let Some(value) = old_home {
        env::set_var("HOME", value);
    }
    if let Some(value) = old_userprofile {
        env::set_var("USERPROFILE", value);
    }
    if let Some(value) = old_path {
        env::set_var("PATH", value);
    }

    let conn = Connection::open(&db_path).expect("reopen sqlite");
    let provider: String = conn
        .query_row("SELECT model_provider FROM threads LIMIT 1", [], |row| {
            row.get(0)
        })
        .expect("query provider");
    assert_eq!(provider, "openai_custom");

    let sessions_content =
        fs::read_to_string(sessions_dir.join("one.jsonl")).expect("read sessions");
    let archived_content =
        fs::read_to_string(archived_dir.join("two.jsonl")).expect("read archived");
    assert!(sessions_content.contains("\"model_provider\":\"openai_custom\""));
    assert!(archived_content.contains("\"model_provider\":\"openai_custom\""));
}

#[test]
fn fix_session_database_sanitizes_official_oauth_config() {
    let (_app_dir, target_dir, manager) = temp_manager();

    fs::write(
        target_dir.path().join("auth.json"),
        oauth_auth_json("owner@example.com", "user-1", "tapcash-main-001"),
    )
    .expect("seed oauth auth");
    fs::write(
        target_dir.path().join("config.toml"),
        stale_official_config_toml("gpt-5"),
    )
    .expect("seed stale official config");

    manager
        .fix_session_database_and_configs()
        .expect("sanitize official config");

    let repaired =
        fs::read_to_string(target_dir.path().join("config.toml")).expect("read repaired config");
    assert!(repaired.contains("model = \"gpt-5\""));
    assert!(repaired.contains("model_reasoning_effort = \"medium\""));
    assert!(!repaired.contains("model_provider ="));
    assert!(!repaired.contains("review_model ="));
    assert!(!repaired.contains("disable_response_storage ="));
    assert!(!repaired.contains("network_access ="));
    assert!(!repaired.contains("model_context_window ="));
    assert!(!repaired.contains("model_auto_compact_token_limit ="));
    assert!(!repaired.contains("[model_providers."));
    assert!(!repaired.contains("intellectgrowth"));
}

#[test]
fn fix_session_database_rebuilds_session_index_from_threads_table() {
    let home_dir = TempDir::new().expect("temp home");
    let app_dir = TempDir::new().expect("temp app");
    let codex_dir = home_dir.path().join(".codex");
    fs::create_dir_all(&codex_dir).expect("create codex dir");

    fs::write(
        codex_dir.join("config.toml"),
        r#"model_provider = "openai_custom""#,
    )
    .expect("seed config");

    let db_path = codex_dir.join("state_1.sqlite");
    let conn = Connection::open(&db_path).expect("open sqlite");
    conn.execute(
        "CREATE TABLE threads (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            model_provider TEXT NOT NULL,
            archived INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )
    .expect("create threads table");
    conn.execute(
        "INSERT INTO threads (id, title, updated_at, model_provider, archived) VALUES (?1, ?2, ?3, ?4, ?5)",
        ("old-thread", "Updated Old Title", 100_i64, "openai", 0_i64),
    )
    .expect("seed old thread");
    conn.execute(
        "INSERT INTO threads (id, title, updated_at, model_provider, archived) VALUES (?1, ?2, ?3, ?4, ?5)",
        ("fresh-thread", "Fresh Title", 200_i64, "openai", 0_i64),
    )
    .expect("seed fresh thread");
    conn.execute(
        "INSERT INTO threads (id, title, updated_at, model_provider, archived) VALUES (?1, ?2, ?3, ?4, ?5)",
        ("archived-thread", "Archived Title", 300_i64, "openai", 1_i64),
    )
    .expect("seed archived thread");
    drop(conn);

    fs::write(
        codex_dir.join("session_index.jsonl"),
        concat!(
            r#"{"id":"old-thread","thread_name":"Stale Title","updated_at":"1970-01-01T00:00:01Z"}"#,
            "\n",
            r#"{"id":"ghost-thread","thread_name":"Ghost Title","updated_at":"1970-01-01T00:00:02Z"}"#,
            "\n"
        ),
    )
    .expect("seed stale session index");

    let old_home = env::var("HOME").ok();
    let old_userprofile = env::var("USERPROFILE").ok();
    let old_path = env::var("PATH").ok();
    env::set_var("HOME", home_dir.path());
    env::set_var("USERPROFILE", home_dir.path());
    env::set_var("PATH", "");

    let manager =
        ProfileManager::load_or_default(app_dir.path().to_path_buf()).expect("load manager");
    manager
        .fix_session_database_and_configs()
        .expect("repair sessions and index");

    if let Some(value) = old_home {
        env::set_var("HOME", value);
    }
    if let Some(value) = old_userprofile {
        env::set_var("USERPROFILE", value);
    }
    if let Some(value) = old_path {
        env::set_var("PATH", value);
    }

    let session_index = fs::read_to_string(codex_dir.join("session_index.jsonl"))
        .expect("read rebuilt session index");
    let entries = session_index
        .lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).expect("parse index entry"))
        .collect::<Vec<_>>();

    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0]["id"], "old-thread");
    assert_eq!(entries[0]["thread_name"], "Updated Old Title");
    assert_eq!(entries[1]["id"], "fresh-thread");
    assert_eq!(entries[1]["thread_name"], "Fresh Title");
    assert!(entries.iter().all(|entry| entry["id"] != "ghost-thread"));
    assert!(entries.iter().all(|entry| entry["id"] != "archived-thread"));
}

#[test]
fn restart_codex_script_targets_codex_app_on_macos() {
    #[cfg(target_os = "macos")]
    {
        let script = restart_codex_script().expect("script should exist on macOS");
        assert!(script.contains("application \"Codex\""));
        assert!(script.contains("quit"));
    }

    #[cfg(not(target_os = "macos"))]
    {
        assert!(restart_codex_script().is_none());
    }
}
