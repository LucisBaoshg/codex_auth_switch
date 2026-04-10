# Antigravity Auth Switch Design

## Summary

This project already ships a stable Codex profile switcher. We should keep the existing Codex logic unchanged and add a second engine for Google Antigravity account switching inside the same app shell.

The first Antigravity release should support one high-value workflow:

1. import the account currently logged into `Antigravity.app`
2. save that login state as a reusable profile
3. switch between saved Antigravity accounts with automatic app restart

The Antigravity scope is intentionally narrow. We only switch account login state. We do not switch device fingerprints, we do not copy the whole `globalStorage` directory, and we do not implement OAuth login inside this app in v1.

## Goals

- Preserve all existing Codex behavior and data layout
- Add Antigravity as a sibling platform inside the same desktop app
- Import the current logged-in Antigravity account from the local machine
- Switch saved Antigravity accounts with one action
- Create a backup before every Antigravity switch
- Restart `Antigravity.app` automatically after a successful switch

## Non-Goals

- Refactoring Codex profiles into a new shared provider framework in v1
- Editing protobuf payloads field-by-field beyond the required database keys
- Capturing or switching `storage.json` device fields
- Full `globalStorage` snapshot switching
- In-app Google OAuth login
- Multi-platform support beyond Codex plus Antigravity in this iteration

## Approach Options

### Option A: Generic provider architecture first

Create a new provider abstraction, migrate Codex onto it, then add Antigravity as a second provider.

Pros:

- clean long-term architecture
- easier to add more platforms later

Cons:

- touches stable Codex logic
- increases migration risk and implementation time

### Option B: Keep Codex engine intact and add an Antigravity engine

Reuse the app shell, but keep Codex and Antigravity storage and switching logic separate.

Pros:

- lowest risk to existing behavior
- fastest path to user value
- aligns with the requirement to avoid changing Codex logic

Cons:

- duplicated concepts in the short term
- less elegant than a unified provider model

### Option C: Ship Antigravity as a mostly separate mode

Build an Antigravity-only subsystem with minimal shared UX and little shared state.

Pros:

- strong implementation isolation

Cons:

- fragmented user experience
- harder to unify later

## Decision

Choose Option B.

The app should become a multi-platform auth switch helper at the product layer, while the implementation keeps two independent engines:

- existing Codex engine remains unchanged
- new Antigravity engine is added alongside it

This preserves current reliability and still leaves room for a later provider abstraction after Antigravity proves its value.

## Product Surface

### Platform Selector

The desktop app should expose two top-level platform views:

- `Codex`
- `Antigravity`

Codex keeps the current behavior and screens. Antigravity gets its own list and detail flow. The platform selector can be implemented as a sidebar section or segmented top navigation, but the important point is that the user always knows which platform they are managing.

### Antigravity v1 Actions

The Antigravity view should support:

- `Import Current Account`
- `Switch`
- `Refresh`
- `Reveal Antigravity Data`
- `Restore Last Backup`

Each saved Antigravity profile card should show:

- display name
- email
- last updated time
- whether it matches the currently active local Antigravity login

## Antigravity Data Model

Antigravity should not reuse the Codex `auth.json + config.toml` profile model. It needs a dedicated storage model based on login-related database keys.

### Profile Metadata

`AntigravityProfileMeta`

- `id`
- `name`
- `notes`
- `email`
- `display_name`
- `created_at`
- `updated_at`
- `source_db_path`

### Profile Payload

`AntigravityProfilePayload`

- `antigravityAuthStatus`
- `antigravityUnifiedStateSync.oauthToken`
- `antigravityUnifiedStateSync.userStatus`
- `antigravityUnifiedStateSync.enterprisePreferences` optional
- `antigravityUnifiedStateSync.modelCredits` optional
- `antigravity.profileUrl` optional

The payload stores raw database values. v1 should not decompose and rebuild these values beyond extracting display metadata for the UI.

### Backup Payload

`AntigravitySwitchBackup`

- `created_at`
- `source_profile_id` optional
- `db_path`
- `payload`

The backup payload uses the same key structure as the profile payload so that restore and rollback stay simple and deterministic.

## Disk Layout

Codex storage stays unchanged. Antigravity uses its own namespace.

```text
app_data/
  profiles/
    ... existing Codex data unchanged ...
  backups/
    ... existing Codex backups unchanged ...
  state.json
  antigravity/
    profiles/
      {profile-id}/
        meta.json
        payload.json
    backups/
      {backup-id}/
        meta.json
        payload.json
    state.json
```

This layout avoids any migration of existing Codex files and keeps Antigravity persistence easy to inspect.

## Local Antigravity Source Detection

### Default macOS Path

v1 should support the standard macOS path:

`~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb`

### Future Paths

The implementation should keep path resolution isolated so later we can add:

- portable installs
- custom `user-data-dir`
- Windows and Linux defaults

### Database Shape

Antigravity stores the relevant values in the SQLite database `state.vscdb`, table:

- `ItemTable(key TEXT UNIQUE, value BLOB)`

The required keys are:

- `antigravityAuthStatus`
- `antigravityUnifiedStateSync.oauthToken`
- `antigravityUnifiedStateSync.userStatus`

Optional keys that should be imported when present:

- `antigravityUnifiedStateSync.enterprisePreferences`
- `antigravityUnifiedStateSync.modelCredits`
- `antigravity.profileUrl`

