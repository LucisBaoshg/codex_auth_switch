use codex_auth_switch_lib::core::{restart_codex_script, ProfileInput, ProfileManager};
use std::fs;
use tempfile::TempDir;

fn valid_auth_json(email: &str) -> String {
    format!(
        r#"{{
  "user": {{
    "email": "{email}"
  }},
  "token": "sample-token"
}}"#
    )
}

fn valid_config_toml(model: &str) -> String {
    format!(
        r#"default_model = "{model}"
theme = "system"
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

#[test]
fn import_profile_persists_valid_profile_files_and_metadata() {
    let (_app_dir, _target_dir, manager) = temp_manager();

    let profile = manager
        .import_profile(ProfileInput {
            name: "Work Account".into(),
            notes: "primary profile".into(),
            auth_json: valid_auth_json("work@example.com"),
            config_toml: valid_config_toml("gpt-5"),
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
            config_toml: valid_config_toml("gpt-5"),
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
            auth_json: valid_auth_json("broken@example.com"),
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
        valid_auth_json("current@example.com"),
    )
    .expect("seed auth");
    fs::write(
        target_dir.path().join("config.toml"),
        valid_config_toml("gpt-5"),
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
        valid_auth_json("current-target@example.com"),
    )
    .expect("seed auth");
    fs::write(
        target_dir.path().join("config.toml"),
        valid_config_toml("gpt-5"),
    )
    .expect("seed config");

    let input = manager
        .get_target_profile_input()
        .expect("load current target input");

    assert!(input.auth_json.contains("current-target@example.com"));
    assert!(input.config_toml.contains("default_model = \"gpt-5\""));
}

#[test]
fn get_profile_document_returns_saved_auth_and_config_contents() {
    let (_app_dir, _target_dir, manager) = temp_manager();

    let profile = manager
        .import_profile(ProfileInput {
            name: "Browse Me".into(),
            notes: "inspect contents".into(),
            auth_json: valid_auth_json("browse@example.com"),
            config_toml: valid_config_toml("gpt-5"),
        })
        .expect("import");

    let document = manager
        .get_profile_document(&profile.id)
        .expect("load document");

    assert_eq!(document.id, profile.id);
    assert!(document.auth_json.contains("browse@example.com"));
    assert!(document.config_toml.contains("default_model = \"gpt-5\""));
}

#[test]
fn update_profile_rewrites_saved_contents_and_metadata() {
    let (_app_dir, _target_dir, manager) = temp_manager();

    let profile = manager
        .import_profile(ProfileInput {
            name: "Editable".into(),
            notes: "before edit".into(),
            auth_json: valid_auth_json("before@example.com"),
            config_toml: valid_config_toml("gpt-4.1"),
        })
        .expect("import");

    let updated = manager
        .update_profile(
            &profile.id,
            ProfileInput {
                name: "Editable Updated".into(),
                notes: "after edit".into(),
                auth_json: valid_auth_json("after@example.com"),
                config_toml: valid_config_toml("gpt-5"),
            },
        )
        .expect("update profile");

    assert_eq!(updated.name, "Editable Updated");
    assert_eq!(updated.notes, "after edit");
    assert_ne!(updated.auth_hash, profile.auth_hash);

    let document = manager
        .get_profile_document(&profile.id)
        .expect("reload document");
    assert!(document.auth_json.contains("after@example.com"));
    assert!(document.config_toml.contains("default_model = \"gpt-5\""));
}

#[test]
fn switch_profile_creates_backup_and_updates_target_files() {
    let (app_dir, target_dir, manager) = temp_manager();

    fs::write(
        target_dir.path().join("auth.json"),
        valid_auth_json("existing@example.com"),
    )
    .expect("seed auth");
    fs::write(
        target_dir.path().join("config.toml"),
        valid_config_toml("gpt-4.1"),
    )
    .expect("seed config");

    let profile = manager
        .import_profile(ProfileInput {
            name: "Alt Account".into(),
            notes: String::new(),
            auth_json: valid_auth_json("alt@example.com"),
            config_toml: valid_config_toml("gpt-5"),
        })
        .expect("import");

    let result = manager.switch_profile(&profile.id).expect("switch profile");

    let active_auth =
        fs::read_to_string(target_dir.path().join("auth.json")).expect("read switched auth");
    let active_config =
        fs::read_to_string(target_dir.path().join("config.toml")).expect("read switched config");

    assert!(active_auth.contains("alt@example.com"));
    assert!(active_config.contains("gpt-5"));

    let backup_dir = app_dir.path().join("backups").join(result.backup_id);
    let backup_auth = fs::read_to_string(backup_dir.join("auth.json")).expect("read backup auth");
    let backup_config =
        fs::read_to_string(backup_dir.join("config.toml")).expect("read backup config");

    assert!(backup_auth.contains("existing@example.com"));
    assert!(backup_config.contains("gpt-4.1"));
}

#[test]
fn detect_active_profile_matches_target_file_contents() {
    let (_app_dir, _target_dir, manager) = temp_manager();

    let profile = manager
        .import_profile(ProfileInput {
            name: "Detect Me".into(),
            notes: String::new(),
            auth_json: valid_auth_json("detect@example.com"),
            config_toml: valid_config_toml("gpt-5"),
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
