use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use codex_auth_switch_lib::antigravity::db::{
    build_account_snapshot, read_live_payload, replace_live_payload,
};
use codex_auth_switch_lib::antigravity::models::AntigravityPayload;
use codex_auth_switch_lib::antigravity::storage::read_storage_json_flags;
use rusqlite::Connection;
use std::collections::BTreeMap;
use std::fs;
use tempfile::tempdir;

fn seed_key(conn: &Connection, key: &str, value: &str) {
    conn.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?1, ?2)",
        (key, value),
    )
    .unwrap();
}

fn make_user_status_blob(email: &str) -> String {
    let nested = STANDARD.encode(format!("display-name {email}"));
    STANDARD.encode(format!("userStatusSentinelKey {nested}"))
}

#[test]
fn read_live_payload_extracts_required_and_optional_keys() {
    let temp = tempdir().unwrap();
    let db_path = temp.path().join("state.vscdb");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute(
        "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
        [],
    )
    .unwrap();

    seed_key(
        &conn,
        "antigravityAuthStatus",
        r#"{"email":"alice@example.com","name":"Alice"}"#,
    );
    seed_key(
        &conn,
        "antigravityUnifiedStateSync.oauthToken",
        "oauth-token-row",
    );
    seed_key(
        &conn,
        "antigravityUnifiedStateSync.userStatus",
        "user-status-row",
    );
    seed_key(
        &conn,
        "antigravity.profileUrl",
        "https://example.test/avatar.png",
    );

    let payload = read_live_payload(&db_path).unwrap();

    assert_eq!(payload.email.as_deref(), Some("alice@example.com"));
    assert_eq!(payload.display_name.as_deref(), Some("Alice"));
    assert_eq!(
        payload
            .values
            .get("antigravityUnifiedStateSync.oauthToken")
            .map(String::as_str),
        Some("oauth-token-row")
    );
    assert_eq!(
        payload
            .values
            .get("antigravity.profileUrl")
            .map(String::as_str),
        Some("https://example.test/avatar.png")
    );
}

#[test]
fn read_live_payload_extracts_email_from_unified_state_when_legacy_key_is_missing() {
    let temp = tempdir().unwrap();
    let db_path = temp.path().join("state.vscdb");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute(
        "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
        [],
    )
    .unwrap();

    seed_key(
        &conn,
        "antigravityUnifiedStateSync.oauthToken",
        "oauth-token-row",
    );
    seed_key(
        &conn,
        "antigravityUnifiedStateSync.userStatus",
        &make_user_status_blob("alice@example.com"),
    );

    let payload = read_live_payload(&db_path).unwrap();

    assert_eq!(payload.email.as_deref(), Some("alice@example.com"));
    assert_eq!(payload.display_name, None);
}

#[test]
fn read_live_payload_falls_back_to_profile_url_identifier_when_email_is_unavailable() {
    let temp = tempdir().unwrap();
    let db_path = temp.path().join("state.vscdb");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute(
        "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
        [],
    )
    .unwrap();

    seed_key(
        &conn,
        "antigravityUnifiedStateSync.oauthToken",
        "oauth-token-row",
    );
    seed_key(
        &conn,
        "antigravityUnifiedStateSync.userStatus",
        "ChkKFXVzZXJTdGF0dXNTZW50aW5lbEtleRIA",
    );
    seed_key(
        &conn,
        "antigravity.profileUrl",
        "https://lh3.googleusercontent.com/a/ACg8ocLWvuRak3f-CtS7jIc0yYN5wrUpCI6ecqke_Uh_R7xJixCAMA=s96-c",
    );

    let payload = read_live_payload(&db_path).unwrap();

    assert_eq!(payload.email.as_deref(), Some("profile:ACg8ocLWvuRa"));
    assert_eq!(payload.display_name, None);
}

#[test]
fn read_live_payload_rejects_empty_oauth_token_even_with_profile_url_fallback() {
    let temp = tempdir().unwrap();
    let db_path = temp.path().join("state.vscdb");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute(
        "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
        [],
    )
    .unwrap();

    seed_key(&conn, "antigravityUnifiedStateSync.oauthToken", "");
    seed_key(
        &conn,
        "antigravityUnifiedStateSync.userStatus",
        "ChkKFXVzZXJTdGF0dXNTZW50aW5lbEtleRIA",
    );
    seed_key(
        &conn,
        "antigravity.profileUrl",
        "https://lh3.googleusercontent.com/a/ACg8ocLWvuRak3f-CtS7jIc0yYN5wrUpCI6ecqke_Uh_R7xJixCAMA=s96-c",
    );

    let error = read_live_payload(&db_path).unwrap_err().to_string();
    assert!(error.contains("Antigravity OAuth token is missing"));
}

