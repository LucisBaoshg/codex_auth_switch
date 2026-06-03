# Antigravity Account Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace legacy-DB-only Antigravity profile import/switch with an account snapshot flow that captures account-only state, creates rollback recovery points, and automatically restores the original state on failed switch validation.

**Architecture:** Add a normalized account snapshot layer on top of the existing Antigravity manager. Capture current identity via a new live-identity abstraction, persist account snapshots and recovery points in the app data directory, and convert switching into a stop/apply/restart/validate/rollback transaction that only touches whitelisted account-related sources.

**Tech Stack:** Rust, Tauri backend, rusqlite, serde/serde_json, tempfile-backed tests, existing Antigravity manager/process abstractions.

---

### Task 1: Extend Data Models For Account Snapshots And Recovery Points

**Files:**
- Modify: `src-tauri/src/antigravity/models.rs`
- Test: `src-tauri/tests/antigravity_manager_tests.rs`

- [ ] **Step 1: Write the failing model-oriented tests**

Add assertions in `src-tauri/tests/antigravity_manager_tests.rs` that expect imported profiles to persist a new snapshot file and that backup metadata can represent a recovery-point-style backup separate from legacy payload backup.

```rust
#[test]
fn import_current_profile_persists_snapshot_payload_file() {
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
        db_path,
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

    assert!(profile_dir.join("account_snapshot.json").exists());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml import_current_profile_persists_snapshot_payload_file -- --nocapture`
Expected: FAIL because `account_snapshot.json` is not created yet.

- [ ] **Step 3: Write minimal model additions**

Add snapshot-oriented structs in `src-tauri/src/antigravity/models.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityIdentity {
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub profile_url: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityStorageJsonFlags {
    pub oauth_legacy_migrated: Option<bool>,
    pub user_status_migrated: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityAccountSnapshot {
    pub format_version: u32,
    pub identity: AntigravityIdentity,
    pub values: BTreeMap<String, String>,
    pub storage_json_flags: AntigravityStorageJsonFlags,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityRecoveryPointMeta {
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub source_db_path: String,
    pub source_storage_json_path: String,
    pub identity: AntigravityIdentity,
}
```

- [ ] **Step 4: Run focused tests to verify compilation and model behavior**

Run: `cargo test --manifest-path src-tauri/Cargo.toml antigravity_manager_tests -- --nocapture`
Expected: FAIL later in manager behavior, but compile should succeed and the new test should now fail only because the manager has not written the snapshot file.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/antigravity/models.rs src-tauri/tests/antigravity_manager_tests.rs
git commit -m "feat: add antigravity account snapshot models"
```

### Task 2: Add Account Snapshot Capture Helpers

**Files:**
- Modify: `src-tauri/src/antigravity/db.rs`
- Create: `src-tauri/src/antigravity/storage.rs`
- Modify: `src-tauri/src/antigravity/mod.rs`
- Test: `src-tauri/tests/antigravity_db_tests.rs`

- [ ] **Step 1: Write the failing DB/storage tests**

Add tests in `src-tauri/tests/antigravity_db_tests.rs` that expect:

- reading `storage.json` migration flags
- building an account snapshot from DB rows plus storage flags
- excluding non-whitelisted storage data

```rust
#[test]
fn read_storage_json_flags_extracts_only_account_markers() {
    let temp = tempdir().unwrap();
    let path = temp.path().join("storage.json");
    std::fs::write(
        &path,
        r#"{
          "antigravityUnifiedStateSync.oauthToken.hasLegacyMigrated": true,
          "unifiedStateSync.hasUserStatusMigrated": true,
          "windowControlHeight": 35
        }"#,
    )
    .unwrap();

    let flags = read_storage_json_flags(&path).unwrap();

    assert_eq!(flags.oauth_legacy_migrated, Some(true));
    assert_eq!(flags.user_status_migrated, Some(true));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml antigravity_db_tests -- --nocapture`
Expected: FAIL because the storage helpers do not exist.

- [ ] **Step 3: Implement the storage helper module**

Create `src-tauri/src/antigravity/storage.rs`:

```rust
use crate::antigravity::models::AntigravityStorageJsonFlags;
use crate::antigravity::AntigravityError;
use serde_json::Value;
use std::fs;
use std::path::Path;

