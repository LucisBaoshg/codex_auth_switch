use chrono::{SecondsFormat, TimeZone, Utc};
use codex_auth_switch_lib::core::{restart_codex_script, ProfileInput, ProfileManager};
use filetime::{set_file_mtime, FileTime};
use rusqlite::Connection;
use serde_json::json;
use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tempfile::TempDir;

struct RecoveryThreadSeed {
    id: String,
    cwd: String,
    title: String,
    rollout_path: PathBuf,
    updated_at_ms: i64,
    has_user_event: bool,
    archived: bool,
    model_provider: String,
}

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

fn write_session_state_root(root: &Path, label: &str) {
    fs::create_dir_all(root).expect("create session state root");
    fs::create_dir_all(root.join("sessions").join("2026")).expect("create sessions dir");
    fs::create_dir_all(root.join("archived_sessions")).expect("create archived dir");

    fs::write(
        root.join(".codex-global-state.json"),
        serde_json::to_string_pretty(&json!({
            "project-order": [format!("/tmp/{label}")],
            "electron-saved-workspace-roots": [format!("/tmp/{label}")],
            "label": label
        }))
        .expect("serialize global state"),
    )
    .expect("write global state");
    fs::write(
        root.join("session_index.jsonl"),
        format!(
            r#"{{"id":"{label}-thread","thread_name":"{label} thread","updated_at":"1970-01-01T00:00:01Z"}}"#
        ),
    )
    .expect("write session index");
    fs::write(
        root.join("history.jsonl"),
        format!(r#"{{"label":"{label}","kind":"history"}}"#),
    )
    .expect("write history");
    fs::write(root.join("state_5.sqlite"), format!("sqlite-{label}")).expect("write sqlite");
    fs::write(root.join("state_5.sqlite-wal"), format!("wal-{label}")).expect("write wal");
    fs::write(root.join("state_5.sqlite-shm"), format!("shm-{label}")).expect("write shm");
    fs::write(
        root.join("sessions")
            .join("2026")
            .join(format!("{label}.jsonl")),
        format!(r#"{{"label":"{label}","kind":"session"}}"#),
    )
    .expect("write session file");
    fs::write(
        root.join("archived_sessions")
            .join(format!("{label}-archived.jsonl")),
        format!(r#"{{"label":"{label}","kind":"archived"}}"#),
    )
    .expect("write archived session file");
}

fn assert_session_state_root(root: &Path, label: &str) {
    let global_state =
        fs::read_to_string(root.join(".codex-global-state.json")).expect("read global state");
    let session_index =
        fs::read_to_string(root.join("session_index.jsonl")).expect("read session index");
    let history = fs::read_to_string(root.join("history.jsonl")).expect("read history");
    let sqlite = fs::read_to_string(root.join("state_5.sqlite")).expect("read sqlite");
    let wal = fs::read_to_string(root.join("state_5.sqlite-wal")).expect("read wal");
    let shm = fs::read_to_string(root.join("state_5.sqlite-shm")).expect("read shm");
    let session = fs::read_to_string(
        root.join("sessions")
            .join("2026")
            .join(format!("{label}.jsonl")),
    )
    .expect("read session file");
    let archived = fs::read_to_string(
        root.join("archived_sessions")
            .join(format!("{label}-archived.jsonl")),
    )
    .expect("read archived session file");

    assert!(global_state.contains(&format!(r#""label": "{label}""#)));
    assert!(session_index.contains(&format!(r#""id":"{label}-thread""#)));
    assert!(history.contains(&format!(r#""label":"{label}""#)));
    assert_eq!(sqlite, format!("sqlite-{label}"));
    assert_eq!(wal, format!("wal-{label}"));
    assert_eq!(shm, format!("shm-{label}"));
    assert!(session.contains(&format!(r#""label":"{label}""#)));
    assert!(archived.contains(&format!(r#""label":"{label}""#)));
}

fn profile_session_state_dir(app_dir: &TempDir, profile_id: &str) -> PathBuf {
    app_dir
        .path()
        .join("profiles")
        .join(profile_id)
        .join("session-state")
}

fn session_index_updated_at(ms: i64) -> String {
    Utc.timestamp_millis_opt(ms)
        .single()
        .expect("valid millis")
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn file_time_from_millis(ms: i64) -> FileTime {
    let seconds = ms.div_euclid(1_000);
    let millis = ms.rem_euclid(1_000) as u32;
    FileTime::from_unix_time(seconds, millis * 1_000_000)
}

fn file_mtime_millis(path: &Path) -> i64 {
    let metadata = fs::metadata(path).expect("read file metadata");
    let modified = FileTime::from_last_modification_time(&metadata);
    modified.unix_seconds() * 1_000 + i64::from(modified.nanoseconds() / 1_000_000)
}

fn write_recovery_rollout(path: &Path, has_user_message: bool) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create rollout parent");
    }

    let line = if has_user_message {
        json!({
            "event": {
                "type": "user_message",
                "payload": {
                    "role": "user",
                    "text": "hello"
                }
            }
        })
    } else {
        json!({
            "event": {
                "type": "assistant_message",
                "payload": {
                    "role": "assistant",
                    "text": "hello"
                }
            }
        })
    };

    fs::write(path, format!("{line}\n")).expect("write rollout");
}

fn write_provider_repair_rollout(path: &Path, id: &str, provider: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create rollout parent");
    }

    let meta = json!({
        "type": "session_meta",
        "payload": {
            "id": id,
            "model_provider": provider
        }
    });
    let user_message = json!({
        "event": {
            "type": "user_message",
            "payload": {
                "role": "user",
                "text": "keep model_provider text untouched"
            }
        }
    });
    fs::write(path, format!("{meta}\n{user_message}\n")).expect("write provider rollout");
}

fn write_recovery_session_index(root: &Path, entries: &[(&str, &str, i64)]) {
    let content = entries
        .iter()
        .map(|(id, title, updated_at_ms)| {
            serde_json::to_string(&json!({
                "id": id,
                "thread_name": title,
                "updated_at": session_index_updated_at(*updated_at_ms)
            }))
            .expect("serialize session index entry")
        })
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(root.join("session_index.jsonl"), format!("{content}\n"))
        .expect("write session index");
}

fn seed_recovery_database(root: &Path, threads: &[RecoveryThreadSeed]) {
    let db_path = root.join("state_5.sqlite");
    let conn = Connection::open(&db_path).expect("open recovery db");
    conn.execute_batch(
        "CREATE TABLE threads (
            id TEXT PRIMARY KEY,
            rollout_path TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            source TEXT,
            model_provider TEXT,
            cwd TEXT,
            title TEXT,
            has_user_event INTEGER NOT NULL DEFAULT 0,
            archived INTEGER NOT NULL DEFAULT 0
        );",
    )
    .expect("create recovery threads");

    for thread in threads {
        conn.execute(
            "INSERT INTO threads (
                id,
                rollout_path,
                created_at,
                updated_at,
                created_at_ms,
                updated_at_ms,
                source,
                model_provider,
                cwd,
                title,
                has_user_event,
                archived
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            (
                &thread.id,
                thread.rollout_path.to_string_lossy().to_string(),
                thread.updated_at_ms / 1000 - 5,
                thread.updated_at_ms / 1000,
                thread.updated_at_ms - 5_000,
                thread.updated_at_ms,
                "local",
                &thread.model_provider,
                &thread.cwd,
                &thread.title,
                i64::from(thread.has_user_event),
                i64::from(thread.archived),
            ),
        )
        .expect("insert recovery thread");
    }
}

fn read_recovery_thread_state(root: &Path, id: &str) -> (i64, i64, bool) {
    let conn = Connection::open(root.join("state_5.sqlite")).expect("open recovery db for read");
    conn.query_row(
        "SELECT updated_at, updated_at_ms, has_user_event FROM threads WHERE id = ?1",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get::<_, i64>(2)? == 1)),
    )
    .expect("query recovery thread")
}

fn read_recovery_thread_provider(root: &Path, id: &str) -> String {
    let conn = Connection::open(root.join("state_5.sqlite")).expect("open recovery db for read");
    conn.query_row(
        "SELECT model_provider FROM threads WHERE id = ?1",
        [id],
        |row| row.get(0),
    )
    .expect("query recovery thread provider")
}

fn with_process_env_lock<T>(task: impl FnOnce() -> T) -> T {
    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let _guard = ENV_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("lock process env");
    task()
}

struct ScopedEnvVar {
    key: &'static str,
    previous: Option<OsString>,
}

impl ScopedEnvVar {
    fn set(key: &'static str, value: impl AsRef<std::ffi::OsStr>) -> Self {
        let previous = env::var_os(key);
        env::set_var(key, value);
        Self { key, previous }
    }
}

impl Drop for ScopedEnvVar {
    fn drop(&mut self) {
        if let Some(value) = &self.previous {
            env::set_var(self.key, value);
        } else {
            env::remove_var(self.key);
        }
    }
}

fn with_test_codex_env<T>(home_dir: &Path, task: impl FnOnce() -> T) -> T {
    with_process_env_lock(|| {
        let _home = ScopedEnvVar::set("HOME", home_dir.as_os_str());
        let _userprofile = ScopedEnvVar::set("USERPROFILE", home_dir.as_os_str());
        let _path = ScopedEnvVar::set("PATH", "");
        task()
    })
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
fn update_active_profile_rewrites_live_target_files() {
    let (_app_dir, target_dir, mut manager) = temp_manager();

    let profile = manager
        .import_profile(ProfileInput {
            name: "Active Editable".into(),
            notes: "before edit".into(),
            auth_json: api_key_auth_json("sk-before"),
            config_toml: third_party_config_toml("gpt-4.1"),
        })
        .expect("import");

    manager
        .switch_profile(&profile.id)
        .expect("switch active profile");

    manager
        .update_profile(
            &profile.id,
            ProfileInput {
                name: "Active Editable".into(),
                notes: "after edit".into(),
                auth_json: api_key_auth_json("sk-after"),
                config_toml: third_party_config_toml("gpt-5.4"),
            },
        )
        .expect("update active profile");

    let live_auth =
        fs::read_to_string(target_dir.path().join("auth.json")).expect("read live auth");
    let live_config =
        fs::read_to_string(target_dir.path().join("config.toml")).expect("read live config");

    assert!(live_auth.contains("sk-after"));
    assert!(live_config.contains("model = \"gpt-5.4\""));

    let document = manager
        .get_profile_document(&profile.id)
        .expect("reload active document");

    assert!(document.loaded_from_target);
    assert!(!document.has_target_changes);
    assert!(document.auth_json.contains("sk-after"));
    assert!(document.config_toml.contains("model = \"gpt-5.4\""));
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
fn switch_profile_keeps_live_session_state_shared_without_per_profile_snapshot() {
    let (app_dir, target_dir, mut manager) = temp_manager();

    let profile_a = manager
        .import_profile(ProfileInput {
            name: "Profile A".into(),
            notes: String::new(),
            auth_json: oauth_auth_json("a@example.com", "user-a", "acct-a"),
            config_toml: official_config_toml("gpt-5"),
        })
        .expect("import a");
    let profile_b = manager
        .import_profile(ProfileInput {
            name: "Profile B".into(),
            notes: String::new(),
            auth_json: api_key_auth_json("sk-b"),
            config_toml: third_party_config_toml("gpt-5"),
        })
        .expect("import b");

    manager.switch_profile(&profile_a.id).expect("switch to a");
    write_session_state_root(target_dir.path(), "alpha");

    manager.switch_profile(&profile_b.id).expect("switch to b");

    assert_session_state_root(target_dir.path(), "alpha");
    assert!(!profile_session_state_dir(&app_dir, &profile_a.id).exists());
}

#[test]
fn switch_profile_ignores_stale_profile_session_state_snapshot() {
    let (app_dir, target_dir, mut manager) = temp_manager();

    let profile_a = manager
        .import_profile(ProfileInput {
            name: "Profile A".into(),
            notes: String::new(),
            auth_json: oauth_auth_json("a@example.com", "user-a", "acct-a"),
            config_toml: official_config_toml("gpt-5"),
        })
        .expect("import a");
    let profile_b = manager
        .import_profile(ProfileInput {
            name: "Profile B".into(),
            notes: String::new(),
            auth_json: api_key_auth_json("sk-b"),
            config_toml: third_party_config_toml("gpt-5"),
        })
        .expect("import b");

    write_session_state_root(&profile_session_state_dir(&app_dir, &profile_a.id), "alpha");

    manager.switch_profile(&profile_b.id).expect("switch to b");
    write_session_state_root(target_dir.path(), "beta");

    manager
        .switch_profile(&profile_a.id)
        .expect("switch back to a");

    assert_session_state_root(target_dir.path(), "beta");
    assert!(!profile_session_state_dir(&app_dir, &profile_b.id).exists());
}

#[test]
fn diagnose_codex_sessions_reports_saved_roots_outside_recent_window_without_marking_corruption() {
    let (_app_dir, target_dir, manager) = temp_manager();

    let mut threads = Vec::new();
    let mut session_index_entries = Vec::new();
    for index in 0..51 {
        let id = format!("thread-{index}");
        let cwd = format!("/tmp/project-{index}");
        let title = format!("Thread {index}");
        let updated_at_ms = (index as i64 + 1) * 1_000;
        let rollout_path = target_dir
            .path()
            .join("sessions")
            .join("2026")
            .join(format!("{id}.jsonl"));
        write_recovery_rollout(&rollout_path, true);
        set_file_mtime(&rollout_path, file_time_from_millis(updated_at_ms))
            .expect("set rollout mtime");

        threads.push(RecoveryThreadSeed {
            id: id.clone(),
            cwd: cwd.clone(),
            title: title.clone(),
            rollout_path,
            updated_at_ms,
            has_user_event: true,
            archived: false,
            model_provider: "openai".into(),
        });
        session_index_entries.push((id, title, updated_at_ms));
    }
    seed_recovery_database(target_dir.path(), &threads);
    let index_refs = session_index_entries
        .iter()
        .map(|(id, title, updated_at_ms)| (id.as_str(), title.as_str(), *updated_at_ms))
        .collect::<Vec<_>>();
    write_recovery_session_index(target_dir.path(), &index_refs);
    fs::write(
        target_dir.path().join(".codex-global-state.json"),
        serde_json::to_string_pretty(&json!({
            "electron-saved-workspace-roots": ["/tmp/project-0"],
            "project-order": ["/tmp/project-0"]
        }))
        .expect("serialize global state"),
    )
    .expect("write global state");

    let report = manager
        .diagnose_codex_sessions()
        .expect("diagnose codex sessions");

    assert_eq!(report.sqlite_integrity, "ok");
    assert_eq!(report.counts.db_threads, 51);
    assert_eq!(report.repair_candidates.missing_rollout_files, 0);
    assert_eq!(
        report
            .repair_candidates
            .has_user_event_false_but_rollout_has_user_message,
        0
    );
    assert_eq!(
        report
            .samples
            .saved_roots_with_chats_outside_recent_window
            .len(),
        1
    );
    assert_eq!(
        report.samples.saved_roots_with_chats_outside_recent_window[0].root,
        "/tmp/project-0"
    );
}

#[test]
fn repair_codex_sessions_sets_has_user_event_without_rewriting_times_by_default() {
    let (_app_dir, target_dir, manager) = temp_manager();

    let rollout_path = target_dir
        .path()
        .join("sessions")
        .join("2026")
        .join("alpha.jsonl");
    write_recovery_rollout(&rollout_path, true);
    set_file_mtime(&rollout_path, file_time_from_millis(7_000)).expect("set rollout mtime");
    seed_recovery_database(
        target_dir.path(),
        &[RecoveryThreadSeed {
            id: "alpha".into(),
            cwd: "/tmp/alpha".into(),
            title: "Alpha".into(),
            rollout_path: rollout_path.clone(),
            updated_at_ms: 1_000,
            has_user_event: false,
            archived: false,
            model_provider: "openai".into(),
        }],
    );
    write_recovery_session_index(target_dir.path(), &[("alpha", "Alpha", 9_000)]);

    let result = manager
        .repair_codex_sessions(false)
        .expect("default session repair");

    let (updated_at, updated_at_ms, has_user_event) =
        read_recovery_thread_state(target_dir.path(), "alpha");
    assert_eq!(updated_at, 1);
    assert_eq!(updated_at_ms, 1_000);
    assert!(has_user_event);
    assert_eq!(file_mtime_millis(&rollout_path), 7_000);
    assert_eq!(result.updates.has_user_event, 1);
    assert_eq!(result.updates.db_time, 0);
    assert_eq!(result.updates.rollout_mtime, 0);
    assert!(Path::new(&result.backup_path).exists());
    assert!(Path::new(&result.audit_path).exists());
}

#[test]
fn repair_codex_sessions_can_restore_times_from_session_index_when_requested() {
    let (_app_dir, target_dir, manager) = temp_manager();

    let rollout_path = target_dir
        .path()
        .join("sessions")
        .join("2026")
        .join("beta.jsonl");
    write_recovery_rollout(&rollout_path, true);
    set_file_mtime(&rollout_path, file_time_from_millis(7_000)).expect("set rollout mtime");
    seed_recovery_database(
        target_dir.path(),
        &[RecoveryThreadSeed {
            id: "beta".into(),
            cwd: "/tmp/beta".into(),
            title: "Beta".into(),
            rollout_path: rollout_path.clone(),
            updated_at_ms: 1_000,
            has_user_event: true,
            archived: false,
            model_provider: "openai".into(),
        }],
    );
    write_recovery_session_index(target_dir.path(), &[("beta", "Beta", 9_000)]);

    let result = manager
        .repair_codex_sessions(true)
        .expect("advanced session repair");

    let (updated_at, updated_at_ms, has_user_event) =
        read_recovery_thread_state(target_dir.path(), "beta");
    assert_eq!(updated_at, 9);
    assert_eq!(updated_at_ms, 9_000);
    assert!(has_user_event);
    assert_eq!(file_mtime_millis(&rollout_path), 9_000);
    assert_eq!(result.updates.has_user_event, 0);
    assert_eq!(result.updates.db_time, 1);
    assert_eq!(result.updates.rollout_mtime, 1);
}

#[test]
fn switch_profile_does_not_repair_shared_session_state() {
    let (_app_dir, target_dir, mut manager) = temp_manager();

    let profile = manager
        .import_profile(ProfileInput {
            name: "Profile".into(),
            notes: String::new(),
            auth_json: oauth_auth_json("profile@example.com", "user-profile", "acct-profile"),
            config_toml: official_config_toml("gpt-5"),
        })
        .expect("import profile");

    let rollout_path = target_dir
        .path()
        .join("sessions")
        .join("2026")
        .join("shared.jsonl");
    write_recovery_rollout(&rollout_path, true);
    set_file_mtime(&rollout_path, file_time_from_millis(1_000)).expect("set rollout mtime");
    seed_recovery_database(
        target_dir.path(),
        &[RecoveryThreadSeed {
            id: "shared".into(),
            cwd: "/tmp/shared".into(),
            title: "Shared".into(),
            rollout_path,
            updated_at_ms: 1_000,
            has_user_event: false,
            archived: false,
            model_provider: "openai".into(),
        }],
    );
    write_recovery_session_index(target_dir.path(), &[("shared", "Shared", 1_000)]);

    manager.switch_profile(&profile.id).expect("switch profile");

    let (_, _, has_user_event) = read_recovery_thread_state(target_dir.path(), "shared");
    assert!(!has_user_event);
}

#[test]
fn switch_profile_repairs_active_session_provider_when_model_provider_changes() {
    let (_app_dir, target_dir, mut manager) = temp_manager();

    let profile = manager
        .import_profile(ProfileInput {
            name: "Third Party".into(),
            notes: String::new(),
            auth_json: api_key_auth_json("sk-third"),
            config_toml: third_party_config_toml("gpt-5"),
        })
        .expect("import profile");

    let rollout_path = target_dir
        .path()
        .join("sessions")
        .join("2026")
        .join("shared.jsonl");
    write_provider_repair_rollout(&rollout_path, "shared", "openai");
    set_file_mtime(&rollout_path, file_time_from_millis(1_000)).expect("set rollout mtime");
    seed_recovery_database(
        target_dir.path(),
        &[RecoveryThreadSeed {
            id: "shared".into(),
            cwd: "/tmp/shared".into(),
            title: "Shared".into(),
            rollout_path: rollout_path.clone(),
            updated_at_ms: 1_000,
            has_user_event: true,
            archived: false,
            model_provider: "openai".into(),
        }],
    );

    manager.switch_profile(&profile.id).expect("switch profile");

    assert_eq!(
        read_recovery_thread_provider(target_dir.path(), "shared"),
        "OpenAI"
    );
    let rollout = fs::read_to_string(&rollout_path).expect("read rollout");
    assert!(rollout.contains(r#""model_provider":"OpenAI""#));
    assert_eq!(file_mtime_millis(&rollout_path), 1_000);
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
    conn.execute_batch(
        "CREATE TABLE threads (
            id TEXT PRIMARY KEY,
            rollout_path TEXT,
            updated_at_ms INTEGER NOT NULL,
            model_provider TEXT,
            archived INTEGER NOT NULL DEFAULT 0,
            has_user_event INTEGER NOT NULL DEFAULT 0
        );",
    )
    .expect("create table");
    let sessions_dir = codex_dir.join("sessions");
    let archived_dir = codex_dir.join("archived_sessions");
    fs::create_dir_all(&sessions_dir).expect("create sessions dir");
    fs::create_dir_all(&archived_dir).expect("create archived sessions dir");
    let rollout_path = sessions_dir.join("one.jsonl");
    write_provider_repair_rollout(&rollout_path, "active-thread", "openai");
    set_file_mtime(&rollout_path, file_time_from_millis(1_000)).expect("set rollout mtime");
    conn.execute(
        "INSERT INTO threads (id, rollout_path, updated_at_ms, model_provider, archived, has_user_event)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (
            "active-thread",
            rollout_path.to_string_lossy().to_string(),
            1_000_i64,
            "openai",
            0_i64,
            1_i64,
        ),
    )
    .expect("seed active row");
    drop(conn);

    with_test_codex_env(home_dir.path(), || {
        let manager =
            ProfileManager::load_or_default(app_dir.path().to_path_buf()).expect("load manager");
        manager
            .fix_session_database_and_configs()
            .expect("fix sessions");
    });

    let conn = Connection::open(&db_path).expect("reopen sqlite");
    let provider: String = conn
        .query_row("SELECT model_provider FROM threads LIMIT 1", [], |row| {
            row.get(0)
        })
        .expect("query provider");
    assert_eq!(provider, "openai_custom");

    let sessions_content =
        fs::read_to_string(sessions_dir.join("one.jsonl")).expect("read sessions");
    assert!(sessions_content.contains("\"model_provider\":\"openai_custom\""));
    assert_eq!(file_mtime_millis(&rollout_path), 1_000);
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
fn fix_session_database_does_not_rebuild_session_index_from_threads_table() {
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

    with_test_codex_env(home_dir.path(), || {
        let manager =
            ProfileManager::load_or_default(app_dir.path().to_path_buf()).expect("load manager");
        manager
            .fix_session_database_and_configs()
            .expect("repair sessions");
    });

    let session_index =
        fs::read_to_string(codex_dir.join("session_index.jsonl")).expect("read session index");
    let entries = session_index
        .lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).expect("parse index entry"))
        .collect::<Vec<_>>();

    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0]["id"], "old-thread");
    assert_eq!(entries[0]["thread_name"], "Stale Title");
    assert_eq!(entries[1]["id"], "ghost-thread");
    assert_eq!(entries[1]["thread_name"], "Ghost Title");
    assert!(entries.iter().all(|entry| entry["id"] != "fresh-thread"));
    assert!(entries.iter().all(|entry| entry["id"] != "archived-thread"));
}

#[test]
fn fix_session_database_repairs_missing_workspace_project_order_entries() {
    let home_dir = TempDir::new().expect("temp home");
    let app_dir = TempDir::new().expect("temp app");
    let codex_dir = home_dir.path().join(".codex");
    fs::create_dir_all(&codex_dir).expect("create codex dir");

    fs::write(
        codex_dir.join("config.toml"),
        r#"model_provider = "openai_custom""#,
    )
    .expect("seed config");
    fs::write(
        codex_dir.join(".codex-global-state.json"),
        serde_json::to_string_pretty(&json!({
            "electron-saved-workspace-roots": [
                "/tmp/alpha",
                "/tmp/beta",
                "/tmp/gamma"
            ],
            "project-order": [
                "/tmp/alpha"
            ],
            "electron-workspace-root-labels": {
                "/tmp/gamma": "gamma-label"
            }
        }))
        .expect("serialize global state"),
    )
    .expect("seed global state");

    with_test_codex_env(home_dir.path(), || {
        let manager =
            ProfileManager::load_or_default(app_dir.path().to_path_buf()).expect("load manager");
        manager
            .fix_session_database_and_configs()
            .expect("repair workspace order");
    });

    let global_state: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(codex_dir.join(".codex-global-state.json")).expect("read global state"),
    )
    .expect("parse global state");

    assert_eq!(
        global_state.get("project-order"),
        Some(&json!(["/tmp/alpha", "/tmp/beta", "/tmp/gamma"]))
    );
    assert_eq!(
        global_state
            .get("electron-workspace-root-labels")
            .and_then(|value| value.get("/tmp/gamma"))
            .and_then(|value| value.as_str()),
        Some("gamma-label")
    );
}

#[test]
fn fix_session_database_clears_active_workspace_roots_after_workspace_order_repair() {
    let home_dir = TempDir::new().expect("temp home");
    let app_dir = TempDir::new().expect("temp app");
    let codex_dir = home_dir.path().join(".codex");
    fs::create_dir_all(&codex_dir).expect("create codex dir");

    fs::write(
        codex_dir.join("config.toml"),
        r#"model_provider = "openai_custom""#,
    )
    .expect("seed config");
    fs::write(
        codex_dir.join(".codex-global-state.json"),
        serde_json::to_string_pretty(&json!({
            "active-workspace-roots": [
                "/tmp/sharing-session"
            ],
            "electron-saved-workspace-roots": [
                "/tmp/sharing-session",
                "/tmp/alpha",
                "/tmp/beta"
            ],
            "project-order": [
                "/tmp/sharing-session"
            ]
        }))
        .expect("serialize global state"),
    )
    .expect("seed global state");

    with_test_codex_env(home_dir.path(), || {
        let manager =
            ProfileManager::load_or_default(app_dir.path().to_path_buf()).expect("load manager");
        manager
            .fix_session_database_and_configs()
            .expect("repair workspace state");
    });

    let global_state: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(codex_dir.join(".codex-global-state.json")).expect("read global state"),
    )
    .expect("parse global state");

    assert_eq!(
        global_state.get("project-order"),
        Some(&json!(["/tmp/sharing-session", "/tmp/alpha", "/tmp/beta"]))
    );
    assert_eq!(global_state.get("active-workspace-roots"), Some(&json!([])));
}

#[test]
fn fix_session_database_preserves_active_workspace_roots_when_workspace_state_is_consistent() {
    let home_dir = TempDir::new().expect("temp home");
    let app_dir = TempDir::new().expect("temp app");
    let codex_dir = home_dir.path().join(".codex");
    fs::create_dir_all(&codex_dir).expect("create codex dir");

    fs::write(
        codex_dir.join("config.toml"),
        r#"model_provider = "openai_custom""#,
    )
    .expect("seed config");
    fs::write(
        codex_dir.join(".codex-global-state.json"),
        serde_json::to_string_pretty(&json!({
            "active-workspace-roots": [
                "/tmp/alpha"
            ],
            "electron-saved-workspace-roots": [
                "/tmp/alpha",
                "/tmp/beta"
            ],
            "project-order": [
                "/tmp/alpha",
                "/tmp/beta"
            ]
        }))
        .expect("serialize global state"),
    )
    .expect("seed global state");

    with_test_codex_env(home_dir.path(), || {
        let manager =
            ProfileManager::load_or_default(app_dir.path().to_path_buf()).expect("load manager");
        manager
            .fix_session_database_and_configs()
            .expect("repair workspace state");
    });

    let global_state: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(codex_dir.join(".codex-global-state.json")).expect("read global state"),
    )
    .expect("parse global state");

    assert_eq!(
        global_state.get("active-workspace-roots"),
        Some(&json!(["/tmp/alpha"]))
    );
}

#[test]
fn fix_session_database_preserves_existing_session_title_when_thread_title_is_blank() {
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
        ("blank-title-thread", "", 100_i64, "openai", 0_i64),
    )
    .expect("seed blank title thread");
    drop(conn);

    fs::write(
        codex_dir.join("session_index.jsonl"),
        concat!(
            r#"{"id":"blank-title-thread","thread_name":"Recovered Title","updated_at":"1970-01-01T00:00:01Z"}"#,
            "\n"
        ),
    )
    .expect("seed existing session index");

    with_test_codex_env(home_dir.path(), || {
        let manager =
            ProfileManager::load_or_default(app_dir.path().to_path_buf()).expect("load manager");
        manager
            .fix_session_database_and_configs()
            .expect("repair sessions and index");
    });

    let session_index = fs::read_to_string(codex_dir.join("session_index.jsonl"))
        .expect("read rebuilt session index");
    let entries = session_index
        .lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).expect("parse index entry"))
        .collect::<Vec<_>>();

    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["id"], "blank-title-thread");
    assert_eq!(entries[0]["thread_name"], "Recovered Title");
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
