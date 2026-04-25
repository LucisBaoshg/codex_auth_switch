use chrono::Utc;
use codex_auth_switch_lib::antigravity::manager::{AntigravityManager, NoopProcessController};
use codex_auth_switch_lib::antigravity::models::{AntigravityPayload, AntigravityProfileMeta};
use codex_auth_switch_lib::antigravity::process::AntigravityProcessController;
use codex_auth_switch_lib::antigravity::AntigravityError;
use rusqlite::Connection;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tempfile::tempdir;

fn seed_key(conn: &Connection, key: &str, value: &str) {
    conn.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?1, ?2)",
        (key, value),
    )
    .unwrap();
}

fn create_state_db() -> (tempfile::TempDir, std::path::PathBuf, Connection) {
    let temp = tempdir().unwrap();
    let db_path = temp.path().join("state.vscdb");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute(
        "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
        [],
    )
    .unwrap();
    (temp, db_path, conn)
}

fn payload(email: &str, suffix: &str) -> AntigravityPayload {
    let mut values = BTreeMap::new();
    values.insert(
        "antigravityAuthStatus".into(),
        format!(r#"{{"email":"{email}","name":"{suffix}"}}"#),
    );
    values.insert(
        "antigravityUnifiedStateSync.oauthToken".into(),
        format!("oauth-{suffix}"),
    );
    values.insert(
        "antigravityUnifiedStateSync.userStatus".into(),
        format!("user-{suffix}"),
    );

    AntigravityPayload {
        values,
        email: Some(email.to_string()),
        display_name: Some(suffix.to_string()),
    }
}

struct MutatingRestartProcessController {
    db_path: PathBuf,
    payload: AntigravityPayload,
    storage_json_path: Option<PathBuf>,
    storage_json_contents: Option<String>,
    mutate_once: Arc<AtomicBool>,
}

impl AntigravityProcessController for MutatingRestartProcessController {
    fn stop(&self) -> Result<(), AntigravityError> {
        Ok(())
    }

    fn restart(&self) -> Result<(), AntigravityError> {
        if self.mutate_once.swap(false, Ordering::SeqCst) {
            let conn = Connection::open(&self.db_path)?;
            for (key, value) in &self.payload.values {
                conn.execute(
                    "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?1, ?2)",
                    (key.as_str(), value.as_str()),
                )?;
            }
            if let (Some(path), Some(contents)) =
                (&self.storage_json_path, &self.storage_json_contents)
            {
                fs::write(path, contents)?;
            }
        }
        Ok(())
    }
}

#[test]
fn import_current_profile_persists_meta_payload_and_snapshot() {
    let (_temp, db_path, conn) = create_state_db();
    seed_key(
        &conn,
        "antigravityAuthStatus",
        r#"{"email":"alice@example.com","name":"Alice"}"#,
    );
    seed_key(&conn, "antigravityUnifiedStateSync.oauthToken", "oauth-a");
    seed_key(&conn, "antigravityUnifiedStateSync.userStatus", "user-a");

    let app_data = tempdir().unwrap();
    let manager = AntigravityManager::new(
        app_data.path().to_path_buf(),
        db_path.clone(),
        Box::new(NoopProcessController::default()),
    )
    .unwrap();

    let summary = manager
        .import_current_profile("Alice".into(), "Imported".into())
        .unwrap();

    let profile_dir = app_data
        .path()
        .join("antigravity")
        .join("profiles")
        .join(&summary.id);
    let meta: AntigravityProfileMeta =
        serde_json::from_str(&fs::read_to_string(profile_dir.join("meta.json")).unwrap()).unwrap();
    let payload: AntigravityPayload =
        serde_json::from_str(&fs::read_to_string(profile_dir.join("payload.json")).unwrap())
            .unwrap();
    let account_snapshot: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(profile_dir.join("account_snapshot.json")).unwrap(),
    )
    .unwrap();
    let snapshot = manager.snapshot().unwrap();

    assert!(profile_dir.join("account_snapshot.json").exists());
    assert_eq!(
        account_snapshot
            .get("formatVersion")
            .and_then(serde_json::Value::as_u64),
        Some(1)
    );
    assert_eq!(
        account_snapshot
            .get("identity")
            .and_then(serde_json::Value::as_object)
            .and_then(|identity| identity.get("email"))
            .and_then(serde_json::Value::as_str),
        Some("alice@example.com")
    );
    assert_eq!(
        account_snapshot
            .get("identity")
            .and_then(serde_json::Value::as_object)
            .and_then(|identity| identity.get("source"))
            .and_then(serde_json::Value::as_str),
        Some("db")
    );
    assert_eq!(summary.email, "alice@example.com");
    assert_eq!(meta.email, "alice@example.com");
    assert_eq!(
        payload
            .values
            .get("antigravityUnifiedStateSync.oauthToken")
            .map(String::as_str),
        Some("oauth-a")
    );
    assert_eq!(
        snapshot.active_profile_id.as_deref(),
        Some(summary.id.as_str())
    );
    assert_eq!(snapshot.profiles.len(), 1);
}

