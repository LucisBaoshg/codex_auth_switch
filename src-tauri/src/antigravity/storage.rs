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
