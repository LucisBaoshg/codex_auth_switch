# Antigravity Auth Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new Antigravity platform flow that can import the currently logged-in `Antigravity.app` account, save it as a reusable profile, and switch between saved Antigravity login states without modifying existing Codex switching logic.

**Architecture:** Keep the current Codex `ProfileManager` untouched and add a sibling `antigravity` backend module plus a thin frontend platform shell. Antigravity stores raw managed key payloads from `state.vscdb`, performs transactional key replacement with backups, and restarts `Antigravity.app` after a verified switch.

**Tech Stack:** Tauri 2, Rust, rusqlite, TypeScript, Vite, Vitest

---

## File Map

### Backend

- Create: `src-tauri/src/antigravity/mod.rs`
- Create: `src-tauri/src/antigravity/models.rs`
- Create: `src-tauri/src/antigravity/paths.rs`
- Create: `src-tauri/src/antigravity/db.rs`
- Create: `src-tauri/src/antigravity/process.rs`
- Create: `src-tauri/src/antigravity/manager.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/antigravity_db_tests.rs`
- Test: `src-tauri/tests/antigravity_manager_tests.rs`

### Frontend

- Create: `src/antigravity.ts`
- Modify: `src/main.ts`
- Test: `tests/antigravity-platform.test.ts`

### Docs

- Modify: `README.md`

## Task 1: Build Antigravity Payload Extraction

**Files:**
- Create: `src-tauri/src/antigravity/mod.rs`
- Create: `src-tauri/src/antigravity/models.rs`
- Create: `src-tauri/src/antigravity/paths.rs`
- Create: `src-tauri/src/antigravity/db.rs`
- Test: `src-tauri/tests/antigravity_db_tests.rs`

- [ ] **Step 1: Write the failing database extraction test**

```rust
use codex_auth_switch_lib::antigravity::db::read_live_payload;
use rusqlite::Connection;
use tempfile::tempdir;

fn seed_key(conn: &Connection, key: &str, value: &str) {
    conn.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?1, ?2)",
        (key, value),
    )
    .unwrap();
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
    seed_key(&conn, "antigravityUnifiedStateSync.oauthToken", "oauth-token-row");
    seed_key(&conn, "antigravityUnifiedStateSync.userStatus", "user-status-row");
    seed_key(&conn, "antigravity.profileUrl", "https://example.test/avatar.png");

    let payload = read_live_payload(&db_path).unwrap();

    assert_eq!(payload.email.as_deref(), Some("alice@example.com"));
    assert_eq!(payload.display_name.as_deref(), Some("Alice"));
    assert_eq!(
        payload.values.get("antigravityUnifiedStateSync.oauthToken").map(String::as_str),
        Some("oauth-token-row")
    );
    assert_eq!(
        payload.values.get("antigravity.profileUrl").map(String::as_str),
        Some("https://example.test/avatar.png")
    );
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

    seed_key(&conn, "antigravityAuthStatus", r#"{"email":"","name":"Alice"}"#);
    seed_key(&conn, "antigravityUnifiedStateSync.oauthToken", "oauth-token-row");
    seed_key(&conn, "antigravityUnifiedStateSync.userStatus", "user-status-row");

    let error = read_live_payload(&db_path).unwrap_err().to_string();
    assert!(error.contains("Antigravity account email is empty"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path /Volumes/Acer/Dev/codex_auth_switch/src-tauri/Cargo.toml --test antigravity_db_tests -v`

Expected: FAIL with unresolved imports for `codex_auth_switch_lib::antigravity::*`

- [ ] **Step 3: Write minimal Antigravity models and SQLite reader**

```rust
// src-tauri/src/antigravity/mod.rs
pub mod db;
pub mod models;
pub mod paths;

use thiserror::Error;

pub const REQUIRED_KEYS: &[&str] = &[
    "antigravityAuthStatus",
    "antigravityUnifiedStateSync.oauthToken",
    "antigravityUnifiedStateSync.userStatus",
];

pub const OPTIONAL_KEYS: &[&str] = &[
    "antigravityUnifiedStateSync.enterprisePreferences",
    "antigravityUnifiedStateSync.modelCredits",
    "antigravity.profileUrl",
];

#[derive(Debug, Error)]
pub enum AntigravityError {
    #[error("Failed to access the filesystem: {0}")]
    Io(#[from] std::io::Error),
    #[error("Failed to access SQLite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Failed to process Antigravity JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Message(String),
}
```