pub fn read_storage_json_flags(path: &Path) -> Result<AntigravityStorageJsonFlags, AntigravityError> {
    if !path.exists() {
        return Ok(AntigravityStorageJsonFlags::default());
    }

    let json: Value = serde_json::from_str(&fs::read_to_string(path)?)?;
    Ok(AntigravityStorageJsonFlags {
        oauth_legacy_migrated: json
            .get("antigravityUnifiedStateSync.oauthToken.hasLegacyMigrated")
            .and_then(Value::as_bool),
        user_status_migrated: json
            .get("unifiedStateSync.hasUserStatusMigrated")
            .and_then(Value::as_bool),
    })
}
```

- [ ] **Step 4: Implement account snapshot construction**

Add to `src-tauri/src/antigravity/db.rs`:

```rust
pub fn build_account_snapshot(
    payload: &AntigravityPayload,
    storage_json_flags: AntigravityStorageJsonFlags,
) -> AntigravityAccountSnapshot {
    AntigravityAccountSnapshot {
        format_version: 1,
        identity: AntigravityIdentity {
            email: payload.email.clone(),
            display_name: payload.display_name.clone(),
            profile_url: payload.values.get("antigravity.profileUrl").cloned(),
            source: "db".into(),
        },
        values: payload.values.clone(),
        storage_json_flags,
    }
}
```

Also export the new module in `src-tauri/src/antigravity/mod.rs`:

```rust
pub mod storage;
```

- [ ] **Step 5: Run focused tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml antigravity_db_tests -- --nocapture`
Expected: PASS for the new storage/account snapshot tests.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/antigravity/mod.rs src-tauri/src/antigravity/db.rs src-tauri/src/antigravity/storage.rs src-tauri/tests/antigravity_db_tests.rs
git commit -m "feat: add antigravity account snapshot capture helpers"
```

### Task 3: Add Live Identity Reader And Import Snapshot Persistence

**Files:**
- Create: `src-tauri/src/antigravity/live.rs`
- Modify: `src-tauri/src/antigravity/manager.rs`
- Modify: `src-tauri/src/antigravity/mod.rs`
- Test: `src-tauri/tests/antigravity_manager_tests.rs`

- [ ] **Step 1: Write the failing import test for live identity-aware snapshot persistence**

Extend the import test in `src-tauri/tests/antigravity_manager_tests.rs` to read `account_snapshot.json` and assert that it contains profile URL and account identity fields.

```rust
let snapshot: AntigravityAccountSnapshot = serde_json::from_str(
    &fs::read_to_string(profile_dir.join("account_snapshot.json")).unwrap(),
)
.unwrap();

assert_eq!(snapshot.identity.email.as_deref(), Some("alice@example.com"));
assert_eq!(snapshot.identity.source, "db");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml import_current_profile_persists_snapshot_payload_file -- --nocapture`
Expected: FAIL because manager import still writes only `payload.json`.

- [ ] **Step 3: Add a live identity abstraction**

Create `src-tauri/src/antigravity/live.rs`:

```rust
use crate::antigravity::models::AntigravityIdentity;
use crate::antigravity::AntigravityError;

pub trait AntigravityIdentityReader: Send + Sync {
    fn read_identity(&self) -> Result<Option<AntigravityIdentity>, AntigravityError>;
}

#[derive(Default)]
pub struct NoopIdentityReader;