## Import Flow

### User Action

The user clicks `Import Current Account` in the Antigravity view.

### Backend Steps

1. Resolve the source `state.vscdb` path
2. Open the database read-only
3. Read the required and optional keys from `ItemTable`
4. Reject import if any required key is missing
5. Parse `antigravityAuthStatus` as JSON to extract:
   - `email`
   - `name`
6. Build a default profile name from email or display name
7. Save `meta.json` and `payload.json` under `app_data/antigravity/profiles/{id}`
8. Refresh the Antigravity snapshot returned to the frontend

### Validation Rules

Import fails if:

- the database file is missing
- the file cannot be opened as SQLite
- `antigravityAuthStatus` is not valid JSON
- any required key is missing
- extracted email is empty

## Switch Flow

### User Action

The user selects a saved Antigravity profile and clicks `Switch`.

### Backend Steps

1. Resolve the live `state.vscdb` path
2. Detect whether `Antigravity.app` is running
3. If running, close it gracefully before writing
4. Read the current live payload from the same key set
5. Save a backup under `app_data/antigravity/backups/{backup-id}`
6. Open the database in read-write mode
7. Start a SQLite transaction
8. For each payload key in the target profile:
   - `INSERT OR REPLACE` the target value
9. For each optional managed key that is absent in the target profile:
   - `DELETE` it from the live database
10. Commit the transaction
11. Re-open the database read-only and re-read the managed keys
12. Verify that required keys match the target payload
13. Launch `Antigravity.app`
14. Update Antigravity state with the last switched profile and timestamp

### Managed Key Set

The switch operation should only touch this Antigravity-managed subset:

- `antigravityAuthStatus`
- `antigravity.profileUrl`
- `antigravityUnifiedStateSync.enterprisePreferences`
- `antigravityUnifiedStateSync.modelCredits`
- `antigravityUnifiedStateSync.oauthToken`
- `antigravityUnifiedStateSync.userStatus`

This keeps v1 narrowly focused on user identity and avoids clobbering unrelated preferences.

## Active Profile Detection

The Antigravity view should detect which saved profile matches the live local login state.

The safest v1 strategy is hash-based matching:

1. read the managed key set from the live database
2. normalize missing optional keys to `null`
3. hash the payload in a deterministic key order
4. compare it with each saved profile payload hash

If there is a match, mark that profile active. If there is no match, show the local state as `custom / unknown`.

## Backend Architecture

The new logic should live outside the current Codex `ProfileManager` path.

### New Modules

Suggested backend layout:

```text
src-tauri/src/
  antigravity/
    mod.rs
    models.rs
    paths.rs
    db.rs
    manager.rs
    process.rs
```

Responsibilities:

- `models.rs`: Antigravity metadata, payload, backup, and snapshot structs
- `paths.rs`: resolve source DB path and app data paths
- `db.rs`: SQLite read and write operations for managed keys
- `process.rs`: detect, stop, and restart `Antigravity.app`
- `manager.rs`: import, switch, restore, snapshot assembly

### Tauri Commands

Suggested commands:

- `load_antigravity_snapshot`
- `import_current_antigravity_profile`
- `switch_antigravity_profile`
- `delete_antigravity_profile`
- `restore_last_antigravity_backup`
- `reveal_antigravity_source`

These commands should not modify existing Codex commands.

## Frontend Architecture

The current frontend should gain a platform shell layer, but Codex screens should remain functionally unchanged.

### Suggested UI Split

- app shell selects platform
- Codex page reuses existing data flow
- Antigravity page uses a new Antigravity store and command set

Suggested frontend additions:

- `src/features/antigravity/*`
- `src/stores/useAntigravityStore.ts`
- `src/services/antigravityService.ts`

The Antigravity list can deliberately mirror the Codex card interaction model where possible so the app still feels coherent.

## Error Handling

### Import Errors

Show explicit messages for:

- database not found
- not logged into Antigravity
- missing required auth keys
- malformed `antigravityAuthStatus`

### Switch Errors

Show explicit messages for:

- failed to close Antigravity
- failed to back up current state
- database write failure
- post-write verification mismatch
- failed to relaunch Antigravity

If writing fails after backup creation, keep the backup and surface the backup id in the error so recovery is possible.

## Restore Flow

The Antigravity feature should include a minimal restore action in v1:

- restore the latest Antigravity backup payload into the live `state.vscdb`
- restart `Antigravity.app`

This is important because Antigravity switching edits a live application database rather than plain text config files.

## Testing Strategy

### Backend Unit Tests

- import succeeds with a valid sample SQLite database
- import fails when `antigravityAuthStatus` is missing
- import fails when `oauthToken` is missing
- switch creates a backup before mutation
- switch writes required keys
- switch deletes absent optional keys
- restore writes backup payload back correctly
- active profile detection matches on normalized payload hash

### Backend Integration Tests

- switch profile A to B against a fixture database
- verify required keys match B after switch
- restore previous backup and verify keys match A again

### Manual Validation

1. log into Antigravity with account A
2. import A
3. log into Antigravity with account B
4. import B
5. switch from A to B through the app
6. verify Antigravity relaunches into B
7. switch back to A
8. verify Codex functionality is unchanged

## Rollout Notes

This iteration intentionally favors correctness over abstraction. If Antigravity proves stable and more platforms are added later, we can then introduce a shared provider layer with real usage knowledge instead of speculative generalization.