```rust
// src-tauri/src/antigravity/models.rs
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityPayload {
    pub values: BTreeMap<String, String>,
    pub email: Option<String>,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityProfileMeta {
    pub id: String,
    pub name: String,
    pub notes: String,
    pub email: String,
    pub display_name: Option<String>,
    pub source_db_path: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

```rust
// src-tauri/src/antigravity/paths.rs
use crate::antigravity::AntigravityError;
use std::path::PathBuf;

pub fn default_state_db_path() -> Result<PathBuf, AntigravityError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AntigravityError::Message("Failed to resolve home directory.".into()))?;
    Ok(home.join(
        "Library/Application Support/Antigravity/User/globalStorage/state.vscdb",
    ))
}
```

```rust
// src-tauri/src/antigravity/db.rs
use crate::antigravity::{models::AntigravityPayload, AntigravityError, OPTIONAL_KEYS, REQUIRED_KEYS};
use rusqlite::Connection;
use std::collections::BTreeMap;
use std::path::Path;

pub fn read_live_payload(db_path: &Path) -> Result<AntigravityPayload, AntigravityError> {
    let conn = Connection::open(db_path)?;
    let mut values = BTreeMap::new();

    for key in REQUIRED_KEYS.iter().chain(OPTIONAL_KEYS.iter()) {
        let value: Option<String> = conn
            .query_row(
                "SELECT CAST(value AS TEXT) FROM ItemTable WHERE key = ?1",
                [*key],
                |row| row.get(0),
            )
            .ok();
        if let Some(value) = value {
            values.insert((*key).to_string(), value);
        }
    }

    let missing = REQUIRED_KEYS
        .iter()
        .filter(|key| !values.contains_key(**key))
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(AntigravityError::Message(format!(
            "Missing required Antigravity keys: {}",
            missing.join(", ")
        )));
    }

    let auth_status = values
        .get("antigravityAuthStatus")
        .ok_or_else(|| AntigravityError::Message("antigravityAuthStatus is missing.".into()))?;
    let auth_json = serde_json::from_str::<serde_json::Value>(auth_status)?;
    let email = auth_json.get("email").and_then(|value| value.as_str()).map(str::to_owned);
    let display_name = auth_json.get("name").and_then(|value| value.as_str()).map(str::to_owned);
    if email.as_deref().map(str::trim).unwrap_or("").is_empty() {
        return Err(AntigravityError::Message(
            "Antigravity account email is empty.".into(),
        ));
    }

    Ok(AntigravityPayload {
        values,
        email,
        display_name,
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path /Volumes/Acer/Dev/codex_auth_switch/src-tauri/Cargo.toml --test antigravity_db_tests -v`

Expected: PASS with 3 tests passed

- [ ] **Step 5: Commit**

```bash
git -C /Volumes/Acer/Dev/codex_auth_switch add \
  src-tauri/src/antigravity/mod.rs \
  src-tauri/src/antigravity/models.rs \
  src-tauri/src/antigravity/paths.rs \
  src-tauri/src/antigravity/db.rs \
  src-tauri/tests/antigravity_db_tests.rs
git -C /Volumes/Acer/Dev/codex_auth_switch commit -m "feat: add antigravity payload extraction"
```

## Task 2: Implement Antigravity Profile Import, Switch, and Restore

**Files:**
- Create: `src-tauri/src/antigravity/process.rs`
- Create: `src-tauri/src/antigravity/manager.rs`
- Modify: `src-tauri/src/antigravity/mod.rs`
- Modify: `src-tauri/src/antigravity/models.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/antigravity_manager_tests.rs`

- [ ] **Step 1: Write the failing manager tests**

```rust
use codex_auth_switch_lib::antigravity::manager::{AntigravityManager, NoopProcessController};
use codex_auth_switch_lib::antigravity::models::AntigravityPayload;
use rusqlite::Connection;
use std::collections::BTreeMap;
use tempfile::tempdir;

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

#[test]
fn import_current_profile_persists_meta_and_payload() {
    let temp = tempdir().unwrap();
    let db_path = temp.path().join("state.vscdb");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute(
        "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?1, ?2)",
        (
            "antigravityAuthStatus",
            r#"{"email":"alice@example.com","name":"Alice"}"#,
        ),
    )
    .unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?1, ?2)",
        ("antigravityUnifiedStateSync.oauthToken", "oauth-a"),
    )
    .unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?1, ?2)",
        ("antigravityUnifiedStateSync.userStatus", "user-a"),
    )
    .unwrap();

    let app_data = temp.path().join("app-data");
    let manager = AntigravityManager::new(
        app_data,
        db_path.clone(),
        Box::new(NoopProcessController::default()),
    )
    .unwrap();

    let summary = manager.import_current_profile("Alice".into(), "Imported".into()).unwrap();

    assert_eq!(summary.email, "alice@example.com");
    assert!(db_path.exists());
}

