# Antigravity Account Snapshot Design

Date: 2026-04-10

## Goal

Replace the current legacy-DB-only Antigravity switching model with a safer account snapshot model that:

- preserves only account login state and account profile metadata
- avoids switching workspace state, editor history, and unrelated user preferences
- always creates a recoverable rollback point before applying a switch
- automatically restores the previous state if switch application or post-switch validation fails

## Non-Goals

- Do not attempt to switch the entire `~/Library/Application Support/Antigravity/User` directory.
- Do not migrate workspace-local state under `workspaceStorage`.
- Do not migrate terminal history, editor history, snippets, or non-account preferences.
- Do not claim full external export/import of live `uss-oauth` beyond what we can currently observe and copy from local storage.

## Confirmed Constraints

- The legacy `antigravityUnifiedStateSync.oauthToken` row in `state.vscdb` is no longer authoritative.
- The legacy `antigravityUnifiedStateSync.userStatus` row can now be only a sentinel payload.
- Antigravity desktop uses USS topics `uss-userStatus` and `uss-oauth`.
- The local Antigravity language server can provide live identity via `GetUserStatus`.
- The obvious external OAuth subscription API is blocked in external builds.
- We must not leave the machine in a half-switched state if a switch fails.

## User-Facing Outcome

The app will treat an Antigravity account profile as an account snapshot, not as a raw DB export. Importing or switching an account will:

1. capture a rollback snapshot of the current machine state
2. stop Antigravity
3. apply only the account-related snapshot subset
4. restart Antigravity
5. verify that the intended account became active
6. automatically roll back if verification fails

This design decouples identity display from switchability:

- identity display can use live LS fallback
- switching still requires a restorable snapshot transaction

## Proposed Approaches

### Approach A: Legacy DB field replacement

Keep switching based on individual DB keys such as `antigravityUnifiedStateSync.oauthToken` and `antigravityAuthStatus`.

Why not:

- already proven stale on this machine
- fails for USS/sentinel-backed accounts
- highest risk of false logout

### Approach B: Full `User` directory swap

Treat the entire Antigravity `User` directory as the account payload and swap it wholesale.

Why not:

- captures too much unrelated state
- violates the requirement to avoid switching workspace/history
- larger blast radius on failure

### Approach C: Account whitelist snapshot with transactional rollback

Persist a focused account snapshot made of a small whitelist of files and logical fragments, and apply it inside a stop/apply/verify/rollback transaction.

Why this is recommended:

- matches the desired scope
- gives us a clean rollback story
- can evolve as we discover more real auth carriers
- keeps workspace and history out of the switch surface

## Recommended Design

### 1. Snapshot Model

Introduce a new Antigravity snapshot format with two layers:

- `backup/`
  - a full backup copy of every source file we touch during switch
  - used only for rollback and recovery
- `account/`
  - the normalized account-only payload we intend to apply

Each snapshot stores metadata:

- snapshot id
- created time
- source machine paths
- captured identity if known
- capture method per section
- format version

### 2. First-Version Account Whitelist

Version 1 should include only these sources:

- `User/globalStorage/state.vscdb`
  - not as a whole-account truth source
  - as a physical source file from which we preserve and rewrite only account-related rows
- `User/globalStorage/storage.json`
  - only a small whitelist of account migration markers and account metadata keys
- future-compatible room for additional sources
  - secret-backed material if we later prove an Antigravity-specific `secret://...` entry
  - other USS-backed account files if discovered later

Version 1 must explicitly exclude:

- `User/workspaceStorage/**`
- `User/History/**`
- `User/snippets/**`
- `User/settings.json`
- any other file not on the whitelist

### 3. Logical Sections Inside the Snapshot

Even when the physical source is `state.vscdb`, the account payload should be normalized into named sections:

- `identity`
  - email
  - display name
  - profile URL
  - capture source, such as `language_server` or `db`
- `user_status_topic`
  - the `uss-userStatus` logical payload if available
- `oauth_topic`
  - the `uss-oauth` logical payload if available
- `legacy_rows`
  - account-related legacy rows we still need to preserve for compatibility
- `storage_json_flags`
  - only account-related migration and auth markers

This keeps the on-disk snapshot stable even if the physical storage layout changes later.

### 4. Capture Strategy

Capture should use the most authoritative source available in this order:

