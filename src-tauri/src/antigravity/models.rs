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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AntigravitySwitchResult {
    pub profile_id: String,
    pub backup_id: String,
    pub switched_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityBackupMeta {
    pub id: String,
    pub source_profile_id: Option<String>,
    pub db_path: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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