#[test]
fn read_live_payload_rejects_missing_required_keys() {
    let temp = tempdir().unwrap();
    let db_path = temp.path().join("state.vscdb");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute(
        "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
        [],
    )
    .unwrap();

    seed_key(
        &conn,
        "antigravityAuthStatus",
        r#"{"email":"alice@example.com","name":"Alice"}"#,
    );

    let error = read_live_payload(&db_path).unwrap_err().to_string();
    assert!(error.contains("Missing required Antigravity keys"));
}

#[test]
fn read_live_payload_rejects_empty_email() {
    let temp = tempdir().unwrap();
    let db_path = temp.path().join("state.vscdb");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute(
        "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
        [],
    )
    .unwrap();

    seed_key(
        &conn,
        "antigravityAuthStatus",
        r#"{"email":"","name":"Alice"}"#,
    );
    seed_key(
        &conn,
        "antigravityUnifiedStateSync.oauthToken",
        "oauth-token-row",
    );
    seed_key(
        &conn,
        "antigravityUnifiedStateSync.userStatus",
        "user-status-row",
    );

    let error = read_live_payload(&db_path).unwrap_err().to_string();
    assert!(error.contains("Antigravity account email is empty"));
}

#[test]
fn read_live_payload_rejects_missing_database_without_creating_it() {
    let temp = tempdir().unwrap();
    let db_path = temp.path().join("missing-state.vscdb");

    let error = read_live_payload(&db_path).unwrap_err().to_string();

    assert!(error.contains("Antigravity state database was not found"));
    assert!(!db_path.exists());
}

#[test]
fn replace_live_payload_rejects_missing_database_without_creating_it() {
    let temp = tempdir().unwrap();
    let db_path = temp.path().join("missing-state.vscdb");
    let mut values = BTreeMap::new();
    values.insert(
        "antigravityAuthStatus".into(),
        r#"{"email":"alice@example.com","name":"Alice"}"#.into(),
    );
    values.insert(
        "antigravityUnifiedStateSync.oauthToken".into(),
        "oauth-token-row".into(),
    );
    values.insert(
        "antigravityUnifiedStateSync.userStatus".into(),
        "user-status-row".into(),
    );
    let payload = AntigravityPayload {
        values,
        email: Some("alice@example.com".into()),
        display_name: Some("Alice".into()),
    };

    let error = replace_live_payload(&db_path, &payload)
        .unwrap_err()
        .to_string();

    assert!(error.contains("Antigravity state database was not found"));
    assert!(!db_path.exists());
}

#[test]
fn read_storage_json_flags_extracts_only_account_markers() {
    let temp = tempdir().unwrap();
    let storage_json_path = temp.path().join("storage.json");
    fs::write(
        &storage_json_path,
        r#"{
  "antigravityUnifiedStateSync.oauthToken.hasLegacyMigrated": true,
  "unifiedStateSync.hasUserStatusMigrated": true,
  "windowControlHeight": 35
}"#,
    )
    .unwrap();

    let flags = read_storage_json_flags(&storage_json_path).unwrap();

    assert_eq!(flags.oauth_legacy_migrated, Some(true));
    assert_eq!(flags.user_status_migrated, Some(true));
}

#[test]
fn build_account_snapshot_preserves_identity_and_storage_flags() {
    let payload = AntigravityPayload {
        values: BTreeMap::from([
            (
                "antigravity.profileUrl".into(),
                "https://example.test/avatar.png".into(),
            ),
            (
                "antigravityUnifiedStateSync.oauthToken".into(),
                "oauth-token-row".into(),
            ),
            (
                "antigravityUnifiedStateSync.userStatus".into(),
                "user-status-row".into(),
            ),
        ]),
        email: Some("alice@example.com".into()),
        display_name: Some("Alice".into()),
    };

    let snapshot = build_account_snapshot(
        &payload,
        read_storage_json_flags(tempdir().unwrap().path().join("missing.json").as_path()).unwrap(),
    );

    assert_eq!(snapshot.format_version, 1);
    assert_eq!(
        snapshot.identity.email.as_deref(),
        Some("alice@example.com")
    );
    assert_eq!(
        snapshot.identity.profile_url.as_deref(),
        Some("https://example.test/avatar.png")
    );
    assert_eq!(snapshot.identity.source, "db");
    assert_eq!(
        snapshot
            .values
            .get("antigravityUnifiedStateSync.oauthToken")
            .map(String::as_str),
        Some("oauth-token-row")
    );
}