1. local language server for live identity
2. USS/secret-backed logical payloads from confirmed local storage
3. legacy DB rows only as compatibility fallback

Important rule:

- missing live identity is allowed to block capture
- stale legacy rows must never override a fresher LS identity

### 5. Switch Transaction

The switch flow should become:

1. read current live identity
2. build a rollback snapshot from current touched files and current account sections
3. stop Antigravity processes
4. apply target account snapshot to the whitelist surface only
5. restart Antigravity
6. wait for readiness
7. validate target identity
8. commit success or perform rollback

This is a transactional switch. A switch is only considered successful after step 7.

### 6. Rollback Rules

Rollback is mandatory if any of the following happens:

- failed to create rollback snapshot
- failed to stop Antigravity cleanly
- failed to write any target section
- failed to restart Antigravity
- post-switch identity does not match target account
- post-switch identity is empty or unavailable after timeout

Rollback flow:

1. stop Antigravity again if needed
2. restore the exact pre-switch backup files
3. restart Antigravity
4. verify that the original identity is back if possible
5. surface the switch as failed

The machine must prefer returning to the original state over partially preserving the target state.

### 7. Recovery Points

In addition to profile snapshots, every switch attempt creates a temporary recovery point for the current state.

Requirements:

- recovery points live in the app's own data directory
- recovery points are separate from saved user profiles
- the latest few recovery points are retained
- manual restore from the latest recovery point remains available even if automatic rollback fails

### 8. Validation Rules

Success must not be based only on file writes.

Validation should check:

- Antigravity restarted successfully
- local LS becomes reachable again if available
- `GetUserStatus` email matches the target profile email when present
- if no email is available, at least the fallback identity marker matches the target snapshot

If validation is inconclusive after timeout, treat it as failure and roll back.

### 9. Profile Import Semantics

Importing the current account should save:

- the normalized account snapshot sections
- display metadata such as email, display name, profile URL
- the raw touched-file backup that corresponds to the account-related whitelist surface

Import must not save workspace or history directories.

### 10. Compatibility Story

Existing profiles based on legacy payloads should remain readable, but the new format becomes the preferred format.

The loader should support:

- old DB-row payload profiles
- new account snapshot profiles

Switch execution should always upgrade into the transactional whitelist pipeline internally.

## Data Flow

### Capture

`AntigravityManager`
-> `IdentityReader`
-> `AccountSnapshotCollector`
-> `ProfileStore`

### Switch

`AntigravityManager`
-> `RecoveryPointCreator`
-> `ProcessController.stop()`
-> `AccountSnapshotApplier`
-> `ProcessController.restart()`
-> `PostSwitchValidator`
-> success or `RollbackRestorer`

## Error Handling

- If current identity cannot be determined, import should fail with a precise capture error.
- If target snapshot lacks the minimum required account sections, switch should fail before stopping Antigravity.
- If rollback also fails, surface a high-severity recovery error and keep the latest recovery point path visible in app state.

## Testing Strategy

### Unit Tests

- normalize live identity from LS over stale DB values
- create account snapshot from mixed sources
- exclude workspace/history paths from snapshot
- apply only whitelisted account rows and flags
- create rollback snapshot before write
- trigger rollback on validation failure

### Integration-Style Manager Tests

- successful switch creates recovery point and commits target account
- failed post-switch validation restores original account state
- import stores account snapshot metadata without workspace/history content
- legacy profile payload can still be loaded and translated into the new switch path

## Risks

- We still have not proven the final storage carrier for all live OAuth material.
- Some account-critical state may still live outside the first whitelist.
- LS validation may be temporarily unavailable during restart windows.

## Risk Mitigations

- normalize snapshot format so we can add new account sections later
- keep rollback based on actual touched source files, not only normalized JSON
- treat validation uncertainty as failure, not success

## Open Questions

- Which exact `storage.json` keys should be included in the version 1 account whitelist beyond migration markers?
- Is there an Antigravity-specific `secret://...` row that appears only after a different login sequence or later flush?
- Do we need a small post-restart delay window before LS identity becomes reliable for validation?

## Implementation Boundary for Version 1

Version 1 should deliver:

- normalized account snapshot format
- current-state recovery point creation
- whitelist-based apply path
- automatic rollback on failed validation
- identity display using live LS fallback

Version 1 should not promise:

- full arbitrary external OAuth export
- workspace-scoped state switching
- full profile clone of the entire Antigravity user environment