#[test]
fn switch_profile_creates_backup_and_updates_live_db() {
    let temp = tempdir().unwrap();
    let db_path = temp.path().join("state.vscdb");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute(
        "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
        [],
    )
    .unwrap();

    let app_data = temp.path().join("app-data");
    let mut manager = AntigravityManager::new(
        app_data.clone(),
        db_path.clone(),
        Box::new(NoopProcessController::default()),
    )
    .unwrap();

    let imported = manager
        .save_imported_profile("Alice".into(), "Imported".into(), payload("alice@example.com", "alice"))
        .unwrap();
    manager
        .write_live_payload_for_tests(payload("bob@example.com", "bob"))
        .unwrap();

    let result = manager.switch_profile(&imported.id).unwrap();
    let live = manager.read_live_payload_for_tests().unwrap();

    assert_eq!(result.profile_id, imported.id);
    assert_eq!(live.email.as_deref(), Some("alice@example.com"));
    assert!(app_data.join("antigravity").join("backups").exists());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path /Volumes/Acer/Dev/codex_auth_switch/src-tauri/Cargo.toml --test antigravity_manager_tests -v`

Expected: FAIL with unresolved imports for `AntigravityManager` and `NoopProcessController`

- [ ] **Step 3: Write the minimal manager, process controller, snapshot state, and Tauri commands**

```rust
// src-tauri/src/antigravity/models.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityProfileSummary {
    pub id: String,
    pub name: String,
    pub notes: String,
    pub email: String,
    pub display_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravitySwitchResult {
    pub profile_id: String,
    pub backup_id: String,
    pub switched_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityBackupMeta {
    pub id: String,
    pub source_profile_id: Option<String>,
    pub db_path: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravitySnapshot {
    pub source_db_path: String,
    pub source_exists: bool,
    pub active_profile_id: Option<String>,
    pub last_selected_profile_id: Option<String>,
    pub last_switch_profile_id: Option<String>,
    pub last_switched_at: Option<DateTime<Utc>>,
    pub profiles: Vec<AntigravityProfileSummary>,
}
```

```rust
// src-tauri/src/antigravity/process.rs
use crate::antigravity::AntigravityError;

pub trait AntigravityProcessController: Send + Sync {
    fn stop(&self) -> Result<(), AntigravityError>;
    fn restart(&self) -> Result<(), AntigravityError>;
}

#[derive(Default)]
pub struct NoopProcessController;

impl AntigravityProcessController for NoopProcessController {
    fn stop(&self) -> Result<(), AntigravityError> {
        Ok(())
    }

    fn restart(&self) -> Result<(), AntigravityError> {
        Ok(())
    }
}

pub struct SystemAntigravityProcessController;

impl AntigravityProcessController for SystemAntigravityProcessController {
    fn stop(&self) -> Result<(), AntigravityError> {
        let _ = std::process::Command::new("osascript")
            .args(["-e", "tell application \"Antigravity\" to quit"])
            .status()?;
        Ok(())
    }

    fn restart(&self) -> Result<(), AntigravityError> {
        let _ = std::process::Command::new("open")
            .arg("/Applications/Antigravity.app")
            .status()?;
        Ok(())
    }
}
```

```rust
// src-tauri/src/antigravity/manager.rs
use crate::antigravity::db::{read_live_payload, replace_live_payload};
use crate::antigravity::models::{
    AntigravityPayload, AntigravityProfileMeta, AntigravityProfileSummary, AntigravitySnapshot,
    AntigravitySwitchResult,
};
use crate::antigravity::process::{AntigravityProcessController, NoopProcessController, SystemAntigravityProcessController};
use crate::antigravity::{paths::default_state_db_path, AntigravityError};
use chrono::Utc;
use uuid::Uuid;

pub struct AntigravityManager {
    app_data_dir: std::path::PathBuf,
    state_db_path: std::path::PathBuf,
    process: Box<dyn AntigravityProcessController>,
}

impl AntigravityManager {
    pub fn load_or_default(app_data_dir: std::path::PathBuf) -> Result<Self, AntigravityError> {
        Self::new(app_data_dir, default_state_db_path()?, Box::new(SystemAntigravityProcessController))
    }

    pub fn new(
        app_data_dir: std::path::PathBuf,
        state_db_path: std::path::PathBuf,
        process: Box<dyn AntigravityProcessController>,
    ) -> Result<Self, AntigravityError> {
        std::fs::create_dir_all(app_data_dir.join("antigravity").join("profiles"))?;
        std::fs::create_dir_all(app_data_dir.join("antigravity").join("backups"))?;
        Ok(Self { app_data_dir, state_db_path, process })
    }

    pub fn import_current_profile(
        &self,
        name: String,
        notes: String,
    ) -> Result<AntigravityProfileSummary, AntigravityError> {
        let payload = read_live_payload(&self.state_db_path)?;
        self.save_imported_profile(name, notes, payload)
    }

    pub fn save_imported_profile(
        &self,
        name: String,
        notes: String,
        payload: AntigravityPayload,
    ) -> Result<AntigravityProfileSummary, AntigravityError> {
        let now = Utc::now();
        let id = Uuid::new_v4().to_string();
        let profile_dir = self.app_data_dir.join("antigravity").join("profiles").join(&id);
        std::fs::create_dir_all(&profile_dir)?;
        let meta = AntigravityProfileMeta {
            id: id.clone(),
            name,
            notes,
            email: payload.email.clone().unwrap_or_default(),
            display_name: payload.display_name.clone(),
            source_db_path: self.state_db_path.to_string_lossy().to_string(),
            created_at: now,
            updated_at: now,
        };
        std::fs::write(profile_dir.join("meta.json"), serde_json::to_vec_pretty(&meta)?)?;
        std::fs::write(profile_dir.join("payload.json"), serde_json::to_vec_pretty(&payload)?)?;
        Ok(AntigravityProfileSummary {
            id: meta.id,
            name: meta.name,
            notes: meta.notes,
            email: meta.email,
            display_name: meta.display_name,
            created_at: meta.created_at,
            updated_at: meta.updated_at,
        })
    }

    pub fn switch_profile(&mut self, profile_id: &str) -> Result<AntigravitySwitchResult, AntigravityError> {
        self.process.stop()?;
        let current = read_live_payload(&self.state_db_path)?;
        let backup_id = format!("{}-{}", Utc::now().format("%Y%m%d-%H%M%S"), &Uuid::new_v4().simple().to_string()[..8]);
        let backup_dir = self.app_data_dir.join("antigravity").join("backups").join(&backup_id);
        std::fs::create_dir_all(&backup_dir)?;
        let backup_meta = AntigravityBackupMeta {
            id: backup_id.clone(),
            source_profile_id: None,
            db_path: self.state_db_path.to_string_lossy().to_string(),
            created_at: Utc::now(),
        };
        std::fs::write(backup_dir.join("meta.json"), serde_json::to_vec_pretty(&backup_meta)?)?;
        std::fs::write(backup_dir.join("payload.json"), serde_json::to_vec_pretty(&current)?)?;
        let target = self.read_profile_payload(profile_id)?;
        replace_live_payload(&self.state_db_path, &target)?;
        let verified = read_live_payload(&self.state_db_path)?;
        if verified.values != target.values {
            return Err(AntigravityError::Message("Antigravity post-write verification failed.".into()));
        }
        self.process.restart()?;
        Ok(AntigravitySwitchResult {
            profile_id: profile_id.to_string(),
            backup_id,
            switched_at: Utc::now(),
        })
    }

    pub fn snapshot(&self) -> Result<AntigravitySnapshot, AntigravityError> {
        let live = read_live_payload(&self.state_db_path).ok();
        let profiles = self.list_profiles()?;
        let active_profile_id = live.as_ref().and_then(|payload| {
            profiles
                .iter()
                .find(|profile| profile.email == payload.email.clone().unwrap_or_default())
                .map(|profile| profile.id.clone())
        });
        Ok(AntigravitySnapshot {
            source_db_path: self.state_db_path.to_string_lossy().to_string(),
            source_exists: self.state_db_path.exists(),
            active_profile_id,
            last_selected_profile_id: None,
            last_switch_profile_id: None,
            last_switched_at: None,
            profiles,
        })
    }

    fn list_profiles(&self) -> Result<Vec<AntigravityProfileSummary>, AntigravityError> {
        let profiles_dir = self.app_data_dir.join("antigravity").join("profiles");
        let mut profiles = std::fs::read_dir(profiles_dir)?
            .flatten()
            .filter(|entry| entry.path().is_dir())
            .map(|entry| {
                let meta: AntigravityProfileMeta =
                    serde_json::from_slice(&std::fs::read(entry.path().join("meta.json"))?)?;
                Ok(AntigravityProfileSummary {
                    id: meta.id,
                    name: meta.name,
                    notes: meta.notes,
                    email: meta.email,
                    display_name: meta.display_name,
                    created_at: meta.created_at,
                    updated_at: meta.updated_at,
                })
            })
            .collect::<Result<Vec<_>, AntigravityError>>()?;
        profiles.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        Ok(profiles)
    }

    pub fn read_profile_payload(&self, profile_id: &str) -> Result<AntigravityPayload, AntigravityError> {
        let path = self.app_data_dir.join("antigravity").join("profiles").join(profile_id).join("payload.json");
        Ok(serde_json::from_slice(&std::fs::read(path)?)?)
    }

    pub fn read_live_payload_for_tests(&self) -> Result<AntigravityPayload, AntigravityError> {
        read_live_payload(&self.state_db_path)
    }

    pub fn write_live_payload_for_tests(&self, payload: AntigravityPayload) -> Result<(), AntigravityError> {
        replace_live_payload(&self.state_db_path, &payload)
    }
}

pub use crate::antigravity::process::NoopProcessController;
```

```rust
// src-tauri/src/antigravity/db.rs
pub fn replace_live_payload(
    db_path: &Path,
    payload: &AntigravityPayload,
) -> Result<(), AntigravityError> {
    let conn = Connection::open(db_path)?;
    let tx = conn.unchecked_transaction()?;
    for key in REQUIRED_KEYS.iter().chain(OPTIONAL_KEYS.iter()) {
        if let Some(value) = payload.values.get(*key) {
            tx.execute(
                "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?1, ?2)",
                [*key, value.as_str()],
            )?;
        } else if OPTIONAL_KEYS.contains(key) {
            tx.execute("DELETE FROM ItemTable WHERE key = ?1", [*key])?;
        }
    }
    tx.commit()?;
    Ok(())
}
```

```rust
// src-tauri/src/lib.rs
pub mod antigravity;
pub mod core;

use crate::antigravity::manager::AntigravityManager;
use crate::antigravity::models::{AntigravitySnapshot, AntigravityProfileSummary, AntigravitySwitchResult};

fn antigravity_manager_from_app(app: &AppHandle) -> Result<AntigravityManager, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    AntigravityManager::load_or_default(app_data_dir).map_err(|error| error.to_string())
}

#[tauri::command]
fn load_antigravity_snapshot(app: AppHandle) -> Result<AntigravitySnapshot, String> {
    antigravity_manager_from_app(&app)?
        .snapshot()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn import_current_antigravity_profile(
    app: AppHandle,
    name: String,
    notes: String,
) -> Result<AntigravityProfileSummary, String> {
    antigravity_manager_from_app(&app)?
        .import_current_profile(name, notes)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn switch_antigravity_profile(app: AppHandle, profile_id: String) -> Result<AntigravitySwitchResult, String> {
    let mut manager = antigravity_manager_from_app(&app)?;
    manager.switch_profile(&profile_id).map_err(|error| error.to_string())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path /Volumes/Acer/Dev/codex_auth_switch/src-tauri/Cargo.toml --test antigravity_manager_tests -v`

Expected: PASS with 2 tests passed

- [ ] **Step 5: Commit**

```bash
git -C /Volumes/Acer/Dev/codex_auth_switch add \
  src-tauri/src/antigravity/mod.rs \
  src-tauri/src/antigravity/models.rs \
  src-tauri/src/antigravity/process.rs \
  src-tauri/src/antigravity/manager.rs \
  src-tauri/src/lib.rs \
  src-tauri/tests/antigravity_manager_tests.rs
git -C /Volumes/Acer/Dev/codex_auth_switch commit -m "feat: add antigravity switching backend"
```

## Task 3: Add Antigravity Platform Shell in the Frontend

**Files:**
- Create: `src/antigravity.ts`
- Modify: `src/main.ts`
- Test: `tests/antigravity-platform.test.ts`

- [ ] **Step 1: Write the failing frontend platform test**

```ts
import { beforeEach, expect, test, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn().mockResolvedValue("1.4.11") }));

beforeEach(() => {
  vi.resetModules();
  invokeMock.mockReset();
  document.body.innerHTML = '<div id="app"></div>';
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
});

test("switches to the Antigravity platform and imports the current account", async () => {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return {
        targetDir: "/Users/example/.codex",
        usingDefaultTargetDir: true,
        targetExists: true,
        targetAuthExists: true,
        targetConfigExists: true,
        targetUpdatedAt: "2026-04-10T00:00:00Z",
        targetAuthTypeLabel: "官方 OAuth",
        activeProfileId: null,
        lastSelectedProfileId: null,
        lastSwitchProfileId: null,
        lastSwitchedAt: null,
        codexUsageApiEnabled: true,
        profiles: [],
      };
    }
    if (command === "load_antigravity_snapshot") {
      return {
        sourceDbPath: "/Users/example/Library/Application Support/Antigravity/User/globalStorage/state.vscdb",
        sourceExists: true,
        activeProfileId: null,
        lastSelectedProfileId: null,
        lastSwitchProfileId: null,
        lastSwitchedAt: null,
        profiles: [],
      };
    }
    if (command === "import_current_antigravity_profile") {
      return {
        id: "ag-1",
        name: "Alice",
        notes: "Imported",
        email: "alice@example.com",
        displayName: "Alice",
        createdAt: "2026-04-10T00:00:00Z",
        updatedAt: "2026-04-10T00:00:00Z",
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  await import("../src/main");
  await Promise.resolve();
  await Promise.resolve();

  document
    .querySelector<HTMLButtonElement>('[data-action="switch-platform"][data-platform="antigravity"]')
    ?.click();
  await Promise.resolve();

  document
    .querySelector<HTMLButtonElement>('[data-action="import-current-antigravity"]')
    ?.click();
  await Promise.resolve();

  expect(invokeMock).toHaveBeenCalledWith("load_antigravity_snapshot", undefined);
  expect(invokeMock).toHaveBeenCalledWith("import_current_antigravity_profile", {
    name: "Current Antigravity Account",
    notes: "Imported from local state.vscdb",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix /Volumes/Acer/Dev/codex_auth_switch test -- tests/antigravity-platform.test.ts`

Expected: FAIL because the UI has no Antigravity platform buttons or commands yet

- [ ] **Step 3: Add a lightweight Antigravity service module and platform-aware UI**

```ts
// src/antigravity.ts
import { invoke } from "@tauri-apps/api/core";

export type AntigravityProfileSummary = {
  id: string;
  name: string;
  notes: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AntigravitySnapshot = {
  sourceDbPath: string;
  sourceExists: boolean;
  activeProfileId: string | null;
  lastSelectedProfileId: string | null;
  lastSwitchProfileId: string | null;
  lastSwitchedAt: string | null;
  profiles: AntigravityProfileSummary[];
};

export async function loadAntigravitySnapshot(): Promise<AntigravitySnapshot> {
  return invoke("load_antigravity_snapshot");
}

export async function importCurrentAntigravityProfile(): Promise<AntigravityProfileSummary> {
  return invoke("import_current_antigravity_profile", {
    name: "Current Antigravity Account",
    notes: "Imported from local state.vscdb",
  });
}

export async function switchAntigravityProfile(profileId: string) {
  return invoke("switch_antigravity_profile", { profileId });
}
```

```ts
// src/main.ts
import {
  loadAntigravitySnapshot,
  importCurrentAntigravityProfile,
  switchAntigravityProfile,
  type AntigravitySnapshot,
} from "./antigravity";

type PlatformMode = "codex" | "antigravity";

const state: {
  platform: PlatformMode;
  snapshot: AppSnapshot | null;
  antigravitySnapshot: AntigravitySnapshot | null;
  // keep existing fields...
} = {
  platform: "codex",
  snapshot: null,
  antigravitySnapshot: null,
  // keep existing initial values...
};

async function loadAntigravityState(): Promise<void> {
  state.antigravitySnapshot = await loadAntigravitySnapshot();
  render();
}

async function handleImportCurrentAntigravity(): Promise<void> {
  await importCurrentAntigravityProfile();
  await loadAntigravityState();
  setFlash("success", "已导入当前 Antigravity 账号。");
}

async function handleSwitchAntigravity(profileId: string, profileName: string): Promise<void> {
  await switchAntigravityProfile(profileId);
  await loadAntigravityState();
  setFlash("success", `已切换到 Antigravity 账号「${profileName}」，应用会自动重启。`);
}

function renderPlatformTabs(): string {
  return `
    <div class="platform-tabs">
      <button data-action="switch-platform" data-platform="codex">Codex</button>
      <button data-action="switch-platform" data-platform="antigravity">Antigravity</button>
    </div>
  `;
}

function renderAntigravityCards(): string {
  const snapshot = state.antigravitySnapshot;
  if (!snapshot) return `<section data-page="antigravity">加载中...</section>`;
  const cards = snapshot.profiles
    .map(
      (profile) => `
        <article data-role="antigravity-profile-card" data-id="${profile.id}">
          <h3>${profile.name}</h3>
          <p>${profile.email}</p>
          <button data-action="switch-antigravity" data-id="${profile.id}">切换</button>
        </article>
      `,
    )
    .join("");
  return `
    <section data-page="antigravity">
      <button data-action="import-current-antigravity">导入当前账号</button>
      <div class="card-grid">${cards}</div>
    </section>
  `;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix /Volumes/Acer/Dev/codex_auth_switch test -- tests/antigravity-platform.test.ts`

Expected: PASS with 1 test passed

- [ ] **Step 5: Commit**

```bash
git -C /Volumes/Acer/Dev/codex_auth_switch add \
  src/antigravity.ts \
  src/main.ts \
  tests/antigravity-platform.test.ts
git -C /Volumes/Acer/Dev/codex_auth_switch commit -m "feat: add antigravity platform UI"
```

## Task 4: Finish Restore, Reveal, and Release Notes

**Files:**
- Modify: `src-tauri/src/antigravity/manager.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/main.ts`
- Modify: `README.md`
- Test: `src-tauri/tests/antigravity_manager_tests.rs`
- Test: `tests/antigravity-platform.test.ts`

- [ ] **Step 1: Write the failing restore and reveal tests**

```rust
#[test]
fn restore_last_backup_replays_latest_payload() {
    let temp = tempdir().unwrap();
    let db_path = temp.path().join("state.vscdb");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute(
        "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
        [],
    )
    .unwrap();

    let app_data = temp.path().join("app-data");
    let mut manager = AntigravityManager::new(
        app_data,
        db_path,
        Box::new(NoopProcessController::default()),
    )
    .unwrap();

    let imported = manager
        .save_imported_profile("Alice".into(), "".into(), payload("alice@example.com", "alice"))
        .unwrap();
    manager.write_live_payload_for_tests(payload("bob@example.com", "bob")).unwrap();
    manager.switch_profile(&imported.id).unwrap();

    manager.restore_latest_backup().unwrap();
    let restored = manager.read_live_payload_for_tests().unwrap();
    assert_eq!(restored.email.as_deref(), Some("bob@example.com"));
}
```

```ts
test("restores the latest Antigravity backup from the platform page", async () => {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return { targetDir: "/Users/example/.codex", usingDefaultTargetDir: true, targetExists: true, targetAuthExists: true, targetConfigExists: true, targetUpdatedAt: null, targetAuthTypeLabel: "官方 OAuth", activeProfileId: null, lastSelectedProfileId: null, lastSwitchProfileId: null, lastSwitchedAt: null, codexUsageApiEnabled: true, profiles: [] };
    }
    if (command === "load_antigravity_snapshot") {
      return { sourceDbPath: "/Users/example/Library/Application Support/Antigravity/User/globalStorage/state.vscdb", sourceExists: true, activeProfileId: "ag-1", lastSelectedProfileId: "ag-1", lastSwitchProfileId: "ag-1", lastSwitchedAt: "2026-04-10T00:00:00Z", profiles: [{ id: "ag-1", name: "Alice", notes: "", email: "alice@example.com", displayName: "Alice", createdAt: "2026-04-10T00:00:00Z", updatedAt: "2026-04-10T00:00:00Z" }] };
    }
    if (command === "restore_last_antigravity_backup") {
      return { profileId: "ag-1", backupId: "backup-1", switchedAt: "2026-04-10T00:10:00Z" };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  await import("../src/main");
  await Promise.resolve();
  await Promise.resolve();
  document.querySelector<HTMLButtonElement>('[data-action="switch-platform"][data-platform="antigravity"]')?.click();
  await Promise.resolve();
  document.querySelector<HTMLButtonElement>('[data-action="restore-antigravity-backup"]')?.click();
  await Promise.resolve();

  expect(invokeMock).toHaveBeenCalledWith("restore_last_antigravity_backup", undefined);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path /Volumes/Acer/Dev/codex_auth_switch/src-tauri/Cargo.toml --test antigravity_manager_tests -v`

Expected: FAIL because `restore_latest_backup` does not exist

Run: `npm --prefix /Volumes/Acer/Dev/codex_auth_switch test -- tests/antigravity-platform.test.ts`

Expected: FAIL because the restore button and command do not exist

- [ ] **Step 3: Add restore, reveal, and README wiring**

```rust
// src-tauri/src/antigravity/manager.rs
impl AntigravityManager {
    pub fn restore_latest_backup(&mut self) -> Result<AntigravitySwitchResult, AntigravityError> {
        let backups_dir = self.app_data_dir.join("antigravity").join("backups");
        let latest = std::fs::read_dir(&backups_dir)?
            .flatten()
            .filter(|entry| entry.path().is_dir())
            .max_by_key(|entry| entry.file_name())
            .ok_or_else(|| AntigravityError::Message("No Antigravity backup is available.".into()))?;
        let payload: AntigravityPayload =
            serde_json::from_slice(&std::fs::read(latest.path().join("payload.json"))?)?;
        self.process.stop()?;
        replace_live_payload(&self.state_db_path, &payload)?;
        self.process.restart()?;
        Ok(AntigravitySwitchResult {
            profile_id: "backup-restore".into(),
            backup_id: latest.file_name().to_string_lossy().to_string(),
            switched_at: Utc::now(),
        })
    }

    pub fn reveal_source_dir(&self) -> Result<(), AntigravityError> {
        let parent = self
            .state_db_path
            .parent()
            .ok_or_else(|| AntigravityError::Message("Antigravity source directory is missing.".into()))?;
        let _ = std::process::Command::new("open").arg(parent).status()?;
        Ok(())
    }
}
```

```rust
// src-tauri/src/lib.rs
#[tauri::command]
fn restore_last_antigravity_backup(app: AppHandle) -> Result<AntigravitySwitchResult, String> {
    let mut manager = antigravity_manager_from_app(&app)?;
    manager.restore_latest_backup().map_err(|error| error.to_string())
}

#[tauri::command]
fn reveal_antigravity_source(app: AppHandle) -> Result<(), String> {
    antigravity_manager_from_app(&app)?
        .reveal_source_dir()
        .map_err(|error| error.to_string())
}
```

```ts
// src/main.ts
async function handleRestoreAntigravityBackup(): Promise<void> {
  await desktopInvoke("restore_last_antigravity_backup");
  await loadAntigravityState();
  setFlash("success", "已恢复最近一次 Antigravity 备份。");
}

function renderAntigravityCards(): string {
  const snapshot = state.antigravitySnapshot;
  if (!snapshot) return `<section data-page="antigravity">加载中...</section>`;
  return `
    <section data-page="antigravity">
      <div class="toolbar-row">
        <button data-action="import-current-antigravity">导入当前账号</button>
        <button data-action="restore-antigravity-backup">恢复最近备份</button>
        <button data-action="reveal-antigravity-source">打开 Antigravity 数据目录</button>
      </div>
      <div class="card-grid">
        ${snapshot.profiles.map((profile) => `
          <article data-role="antigravity-profile-card" data-id="${profile.id}">
            <h3>${profile.name}</h3>
            <p>${profile.email}</p>
            <button data-action="switch-antigravity" data-id="${profile.id}">切换</button>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}
```

```md
<!-- README.md -->
## Antigravity Support

The desktop app now includes an Antigravity platform view alongside Codex.

Current Antigravity support:

- import the account currently logged into `Antigravity.app`
- save multiple Antigravity login profiles locally
- switch profiles with automatic backup and app restart
- restore the latest Antigravity backup
```

- [ ] **Step 4: Run verification**

Run: `cargo test --manifest-path /Volumes/Acer/Dev/codex_auth_switch/src-tauri/Cargo.toml --test antigravity_db_tests --test antigravity_manager_tests -v`
Expected: PASS with all Antigravity backend tests green

Run: `npm --prefix /Volumes/Acer/Dev/codex_auth_switch test -- tests/sidebar-layout.test.ts tests/antigravity-platform.test.ts`
Expected: PASS with existing Codex UI tests still green and new Antigravity UI tests green

Run: `npm --prefix /Volumes/Acer/Dev/codex_auth_switch build`
Expected: PASS with a successful TypeScript and Vite build

- [ ] **Step 5: Commit**

```bash
git -C /Volumes/Acer/Dev/codex_auth_switch add \
  src-tauri/src/antigravity/manager.rs \
  src-tauri/src/lib.rs \
  src/main.ts \
  README.md \
  src-tauri/tests/antigravity_manager_tests.rs \
  tests/antigravity-platform.test.ts
git -C /Volumes/Acer/Dev/codex_auth_switch commit -m "feat: ship antigravity auth switching"
```