impl AntigravityIdentityReader for NoopIdentityReader {
    fn read_identity(&self) -> Result<Option<AntigravityIdentity>, AntigravityError> {
        Ok(None)
    }
}
```

- [ ] **Step 4: Persist account snapshots during import**

Modify `src-tauri/src/antigravity/manager.rs` so `save_imported_profile` writes both `payload.json` and `account_snapshot.json`:

```rust
let storage_json_flags = read_storage_json_flags(&self.storage_json_path())?;
let snapshot = build_account_snapshot(&payload, storage_json_flags);
fs::write(
    profile_dir.join("account_snapshot.json"),
    serde_json::to_string_pretty(&snapshot)?,
)?;
```

Also add a helper:

```rust
fn storage_json_path(&self) -> PathBuf {
    self.state_db_path
        .parent()
        .expect("state db parent")
        .join("storage.json")
}
```

- [ ] **Step 5: Run focused manager tests to verify import passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml import_current_profile_persists_snapshot_payload_file -- --nocapture`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/antigravity/live.rs src-tauri/src/antigravity/mod.rs src-tauri/src/antigravity/manager.rs src-tauri/tests/antigravity_manager_tests.rs
git commit -m "feat: persist antigravity account snapshots on import"
```

### Task 4: Add Recovery Point Persistence For Switch Attempts

**Files:**
- Modify: `src-tauri/src/antigravity/manager.rs`
- Test: `src-tauri/tests/antigravity_manager_tests.rs`

- [ ] **Step 1: Write the failing recovery-point test**

Add a test that expects `switch_profile` to create a recovery-point directory before applying the target snapshot.

```rust
#[test]
fn switch_profile_creates_recovery_point_before_applying_target() {
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

    let recovery_root = app_data
        .path()
        .join("antigravity")
        .join("recovery-points");

    assert!(recovery_root.exists());
    assert!(!result.backup_id.is_empty());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml switch_profile_creates_recovery_point_before_applying_target -- --nocapture`
Expected: FAIL because no recovery-point directory is created.

- [ ] **Step 3: Implement recovery-point creation**

Add helpers to `src-tauri/src/antigravity/manager.rs`:

```rust
fn recovery_points_dir(&self) -> PathBuf {
    self.app_data_dir.join("antigravity").join("recovery-points")
}

fn create_recovery_point(
    &self,
    current: &AntigravityPayload,
) -> Result<String, AntigravityError> {
    let id = format!(
        "{}-{}",
        Utc::now().format("%Y%m%d-%H%M%S"),
        &Uuid::new_v4().simple().to_string()[..8]
    );
    let dir = self.recovery_points_dir().join(&id);
    fs::create_dir_all(&dir)?;
    fs::copy(&self.state_db_path, dir.join("state.vscdb"))?;

    let storage_json_path = self.storage_json_path();
    if storage_json_path.exists() {
        fs::copy(&storage_json_path, dir.join("storage.json"))?;
    }

    let meta = AntigravityRecoveryPointMeta {
        id: id.clone(),
        created_at: Utc::now(),
        source_db_path: self.state_db_path.to_string_lossy().to_string(),
        source_storage_json_path: storage_json_path.to_string_lossy().to_string(),
        identity: AntigravityIdentity {
            email: current.email.clone(),
            display_name: current.display_name.clone(),
            profile_url: current.values.get("antigravity.profileUrl").cloned(),
            source: "db".into(),
        },
    };
    fs::write(dir.join("meta.json"), serde_json::to_string_pretty(&meta)?)?;
    Ok(id)
}
```

- [ ] **Step 4: Call recovery-point creation before mutating live state**

Inside `switch_profile`:

```rust
let current = read_live_payload(&self.state_db_path)?;
let _recovery_point_id = self.create_recovery_point(&current)?;
```

Place it before any live write.

- [ ] **Step 5: Run the recovery-point test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml switch_profile_creates_recovery_point_before_applying_target -- --nocapture`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/antigravity/manager.rs src-tauri/tests/antigravity_manager_tests.rs
git commit -m "feat: create antigravity recovery points before switch"
```

### Task 5: Validate Post-Switch Identity And Roll Back On Failure

**Files:**
- Modify: `src-tauri/src/antigravity/manager.rs`
- Test: `src-tauri/tests/antigravity_manager_tests.rs`

- [ ] **Step 1: Write the failing rollback test**

Add a test-only switch path that simulates validation failure and expects the original state to be restored.

```rust
#[test]
fn switch_profile_rolls_back_when_post_switch_validation_fails() {
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
    manager.set_force_validation_failure_for_tests(true);

    let error = manager.switch_profile(&imported.id).unwrap_err().to_string();
    let live = manager.read_live_payload_for_tests().unwrap();

    assert!(error.contains("post-switch validation failed"));
    assert_eq!(live.email.as_deref(), Some("bob@example.com"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml switch_profile_rolls_back_when_post_switch_validation_fails -- --nocapture`
Expected: FAIL because rollback-on-validation-failure is not implemented.

- [ ] **Step 3: Add validation and rollback helpers**

Add to `src-tauri/src/antigravity/manager.rs`:

```rust
fn validate_switched_identity(
    &self,
    target: &AntigravityPayload,
    live: &AntigravityPayload,
) -> Result<(), AntigravityError> {
    if live.email != target.email {
        return Err(AntigravityError::Message(
            "Antigravity post-switch validation failed.".into(),
        ));
    }
    Ok(())
}

fn restore_recovery_point(&self, recovery_point_id: &str) -> Result<(), AntigravityError> {
    let dir = self.recovery_points_dir().join(recovery_point_id);
    fs::copy(dir.join("state.vscdb"), &self.state_db_path)?;
    let storage_json_backup = dir.join("storage.json");
    if storage_json_backup.exists() {
        fs::copy(storage_json_backup, self.storage_json_path())?;
    }
    Ok(())
}
```

- [ ] **Step 4: Wrap switch apply path in rollback logic**

Update `switch_profile`:

```rust
let recovery_point_id = self.create_recovery_point(&current)?;
replace_live_payload(&self.state_db_path, &target)?;
let verified = match read_live_payload(&self.state_db_path) {
    Ok(value) => value,
    Err(error) => {
        self.restore_recovery_point(&recovery_point_id)?;
        return Err(error);
    }
};

if let Err(error) = self.validate_switched_identity(&target, &verified) {
    self.restore_recovery_point(&recovery_point_id)?;
    return Err(AntigravityError::Message(format!(
        "Antigravity post-switch validation failed: {error}"
    )));
}
```

- [ ] **Step 5: Run rollback-focused tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml switch_profile_rolls_back_when_post_switch_validation_fails -- --nocapture`
Expected: PASS.

Run: `cargo test --manifest-path src-tauri/Cargo.toml switch_profile_creates_backup_updates_live_db_and_state -- --nocapture`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/antigravity/manager.rs src-tauri/tests/antigravity_manager_tests.rs
git commit -m "feat: roll back antigravity switch on validation failure"
```

### Task 6: Preserve Backward Compatibility For Existing Profiles

**Files:**
- Modify: `src-tauri/src/antigravity/manager.rs`
- Test: `src-tauri/tests/antigravity_manager_tests.rs`

- [ ] **Step 1: Write the failing compatibility test**

Add a test that creates a profile directory with only `payload.json` and confirms the manager can still switch using it.

```rust
#[test]
fn switch_profile_supports_legacy_payload_only_profiles() {
    let (_temp, db_path, _conn) = create_state_db();
    let app_data = tempdir().unwrap();
    let mut manager = AntigravityManager::new(
        app_data.path().to_path_buf(),
        db_path.clone(),
        Box::new(NoopProcessController::default()),
    )
    .unwrap();

    manager
        .write_live_payload_for_tests(payload("bob@example.com", "bob"))
        .unwrap();
    let summary = manager
        .save_imported_profile(
            "Alice".into(),
            "Imported".into(),
            payload("alice@example.com", "alice"),
        )
        .unwrap();

    std::fs::remove_file(
        app_data
            .path()
            .join("antigravity")
            .join("profiles")
            .join(&summary.id)
            .join("account_snapshot.json"),
    )
    .unwrap();

    let result = manager.switch_profile(&summary.id);
    assert!(result.is_ok());
}
```

- [ ] **Step 2: Run test to verify it fails if snapshot loading is hard-required**

Run: `cargo test --manifest-path src-tauri/Cargo.toml switch_profile_supports_legacy_payload_only_profiles -- --nocapture`
Expected: FAIL after introducing snapshot-first logic unless legacy fallback is implemented.

- [ ] **Step 3: Implement snapshot-first, payload-fallback loading**

In `src-tauri/src/antigravity/manager.rs`, add:

```rust
fn read_profile_account_snapshot(
    &self,
    profile_id: &str,
) -> Result<Option<AntigravityAccountSnapshot>, AntigravityError> {
    let path = self.profiles_dir().join(profile_id).join("account_snapshot.json");
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_str(&fs::read_to_string(path)?)?))
}
```

Keep `read_profile_payload` available as legacy fallback, and let switch continue using payload data if snapshot-only application is not yet richer than payload values.

- [ ] **Step 4: Run compatibility tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml antigravity_manager_tests -- --nocapture`
Expected: PASS for both new snapshot profiles and old payload-only profiles.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/antigravity/manager.rs src-tauri/tests/antigravity_manager_tests.rs
git commit -m "feat: keep antigravity legacy profile compatibility"
```

### Task 7: Verify Full Focused Test Set

**Files:**
- Modify: `src-tauri/tests/antigravity_db_tests.rs`
- Modify: `src-tauri/tests/antigravity_manager_tests.rs`

- [ ] **Step 1: Add final focused assertions**

Ensure tests cover:

- snapshot file creation
- storage flag capture
- recovery point creation
- rollback restore
- legacy compatibility

```rust
assert!(profile_dir.join("account_snapshot.json").exists());
assert!(app_data.path().join("antigravity").join("recovery-points").exists());
```

- [ ] **Step 2: Run the focused Antigravity test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml antigravity_ -- --nocapture`
Expected: PASS for the Antigravity tests in this repo.

- [ ] **Step 3: Run a broader library verification**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture`
Expected: PASS, or if unrelated failures exist, only pre-existing unrelated failures outside the Antigravity area.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tests/antigravity_db_tests.rs src-tauri/tests/antigravity_manager_tests.rs
git commit -m "test: verify antigravity account snapshot flow"
```

## Spec Coverage Check

- Account-only whitelist is covered by Tasks 2 and 3.
- Recovery points and rollback are covered by Tasks 4 and 5.
- Import semantics and compatibility are covered by Tasks 3 and 6.
- Validation-based success criteria are covered by Task 5.
- Focused testing coverage is covered by Task 7.

## Placeholder Scan

- No `TODO`, `TBD`, or “handle appropriately” placeholders remain.
- Every code-changing step includes concrete code snippets.
- Every verification step includes an exact command and expected outcome.

## Type Consistency Check

- Snapshot types are introduced in Task 1 and reused consistently in Tasks 2 through 6.
- `AntigravityAccountSnapshot`, `AntigravityIdentity`, and `AntigravityRecoveryPointMeta` names stay stable across tasks.
- `read_storage_json_flags`, `build_account_snapshot`, `create_recovery_point`, `restore_recovery_point`, and `validate_switched_identity` are named consistently across tasks.