#[test]
fn switch_profile_creates_backup_updates_live_db_and_state() {
    let (_temp, db_path, _conn) = create_state_db();
    let app_data = tempdir().unwrap();
    let mut manager = AntigravityManager::new(
        app_data.path().to_path_buf(),
        db_path.clone(),
        Box::new(NoopProcessController::default()),
    )
    .unwrap();

    let imported = manager
        .save_imported_profile(
            "Alice".into(),
            "Imported".into(),
            payload("alice@example.com", "alice"),
        )
        .unwrap();
    manager
        .write_live_payload_for_tests(payload("bob@example.com", "bob"))
        .unwrap();

    let result = manager.switch_profile(&imported.id).unwrap();
    let live = manager.read_live_payload_for_tests().unwrap();
    let backup_dir = app_data
        .path()
        .join("antigravity")
        .join("backups")
        .join(&result.backup_id);
    let backed_up_payload: AntigravityPayload =
        serde_json::from_str(&fs::read_to_string(backup_dir.join("payload.json")).unwrap())
            .unwrap();
    let snapshot = manager.snapshot().unwrap();
    let recovery_points_dir = app_data.path().join("antigravity").join("recovery-points");
    let recovery_entries = fs::read_dir(&recovery_points_dir)
        .unwrap()
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    assert_eq!(result.profile_id, imported.id);
    assert!(recovery_points_dir.exists());
    assert_eq!(recovery_entries.len(), 1);
    assert!(recovery_entries[0].path().join("meta.json").exists());
    assert!(recovery_entries[0].path().join("state.vscdb").exists());
    assert_eq!(live.email.as_deref(), Some("alice@example.com"));
    assert_eq!(backed_up_payload.email.as_deref(), Some("bob@example.com"));
    assert!(backup_dir.join("meta.json").exists());
    assert_eq!(
        snapshot.active_profile_id.as_deref(),
        Some(imported.id.as_str())
    );
    assert_eq!(
        snapshot.last_selected_profile_id.as_deref(),
        Some(imported.id.as_str())
    );
    assert_eq!(
        snapshot.last_switch_profile_id.as_deref(),
        Some(imported.id.as_str())
    );
    assert!(snapshot.last_switched_at.is_some());
}

#[test]
fn restore_latest_backup_replays_the_last_saved_payload() {
    let (_temp, db_path, _conn) = create_state_db();
    let app_data = tempdir().unwrap();
    let mut manager = AntigravityManager::new(
        app_data.path().to_path_buf(),
        db_path.clone(),
        Box::new(NoopProcessController::default()),
    )
    .unwrap();

    let imported = manager
        .save_imported_profile(
            "Alice".into(),
            "Imported".into(),
            payload("alice@example.com", "alice"),
        )
        .unwrap();
    manager
        .write_live_payload_for_tests(payload("bob@example.com", "bob"))
        .unwrap();
    manager.switch_profile(&imported.id).unwrap();

    let result = manager.restore_latest_backup().unwrap();
    let restored = manager.read_live_payload_for_tests().unwrap();

    assert!(!result.backup_id.is_empty());
    assert_eq!(restored.email.as_deref(), Some("bob@example.com"));
}

