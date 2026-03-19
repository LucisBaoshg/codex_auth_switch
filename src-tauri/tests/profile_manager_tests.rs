use codex_auth_switch_lib::core::{restart_codex_script, ProfileInput, ProfileManager};
use serde_json::json;
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
    assert!(document.config_toml.contains("base_url = \"http://sub2api.ite.tapcash.com\""));
    assert_eq!(document.auth_type_label, "第三方 API");
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
    let (app_dir, target_dir, manager) = temp_manager();

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
    let (_app_dir, _target_dir, manager) = temp_manager();

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
fn switch_profile_syncs_current_auth_and_managed_config_back_to_previous_profile() {
    let (app_dir, target_dir, manager) = temp_manager();

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

    let manager = ProfileManager::load_or_default(app_dir.path().to_path_buf())
        .expect("reload manager with updated state");

    fs::write(
        target_dir.path().join("auth.json"),
        oauth_auth_json("one@example.com", "user-a", "acct-a"),
    )
    .expect("rewrite auth");
    fs::write(
        target_dir.path().join("config.toml"),
        official_config_toml("gpt-5.4-turbo"),
    )
    .expect("rewrite config");

    manager
        .switch_profile(&profile_b.id)
        .expect("switch away from first profile");

    let synced = manager
        .get_profile_document(&profile_a.id)
        .expect("load synced profile");
    assert!(synced.config_toml.contains("model = \"gpt-5.4-turbo\""));
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