#[test]
fn switch_profile_rejects_saved_profile_with_missing_oauth_token() {
    let (_temp, db_path, _conn) = create_state_db();
    let app_data = tempdir().unwrap();
    let mut manager = AntigravityManager::new(
        app_data.path().to_path_buf(),
        db_path.clone(),
        Box::new(NoopProcessController::default()),
    )
    .unwrap();

    manager
        .write_live_payload_for_tests(payload("alice@example.com", "alice"))
        .unwrap();

    let profile_dir = app_data
        .path()
        .join("antigravity")
        .join("profiles")
        .join("broken-profile");
    fs::create_dir_all(&profile_dir).unwrap();
    let meta = AntigravityProfileMeta {
        id: "broken-profile".into(),
        name: "Broken".into(),
        notes: "Imported before validation".into(),
        email: "profile:ACg8ocLWvuRa".into(),
        display_name: None,
        source_db_path: db_path.to_string_lossy().to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    fs::write(
        profile_dir.join("meta.json"),
        serde_json::to_string_pretty(&meta).unwrap(),
    )
    .unwrap();
    let invalid_payload = AntigravityPayload {
        values: BTreeMap::from([
            ("antigravityUnifiedStateSync.oauthToken".into(), "".into()),
            (
                "antigravityUnifiedStateSync.userStatus".into(),
                "ChkKFXVzZXJTdGF0dXNTZW50aW5lbEtleRIA".into(),
            ),
            (
                "antigravity.profileUrl".into(),
                "https://lh3.googleusercontent.com/a/ACg8ocLWvuRak3f-CtS7jIc0yYN5wrUpCI6ecqke_Uh_R7xJixCAMA=s96-c".into(),
            ),
        ]),
        email: Some("profile:ACg8ocLWvuRa".into()),
        display_name: None,
    };
    fs::write(
        profile_dir.join("payload.json"),
        serde_json::to_string_pretty(&invalid_payload).unwrap(),
    )
    .unwrap();

    let error = manager
        .switch_profile("broken-profile")
        .unwrap_err()
        .to_string();
    let live = manager.read_live_payload_for_tests().unwrap();

    assert!(error.contains("Antigravity OAuth token is missing"));
    assert_eq!(live.email.as_deref(), Some("alice@example.com"));
}

#[test]
fn switch_profile_rolls_back_when_post_switch_validation_fails() {
    let (_temp, db_path, _conn) = create_state_db();
    let app_data = tempdir().unwrap();
    let storage_json_path = db_path.parent().unwrap().join("storage.json");
    let original_storage_json = r#"{
  "antigravityUnifiedStateSync.oauthToken.hasLegacyMigrated": true,
  "unifiedStateSync.hasUserStatusMigrated": true
}"#;
    fs::write(&storage_json_path, original_storage_json).unwrap();

    let original_payload = payload("bob@example.com", "bob");
    let mut manager = AntigravityManager::new(
        app_data.path().to_path_buf(),
        db_path.clone(),
        Box::new(MutatingRestartProcessController {
            db_path: db_path.clone(),
            payload: original_payload.clone(),
            storage_json_path: Some(storage_json_path.clone()),
            storage_json_contents: Some(
                r#"{
  "antigravityUnifiedStateSync.oauthToken.hasLegacyMigrated": false,
  "unifiedStateSync.hasUserStatusMigrated": false
}"#
                .into(),
            ),
            mutate_once: Arc::new(AtomicBool::new(true)),
        }),
    )
    .unwrap();

    let imported = manager
        .save_imported_profile(
            "Alice".into(),
            "Imported".into(),
            payload("alice@example.com", "alice"),
        )
        .unwrap();
    manager
        .write_live_payload_for_tests(original_payload)
        .unwrap();

    let error = manager
        .switch_profile(&imported.id)
        .unwrap_err()
        .to_string();
    let live = manager.read_live_payload_for_tests().unwrap();
    let restored_storage_json = fs::read_to_string(&storage_json_path).unwrap();

    assert!(error.contains("Antigravity post-switch validation failed"));
    assert_eq!(live.email.as_deref(), Some("bob@example.com"));
    assert_eq!(restored_storage_json, original_storage_json);
}
