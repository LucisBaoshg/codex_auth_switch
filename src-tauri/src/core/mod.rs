use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, NaiveDate, SecondsFormat, TimeZone, Utc};
use filetime::{set_file_mtime, set_file_times, FileTime};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};
use thiserror::Error;
use uuid::Uuid;

mod restart;
mod updates;

pub use restart::{
    codex_restart_plan_for_platform, restart_codex_app, restart_codex_script, CodexRestartPlatform,
};
pub use updates::{
    check_for_update, check_install_location, install_update, InstallLocationStatus,
    UpdateCheckResult, UpdateInstallRequest,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInput {
    pub name: String,
    pub notes: String,
    pub auth_json: String,
    pub config_toml: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsageWindow {
    pub used_percent: f64,
    pub window_minutes: Option<i64>,
    pub resets_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsageCredits {
    pub has_credits: bool,
    pub unlimited: bool,
    pub balance: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsageSnapshot {
    pub source: String,
    pub plan_type: Option<String>,
    pub primary: Option<CodexUsageWindow>,
    pub secondary: Option<CodexUsageWindow>,
    pub credits: Option<CodexUsageCredits>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsageStatsSnapshot {
    pub updated_at: DateTime<Utc>,
    pub filter: CodexUsageStatsFilter,
    pub sync: CodexUsageStatsSyncResult,
    pub summary: CodexUsageStatsSummary,
    pub trends: Vec<CodexUsageStatsTrend>,
    pub model_breakdown: Vec<CodexUsageStatsBreakdown>,
    pub effort_breakdown: Vec<CodexUsageStatsBreakdown>,
    pub available_models: Vec<String>,
    pub available_efforts: Vec<String>,
    pub logs: Vec<CodexUsageStatsLog>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsageStatsFilter {
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
}

impl Default for CodexUsageStatsFilter {
    fn default() -> Self {
        Self {
            start_date: None,
            end_date: None,
            model: None,
            effort: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsageStatsSummary {
    pub total_requests: i64,
    pub total_cost_usd: String,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cache_read_tokens: i64,
    pub total_cache_creation_tokens: i64,
    pub total_reasoning_output_tokens: i64,
    pub real_total_tokens: i64,
    pub cache_hit_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsageStatsTrend {
    pub date: String,
    pub request_count: i64,
    pub total_cost_usd: String,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cache_read_tokens: i64,
    pub total_cache_creation_tokens: i64,
    pub total_reasoning_output_tokens: i64,
    pub real_total_tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsageStatsBreakdown {
    pub name: String,
    pub request_count: i64,
    pub total_cost_usd: String,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cache_read_tokens: i64,
    pub total_cache_creation_tokens: i64,
    pub total_reasoning_output_tokens: i64,
    pub real_total_tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsageStatsLog {
    pub request_id: String,
    pub session_id: String,
    pub model: String,
    pub provider: String,
    pub effort: String,
    pub created_at: DateTime<Utc>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_creation_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_cost_usd: String,
    pub source_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsageStatsSyncResult {
    pub imported: i64,
    pub skipped: i64,
    pub files_scanned: i64,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThirdPartyLatencySnapshot {
    pub wire_api: Option<String>,
    pub model: Option<String>,
    pub ttft_ms: Option<u64>,
    pub total_ms: Option<u64>,
    pub status_code: Option<u16>,
    pub updated_at: DateTime<Utc>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThirdPartyUsageSnapshot {
    pub provider: Option<String>,
    pub remaining: Option<String>,
    pub unit: Option<String>,
    #[serde(default)]
    pub daily: Option<ThirdPartyUsageQuotaSnapshot>,
    #[serde(default)]
    pub weekly: Option<ThirdPartyUsageQuotaSnapshot>,
    #[serde(default)]
    pub subscription: Option<ThirdPartySubscriptionSnapshot>,
    #[serde(default)]
    pub credit: Option<ThirdPartyCreditSnapshot>,
    pub updated_at: DateTime<Utc>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThirdPartyUsageQuotaSnapshot {
    pub used: Option<String>,
    pub total: Option<String>,
    pub remaining: Option<String>,
    pub used_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThirdPartySubscriptionSnapshot {
    pub daily_quota: Option<String>,
    pub weekly_quota: Option<String>,
    pub monthly_quota: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub amount: Option<String>,
    pub package_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThirdPartyCreditSnapshot {
    pub free_balance: Option<String>,
    pub paid_balance: Option<String>,
    pub total_balance: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub id: String,
    pub name: String,
    pub notes: String,
    pub auth_type_label: String,
    #[serde(default)]
    pub model_provider_id: Option<String>,
    #[serde(default)]
    pub model_provider_api_key_id: Option<String>,
    #[serde(default)]
    pub model_provider_key: Option<String>,
    #[serde(default)]
    pub model_provider_name: Option<String>,
    #[serde(default)]
    pub model_provider_base_url: Option<String>,
    #[serde(default)]
    pub model_provider_wire_api: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub auth_hash: String,
    pub config_hash: String,
    pub codex_usage: Option<CodexUsageSnapshot>,
    pub third_party_latency: Option<ThirdPartyLatencySnapshot>,
    pub third_party_usage: Option<ThirdPartyUsageSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDocument {
    pub id: String,
    pub name: String,
    pub notes: String,
    pub auth_type_label: String,
    #[serde(default)]
    pub model_provider_id: Option<String>,
    #[serde(default)]
    pub model_provider_api_key_id: Option<String>,
    #[serde(default)]
    pub model_provider_key: Option<String>,
    #[serde(default)]
    pub model_provider_name: Option<String>,
    #[serde(default)]
    pub model_provider_base_url: Option<String>,
    #[serde(default)]
    pub model_provider_wire_api: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub auth_json: String,
    pub config_toml: String,
    pub loaded_from_target: bool,
    pub has_target_changes: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchResult {
    pub profile_id: String,
    pub backup_id: String,
    pub switched_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub target_dir: String,
    pub using_default_target_dir: bool,
    pub target_exists: bool,
    pub target_auth_exists: bool,
    pub target_config_exists: bool,
    pub target_updated_at: Option<DateTime<Utc>>,
    pub target_auth_type_label: Option<String>,
    pub active_profile_id: Option<String>,
    pub last_selected_profile_id: Option<String>,
    pub last_switch_profile_id: Option<String>,
    pub last_switched_at: Option<DateTime<Utc>>,
    pub codex_usage_api_enabled: bool,
    pub profiles: Vec<ProfileSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyThirdPartyMigrationResult {
    pub migrated_profile_ids: Vec<String>,
    pub skipped_profile_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThirdPartyWebsocketsDefaultResult {
    pub updated_profile_ids: Vec<String>,
    pub skipped_profile_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecoveryCounts {
    pub session_index_entries: usize,
    pub db_threads: usize,
    pub archived: usize,
    pub unarchived: usize,
    pub has_user_event_true: usize,
    pub has_user_event_false: usize,
    pub inferred_current_model_provider: Option<String>,
    pub model_provider_counts: HashMap<String, usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecoveryCandidates {
    pub missing_rollout_files: usize,
    pub has_user_event_false_but_rollout_has_user_message: usize,
    pub db_time_mismatch_with_session_index: usize,
    pub rollout_mtime_mismatch_with_session_index: usize,
    pub db_thread_ids_missing_from_session_index: usize,
    pub session_index_ids_missing_from_db: usize,
    pub app_default_model_provider_mismatch: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingRolloutSample {
    pub id: String,
    pub archived: bool,
    pub rollout_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HasUserEventMismatchSample {
    pub id: String,
    pub archived: bool,
    pub cwd: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTimeMismatchSample {
    pub id: String,
    pub cwd: Option<String>,
    pub db_updated_at_ms: i64,
    pub indexed_updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RolloutMtimeMismatchSample {
    pub id: String,
    pub rollout_path: String,
    pub rollout_mtime_ms: i64,
    pub indexed_updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRootOutsideRecentWindowSample {
    pub root: String,
    pub latest_thread_id: String,
    pub latest_title: Option<String>,
    pub latest_updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecoverySamples {
    pub missing_rollout_files: Vec<MissingRolloutSample>,
    pub has_user_event_false_but_rollout_has_user_message: Vec<HasUserEventMismatchSample>,
    pub db_time_mismatch_with_session_index: Vec<SessionTimeMismatchSample>,
    pub rollout_mtime_mismatch_with_session_index: Vec<RolloutMtimeMismatchSample>,
    pub saved_roots_with_chats_outside_recent_window: Vec<SavedRootOutsideRecentWindowSample>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecoveryReport {
    pub codex_home: String,
    pub db_path: String,
    pub session_index_path: String,
    pub recent_limit: usize,
    pub sqlite_integrity: String,
    pub counts: SessionRecoveryCounts,
    pub repair_candidates: SessionRecoveryCandidates,
    pub samples: SessionRecoverySamples,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionRepairUpdateCounts {
    pub has_user_event: usize,
    pub db_time: usize,
    pub rollout_mtime: usize,
    pub time_mismatches_not_repaired: usize,
    pub skipped_missing_rollout_files: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRepairResult {
    pub repaired: bool,
    pub backup_path: String,
    pub audit_path: String,
    pub updates: SessionRepairUpdateCounts,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncResult {
    pub synced: usize,
    pub imported: usize,
    pub updated: usize,
    pub profiles: Vec<ProfileSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProviderApiKeyRecord {
    pub id: String,
    pub name: String,
    pub api_key: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProviderRecord {
    pub id: String,
    #[serde(default)]
    pub model_provider_key: Option<String>,
    pub name: String,
    pub base_url: String,
    pub wire_api: String,
    #[serde(default)]
    pub api_keys: Vec<ModelProviderApiKeyRecord>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProviderSummary {
    pub id: String,
    #[serde(default)]
    pub model_provider_key: Option<String>,
    pub name: String,
    pub base_url: String,
    pub wire_api: String,
    pub api_key_count: usize,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteProfileRecord {
    id: String,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StateFile {
    pub target_dir: Option<String>,
    pub last_selected_profile_id: Option<String>,
    pub last_switch_profile_id: Option<String>,
    pub last_switched_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub codex_usage_api_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TargetMarkerFile {
    pub profile_id: String,
    pub auth_hash: String,
    pub config_hash: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileMetadata {
    pub id: String,
    pub name: String,
    pub notes: String,
    #[serde(default)]
    pub remote_profile_id: Option<String>,
    #[serde(default = "unknown_auth_type_label")]
    pub auth_type_label: String,
    #[serde(default)]
    pub model_provider_id: Option<String>,
    #[serde(default)]
    pub model_provider_api_key_id: Option<String>,
    #[serde(default)]
    pub model_provider_key: Option<String>,
    #[serde(default)]
    pub model_provider_name: Option<String>,
    #[serde(default)]
    pub model_provider_base_url: Option<String>,
    #[serde(default)]
    pub model_provider_wire_api: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub auth_hash: String,
    pub config_hash: String,
    #[serde(default)]
    pub codex_usage: Option<CodexUsageSnapshot>,
    #[serde(default)]
    pub third_party_latency: Option<ThirdPartyLatencySnapshot>,
    #[serde(default)]
    pub third_party_usage: Option<ThirdPartyUsageSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionIndexEntry {
    id: String,
    thread_name: String,
    updated_at: String,
}

#[derive(Debug, Clone)]
struct SessionRecoveryIndexEntry {
    ms: i64,
    sec: i64,
}

#[derive(Debug, Clone)]
struct SessionRecoveryThread {
    id: String,
    rollout_path: Option<PathBuf>,
    updated_at: i64,
    updated_at_ms: i64,
    cwd: Option<String>,
    title: Option<String>,
    has_user_event: bool,
    archived: bool,
    model_provider: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionInfo {
    pub id: String,
    pub rollout_path: Option<String>,
    pub updated_at_ms: i64,
    pub cwd: Option<String>,
    pub title: Option<String>,
    pub has_user_event: bool,
    pub archived: bool,
    pub model_provider: Option<String>,
    pub file_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexMessage {
    pub role: String,
    pub text: String,
}

fn extract_message_text(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(arr) => {
            let mut parts = Vec::new();
            for item in arr {
                if let Some(text_val) = item.get("text").and_then(|v| v.as_str()) {
                    parts.push(text_val.to_string());
                } else if let Some(text_val) = item.as_str() {
                    parts.push(text_val.to_string());
                }
            }
            parts.join("\n")
        }
        serde_json::Value::Object(obj) => {
            if let Some(text_val) = obj.get("text").and_then(|v| v.as_str()) {
                text_val.to_string()
            } else {
                String::new()
            }
        }
        _ => String::new(),
    }
}

fn parse_rollout_date_parts(filename: &str) -> Option<(&str, &str, &str)> {
    if filename.starts_with("rollout-") && filename.len() >= 18 {
        let year = &filename[8..12];
        let month = &filename[13..15];
        let day = &filename[16..18];
        if year.chars().all(|c| c.is_ascii_digit())
            && month.chars().all(|c| c.is_ascii_digit())
            && day.chars().all(|c| c.is_ascii_digit())
        {
            return Some((year, month, day));
        }
    }
    None
}

fn update_session_index_title(
    session_index_path: &Path,
    thread_id: &str,
    new_title: &str,
) -> Result<(), AppError> {
    if !session_index_path.exists() {
        return Ok(());
    }
    let file = fs::File::open(session_index_path)?;
    let temp_path = session_index_path.with_extension("tmp");
    let mut temp_file = fs::File::create(&temp_path)?;

    for line in BufReader::new(file).lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(mut entry) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if entry.get("id").and_then(|v| v.as_str()) == Some(thread_id) {
                if let Some(obj) = entry.as_object_mut() {
                    obj.insert(
                        "thread_name".to_string(),
                        serde_json::Value::String(new_title.to_string()),
                    );
                }
            }
            let serialized = serde_json::to_string(&entry)?;
            writeln!(temp_file, "{}", serialized)?;
        } else {
            writeln!(temp_file, "{}", line)?;
        }
    }
    fs::rename(&temp_path, session_index_path)?;
    Ok(())
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionRepairAudit {
    backup_path: String,
    audit_path: String,
    has_user_event_updates: Vec<HasUserEventMismatchSample>,
    db_time_updates: Vec<SessionTimeMismatchSample>,
    rollout_mtime_updates: Vec<RolloutMtimeMismatchSample>,
    time_mismatches_not_repaired: Vec<SessionTimeMismatchSample>,
    skipped_missing_rollout_files: Vec<MissingRolloutSample>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionProviderRepairAudit {
    db_backup_path: String,
    rollout_backup_dir: String,
    provider: String,
    db_updates: Vec<String>,
    rollout_updates: Vec<String>,
    skipped_missing_rollout_files: Vec<MissingRolloutSample>,
    skipped_without_session_meta: Vec<String>,
}

#[derive(Debug)]
struct SessionProviderRepairCandidate {
    id: String,
    rollout_path: Option<PathBuf>,
    archived: bool,
}

#[derive(Debug)]
struct ThirdPartyProbeTarget {
    provider_name: String,
    api_key: String,
    base_url: String,
    model: String,
    wire_api: String,
}

#[derive(Debug, Clone)]
struct ThirdPartyProviderDescriptor {
    provider_id: String,
    api_key_id: String,
    provider_key: String,
    provider_name: String,
    base_url: String,
    wire_api: String,
    api_key: String,
}

#[derive(Debug)]
struct SseEvent {
    event: Option<String>,
    data: String,
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Failed to access the filesystem: {0}")]
    Io(#[from] std::io::Error),
    #[error("Failed to process JSON data: {0}")]
    Json(#[from] serde_json::Error),
    #[error("auth.json is invalid: {0}")]
    InvalidAuthJson(String),
    #[error("config.toml is invalid: {0}")]
    InvalidConfigToml(String),
    #[error("Profile `{0}` was not found.")]
    ProfileNotFound(String),
    #[error("{0}")]
    Message(String),
    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

const SESSION_RECOVERY_RECENT_LIMIT: usize = 50;

pub struct ProfileManager {
    app_data_dir: PathBuf,
    target_dir: PathBuf,
    state: StateFile,
}

impl ProfileManager {
    pub fn new(app_data_dir: PathBuf, target_dir: PathBuf) -> Result<Self, AppError> {
        let mut state = StateFile::default();
        state.target_dir = Some(target_dir.to_string_lossy().to_string());

        let manager = Self {
            app_data_dir,
            target_dir,
            state,
        };

        manager.ensure_storage_dirs()?;
        manager.persist_state()?;
        Ok(manager)
    }

    pub fn load_or_default(app_data_dir: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&app_data_dir)?;

        let state_path = app_data_dir.join("state.json");
        let state = if state_path.exists() {
            serde_json::from_str::<StateFile>(&fs::read_to_string(&state_path)?)?
        } else {
            StateFile::default()
        };

        let default_target_dir = default_codex_target_dir()?;
        let target_dir = state
            .target_dir
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| default_target_dir.clone());

        let manager = Self {
            app_data_dir,
            target_dir,
            state,
        };

        manager.ensure_storage_dirs()?;
        if !state_path.exists() {
            manager.persist_state()?;
        }
        Ok(manager)
    }

    pub fn list_profiles(&self) -> Result<Vec<ProfileSummary>, AppError> {
        let mut profiles = Vec::new();

        if !self.profiles_dir().exists() {
            return Ok(profiles);
        }

        for entry in fs::read_dir(self.profiles_dir())? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }

            let meta_path = entry.path().join("meta.json");
            if !meta_path.exists() {
                continue;
            }

            let metadata =
                serde_json::from_str::<ProfileMetadata>(&fs::read_to_string(meta_path)?)?;
            profiles.push(ProfileSummary::from(metadata));
        }

        profiles.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        Ok(profiles)
    }

    pub fn list_model_providers(&self) -> Result<Vec<ModelProviderRecord>, AppError> {
        self.read_model_provider_store()
    }

    pub fn migrate_legacy_third_party_profiles(
        &self,
    ) -> Result<LegacyThirdPartyMigrationResult, AppError> {
        let mut migrated_profile_ids = Vec::new();
        let mut skipped_profile_ids = Vec::new();

        if !self.profiles_dir().exists() {
            return Ok(LegacyThirdPartyMigrationResult {
                migrated_profile_ids,
                skipped_profile_ids,
            });
        }

        for entry in fs::read_dir(self.profiles_dir())? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }

            let profile_dir = entry.path();
            let meta_path = profile_dir.join("meta.json");
            let auth_path = profile_dir.join("auth.json");
            let config_path = profile_dir.join("config.toml");
            if !meta_path.exists() || !auth_path.exists() || !config_path.exists() {
                continue;
            }

            let metadata = self.read_profile_metadata(&profile_dir)?;
            let auth_json = fs::read_to_string(&auth_path)?;
            let config_toml = fs::read_to_string(&config_path)?;
            let Some(migrated_config) =
                migrate_legacy_third_party_config_toml(&auth_json, &config_toml)?
            else {
                skipped_profile_ids.push(metadata.id);
                continue;
            };

            let normalized_config = normalize_config_toml_for_auth(&auth_json, &migrated_config)?;
            fs::write(&config_path, &normalized_config)?;
            self.register_model_provider_from_profile(
                &auth_json,
                &normalized_config,
                &metadata.name,
            )?;

            let next_metadata = self.compose_profile_metadata(
                metadata.id.clone(),
                metadata.name,
                metadata.notes,
                metadata.remote_profile_id.clone(),
                metadata.created_at,
                Utc::now(),
                &auth_json,
                &normalized_config,
                None,
                None,
                None,
            )?;
            self.write_profile_metadata(&profile_dir, &next_metadata)?;
            migrated_profile_ids.push(metadata.id);
        }

        migrated_profile_ids.sort();
        skipped_profile_ids.sort();
        Ok(LegacyThirdPartyMigrationResult {
            migrated_profile_ids,
            skipped_profile_ids,
        })
    }

    pub fn write_third_party_websockets_defaults(
        &self,
    ) -> Result<ThirdPartyWebsocketsDefaultResult, AppError> {
        let mut updated_profile_ids = Vec::new();
        let mut skipped_profile_ids = Vec::new();

        if !self.profiles_dir().exists() {
            return Ok(ThirdPartyWebsocketsDefaultResult {
                updated_profile_ids,
                skipped_profile_ids,
            });
        }

        for entry in fs::read_dir(self.profiles_dir())? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }

            let profile_dir = entry.path();
            let meta_path = profile_dir.join("meta.json");
            let auth_path = profile_dir.join("auth.json");
            let config_path = profile_dir.join("config.toml");
            if !meta_path.exists() || !auth_path.exists() || !config_path.exists() {
                continue;
            }

            let metadata = self.read_profile_metadata(&profile_dir)?;
            let auth_json = fs::read_to_string(&auth_path)?;
            let config_toml = fs::read_to_string(&config_path)?;
            let config_table = parse_toml_table(&repair_illegal_config_toml(&config_toml))?;
            if !third_party_websockets_default_target(&auth_json, &config_table)? {
                skipped_profile_ids.push(metadata.id);
                continue;
            }

            let normalized_config = normalize_config_toml_for_auth(
                &auth_json,
                &repair_illegal_config_toml(&config_toml),
            )?;
            if normalized_config == config_toml {
                skipped_profile_ids.push(metadata.id);
                continue;
            }

            fs::write(&config_path, &normalized_config)?;
            self.register_model_provider_from_profile(
                &auth_json,
                &normalized_config,
                &metadata.name,
            )?;

            let next_metadata = self.compose_profile_metadata(
                metadata.id.clone(),
                metadata.name.clone(),
                metadata.notes.clone(),
                metadata.remote_profile_id.clone(),
                metadata.created_at,
                Utc::now(),
                &auth_json,
                &normalized_config,
                metadata.codex_usage.clone(),
                None,
                None,
            )?;
            self.write_profile_metadata(&profile_dir, &next_metadata)?;
            updated_profile_ids.push(metadata.id);
        }

        updated_profile_ids.sort();
        skipped_profile_ids.sort();
        Ok(ThirdPartyWebsocketsDefaultResult {
            updated_profile_ids,
            skipped_profile_ids,
        })
    }

    pub fn import_profile(&self, input: ProfileInput) -> Result<ProfileSummary, AppError> {
        let name = input.name.trim();
        if name.is_empty() {
            return Err(AppError::Message("Profile name cannot be empty.".into()));
        }

        validate_auth_json(&input.auth_json)?;
        let normalized_config = normalize_config_toml_for_auth(
            &input.auth_json,
            &repair_illegal_config_toml(&input.config_toml),
        )?;
        validate_config_toml(&normalized_config)?;

        let now = Utc::now();
        let profile_id = Uuid::new_v4().to_string();
        let profile_dir = self.profiles_dir().join(&profile_id);
        fs::create_dir_all(&profile_dir)?;

        fs::write(profile_dir.join("auth.json"), input.auth_json)?;
        fs::write(profile_dir.join("config.toml"), &normalized_config)?;
        self.register_model_provider_from_profile(
            &fs::read_to_string(profile_dir.join("auth.json"))?,
            &fs::read_to_string(profile_dir.join("config.toml"))?,
            name,
        )?;

        let metadata = self.compose_profile_metadata(
            profile_id,
            name.to_string(),
            input.notes.trim().to_string(),
            None,
            now,
            now,
            &fs::read_to_string(profile_dir.join("auth.json"))?,
            &fs::read_to_string(profile_dir.join("config.toml"))?,
            None,
            None,
            None,
        )?;

        self.write_profile_metadata(&profile_dir, &metadata)?;

        Ok(ProfileSummary::from(metadata))
    }

    pub fn import_profile_from_target_dir(
        &self,
        name: String,
        notes: String,
    ) -> Result<ProfileSummary, AppError> {
        if !self.target_auth_path().exists() || !self.target_config_path().exists() {
            return Err(AppError::Message(
                "The target Codex directory does not contain both auth.json and config.toml."
                    .into(),
            ));
        }

        let auth_json = fs::read_to_string(self.target_auth_path())?;
        let config_toml = fs::read_to_string(self.target_config_path())?;

        self.import_profile(ProfileInput {
            name,
            notes,
            auth_json,
            config_toml,
        })
    }

    pub fn get_target_profile_input(&self) -> Result<ProfileInput, AppError> {
        if !self.target_auth_path().exists() || !self.target_config_path().exists() {
            return Err(AppError::Message(
                "The target Codex directory does not contain both auth.json and config.toml."
                    .into(),
            ));
        }

        Ok(ProfileInput {
            name: String::new(),
            notes: String::new(),
            auth_json: fs::read_to_string(self.target_auth_path())?,
            config_toml: fs::read_to_string(self.target_config_path())?,
        })
    }

    pub fn get_profile_document(&self, profile_id: &str) -> Result<ProfileDocument, AppError> {
        let profile_dir = self.profile_dir(profile_id)?;
        let metadata = self.read_profile_metadata(&profile_dir)?;
        let saved_auth_json = fs::read_to_string(profile_dir.join("auth.json"))?;
        let saved_config_toml = fs::read_to_string(profile_dir.join("config.toml"))?;
        let active_profile_id = self.detect_active_profile()?.map(|profile| profile.id);

        let (auth_json, config_toml, loaded_from_target, has_target_changes) =
            if active_profile_id.as_deref() == Some(profile_id)
                && self.target_auth_path().exists()
                && self.target_config_path().exists()
            {
                let target_auth_json = fs::read_to_string(self.target_auth_path())?;
                let target_config_toml = fs::read_to_string(self.target_config_path())?;
                let has_target_changes =
                    target_auth_json != saved_auth_json || target_config_toml != saved_config_toml;

                (
                    target_auth_json,
                    target_config_toml,
                    true,
                    has_target_changes,
                )
            } else {
                (saved_auth_json, saved_config_toml, false, false)
            };

        Ok(ProfileDocument {
            id: metadata.id,
            name: metadata.name,
            notes: metadata.notes,
            auth_type_label: metadata.auth_type_label,
            model_provider_id: metadata.model_provider_id,
            model_provider_api_key_id: metadata.model_provider_api_key_id,
            model_provider_key: metadata.model_provider_key,
            model_provider_name: metadata.model_provider_name,
            model_provider_base_url: metadata.model_provider_base_url,
            model_provider_wire_api: metadata.model_provider_wire_api,
            created_at: metadata.created_at,
            updated_at: metadata.updated_at,
            auth_json,
            config_toml,
            loaded_from_target,
            has_target_changes,
        })
    }

    pub fn update_profile(
        &self,
        profile_id: &str,
        input: ProfileInput,
    ) -> Result<ProfileSummary, AppError> {
        let name = input.name.trim();
        if name.is_empty() {
            return Err(AppError::Message("Profile name cannot be empty.".into()));
        }

        validate_auth_json(&input.auth_json)?;
        let normalized_config = normalize_config_toml_for_auth(
            &input.auth_json,
            &repair_illegal_config_toml(&input.config_toml),
        )?;
        validate_config_toml(&normalized_config)?;

        let profile_dir = self.profile_dir(profile_id)?;
        let existing_metadata = self.read_profile_metadata(&profile_dir)?;
        let is_active_profile = self
            .detect_active_profile()?
            .is_some_and(|profile| profile.id == profile_id);
        let next_auth_hash = auth_match_hash(&input.auth_json)?;
        let next_config_hash = managed_config_hash(&input.auth_json, &normalized_config)?;
        let preserved_codex_usage = if existing_metadata.auth_hash == next_auth_hash {
            existing_metadata.codex_usage.clone()
        } else {
            None
        };
        let preserved_third_party_latency = if existing_metadata.auth_hash == next_auth_hash
            && existing_metadata.config_hash == next_config_hash
        {
            existing_metadata.third_party_latency.clone()
        } else {
            None
        };
        let preserved_third_party_usage = if existing_metadata.auth_hash == next_auth_hash
            && existing_metadata.config_hash == next_config_hash
        {
            existing_metadata.third_party_usage.clone()
        } else {
            None
        };

        fs::write(profile_dir.join("auth.json"), &input.auth_json)?;
        fs::write(profile_dir.join("config.toml"), &normalized_config)?;
        self.register_model_provider_from_profile(&input.auth_json, &normalized_config, name)?;

        let metadata = self.compose_profile_metadata(
            existing_metadata.id,
            name.to_string(),
            input.notes.trim().to_string(),
            existing_metadata.remote_profile_id.clone(),
            existing_metadata.created_at,
            Utc::now(),
            &fs::read_to_string(profile_dir.join("auth.json"))?,
            &fs::read_to_string(profile_dir.join("config.toml"))?,
            preserved_codex_usage,
            preserved_third_party_latency,
            preserved_third_party_usage,
        )?;

        self.write_profile_metadata(&profile_dir, &metadata)?;
        if is_active_profile {
            fs::create_dir_all(&self.target_dir)?;
            fs::write(self.target_auth_path(), &input.auth_json)?;
            fs::write(self.target_config_path(), &normalized_config)?;
            self.persist_target_marker(TargetMarkerFile {
                profile_id: metadata.id.clone(),
                auth_hash: metadata.auth_hash.clone(),
                config_hash: metadata.config_hash.clone(),
                updated_at: Utc::now(),
            })?;
        }
        Ok(ProfileSummary::from(metadata))
    }

    pub fn resolve_profile_selector(&self, selector: &str) -> Result<ProfileSummary, AppError> {
        let selector = selector.trim();
        if selector.is_empty() {
            return Err(AppError::Message(
                "Profile selector cannot be empty.".into(),
            ));
        }

        if let Some(profile) = self.load_profile_summary(selector)? {
            return Ok(profile);
        }

        let matches = self
            .list_profiles()?
            .into_iter()
            .filter(|profile| profile.name == selector)
            .collect::<Vec<_>>();

        match matches.as_slice() {
            [profile] => Ok(profile.clone()),
            [] => Err(AppError::ProfileNotFound(selector.to_string())),
            _ => Err(AppError::Message(format!(
                "Multiple profiles matched `{selector}`. Use the profile id instead."
            ))),
        }
    }

    pub fn sync_remote_profiles(&self, profiles_url: &str) -> Result<RemoteSyncResult, AppError> {
        let profiles_url = normalize_remote_profiles_url(profiles_url);
        let remote_profiles = fetch_remote_profile_index(&profiles_url)?;
        let mut synced_profiles = Vec::new();
        let mut imported = 0;
        let mut updated = 0;

        for remote_profile in remote_profiles {
            let detail_url = format!("{profiles_url}/{}", remote_profile.id);
            let detail = fetch_remote_profile_detail(&detail_url)?;

            if !detail.files.iter().any(|file| file == "auth.json")
                || !detail.files.iter().any(|file| file == "config.toml")
            {
                continue;
            }

            let auth_json = fetch_remote_text_file(&format!("{detail_url}/auth.json"))?;
            let config_toml = fetch_remote_text_file(&format!("{detail_url}/config.toml"))?;

            let payload = ProfileInput {
                name: detail.name.clone(),
                notes: detail.description.clone(),
                auth_json,
                config_toml,
            };

            let profile =
                if let Some(existing) = self.find_profile_metadata_by_remote_id(&detail.id)? {
                    updated += 1;
                    self.update_profile(&existing.id, payload)?
                } else {
                    imported += 1;
                    self.import_remote_profile(&detail.id, payload)?
                };

            synced_profiles.push(profile);
        }

        Ok(RemoteSyncResult {
            synced: synced_profiles.len(),
            imported,
            updated,
            profiles: synced_profiles,
        })
    }

    pub fn delete_profile(&mut self, profile_id: &str) -> Result<(), AppError> {
        let profile_dir = self.profiles_dir().join(profile_id);
        if !profile_dir.exists() {
            return Err(AppError::ProfileNotFound(profile_id.to_string()));
        }

        fs::remove_dir_all(profile_dir)?;

        if self.state.last_selected_profile_id.as_deref() == Some(profile_id) {
            self.state.last_selected_profile_id = None;
        }
        if self.state.last_switch_profile_id.as_deref() == Some(profile_id) {
            self.state.last_switch_profile_id = None;
        }
        if self
            .read_target_marker()?
            .is_some_and(|marker| marker.profile_id == profile_id)
        {
            self.clear_target_marker()?;
        }

        self.persist_state()?;
        Ok(())
    }

    pub fn fix_session_database_and_configs(&self) -> Result<(), AppError> {
        let target_dir = self.target_dir.clone();
        let active_provider = self.repair_configs_and_resolve_session_provider()?;
        self.repair_workspace_project_order(&target_dir);
        let _ = self.repair_session_model_provider_for_switch(&active_provider)?;

        Ok(())
    }

    pub fn diagnose_codex_sessions(&self) -> Result<SessionRecoveryReport, AppError> {
        self.build_session_recovery_report(true)?.ok_or_else(|| {
            AppError::Message(
                "The target Codex directory does not contain readable session state.".into(),
            )
        })
    }

    pub fn repair_codex_sessions(
        &self,
        repair_times_from_session_index: bool,
    ) -> Result<SessionRepairResult, AppError> {
        self.repair_codex_sessions_internal(repair_times_from_session_index, true)?
            .ok_or_else(|| {
                AppError::Message(
                    "The target Codex directory does not contain repairable session state.".into(),
                )
            })
    }

    pub fn refresh_codex_usage_stats(&self) -> Result<CodexUsageStatsSnapshot, AppError> {
        self.refresh_codex_usage_stats_with_filter(CodexUsageStatsFilter::default())
    }

    pub fn refresh_codex_usage_stats_with_filter(
        &self,
        filter: CodexUsageStatsFilter,
    ) -> Result<CodexUsageStatsSnapshot, AppError> {
        let conn = self.open_usage_stats_connection()?;
        let mut sync = CodexUsageStatsSyncResult::default();
        let mut session_files = collect_codex_session_log_files(&self.target_dir);
        session_files.sort();
        sync.files_scanned = session_files.len() as i64;

        for session_path in session_files {
            match import_codex_usage_file(&conn, &session_path) {
                Ok(file_sync) => {
                    sync.imported += file_sync.imported;
                    sync.skipped += file_sync.skipped;
                    sync.errors.extend(file_sync.errors);
                }
                Err(error) => sync
                    .errors
                    .push(format!("{}: {error}", session_path.to_string_lossy())),
            }
        }

        if let Err(error) = backfill_zero_costs(&conn) {
            sync.errors.push(format!("Failed to backfill usage costs: {error}"));
        }

        self.read_codex_usage_stats_snapshot(&conn, sync, filter)
    }

    pub fn list_codex_sessions(&self) -> Result<Vec<CodexSessionInfo>, AppError> {
        let Some(db_path) = primary_state_database_path(&self.target_dir) else {
            return Ok(Vec::new());
        };
        let conn = match open_valid_state_database(&db_path) {
            Some(c) => c,
            None => return Ok(Vec::new()),
        };
        let threads = read_session_recovery_threads(&conn).map_err(|error| {
            AppError::Message(format!(
                "Failed to read threads from session database: {error}"
            ))
        })?;

        let num_items = threads.len();
        let mut list = Vec::with_capacity(num_items);

        if num_items > 0 {
            let num_workers = std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4)
                .min(num_items);

            let mut file_sizes = vec![None; num_items];

            std::thread::scope(|s| {
                let chunk_size = (num_items + num_workers - 1) / num_workers;
                let t_chunks = threads.chunks(chunk_size);
                let s_chunks = file_sizes.chunks_mut(chunk_size);

                for (t_chunk, s_chunk) in t_chunks.zip(s_chunks) {
                    s.spawn(move || {
                        for (t, s_val) in t_chunk.iter().zip(s_chunk.iter_mut()) {
                            if let Some(ref p) = t.rollout_path {
                                if let Ok(m) = fs::metadata(p) {
                                    *s_val = Some(m.len());
                                }
                            }
                        }
                    });
                }
            });

            for (t, file_size) in threads.into_iter().zip(file_sizes.into_iter()) {
                list.push(CodexSessionInfo {
                    id: t.id,
                    rollout_path: t.rollout_path.map(|p| p.to_string_lossy().to_string()),
                    updated_at_ms: t.updated_at_ms,
                    cwd: t.cwd,
                    title: t.title,
                    has_user_event: t.has_user_event,
                    archived: t.archived,
                    model_provider: t.model_provider,
                    file_size,
                });
            }
        }

        Ok(list)
    }

    pub fn get_codex_session_messages(
        &self,
        thread_id: &str,
    ) -> Result<Vec<CodexMessage>, AppError> {
        let Some(db_path) = primary_state_database_path(&self.target_dir) else {
            return Err(AppError::Message("No session database found.".into()));
        };
        let conn = open_valid_state_database(&db_path)
            .ok_or_else(|| AppError::Message("Invalid state database.".into()))?;

        let mut stmt = conn.prepare("SELECT rollout_path FROM threads WHERE id = ?1")?;
        let rollout_path_str: Option<String> = match stmt.query_row([thread_id], |row| row.get(0)) {
            Ok(val) => val,
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => {
                return Err(AppError::Message(format!(
                    "Failed to query thread rollout path: {e}"
                )))
            }
        };

        let Some(path_str) = rollout_path_str else {
            return Err(AppError::Message(format!(
                "No rollout path stored for thread {thread_id}"
            )));
        };

        let path = PathBuf::from(&path_str);
        if !path.exists() {
            return Err(AppError::Message(format!(
                "Rollout file does not exist at {path_str}"
            )));
        }

        let file = fs::File::open(path)?;
        let mut messages = Vec::new();

        for line in BufReader::new(file).lines().map_while(Result::ok) {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
                continue;
            };

            let payload = value.get("payload");
            let target_obj = if let Some(p) = payload {
                if p.is_object() {
                    p
                } else {
                    &value
                }
            } else {
                &value
            };

            let event_type = target_obj.get("type").and_then(|v| v.as_str());
            let role = target_obj.get("role").and_then(|v| v.as_str());

            if event_type == Some("message") || (event_type.is_none() && role.is_some()) {
                if let Some(r) = role {
                    let text = target_obj
                        .get("content")
                        .map(extract_message_text)
                        .unwrap_or_default();
                    if !text.is_empty() {
                        messages.push(CodexMessage {
                            role: r.to_string(),
                            text,
                        });
                    }
                }
            } else if event_type == Some("user_message") {
                let text = target_obj
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                if !text.is_empty() {
                    messages.push(CodexMessage {
                        role: "user".to_string(),
                        text,
                    });
                }
            } else if event_type == Some("agent_message") {
                let text = target_obj
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                if !text.is_empty() {
                    messages.push(CodexMessage {
                        role: "assistant".to_string(),
                        text,
                    });
                }
            } else if event_type == Some("thought") || event_type == Some("reasoning") {
                let text = if let Some(summary_val) = target_obj.get("summary") {
                    let extracted = extract_message_text(summary_val);
                    if !extracted.is_empty() {
                        extracted
                    } else {
                        target_obj
                            .get("text")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .to_string()
                    }
                } else {
                    target_obj
                        .get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string()
                };
                if !text.is_empty() {
                    messages.push(CodexMessage {
                        role: "thought".to_string(),
                        text,
                    });
                }
            } else if event_type == Some("call") || event_type == Some("function_call") {
                let name = target_obj.get("name").and_then(|v| v.as_str()).unwrap_or_default();
                let args = target_obj
                    .get("arguments")
                    .map(|v| {
                        if v.is_string() {
                            v.as_str().unwrap().to_string()
                        } else {
                            serde_json::to_string_pretty(v).unwrap_or_default()
                        }
                    })
                    .unwrap_or_default();
                let text = if args.is_empty() {
                    format!("🔧 调用工具: {name}")
                } else {
                    format!("🔧 调用工具: {name}\n参数:\n{args}")
                };
                messages.push(CodexMessage {
                    role: "call".to_string(),
                    text,
                });
            } else if event_type == Some("response") || event_type == Some("function_call_output") {
                let text = target_obj
                    .get("output")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                if !text.is_empty() {
                    messages.push(CodexMessage {
                        role: "response".to_string(),
                        text,
                    });
                }
            } else if event_type == Some("system") {
                let text = target_obj
                    .get("text")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                if !text.is_empty() {
                    messages.push(CodexMessage {
                        role: "system".to_string(),
                        text,
                    });
                }
            }
        }
        Ok(messages)
    }

    pub fn archive_codex_session(&self, thread_id: &str, archive: bool) -> Result<(), AppError> {
        let Some(db_path) = primary_state_database_path(&self.target_dir) else {
            return Err(AppError::Message("No session database found.".into()));
        };
        let conn = open_valid_state_database(&db_path)
            .ok_or_else(|| AppError::Message("Invalid state database.".into()))?;

        // Query current state
        let mut stmt = conn.prepare("SELECT rollout_path, archived FROM threads WHERE id = ?1")?;
        let result: Option<(Option<String>, i64)> = match stmt.query_row([thread_id], |row| {
            Ok((row.get::<_, Option<String>>(0)?, row.get::<_, i64>(1)?))
        }) {
            Ok(val) => Some(val),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(AppError::Message(format!("Failed to query thread: {e}"))),
        };

        let Some((rollout_path_str, current_archived_int)) = result else {
            return Err(AppError::ProfileNotFound(thread_id.to_string())); // thread not found
        };

        let current_archived = current_archived_int == 1;
        if current_archived == archive {
            return Ok(()); // Already in desired state
        }

        let mut next_rollout_path_str = rollout_path_str.clone();

        // Handle file move if rollout_path is present and exists
        if let Some(src_path_str) = rollout_path_str {
            let src_path = PathBuf::from(&src_path_str);
            if src_path.exists() {
                let filename = src_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                let target_path = if archive {
                    // Archive: move to archived_sessions/
                    let dest_dir = self.target_dir.join("archived_sessions");
                    fs::create_dir_all(&dest_dir)?;
                    dest_dir.join(filename)
                } else {
                    // Unarchive: move to sessions/YYYY/MM/DD/
                    let (year, month, day) =
                        parse_rollout_date_parts(filename).unwrap_or(("2026", "01", "01"));
                    let dest_dir = self
                        .target_dir
                        .join("sessions")
                        .join(year)
                        .join(month)
                        .join(day);
                    fs::create_dir_all(&dest_dir)?;
                    dest_dir.join(filename)
                };

                // Move file
                fs::rename(&src_path, &target_path)?;
                next_rollout_path_str = Some(target_path.to_string_lossy().to_string());
            }
        }

        // Update database
        let archive_val = if archive { 1 } else { 0 };
        conn.execute(
            "UPDATE threads SET archived = ?1, rollout_path = ?2 WHERE id = ?3",
            rusqlite::params![archive_val, next_rollout_path_str, thread_id],
        )
        .map_err(|e| AppError::Message(format!("Failed to update thread archive state: {e}")))?;

        Ok(())
    }

    pub fn delete_codex_session(&self, thread_id: &str) -> Result<(), AppError> {
        let Some(db_path) = primary_state_database_path(&self.target_dir) else {
            return Err(AppError::Message("No session database found.".into()));
        };
        let conn = open_valid_state_database(&db_path)
            .ok_or_else(|| AppError::Message("Invalid state database.".into()))?;

        // Query rollout path first
        let mut stmt = conn.prepare("SELECT rollout_path FROM threads WHERE id = ?1")?;
        let rollout_path_str: Option<String> = match stmt.query_row([thread_id], |row| row.get(0)) {
            Ok(val) => val,
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => {
                return Err(AppError::Message(format!(
                    "Failed to query thread rollout path: {e}"
                )))
            }
        };

        // Delete from database
        conn.execute("DELETE FROM threads WHERE id = ?1", [thread_id])
            .map_err(|e| {
                AppError::Message(format!("Failed to delete thread from database: {e}"))
            })?;

        // Delete rollout file
        if let Some(path_str) = rollout_path_str {
            let path = PathBuf::from(&path_str);
            if path.exists() {
                let _ = fs::remove_file(&path);
            }
        }

        Ok(())
    }

    pub fn rename_codex_session(&self, thread_id: &str, new_title: &str) -> Result<(), AppError> {
        let Some(db_path) = primary_state_database_path(&self.target_dir) else {
            return Err(AppError::Message("No session database found.".into()));
        };
        let conn = open_valid_state_database(&db_path)
            .ok_or_else(|| AppError::Message("Invalid state database.".into()))?;

        // Update database
        conn.execute(
            "UPDATE threads SET title = ?1 WHERE id = ?2",
            rusqlite::params![new_title, thread_id],
        )
        .map_err(|e| {
            AppError::Message(format!("Failed to update thread title in database: {e}"))
        })?;

        // Update session_index.jsonl
        let session_index_path = self.target_dir.join("session_index.jsonl");
        if session_index_path.exists() {
            let _ = update_session_index_title(&session_index_path, thread_id, new_title);
        }

        Ok(())
    }

    fn repair_configs_and_resolve_session_provider(&self) -> Result<String, AppError> {
        let target_config = self.target_dir.join("config.toml");
        let target_auth = self.target_dir.join("auth.json");
        let mut session_provider = "openai".to_string();

        if target_config.exists() {
            if let Ok(content) = fs::read_to_string(&target_config) {
                let repaired = if target_auth.exists() {
                    match fs::read_to_string(&target_auth) {
                        Ok(auth_json) => normalize_config_toml_for_auth(
                            &auth_json,
                            &repair_illegal_config_toml(&content),
                        )
                        .unwrap_or_else(|_| repair_illegal_config_toml(&content)),
                        Err(_) => repair_illegal_config_toml(&content),
                    }
                } else {
                    repair_illegal_config_toml(&content)
                };
                if repaired != content {
                    let _ = fs::write(&target_config, &repaired);
                }

                session_provider = session_model_provider_key_from_config_toml(&repaired)?;
            }
        }

        let profiles_dir = self.profiles_dir();
        if profiles_dir.exists() {
            if let Ok(entries) = fs::read_dir(profiles_dir) {
                for entry in entries.flatten() {
                    let config_path = entry.path().join("config.toml");
                    let auth_path = entry.path().join("auth.json");
                    if config_path.exists() {
                        if let Ok(content) = fs::read_to_string(&config_path) {
                            let repaired = if auth_path.exists() {
                                match fs::read_to_string(&auth_path) {
                                    Ok(auth_json) => normalize_config_toml_for_auth(
                                        &auth_json,
                                        &repair_illegal_config_toml(&content),
                                    )
                                    .unwrap_or_else(|_| repair_illegal_config_toml(&content)),
                                    Err(_) => repair_illegal_config_toml(&content),
                                }
                            } else {
                                repair_illegal_config_toml(&content)
                            };
                            if repaired != content {
                                let _ = fs::write(&config_path, &repaired);
                            }
                        }
                    }
                }
            }
        }

        Ok(session_provider)
    }

    fn build_session_recovery_report(
        &self,
        strict: bool,
    ) -> Result<Option<SessionRecoveryReport>, AppError> {
        let Some(db_path) = primary_state_database_path(&self.target_dir) else {
            if strict {
                return Err(AppError::Message(
                    "No readable state_*.sqlite database was found in the target Codex directory."
                        .into(),
                ));
            }
            return Ok(None);
        };
        let session_index_path = self.target_dir.join("session_index.jsonl");
        if !session_index_path.exists() {
            if strict {
                return Err(AppError::Message(
                    "session_index.jsonl was not found in the target Codex directory.".into(),
                ));
            }
            return Ok(None);
        }

        let Some(conn) = open_valid_state_database(&db_path) else {
            if strict {
                return Err(AppError::Message(
                    "The primary session database is invalid or unreadable.".into(),
                ));
            }
            return Ok(None);
        };
        let session_index = read_session_recovery_index_entries(&session_index_path)?;
        let threads = match read_session_recovery_threads(&conn) {
            Ok(threads) => threads,
            Err(error) => {
                if strict {
                    return Err(AppError::Message(format!(
                        "Failed to inspect the session database: {error}"
                    )));
                }
                return Ok(None);
            }
        };
        let sqlite_integrity = match sqlite_integrity_check(&conn) {
            Ok(value) => value,
            Err(error) => {
                if strict {
                    return Err(AppError::Message(format!(
                        "Failed to run SQLite integrity_check: {error}"
                    )));
                }
                return Ok(None);
            }
        };

        Ok(Some(assemble_session_recovery_report(
            &self.target_dir,
            &db_path,
            &session_index_path,
            session_index,
            threads,
            sqlite_integrity,
            SESSION_RECOVERY_RECENT_LIMIT,
        )?))
    }

    fn repair_codex_sessions_internal(
        &self,
        repair_times_from_session_index: bool,
        strict: bool,
    ) -> Result<Option<SessionRepairResult>, AppError> {
        let Some(report) = self.build_session_recovery_report(strict)? else {
            return Ok(None);
        };
        if report.sqlite_integrity != "ok" {
            if strict {
                return Err(AppError::Message(format!(
                    "Refusing to repair because SQLite integrity_check returned: {}",
                    report.sqlite_integrity
                )));
            }
            return Ok(None);
        }

        let has_safe_updates = report
            .repair_candidates
            .has_user_event_false_but_rollout_has_user_message
            > 0;
        let has_time_updates = repair_times_from_session_index
            && (report.repair_candidates.db_time_mismatch_with_session_index > 0
                || report
                    .repair_candidates
                    .rollout_mtime_mismatch_with_session_index
                    > 0);
        if !has_safe_updates && !has_time_updates {
            return Ok(Some(SessionRepairResult {
                repaired: false,
                backup_path: String::new(),
                audit_path: String::new(),
                updates: SessionRepairUpdateCounts::default(),
                note: if repair_times_from_session_index {
                    "No session repair candidates were found, including timestamp repair candidates.".into()
                } else {
                    "No safe session repair candidates were found.".into()
                },
            }));
        }

        let db_path = PathBuf::from(&report.db_path);
        let session_index_path = PathBuf::from(&report.session_index_path);
        let session_index = read_session_recovery_index_entries(&session_index_path)?;
        let mut conn = open_valid_state_database(&db_path).ok_or_else(|| {
            AppError::Message(
                "The primary session database became unreadable during repair.".into(),
            )
        })?;
        let threads = read_session_recovery_threads(&conn).map_err(|error| {
            AppError::Message(format!("Failed to read session threads: {error}"))
        })?;

        let stamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
        let temp_dir = std::env::temp_dir();
        let backup_path = temp_dir.join(format!(
            "codex-state-before-session-recovery-{}-{}.sqlite",
            stamp,
            Uuid::new_v4().simple()
        ));
        let audit_path = temp_dir.join(format!(
            "codex-session-recovery-audit-{}-{}.json",
            stamp,
            Uuid::new_v4().simple()
        ));
        fs::copy(&db_path, &backup_path)?;

        let mut audit = SessionRepairAudit {
            backup_path: backup_path.to_string_lossy().to_string(),
            audit_path: audit_path.to_string_lossy().to_string(),
            ..SessionRepairAudit::default()
        };

        {
            let transaction = conn.transaction().map_err(|error| {
                AppError::Message(format!("Failed to open a repair transaction: {error}"))
            })?;
            for thread in threads {
                let Some(rollout_path) = thread.rollout_path.clone() else {
                    audit
                        .skipped_missing_rollout_files
                        .push(MissingRolloutSample {
                            id: thread.id.clone(),
                            archived: thread.archived,
                            rollout_path: None,
                        });
                    continue;
                };
                if !rollout_path.exists() {
                    audit
                        .skipped_missing_rollout_files
                        .push(MissingRolloutSample {
                            id: thread.id.clone(),
                            archived: thread.archived,
                            rollout_path: Some(rollout_path.to_string_lossy().to_string()),
                        });
                    continue;
                }

                if !thread.has_user_event && rollout_has_user_message(&rollout_path) {
                    transaction
                        .execute(
                            "UPDATE threads SET has_user_event = 1 WHERE id = ?1",
                            [&thread.id],
                        )
                        .map_err(|error| {
                            AppError::Message(format!(
                                "Failed to update has_user_event for thread {}: {error}",
                                thread.id
                            ))
                        })?;
                    audit
                        .has_user_event_updates
                        .push(HasUserEventMismatchSample {
                            id: thread.id.clone(),
                            archived: thread.archived,
                            cwd: thread.cwd.clone(),
                            title: thread.title.clone(),
                        });
                }

                let Some(indexed) = session_index.get(&thread.id) else {
                    continue;
                };
                let db_time_differs =
                    thread.updated_at != indexed.sec || thread.updated_at_ms != indexed.ms;
                let rollout_mtime_ms = file_mtime_millis(&rollout_path)?;
                let mtime_differs = (rollout_mtime_ms - indexed.ms).abs() > 1_000;

                if !repair_times_from_session_index && (db_time_differs || mtime_differs) {
                    audit
                        .time_mismatches_not_repaired
                        .push(SessionTimeMismatchSample {
                            id: thread.id.clone(),
                            cwd: thread.cwd.clone(),
                            db_updated_at_ms: thread.updated_at_ms,
                            indexed_updated_at_ms: indexed.ms,
                        });
                    continue;
                }

                if repair_times_from_session_index && db_time_differs {
                    transaction
                        .execute(
                            "UPDATE threads SET updated_at = ?1, updated_at_ms = ?2 WHERE id = ?3",
                            rusqlite::params![indexed.sec, indexed.ms, &thread.id],
                        )
                        .map_err(|error| {
                            AppError::Message(format!(
                                "Failed to update timestamps for thread {}: {error}",
                                thread.id
                            ))
                        })?;
                    audit.db_time_updates.push(SessionTimeMismatchSample {
                        id: thread.id.clone(),
                        cwd: thread.cwd.clone(),
                        db_updated_at_ms: thread.updated_at_ms,
                        indexed_updated_at_ms: indexed.ms,
                    });
                }

                if repair_times_from_session_index && mtime_differs {
                    set_rollout_mtime_millis(&rollout_path, indexed.ms)?;
                    audit
                        .rollout_mtime_updates
                        .push(RolloutMtimeMismatchSample {
                            id: thread.id.clone(),
                            rollout_path: rollout_path.to_string_lossy().to_string(),
                            rollout_mtime_ms,
                            indexed_updated_at_ms: indexed.ms,
                        });
                }
            }
            transaction.commit().map_err(|error| {
                AppError::Message(format!(
                    "Failed to commit session repair transaction: {error}"
                ))
            })?;
        }

        let post_integrity = sqlite_integrity_check(&conn).map_err(|error| {
            AppError::Message(format!("Failed to verify SQLite integrity: {error}"))
        })?;
        if post_integrity != "ok" {
            return Err(AppError::Message(format!(
                "SQLite integrity_check failed after repair: {post_integrity}"
            )));
        }

        fs::write(&audit_path, serde_json::to_string_pretty(&audit)?)?;

        Ok(Some(SessionRepairResult {
            repaired: true,
            backup_path: backup_path.to_string_lossy().to_string(),
            audit_path: audit_path.to_string_lossy().to_string(),
            updates: SessionRepairUpdateCounts {
                has_user_event: audit.has_user_event_updates.len(),
                db_time: audit.db_time_updates.len(),
                rollout_mtime: audit.rollout_mtime_updates.len(),
                time_mismatches_not_repaired: audit.time_mismatches_not_repaired.len(),
                skipped_missing_rollout_files: audit.skipped_missing_rollout_files.len(),
            },
            note: if repair_times_from_session_index {
                "Timestamp repair was enabled.".into()
            } else {
                "Timestamp repair was not enabled. Use advanced repair only for broad batch timestamp corruption.".into()
            },
        }))
    }

    fn repair_session_model_provider_for_switch(
        &self,
        provider: &str,
    ) -> Result<Option<SessionProviderRepairAudit>, AppError> {
        let Some(db_path) = primary_state_database_path(&self.target_dir) else {
            return Ok(None);
        };
        let mut conn = match open_valid_state_database(&db_path) {
            Some(conn) => conn,
            None => return Ok(None),
        };
        if sqlite_integrity_check(&conn).map_err(|error| {
            AppError::Message(format!("Failed to run SQLite integrity_check: {error}"))
        })? != "ok"
        {
            return Ok(None);
        }

        let columns = thread_table_columns(&conn).map_err(|error| {
            AppError::Message(format!(
                "Failed to inspect session database schema: {error}"
            ))
        })?;
        let required_columns = [
            "id",
            "rollout_path",
            "model_provider",
            "archived",
            "has_user_event",
            "updated_at_ms",
        ];
        if required_columns
            .iter()
            .any(|required| !columns.iter().any(|column| column == required))
        {
            return Ok(None);
        }

        let candidates =
            read_session_provider_repair_candidates(&conn, provider).map_err(|error| {
                AppError::Message(format!(
                    "Failed to read provider repair candidates: {error}"
                ))
            })?;
        if candidates.is_empty() {
            return Ok(None);
        }

        let stamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
        let temp_dir = std::env::temp_dir();
        let db_backup_path = temp_dir.join(format!(
            "codex-state-before-provider-switch-{}-{}.sqlite",
            stamp,
            Uuid::new_v4().simple()
        ));
        let rollout_backup_dir = temp_dir.join(format!(
            "codex-rollouts-before-provider-switch-{}-{}",
            stamp,
            Uuid::new_v4().simple()
        ));
        fs::copy(&db_path, &db_backup_path)?;
        fs::create_dir_all(&rollout_backup_dir)?;

        let affected_ids = candidates
            .iter()
            .map(|candidate| candidate.id.clone())
            .collect::<HashSet<_>>();
        let mut audit = SessionProviderRepairAudit {
            db_backup_path: db_backup_path.to_string_lossy().to_string(),
            rollout_backup_dir: rollout_backup_dir.to_string_lossy().to_string(),
            provider: provider.to_string(),
            db_updates: Vec::new(),
            rollout_updates: Vec::new(),
            skipped_missing_rollout_files: Vec::new(),
            skipped_without_session_meta: Vec::new(),
        };

        for candidate in &candidates {
            let Some(rollout_path) = candidate.rollout_path.as_ref() else {
                audit
                    .skipped_missing_rollout_files
                    .push(MissingRolloutSample {
                        id: candidate.id.clone(),
                        archived: candidate.archived,
                        rollout_path: None,
                    });
                continue;
            };
            if !rollout_path.exists() {
                audit
                    .skipped_missing_rollout_files
                    .push(MissingRolloutSample {
                        id: candidate.id.clone(),
                        archived: candidate.archived,
                        rollout_path: Some(rollout_path.to_string_lossy().to_string()),
                    });
                continue;
            }

            let file_name = rollout_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("rollout.jsonl");
            let backup_path = rollout_backup_dir.join(format!("{}-{file_name}", candidate.id));
            let _ = fs::copy(rollout_path, backup_path)?;

            match update_rollout_session_meta_provider(rollout_path, &affected_ids, provider)? {
                true => audit
                    .rollout_updates
                    .push(rollout_path.to_string_lossy().to_string()),
                false => audit
                    .skipped_without_session_meta
                    .push(candidate.id.clone()),
            }
        }

        {
            let transaction = conn.transaction().map_err(|error| {
                AppError::Message(format!(
                    "Failed to open a provider repair transaction: {error}"
                ))
            })?;
            for candidate in &candidates {
                if audit
                    .skipped_missing_rollout_files
                    .iter()
                    .any(|missing| missing.id == candidate.id)
                {
                    continue;
                }
                transaction
                    .execute(
                        "UPDATE threads SET model_provider = ?1 WHERE id = ?2 AND archived = 0 AND has_user_event = 1",
                        rusqlite::params![provider, &candidate.id],
                    )
                    .map_err(|error| {
                        AppError::Message(format!(
                            "Failed to update model_provider for thread {}: {error}",
                            candidate.id
                        ))
                    })?;
                audit.db_updates.push(candidate.id.clone());
            }
            transaction.commit().map_err(|error| {
                AppError::Message(format!(
                    "Failed to commit provider repair transaction: {error}"
                ))
            })?;
        }

        let post_integrity = sqlite_integrity_check(&conn).map_err(|error| {
            AppError::Message(format!(
                "Failed to verify SQLite integrity after provider repair: {error}"
            ))
        })?;
        if post_integrity != "ok" {
            return Err(AppError::Message(format!(
                "SQLite integrity_check failed after provider repair: {post_integrity}"
            )));
        }

        let audit_path = temp_dir.join(format!(
            "codex-provider-switch-repair-audit-{}-{}.json",
            stamp,
            Uuid::new_v4().simple()
        ));
        fs::write(&audit_path, serde_json::to_string_pretty(&audit)?)?;

        Ok(Some(audit))
    }

    fn repair_workspace_project_order(&self, target_dir: &Path) {
        let path = target_dir.join(".codex-global-state.json");
        let Ok(content) = fs::read_to_string(&path) else {
            return;
        };
        let Ok(mut state) = serde_json::from_str::<serde_json::Value>(&content) else {
            return;
        };
        let Some(root) = state.as_object_mut() else {
            return;
        };

        let saved_roots = root
            .get("electron-saved-workspace-roots")
            .and_then(|value| value.as_array())
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|value| value.as_str())
                    .map(str::to_owned)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        if saved_roots.is_empty() {
            return;
        }

        let saved_roots_value = serde_json::Value::Array(
            saved_roots
                .iter()
                .cloned()
                .map(serde_json::Value::String)
                .collect(),
        );
        let saved_roots_changed = root
            .get("electron-saved-workspace-roots")
            .map(|value| value != &saved_roots_value)
            .unwrap_or(true);

        let order_value = root
            .entry("project-order".to_string())
            .or_insert_with(|| serde_json::Value::Array(Vec::new()));
        let Some(existing_order) = order_value.as_array() else {
            return;
        };

        let mut seen = HashSet::new();
        let mut repaired_order = Vec::new();

        for value in existing_order {
            let Some(path) = value.as_str() else {
                continue;
            };
            if seen.insert(path.to_string()) {
                repaired_order.push(serde_json::Value::String(path.to_string()));
            }
        }

        let mut changed = repaired_order.len() != existing_order.len();
        for path in &saved_roots {
            if seen.insert(path.clone()) {
                repaired_order.push(serde_json::Value::String(path.clone()));
                changed = true;
            }
        }

        let saved_root_set = saved_roots.iter().cloned().collect::<HashSet<_>>();
        let existing_active_roots = root
            .get("active-workspace-roots")
            .and_then(|value| value.as_array())
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|value| value.as_str())
                    .map(str::to_owned)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let mut active_seen = HashSet::new();
        let mut repaired_active_roots = Vec::new();
        for path in existing_active_roots {
            if !saved_root_set.contains(&path) {
                continue;
            }

            if active_seen.insert(path.clone()) {
                repaired_active_roots.push(path);
            }
        }

        // Once the saved project roster is repaired, the previously focused workspace root
        // can keep the Electron UI pinned to a stale single-project view.
        if changed && !repaired_active_roots.is_empty() {
            repaired_active_roots.clear();
        }

        let active_roots_value = serde_json::Value::Array(
            repaired_active_roots
                .iter()
                .cloned()
                .map(serde_json::Value::String)
                .collect(),
        );
        let active_roots_changed = root
            .get("active-workspace-roots")
            .map(|value| value != &active_roots_value)
            .unwrap_or(false);

        if !saved_roots_changed && !changed && !active_roots_changed {
            return;
        }

        if saved_roots_changed {
            root.insert(
                "electron-saved-workspace-roots".to_string(),
                saved_roots_value,
            );
        }

        root.insert(
            "project-order".to_string(),
            serde_json::Value::Array(repaired_order),
        );

        if active_roots_changed {
            root.insert("active-workspace-roots".to_string(), active_roots_value);
        }

        if let Ok(serialized) = serde_json::to_string_pretty(&state) {
            let _ = fs::write(path, serialized);
        }
    }

    pub fn switch_profile(&mut self, profile_id: &str) -> Result<SwitchResult, AppError> {
        self.ensure_target_profile_registered()?;
        let profile_dir = self.profile_dir(profile_id)?;
        fs::create_dir_all(&self.target_dir)?;

        let backup_id = format!(
            "{}-{}",
            Utc::now().format("%Y%m%d-%H%M%S"),
            &Uuid::new_v4().simple().to_string()[..8]
        );
        let backup_dir = self.backups_dir().join(&backup_id);
        fs::create_dir_all(&backup_dir)?;

        self.backup_if_exists(&self.target_auth_path(), backup_dir.join("auth.json"))?;
        self.backup_if_exists(&self.target_config_path(), backup_dir.join("config.toml"))?;

        let current_auth_json = if self.target_auth_path().exists() {
            Some(fs::read_to_string(self.target_auth_path())?)
        } else {
            None
        };
        let current_config_toml = if self.target_config_path().exists() {
            Some(fs::read_to_string(self.target_config_path())?)
        } else {
            None
        };
        let active_profile = self.detect_active_profile()?;

        if let (Some(current_auth_json), Some(current_config_toml), Some(active_profile)) = (
            current_auth_json.as_ref(),
            current_config_toml.as_ref(),
            active_profile.as_ref(),
        ) {
            if active_profile.id != profile_id {
                self.sync_runtime_state_to_profile(
                    &active_profile.id,
                    current_auth_json,
                    current_config_toml,
                )?;
            }
        }

        let next_auth_json = refresh_oauth_auth_json_for_switch(&fs::read_to_string(
            profile_dir.join("auth.json"),
        )?)?;
        let next_profile_config = fs::read_to_string(profile_dir.join("config.toml"))?;
        let next_config_toml = match current_config_toml {
            Some(current_config_toml) => merge_profile_managed_config(
                &current_config_toml,
                &next_auth_json,
                &next_profile_config,
            )?,
            None => normalize_config_toml_for_auth(
                &next_auth_json,
                &repair_illegal_config_toml(&next_profile_config),
            )?,
        };
        let next_session_model_provider =
            session_model_provider_key_from_config_toml(&next_config_toml)?;

        fs::write(self.target_auth_path(), &next_auth_json)?;
        fs::write(self.target_config_path(), &next_config_toml)?;
        let _ = self.repair_codex_sessions_internal(false, false)?;
        let _ = self.repair_session_model_provider_for_switch(&next_session_model_provider)?;
        self.sync_runtime_state_to_profile(profile_id, &next_auth_json, &next_config_toml)?;

        let switched_at = Utc::now();
        self.state.last_selected_profile_id = Some(profile_id.to_string());
        self.state.last_switch_profile_id = Some(profile_id.to_string());
        self.state.last_switched_at = Some(switched_at);
        self.persist_target_marker(TargetMarkerFile {
            profile_id: profile_id.to_string(),
            auth_hash: auth_match_hash(&next_auth_json)?,
            config_hash: managed_config_hash(&next_auth_json, &next_config_toml)?,
            updated_at: switched_at,
        })?;
        self.persist_state()?;

        Ok(SwitchResult {
            profile_id: profile_id.to_string(),
            backup_id,
            switched_at,
        })
    }

    pub fn detect_active_profile(&self) -> Result<Option<ProfileSummary>, AppError> {
        if !self.target_auth_path().exists() || !self.target_config_path().exists() {
            return Ok(None);
        }

        let auth_hash = auth_match_hash(&fs::read_to_string(self.target_auth_path())?)?;
        let auth_json = fs::read_to_string(self.target_auth_path())?;
        let config_hash =
            managed_config_hash(&auth_json, &fs::read_to_string(self.target_config_path())?)?;

        if let Some(marker) = self.read_target_marker()? {
            if marker.auth_hash == auth_hash && marker.config_hash == config_hash {
                if let Some(profile) = self.load_profile_summary(&marker.profile_id)? {
                    return Ok(Some(profile));
                }
            }
        }

        for profile in self.list_profiles()? {
            if profile.auth_hash == auth_hash && profile.config_hash == config_hash {
                return Ok(Some(profile));
            }
        }

        if let Some(last_switch_profile_id) = self.state.last_switch_profile_id.as_deref() {
            if let Some(profile) = self.load_profile_summary(last_switch_profile_id)? {
                if profile.auth_hash == auth_hash {
                    return Ok(Some(profile));
                }
            }
        }

        Ok(None)
    }

    pub fn set_target_dir(&mut self, target_dir: Option<PathBuf>) -> Result<(), AppError> {
        let default_target_dir = default_codex_target_dir()?;
        let target_dir = target_dir.unwrap_or_else(|| default_target_dir.clone());
        self.target_dir = target_dir.clone();
        self.state.target_dir = if target_dir == default_target_dir {
            None
        } else {
            Some(target_dir.to_string_lossy().to_string())
        };
        self.persist_state()?;
        Ok(())
    }

    pub fn set_codex_usage_api_enabled(&mut self, enabled: bool) -> Result<(), AppError> {
        self.state.codex_usage_api_enabled = enabled;
        self.persist_state()?;
        Ok(())
    }

    fn resolve_codex_usage_auth_source(
        &self,
        profile_id: &str,
    ) -> Result<ResolvedCodexUsageAuthSource, AppError> {
        let profile_dir = self.profile_dir(profile_id)?;
        let saved_auth_json = fs::read_to_string(profile_dir.join("auth.json"))?;
        let saved_config_toml = fs::read_to_string(profile_dir.join("config.toml"))?;

        if !self.target_auth_path().exists() || !self.target_config_path().exists() {
            return Ok(ResolvedCodexUsageAuthSource {
                auth_json: saved_auth_json,
                config_toml: saved_config_toml,
                should_sync_runtime_state: false,
            });
        }

        let Some(active_profile) = self.detect_active_profile()? else {
            return Ok(ResolvedCodexUsageAuthSource {
                auth_json: saved_auth_json,
                config_toml: saved_config_toml,
                should_sync_runtime_state: false,
            });
        };
        if active_profile.id != profile_id {
            return Ok(ResolvedCodexUsageAuthSource {
                auth_json: saved_auth_json,
                config_toml: saved_config_toml,
                should_sync_runtime_state: false,
            });
        }

        let runtime_auth_json = fs::read_to_string(self.target_auth_path())?;
        if !is_official_oauth_auth(&runtime_auth_json)? {
            return Ok(ResolvedCodexUsageAuthSource {
                auth_json: saved_auth_json,
                config_toml: saved_config_toml,
                should_sync_runtime_state: false,
            });
        }

        let runtime_config_toml = fs::read_to_string(self.target_config_path())?;
        let should_sync_runtime_state =
            runtime_auth_json != saved_auth_json || runtime_config_toml != saved_config_toml;

        Ok(ResolvedCodexUsageAuthSource {
            auth_json: runtime_auth_json,
            config_toml: runtime_config_toml,
            should_sync_runtime_state,
        })
    }

    pub fn refresh_profile_codex_usage(
        &self,
        profile_id: &str,
    ) -> Result<ProfileSummary, AppError> {
        match self.refresh_profile_codex_usage_attempt(profile_id) {
            Ok(summary) => Ok(summary),
            Err(error) => {
                if self.state.codex_usage_api_enabled {
                    let _ = self.record_codex_usage_failure(profile_id, error.to_string());
                }
                Err(error)
            }
        }
    }

    fn refresh_profile_codex_usage_attempt(
        &self,
        profile_id: &str,
    ) -> Result<ProfileSummary, AppError> {
        let profile_dir = self.profile_dir(profile_id)?;
        let source = self.resolve_codex_usage_auth_source(profile_id)?;
        if !is_official_oauth_auth(&source.auth_json)? {
            return Err(AppError::Message(
                "Codex usage is only available for 官方 OAuth profiles.".into(),
            ));
        }
        if !self.state.codex_usage_api_enabled {
            return Err(AppError::Message(
                "Codex usage query is disabled. Run the explicit enable action first.".into(),
            ));
        }

        let usage = fetch_codex_usage_snapshot(&source.auth_json)?;

        if source.should_sync_runtime_state {
            self.sync_runtime_state_to_profile(profile_id, &source.auth_json, &source.config_toml)?;
        }

        let mut metadata = self.read_profile_metadata(&profile_dir)?;
        metadata.codex_usage = Some(usage);
        self.write_profile_metadata(&profile_dir, &metadata)?;
        Ok(ProfileSummary::from(metadata))
    }

    fn record_codex_usage_failure(
        &self,
        profile_id: &str,
        error: String,
    ) -> Result<ProfileSummary, AppError> {
        let profile_dir = self.profile_dir(profile_id)?;
        let mut metadata = self.read_profile_metadata(&profile_dir)?;
        if metadata.auth_type_label != "官方 OAuth" {
            return Ok(ProfileSummary::from(metadata));
        }

        metadata.codex_usage = Some(codex_usage_failure_snapshot(error));
        self.write_profile_metadata(&profile_dir, &metadata)?;
        Ok(ProfileSummary::from(metadata))
    }

    pub fn refresh_profile_latency_probe(
        &self,
        profile_id: &str,
    ) -> Result<ProfileSummary, AppError> {
        let profile_dir = self.profile_dir(profile_id)?;
        let auth_json = fs::read_to_string(profile_dir.join("auth.json"))?;
        let config_toml = fs::read_to_string(profile_dir.join("config.toml"))?;
        let mut metadata = self.read_profile_metadata(&profile_dir)?;

        if !is_third_party_backed_profile(&metadata.auth_type_label) {
            return Err(AppError::Message(
                "Third-party latency probe is only available for 第三方 API or 共生配置 profiles."
                    .into(),
            ));
        }

        metadata.third_party_latency =
            Some(fetch_third_party_latency_snapshot(&auth_json, &config_toml));
        self.write_profile_metadata(&profile_dir, &metadata)?;
        Ok(ProfileSummary::from(metadata))
    }

    pub fn refresh_profile_third_party_usage(
        &self,
        profile_id: &str,
    ) -> Result<ProfileSummary, AppError> {
        let profile_dir = self.profile_dir(profile_id)?;
        let auth_json = fs::read_to_string(profile_dir.join("auth.json"))?;
        let config_toml = fs::read_to_string(profile_dir.join("config.toml"))?;
        let mut metadata = self.read_profile_metadata(&profile_dir)?;

        if !is_third_party_backed_profile(&metadata.auth_type_label) {
            return Err(AppError::Message(
                "Third-party usage query is only available for 第三方 API or 共生配置 profiles."
                    .into(),
            ));
        }

        metadata.third_party_usage =
            Some(fetch_third_party_usage_snapshot(&auth_json, &config_toml));
        self.write_profile_metadata(&profile_dir, &metadata)?;
        Ok(ProfileSummary::from(metadata))
    }

    pub fn refresh_all_codex_usage(&self) -> Result<Vec<ProfileSummary>, AppError> {
        if !self.state.codex_usage_api_enabled {
            return Err(AppError::Message(
                "Codex usage query is disabled. Run the explicit enable action first.".into(),
            ));
        }

        let mut refreshed = Vec::new();
        for profile in self.list_profiles()? {
            if profile.auth_type_label != "官方 OAuth" {
                continue;
            }
            match self.refresh_profile_codex_usage_attempt(&profile.id) {
                Ok(summary) => refreshed.push(summary),
                Err(error) => {
                    refreshed.push(self.record_codex_usage_failure(&profile.id, error.to_string())?)
                }
            }
        }
        Ok(refreshed)
    }

    pub fn open_target_dir(&self) -> Result<(), AppError> {
        fs::create_dir_all(&self.target_dir)?;

        #[cfg(target_os = "macos")]
        let status = Command::new("open").arg(&self.target_dir).status()?;

        #[cfg(target_os = "windows")]
        let status = Command::new("explorer").arg(&self.target_dir).status()?;

        #[cfg(all(unix, not(target_os = "macos")))]
        let status = Command::new("xdg-open").arg(&self.target_dir).status()?;

        if status.success() {
            Ok(())
        } else {
            Err(AppError::Message(
                "Failed to open the Codex directory.".into(),
            ))
        }
    }

    pub fn snapshot(&self) -> Result<AppSnapshot, AppError> {
        let mut manager = self.clone_for_mutation();
        manager.ensure_target_profile_registered()?;
        let default_target_dir = default_codex_target_dir()?;
        let active_profile_id = manager.detect_active_profile()?.map(|profile| profile.id);

        Ok(AppSnapshot {
            target_dir: manager.target_dir.to_string_lossy().to_string(),
            using_default_target_dir: manager.target_dir == default_target_dir,
            target_exists: manager.target_dir.exists(),
            target_auth_exists: manager.target_auth_path().exists(),
            target_config_exists: manager.target_config_path().exists(),
            target_updated_at: manager.resolve_target_updated_at()?,
            target_auth_type_label: manager.resolve_target_auth_type_label()?,
            active_profile_id,
            last_selected_profile_id: manager.state.last_selected_profile_id.clone(),
            last_switch_profile_id: manager.state.last_switch_profile_id.clone(),
            last_switched_at: manager.state.last_switched_at.clone(),
            codex_usage_api_enabled: manager.state.codex_usage_api_enabled,
            profiles: manager.list_profiles()?,
        })
    }

    fn clone_for_mutation(&self) -> Self {
        Self {
            app_data_dir: self.app_data_dir.clone(),
            target_dir: self.target_dir.clone(),
            state: self.state.clone(),
        }
    }

    fn ensure_storage_dirs(&self) -> Result<(), AppError> {
        fs::create_dir_all(self.profiles_dir())?;
        fs::create_dir_all(self.backups_dir())?;
        Ok(())
    }

    fn persist_state(&self) -> Result<(), AppError> {
        fs::create_dir_all(&self.app_data_dir)?;
        let state_json = serde_json::to_string_pretty(&self.state)?;
        fs::write(self.state_path(), state_json)?;
        Ok(())
    }

    fn backup_if_exists(&self, source: &Path, destination: PathBuf) -> Result<(), AppError> {
        if source.exists() {
            fs::copy(source, destination)?;
        }
        Ok(())
    }

    fn read_profile_metadata(&self, profile_dir: &Path) -> Result<ProfileMetadata, AppError> {
        let meta_path = profile_dir.join("meta.json");
        Ok(serde_json::from_str::<ProfileMetadata>(
            &fs::read_to_string(meta_path)?,
        )?)
    }

    fn write_profile_metadata(
        &self,
        profile_dir: &Path,
        metadata: &ProfileMetadata,
    ) -> Result<(), AppError> {
        fs::write(
            profile_dir.join("meta.json"),
            serde_json::to_string_pretty(metadata)?,
        )?;
        Ok(())
    }

    fn model_providers_path(&self) -> PathBuf {
        self.app_data_dir.join("codex_model_providers.json")
    }

    fn read_model_provider_store(&self) -> Result<Vec<ModelProviderRecord>, AppError> {
        let path = self.model_providers_path();
        if !path.exists() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(path)?;
        if content.trim().is_empty() {
            return Ok(Vec::new());
        }

        let mut providers = serde_json::from_str::<Vec<ModelProviderRecord>>(&content)?;
        providers.retain(|provider| {
            !provider.id.trim().is_empty()
                && !provider.name.trim().is_empty()
                && !provider.base_url.trim().is_empty()
        });
        providers.sort_by(|left, right| {
            left.name
                .to_lowercase()
                .cmp(&right.name.to_lowercase())
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(providers)
    }

    fn write_model_provider_store(
        &self,
        providers: &[ModelProviderRecord],
    ) -> Result<(), AppError> {
        fs::create_dir_all(&self.app_data_dir)?;
        fs::write(
            self.model_providers_path(),
            serde_json::to_string_pretty(providers)?,
        )?;
        Ok(())
    }

    fn register_model_provider_from_profile(
        &self,
        auth_json: &str,
        config_toml: &str,
        profile_name: &str,
    ) -> Result<Option<ModelProviderRecord>, AppError> {
        let Some(descriptor) = resolve_third_party_provider_descriptor(auth_json, config_toml)?
        else {
            return Ok(None);
        };

        let mut providers = self.read_model_provider_store()?;
        let provider_id = descriptor.provider_id.clone();
        let now = Utc::now();
        let key_id = descriptor.api_key_id.clone();
        let key_name = if profile_name.trim().is_empty() {
            descriptor.provider_key.clone()
        } else {
            profile_name.trim().to_string()
        };

        let position = providers.iter().position(|provider| {
            provider.id == provider_id
                || normalize_base_url_for_compare(&provider.base_url)
                    == normalize_base_url_for_compare(&descriptor.base_url)
        });

        let index = match position {
            Some(index) => {
                let provider = &mut providers[index];
                provider.id = provider_id;
                provider.model_provider_key = Some(descriptor.provider_key.clone());
                provider.name = descriptor.provider_name.clone();
                provider.base_url = descriptor.base_url.clone();
                provider.wire_api = descriptor.wire_api.clone();
                provider.updated_at = now;
                index
            }
            None => {
                providers.push(ModelProviderRecord {
                    id: provider_id,
                    model_provider_key: Some(descriptor.provider_key.clone()),
                    name: descriptor.provider_name.clone(),
                    base_url: descriptor.base_url.clone(),
                    wire_api: descriptor.wire_api.clone(),
                    api_keys: Vec::new(),
                    created_at: now,
                    updated_at: now,
                });
                providers.len() - 1
            }
        };

        let provider = &mut providers[index];
        match provider
            .api_keys
            .iter_mut()
            .find(|api_key| api_key.api_key.trim() == descriptor.api_key)
        {
            Some(existing) => {
                existing.id = key_id;
                existing.name = key_name;
                existing.updated_at = now;
            }
            None => provider.api_keys.push(ModelProviderApiKeyRecord {
                id: key_id,
                name: key_name,
                api_key: descriptor.api_key,
                created_at: now,
                updated_at: now,
            }),
        }

        let provider = provider.clone();
        self.write_model_provider_store(&providers)?;
        Ok(Some(provider))
    }

    fn compose_profile_metadata(
        &self,
        id: String,
        name: String,
        notes: String,
        remote_profile_id: Option<String>,
        created_at: DateTime<Utc>,
        updated_at: DateTime<Utc>,
        auth_json: &str,
        config_toml: &str,
        codex_usage: Option<CodexUsageSnapshot>,
        third_party_latency: Option<ThirdPartyLatencySnapshot>,
        third_party_usage: Option<ThirdPartyUsageSnapshot>,
    ) -> Result<ProfileMetadata, AppError> {
        let provider = resolve_third_party_provider_descriptor(auth_json, config_toml)?;
        Ok(ProfileMetadata {
            id,
            name,
            notes,
            remote_profile_id,
            auth_type_label: detect_auth_type_label(auth_json, config_toml)?,
            model_provider_id: provider
                .as_ref()
                .map(|provider| provider.provider_id.clone()),
            model_provider_api_key_id: provider
                .as_ref()
                .map(|provider| provider.api_key_id.clone()),
            model_provider_key: provider
                .as_ref()
                .map(|provider| provider.provider_key.clone()),
            model_provider_name: provider
                .as_ref()
                .map(|provider| provider.provider_name.clone()),
            model_provider_base_url: provider.as_ref().map(|provider| provider.base_url.clone()),
            model_provider_wire_api: provider.as_ref().map(|provider| provider.wire_api.clone()),
            created_at,
            updated_at,
            auth_hash: auth_match_hash(auth_json)?,
            config_hash: managed_config_hash(auth_json, config_toml)?,
            codex_usage,
            third_party_latency,
            third_party_usage,
        })
    }

    fn sync_runtime_state_to_profile(
        &self,
        profile_id: &str,
        auth_json: &str,
        config_toml: &str,
    ) -> Result<(), AppError> {
        let profile_dir = self.profile_dir(profile_id)?;
        let existing_metadata = self.read_profile_metadata(&profile_dir)?;
        let normalized_config =
            normalize_config_toml_for_auth(auth_json, &repair_illegal_config_toml(config_toml))?;
        let next_auth_hash = auth_match_hash(auth_json)?;
        let next_config_hash = managed_config_hash(auth_json, &normalized_config)?;
        let preserved_codex_usage = if existing_metadata.auth_hash == next_auth_hash {
            existing_metadata.codex_usage.clone()
        } else {
            None
        };
        let preserved_third_party_latency = if existing_metadata.auth_hash == next_auth_hash
            && existing_metadata.config_hash == next_config_hash
        {
            existing_metadata.third_party_latency.clone()
        } else {
            None
        };
        let preserved_third_party_usage = if existing_metadata.auth_hash == next_auth_hash
            && existing_metadata.config_hash == next_config_hash
        {
            existing_metadata.third_party_usage.clone()
        } else {
            None
        };

        fs::write(profile_dir.join("auth.json"), auth_json)?;
        fs::write(profile_dir.join("config.toml"), &normalized_config)?;
        self.register_model_provider_from_profile(
            auth_json,
            &normalized_config,
            &existing_metadata.name,
        )?;

        let metadata = self.compose_profile_metadata(
            existing_metadata.id,
            existing_metadata.name,
            existing_metadata.notes,
            existing_metadata.remote_profile_id.clone(),
            existing_metadata.created_at,
            Utc::now(),
            auth_json,
            &normalized_config,
            preserved_codex_usage,
            preserved_third_party_latency,
            preserved_third_party_usage,
        )?;

        self.write_profile_metadata(&profile_dir, &metadata)
    }

    fn profile_dir(&self, profile_id: &str) -> Result<PathBuf, AppError> {
        let profile_dir = self.profiles_dir().join(profile_id);
        if !profile_dir.exists() {
            return Err(AppError::ProfileNotFound(profile_id.to_string()));
        }
        Ok(profile_dir)
    }

    fn load_profile_summary(&self, profile_id: &str) -> Result<Option<ProfileSummary>, AppError> {
        let profile_dir = self.profiles_dir().join(profile_id);
        if !profile_dir.exists() {
            return Ok(None);
        }

        Ok(Some(ProfileSummary::from(
            self.read_profile_metadata(&profile_dir)?,
        )))
    }

    fn find_profile_metadata_by_remote_id(
        &self,
        remote_profile_id: &str,
    ) -> Result<Option<ProfileMetadata>, AppError> {
        if !self.profiles_dir().exists() {
            return Ok(None);
        }

        for entry in fs::read_dir(self.profiles_dir())? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }

            let meta_path = entry.path().join("meta.json");
            if !meta_path.exists() {
                continue;
            }

            let metadata =
                serde_json::from_str::<ProfileMetadata>(&fs::read_to_string(meta_path)?)?;
            if metadata.remote_profile_id.as_deref() == Some(remote_profile_id) {
                return Ok(Some(metadata));
            }
        }

        Ok(None)
    }

    fn import_remote_profile(
        &self,
        remote_profile_id: &str,
        input: ProfileInput,
    ) -> Result<ProfileSummary, AppError> {
        let imported = self.import_profile(input)?;
        let profile_dir = self.profile_dir(&imported.id)?;
        let mut metadata = self.read_profile_metadata(&profile_dir)?;
        metadata.remote_profile_id = Some(remote_profile_id.to_string());
        self.write_profile_metadata(&profile_dir, &metadata)?;
        Ok(ProfileSummary::from(metadata))
    }

    fn profiles_dir(&self) -> PathBuf {
        self.app_data_dir.join("profiles")
    }

    fn backups_dir(&self) -> PathBuf {
        self.app_data_dir.join("backups")
    }

    fn target_marker_path(&self) -> PathBuf {
        self.target_dir.join("codex-auth-switch.json")
    }

    fn state_path(&self) -> PathBuf {
        self.app_data_dir.join("state.json")
    }

    fn target_auth_path(&self) -> PathBuf {
        self.target_dir.join("auth.json")
    }

    fn target_config_path(&self) -> PathBuf {
        self.target_dir.join("config.toml")
    }

    fn usage_stats_db_path(&self) -> PathBuf {
        self.app_data_dir.join("usage_logs.sqlite3")
    }

    fn open_usage_stats_connection(&self) -> Result<Connection, AppError> {
        fs::create_dir_all(&self.app_data_dir)?;
        let conn = Connection::open(self.usage_stats_db_path())?;
        initialize_codex_usage_stats_schema(&conn)?;
        Ok(conn)
    }

    fn read_codex_usage_stats_snapshot(
        &self,
        conn: &Connection,
        sync: CodexUsageStatsSyncResult,
        filter: CodexUsageStatsFilter,
    ) -> Result<CodexUsageStatsSnapshot, AppError> {
        let normalized_filter = filter.normalized();
        let summary = read_codex_usage_stats_summary(conn, &normalized_filter)?;
        let trends = read_codex_usage_stats_trends(conn, &normalized_filter)?;
        let model_breakdown = read_codex_usage_stats_breakdown(conn, &normalized_filter, "model")?;
        let effort_breakdown = read_codex_usage_stats_breakdown(conn, &normalized_filter, "effort")?;
        let available_models = read_codex_usage_stats_distinct_values(conn, "model")?;
        let available_efforts = read_codex_usage_stats_distinct_values(conn, "effort")?;
        let logs = read_codex_usage_stats_logs(conn, &normalized_filter)?;

        Ok(CodexUsageStatsSnapshot {
            updated_at: Utc::now(),
            filter: normalized_filter,
            sync,
            summary,
            trends,
            model_breakdown,
            effort_breakdown,
            available_models,
            available_efforts,
            logs,
        })
    }

    fn resolve_target_updated_at(&self) -> Result<Option<DateTime<Utc>>, AppError> {
        let mut timestamps = Vec::new();

        for path in [self.target_auth_path(), self.target_config_path()] {
            if !path.exists() {
                continue;
            }

            let modified = fs::metadata(path)?.modified()?;
            let timestamp: DateTime<Utc> = modified.into();
            timestamps.push(timestamp);
        }

        Ok(timestamps.into_iter().max())
    }

    fn resolve_target_auth_type_label(&self) -> Result<Option<String>, AppError> {
        if !self.target_auth_path().exists() || !self.target_config_path().exists() {
            return Ok(None);
        }

        Ok(Some(detect_auth_type_label(
            &fs::read_to_string(self.target_auth_path())?,
            &fs::read_to_string(self.target_config_path())?,
        )?))
    }

    fn read_target_marker(&self) -> Result<Option<TargetMarkerFile>, AppError> {
        let marker_path = self.target_marker_path();
        if !marker_path.exists() {
            return Ok(None);
        }

        Ok(Some(serde_json::from_str::<TargetMarkerFile>(
            &fs::read_to_string(marker_path)?,
        )?))
    }

    fn persist_target_marker(&self, marker: TargetMarkerFile) -> Result<(), AppError> {
        fs::create_dir_all(&self.target_dir)?;
        fs::write(
            self.target_marker_path(),
            serde_json::to_string_pretty(&marker)?,
        )?;
        Ok(())
    }

    fn clear_target_marker(&self) -> Result<(), AppError> {
        let marker_path = self.target_marker_path();
        if marker_path.exists() {
            fs::remove_file(marker_path)?;
        }
        Ok(())
    }

    fn ensure_target_profile_registered(&mut self) -> Result<(), AppError> {
        if !self.target_auth_path().exists() || !self.target_config_path().exists() {
            self.clear_target_marker()?;
            return Ok(());
        }

        let auth_json = fs::read_to_string(self.target_auth_path())?;
        let config_toml = fs::read_to_string(self.target_config_path())?;
        let auth_hash = auth_match_hash(&auth_json)?;
        let config_hash = managed_config_hash(&auth_json, &config_toml)?;

        if let Some(marker) = self.read_target_marker()? {
            if marker.auth_hash == auth_hash && marker.config_hash == config_hash {
                if self.load_profile_summary(&marker.profile_id)?.is_some() {
                    return Ok(());
                }
            }
        }

        for profile in self.list_profiles()? {
            if profile.auth_hash == auth_hash && profile.config_hash == config_hash {
                self.persist_target_marker(TargetMarkerFile {
                    profile_id: profile.id,
                    auth_hash,
                    config_hash,
                    updated_at: Utc::now(),
                })?;
                return Ok(());
            }
        }

        if let Some(last_switch_profile_id) = self.state.last_switch_profile_id.as_deref() {
            if let Some(profile) = self.load_profile_summary(last_switch_profile_id)? {
                if profile.auth_hash == auth_hash {
                    self.persist_target_marker(TargetMarkerFile {
                        profile_id: profile.id,
                        auth_hash,
                        config_hash,
                        updated_at: Utc::now(),
                    })?;
                    return Ok(());
                }
            }
        }

        let imported = self.import_profile(ProfileInput {
            name: suggested_profile_name(&auth_json, &config_toml)?,
            notes: "自动从当前 Codex 配置生成".into(),
            auth_json,
            config_toml,
        })?;

        self.persist_target_marker(TargetMarkerFile {
            profile_id: imported.id,
            auth_hash: imported.auth_hash,
            config_hash: imported.config_hash,
            updated_at: Utc::now(),
        })?;

        Ok(())
    }
}

impl From<ProfileMetadata> for ProfileSummary {
    fn from(value: ProfileMetadata) -> Self {
        Self {
            id: value.id,
            name: value.name,
            notes: value.notes,
            auth_type_label: value.auth_type_label,
            model_provider_id: value.model_provider_id,
            model_provider_api_key_id: value.model_provider_api_key_id,
            model_provider_key: value.model_provider_key,
            model_provider_name: value.model_provider_name,
            model_provider_base_url: value.model_provider_base_url,
            model_provider_wire_api: value.model_provider_wire_api,
            created_at: value.created_at,
            updated_at: value.updated_at,
            auth_hash: value.auth_hash,
            config_hash: value.config_hash,
            codex_usage: value.codex_usage,
            third_party_latency: value.third_party_latency,
            third_party_usage: value.third_party_usage,
        }
    }
}

impl From<ModelProviderRecord> for ModelProviderSummary {
    fn from(value: ModelProviderRecord) -> Self {
        Self {
            id: value.id,
            model_provider_key: value.model_provider_key,
            name: value.name,
            base_url: value.base_url,
            wire_api: value.wire_api,
            api_key_count: value.api_keys.len(),
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

fn normalize_remote_profiles_url(input: &str) -> String {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.ends_with("/profiles") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/profiles")
    }
}

fn remote_request(url: &str) -> ureq::Request {
    let mut request = ureq::get(url).set("User-Agent", "codex-auth-switch-cli");
    if let Ok(token) = std::env::var("CODEX_AUTH_SWITCH_REMOTE_TOKEN") {
        let header_value = format!("Bearer {}", token.trim());
        request = request.set("Authorization", &header_value);
    }
    request
}

fn fetch_remote_profile_index(url: &str) -> Result<Vec<RemoteProfileRecord>, AppError> {
    let response = remote_request(&normalize_remote_profiles_url(url))
        .call()
        .map_err(|error| AppError::Message(format!("Failed to fetch remote profiles: {error}")))?;

    response
        .into_json::<Vec<RemoteProfileRecord>>()
        .map_err(|error| AppError::Message(format!("Failed to parse remote profiles: {error}")))
}

fn fetch_remote_profile_detail(url: &str) -> Result<RemoteProfileRecord, AppError> {
    let response = remote_request(url).call().map_err(|error| {
        AppError::Message(format!("Failed to fetch remote profile detail: {error}"))
    })?;

    response
        .into_json::<RemoteProfileRecord>()
        .map_err(|error| {
            AppError::Message(format!("Failed to parse remote profile detail: {error}"))
        })
}

fn fetch_remote_text_file(url: &str) -> Result<String, AppError> {
    let response = remote_request(url)
        .call()
        .map_err(|error| AppError::Message(format!("Failed to fetch remote file: {error}")))?;

    response
        .into_string()
        .map_err(|error| AppError::Message(format!("Failed to read remote file: {error}")))
}

pub fn default_cli_app_data_dir() -> Result<PathBuf, AppError> {
    if let Ok(path) = std::env::var("CODEX_AUTH_SWITCH_APP_DATA_DIR") {
        let path = path.trim();
        if !path.is_empty() {
            return Ok(PathBuf::from(path));
        }
    }

    let base_dir = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .or_else(dirs::home_dir)
        .ok_or_else(|| AppError::Message("Unable to resolve the CLI app data directory.".into()))?;

    Ok(base_dir.join("com.lucifer.codex-auth-switch"))
}

pub fn default_codex_target_dir() -> Result<PathBuf, AppError> {
    let home_dir = dirs::home_dir()
        .ok_or_else(|| AppError::Message("Unable to resolve the user home directory.".into()))?;
    Ok(home_dir.join(".codex"))
}

fn unknown_auth_type_label() -> String {
    "未识别".to_string()
}

fn is_third_party_backed_profile(auth_type_label: &str) -> bool {
    matches!(auth_type_label, "第三方 API" | "共生配置")
}

pub fn repair_illegal_config_toml(config_toml: &str) -> String {
    if config_toml.contains("[model_providers.openai]") {
        config_toml
            .replace(
                "[model_providers.openai]",
                "[model_providers.openai_custom]",
            )
            .replace(
                "model_provider = \"openai\"",
                "model_provider = \"openai_custom\"",
            )
            .replace(
                "model_provider = 'openai'",
                "model_provider = 'openai_custom'",
            )
    } else {
        config_toml.to_string()
    }
}

fn session_model_provider_key_from_config_toml(config_toml: &str) -> Result<String, AppError> {
    let table = parse_toml_table(config_toml)?;
    let provider = table
        .get("model_provider")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("openai");

    Ok(provider.to_string())
}

fn resolve_third_party_provider_descriptor(
    auth_json: &str,
    config_toml: &str,
) -> Result<Option<ThirdPartyProviderDescriptor>, AppError> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json)
        .map_err(|error| AppError::InvalidAuthJson(error.to_string()))?;
    let auth_api_key = auth
        .get("OPENAI_API_KEY")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let config = parse_toml_table(config_toml)?;
    let provider_key = config
        .get("model_provider")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "openai".into());

    let provider_from_table = config
        .get("model_providers")
        .and_then(|value| value.as_table())
        .and_then(|providers| {
            providers
                .get(&provider_key)
                .or_else(|| providers.values().next())
        })
        .and_then(|value| value.as_table());

    if is_official_oauth_auth(auth_json)?
        && !provider_from_table
            .and_then(|provider| provider.get("requires_openai_auth"))
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
    {
        return Ok(None);
    }

    let base_url = config
        .get("openai_base_url")
        .and_then(|value| value.as_str())
        .or_else(|| {
            provider_from_table
                .and_then(|provider| provider.get("base_url"))
                .and_then(|value| value.as_str())
        })
        .map(normalize_base_url_for_store)
        .filter(|value| !value.is_empty());

    let Some(base_url) = base_url else {
        return Ok(None);
    };

    let provider_name = provider_from_table
        .and_then(|provider| provider.get("name"))
        .and_then(|name| name.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| infer_third_party_provider_name(&provider_key, &base_url));
    let wire_api = provider_from_table
        .and_then(|provider| provider.get("wire_api"))
        .and_then(|wire_api| wire_api.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "responses".into());
    let api_key = auth_api_key.or_else(|| {
        provider_from_table
            .and_then(|provider| provider.get("experimental_bearer_token"))
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    });

    let Some(api_key) = api_key else {
        return Ok(None);
    };

    let provider_id = stable_model_provider_id(&provider_key, &base_url);
    let api_key_id = stable_model_provider_key_id(&api_key);

    Ok(Some(ThirdPartyProviderDescriptor {
        provider_id,
        api_key_id,
        provider_key,
        provider_name,
        base_url,
        wire_api,
        api_key,
    }))
}

fn normalize_base_url_for_store(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn normalize_base_url_for_compare(value: &str) -> String {
    normalize_base_url_for_store(value).to_ascii_lowercase()
}

fn stable_model_provider_id(provider_key: &str, base_url: &str) -> String {
    let seed = format!(
        "{}\n{}",
        provider_key.trim().to_ascii_lowercase(),
        normalize_base_url_for_compare(base_url)
    );
    format!("cmp_{}", &sha256_bytes(seed.as_bytes())[..16])
}

fn stable_model_provider_key_id(api_key: &str) -> String {
    format!("cmk_{}", &sha256_bytes(api_key.trim().as_bytes())[..16])
}

fn update_rollout_session_meta_provider(
    path: &Path,
    affected_ids: &HashSet<String>,
    provider: &str,
) -> Result<bool, AppError> {
    let metadata = fs::metadata(path)?;
    let atime = FileTime::from_last_access_time(&metadata);
    let mtime = FileTime::from_last_modification_time(&metadata);
    let content = fs::read_to_string(path)?;
    let had_trailing_newline = content.ends_with('\n');
    let mut changed = false;
    let mut updated_lines = Vec::new();

    for line in content.lines() {
        let Ok(mut value) = serde_json::from_str::<serde_json::Value>(line) else {
            updated_lines.push(line.to_string());
            continue;
        };

        if update_session_meta_value_provider(&mut value, affected_ids, provider) {
            changed = true;
            updated_lines.push(serde_json::to_string(&value)?);
        } else {
            updated_lines.push(line.to_string());
        }
    }

    if changed {
        let mut updated = updated_lines.join("\n");
        if had_trailing_newline {
            updated.push('\n');
        }
        fs::write(path, updated)?;
        set_file_times(path, atime, mtime)?;
    }

    Ok(changed)
}

fn update_session_meta_value_provider(
    value: &mut serde_json::Value,
    affected_ids: &HashSet<String>,
    provider: &str,
) -> bool {
    if value.get("type").and_then(|entry_type| entry_type.as_str()) == Some("session_meta") {
        return update_session_meta_payload_provider(
            value.get_mut("payload"),
            affected_ids,
            provider,
        );
    }

    let payload = value
        .get_mut("session_meta")
        .and_then(|session_meta| session_meta.get_mut("payload"));
    update_session_meta_payload_provider(payload, affected_ids, provider)
}

fn update_session_meta_payload_provider(
    payload: Option<&mut serde_json::Value>,
    affected_ids: &HashSet<String>,
    provider: &str,
) -> bool {
    let Some(payload) = payload else {
        return false;
    };
    let Some(payload_object) = payload.as_object_mut() else {
        return false;
    };
    let Some(id) = payload_object
        .get("id")
        .and_then(|value| value.as_str())
        .or_else(|| {
            payload_object
                .get("session_id")
                .and_then(|value| value.as_str())
        })
    else {
        return false;
    };
    if !affected_ids.contains(id) {
        return false;
    }

    let next_provider = serde_json::Value::String(provider.to_string());
    if payload_object.get("model_provider") == Some(&next_provider) {
        return false;
    }
    payload_object.insert("model_provider".to_string(), next_provider);
    true
}

fn primary_state_database_path(target_dir: &Path) -> Option<PathBuf> {
    fs::read_dir(target_dir)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("state_") || !name.ends_with(".sqlite") {
                return None;
            }

            let version = name
                .strip_prefix("state_")
                .and_then(|value| value.strip_suffix(".sqlite"))
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or(0);

            Some((version, name, entry.path()))
        })
        .max_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)))
        .map(|(_, _, path)| path)
}

#[derive(Debug, Clone, Copy, Default)]
struct TokenUsageCounters {
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_creation_tokens: i64,
    reasoning_output_tokens: i64,
}

#[derive(Debug, Clone)]
struct PendingCodexUsageLog {
    request_id: String,
    session_id: String,
    model: String,
    provider: String,
    effort: String,
    created_at: DateTime<Utc>,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_creation_tokens: i64,
    reasoning_output_tokens: i64,
    source_path: String,
}

fn initialize_codex_usage_stats_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS codex_usage_logs (
            request_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            model TEXT NOT NULL,
            provider TEXT NOT NULL DEFAULT 'unknown',
            created_at TEXT NOT NULL,
            input_tokens INTEGER NOT NULL,
            output_tokens INTEGER NOT NULL,
            cache_read_tokens INTEGER NOT NULL,
            cache_creation_tokens INTEGER NOT NULL,
            reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
            effort TEXT NOT NULL DEFAULT 'unknown',
            total_cost_usd TEXT NOT NULL DEFAULT '0',
            source_path TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_codex_usage_logs_created_at
            ON codex_usage_logs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_codex_usage_logs_session_id
            ON codex_usage_logs(session_id);
        ",
    )?;

    ensure_sqlite_column(
        conn,
        "codex_usage_logs",
        "reasoning_output_tokens",
        "ALTER TABLE codex_usage_logs ADD COLUMN reasoning_output_tokens INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_sqlite_column(
        conn,
        "codex_usage_logs",
        "effort",
        "ALTER TABLE codex_usage_logs ADD COLUMN effort TEXT NOT NULL DEFAULT 'unknown'",
    )?;
    ensure_sqlite_column(
        conn,
        "codex_usage_logs",
        "provider",
        "ALTER TABLE codex_usage_logs ADD COLUMN provider TEXT NOT NULL DEFAULT 'unknown'",
    )?;
    conn.execute_batch(
        "
        UPDATE codex_usage_logs SET provider = 'openai' WHERE provider = 'unknown' AND (model LIKE 'gpt-%' OR model LIKE 'o1-%' OR model LIKE 'o3-%');
        UPDATE codex_usage_logs SET provider = 'anthropic' WHERE provider = 'unknown' AND model LIKE 'claude-%';
        UPDATE codex_usage_logs SET provider = 'google' WHERE provider = 'unknown' AND model LIKE 'gemini-%';
        UPDATE codex_usage_logs SET provider = 'deepseek' WHERE provider = 'unknown' AND model LIKE 'deepseek-%';
        ",
    )?;
    Ok(())
}

fn ensure_sqlite_column(
    conn: &Connection,
    table_name: &str,
    column_name: &str,
    alter_sql: &str,
) -> Result<(), rusqlite::Error> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table_name})"))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for row in rows {
        if row? == column_name {
            return Ok(());
        }
    }
    conn.execute_batch(alter_sql)
}

fn collect_codex_session_log_files(target_dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    collect_jsonl_files_recursive(&target_dir.join("sessions"), &mut files);
    collect_jsonl_files_recursive(&target_dir.join("archived_sessions"), &mut files);
    files
}

fn collect_jsonl_files_recursive(dir: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files_recursive(&path, files);
            continue;
        }
        if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
}

fn import_codex_usage_file(
    conn: &Connection,
    session_path: &Path,
) -> Result<CodexUsageStatsSyncResult, AppError> {
    let file = fs::File::open(session_path)?;
    let mut sync = CodexUsageStatsSyncResult::default();
    sync.files_scanned = 1;
    let mut session_id: Option<String> = None;
    let mut model = "unknown".to_string();
    let mut provider = "unknown".to_string();
    let mut effort = "unknown".to_string();
    let mut token_event_index = 0_i64;
    let mut previous_total: Option<TokenUsageCounters> = None;

    for line in BufReader::new(file).lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let value = match serde_json::from_str::<serde_json::Value>(trimmed) {
            Ok(value) => value,
            Err(error) => {
                sync.errors.push(format!(
                    "{}: invalid JSON line: {error}",
                    session_path.to_string_lossy()
                ));
                continue;
            }
        };

        match value.get("type").and_then(|entry_type| entry_type.as_str()) {
            Some("session_meta") => {
                if let Some(id) = value
                    .get("payload")
                    .and_then(|payload| payload.get("id"))
                    .and_then(|id| id.as_str())
                    .filter(|id| !id.trim().is_empty())
                {
                    session_id = Some(id.to_string());
                }
            }
            Some("turn_context") => {
                if let Some(payload) = value.get("payload") {
                    if let Some(raw_model) = payload
                        .get("model")
                        .and_then(|model| model.as_str())
                    {
                        if !raw_model.trim().is_empty() {
                            model = normalize_codex_usage_model(raw_model);
                            provider = extract_codex_usage_provider(raw_model);
                        }
                    }
                    if let Some(next_effort) = read_codex_usage_effort(payload) {
                        effort = next_effort;
                    }
                }
            }
            Some("event_msg") => {
                let Some(payload) = value.get("payload") else {
                    continue;
                };
                if payload
                    .get("type")
                    .and_then(|entry_type| entry_type.as_str())
                    != Some("token_count")
                {
                    continue;
                }
                let Some(info) = payload.get("info") else {
                    continue;
                };

                let Some(created_at) = value
                    .get("timestamp")
                    .and_then(|timestamp| timestamp.as_str())
                    .and_then(parse_usage_timestamp)
                else {
                    continue;
                };
                let Some(session_id) = session_id.clone() else {
                    sync.errors.push(format!(
                        "{}: skipped token_count without session_meta id",
                        session_path.to_string_lossy()
                    ));
                    continue;
                };

                let usage = if let Some(total_usage_value) = info.get("total_token_usage") {
                    let current_total = read_token_usage_counters(total_usage_value);
                    let delta = previous_total
                        .map(|previous| current_total.saturating_sub(previous))
                        .unwrap_or(current_total);
                    previous_total = Some(current_total);
                    delta
                } else if let Some(last_usage_value) = info.get("last_token_usage") {
                    read_token_usage_counters(last_usage_value)
                } else {
                    continue;
                };

                if usage.input_tokens == 0
                    && usage.output_tokens == 0
                    && usage.cache_read_tokens == 0
                    && usage.cache_creation_tokens == 0
                    && usage.reasoning_output_tokens == 0
                {
                    continue;
                }

                token_event_index += 1;
                let log = PendingCodexUsageLog {
                    request_id: format!("codex_session:{session_id}:{token_event_index}"),
                    session_id,
                    model: model.clone(),
                    provider: provider.clone(),
                    effort: effort.clone(),
                    created_at,
                    input_tokens: usage.input_tokens.saturating_sub(usage.cache_read_tokens),
                    output_tokens: usage.output_tokens,
                    cache_read_tokens: usage.cache_read_tokens,
                    cache_creation_tokens: usage.cache_creation_tokens,
                    reasoning_output_tokens: usage.reasoning_output_tokens,
                    source_path: session_path.to_string_lossy().to_string(),
                };
                if insert_codex_usage_log(conn, &log)? {
                    sync.imported += 1;
                } else {
                    sync.skipped += 1;
                }
            }
            _ => {}
        }
    }

    Ok(sync)
}

impl TokenUsageCounters {
    fn saturating_sub(self, previous: Self) -> Self {
        Self {
            input_tokens: self.input_tokens.saturating_sub(previous.input_tokens),
            output_tokens: self.output_tokens.saturating_sub(previous.output_tokens),
            cache_read_tokens: self
                .cache_read_tokens
                .saturating_sub(previous.cache_read_tokens),
            cache_creation_tokens: self
                .cache_creation_tokens
                .saturating_sub(previous.cache_creation_tokens),
            reasoning_output_tokens: self
                .reasoning_output_tokens
                .saturating_sub(previous.reasoning_output_tokens),
        }
    }
}

fn read_token_usage_counters(value: &serde_json::Value) -> TokenUsageCounters {
    TokenUsageCounters {
        input_tokens: read_i64_field(value, &["input_tokens", "inputTokens"]),
        output_tokens: read_i64_field(value, &["output_tokens", "outputTokens"]),
        cache_read_tokens: read_i64_field(
            value,
            &[
                "cached_input_tokens",
                "cache_read_input_tokens",
                "cache_read_tokens",
                "cachedInputTokens",
                "cacheReadInputTokens",
                "cacheReadTokens",
            ],
        ),
        cache_creation_tokens: read_i64_field(
            value,
            &[
                "cache_creation_input_tokens",
                "cache_creation_tokens",
                "cacheCreationInputTokens",
                "cacheCreationTokens",
            ],
        ),
        reasoning_output_tokens: read_i64_field(
            value,
            &[
                "reasoning_output_tokens",
                "reasoningOutputTokens",
                "reasoning_tokens",
                "reasoningTokens",
            ],
        ),
    }
}

fn read_i64_field(value: &serde_json::Value, keys: &[&str]) -> i64 {
    keys.iter()
        .find_map(|key| {
            value.get(*key).and_then(|field| {
                field
                    .as_i64()
                    .or_else(|| field.as_u64().map(|num| num as i64))
            })
        })
        .unwrap_or(0)
        .max(0)
}

fn read_codex_usage_effort(payload: &serde_json::Value) -> Option<String> {
    let direct = payload
        .get("effort")
        .or_else(|| payload.get("reasoning_effort"))
        .or_else(|| payload.get("reasoningEffort"))
        .or_else(|| payload.get("model_reasoning_effort"))
        .or_else(|| payload.get("modelReasoningEffort"))
        .and_then(|value| value.as_str());
    let nested = payload
        .get("reasoning")
        .and_then(|reasoning| reasoning.get("effort"))
        .and_then(|value| value.as_str());

    direct
        .or(nested)
        .map(normalize_codex_usage_effort)
        .filter(|value| !value.is_empty())
}

fn parse_usage_timestamp(timestamp: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(timestamp)
        .map(|parsed| parsed.with_timezone(&Utc))
        .ok()
}

fn normalize_codex_usage_model(model: &str) -> String {
    let provider_stripped = model
        .rsplit('/')
        .next()
        .unwrap_or(model)
        .trim()
        .to_ascii_lowercase();
    strip_date_suffix(&provider_stripped)
}

fn extract_codex_usage_provider(model: &str) -> String {
    let trimmed = model.trim();
    if let Some(slash_idx) = trimmed.find('/') {
        let p = trimmed[..slash_idx].trim().to_ascii_lowercase();
        if !p.is_empty() {
            return p;
        }
    }

    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("gpt-") || lower.starts_with("o1-") || lower.starts_with("o3-") || lower.starts_with("text-davinci") {
        "openai".to_string()
    } else if lower.starts_with("claude-") {
        "anthropic".to_string()
    } else if lower.starts_with("gemini-") {
        "google".to_string()
    } else if lower.starts_with("deepseek-") {
        "deepseek".to_string()
    } else {
        "unknown".to_string()
    }
}

fn normalize_codex_usage_effort(effort: &str) -> String {
    let normalized = effort.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        "unknown".to_string()
    } else {
        normalized
    }
}

fn strip_date_suffix(model: &str) -> String {
    let bytes = model.as_bytes();
    if bytes.len() >= 11 {
        let suffix = &model[model.len() - 11..];
        if suffix.starts_with('-')
            && suffix.as_bytes()[1..5].iter().all(u8::is_ascii_digit)
            && suffix.as_bytes()[5] == b'-'
            && suffix.as_bytes()[6..8].iter().all(u8::is_ascii_digit)
            && suffix.as_bytes()[8] == b'-'
            && suffix.as_bytes()[9..11].iter().all(u8::is_ascii_digit)
        {
            return model[..model.len() - 11].to_string();
        }
    }

    if bytes.len() >= 9 {
        let suffix = &model[model.len() - 9..];
        if suffix.starts_with('-') && suffix.as_bytes()[1..9].iter().all(u8::is_ascii_digit) {
            return model[..model.len() - 9].to_string();
        }
    }

    model.to_string()
}

#[derive(Debug, Clone, Copy)]
struct CodexUsagePrice {
    input_per_million: f64,
    cached_input_per_million: f64,
    output_per_million: f64,
}

fn codex_usage_price_for_model(model: &str) -> Option<CodexUsagePrice> {
    let normalized = normalize_codex_usage_model(model);
    match normalized.as_str() {
        "gpt-5.5" => Some(CodexUsagePrice {
            input_per_million: 5.0,
            cached_input_per_million: 0.5,
            output_per_million: 30.0,
        }),
        "gpt-5.4" => Some(CodexUsagePrice {
            input_per_million: 2.5,
            cached_input_per_million: 0.25,
            output_per_million: 15.0,
        }),
        "gpt-5.4-mini" => Some(CodexUsagePrice {
            input_per_million: 0.75,
            cached_input_per_million: 0.075,
            output_per_million: 4.5,
        }),
        _ => None,
    }
}

fn estimate_codex_usage_cost_usd(
    model: &str,
    input_tokens: i64,
    cache_read_tokens: i64,
    cache_creation_tokens: i64,
    output_tokens: i64,
) -> String {
    let Some(price) = codex_usage_price_for_model(model) else {
        return format_usd(0.0);
    };
    let cost = ((input_tokens.max(0) + cache_creation_tokens.max(0)) as f64
        * price.input_per_million
        + cache_read_tokens.max(0) as f64 * price.cached_input_per_million
        + output_tokens.max(0) as f64 * price.output_per_million)
        / 1_000_000.0;
    format_usd(cost)
}

fn format_usd(value: f64) -> String {
    let rounded = ((value.max(0.0) * 1_000_000.0) + 0.000_000_001).round() / 1_000_000.0;
    format!("{rounded:.6}")
}

fn insert_codex_usage_log(
    conn: &Connection,
    log: &PendingCodexUsageLog,
) -> Result<bool, rusqlite::Error> {
    let total_cost_usd = estimate_codex_usage_cost_usd(
        &log.model,
        log.input_tokens,
        log.cache_read_tokens,
        log.cache_creation_tokens,
        log.output_tokens,
    );
    let inserted = conn.execute(
        "INSERT OR IGNORE INTO codex_usage_logs (
            request_id,
            session_id,
            model,
            provider,
            effort,
            created_at,
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cache_creation_tokens,
            reasoning_output_tokens,
            total_cost_usd,
            source_path
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![
            log.request_id,
            log.session_id,
            log.model,
            log.provider,
            log.effort,
            log.created_at.to_rfc3339_opts(SecondsFormat::Secs, true),
            log.input_tokens,
            log.output_tokens,
            log.cache_read_tokens,
            log.cache_creation_tokens,
            log.reasoning_output_tokens,
            total_cost_usd,
            log.source_path,
        ],
    )?;
    Ok(inserted > 0)
}

impl CodexUsageStatsFilter {
    fn normalized(self) -> Self {
        Self {
            start_date: normalize_usage_filter_date(self.start_date),
            end_date: normalize_usage_filter_date(self.end_date),
            model: normalize_usage_filter_value(self.model),
            effort: normalize_usage_filter_value(self.effort).map(|value| {
                if value == "unknown" {
                    value
                } else {
                    normalize_codex_usage_effort(&value)
                }
            }),
        }
    }
}

fn normalize_usage_filter_date(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("all") {
        return None;
    }
    NaiveDate::parse_from_str(&trimmed, "%Y-%m-%d")
        .ok()
        .map(|date| date.format("%Y-%m-%d").to_string())
}

fn normalize_usage_filter_value(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("all") {
        None
    } else {
        Some(trimmed)
    }
}

fn usage_filter_params<'a>(
    filter: &'a CodexUsageStatsFilter,
) -> (
    Option<&'a str>,
    Option<&'a str>,
    Option<&'a str>,
    Option<&'a str>,
) {
    (
        filter.start_date.as_deref(),
        filter.end_date.as_deref(),
        filter.model.as_deref(),
        filter.effort.as_deref(),
    )
}

const CODEX_USAGE_FILTER_SQL: &str = "
    (?1 IS NULL OR substr(created_at, 1, 10) >= ?1)
    AND (?2 IS NULL OR substr(created_at, 1, 10) <= ?2)
    AND (?3 IS NULL OR model = ?3)
    AND (?4 IS NULL OR effort = ?4)
";

#[derive(Debug, Clone, Copy)]
struct CodexUsageAggregate {
    request_count: i64,
    total_cost_usd: f64,
    total_input_tokens: i64,
    total_output_tokens: i64,
    total_cache_read_tokens: i64,
    total_cache_creation_tokens: i64,
    total_reasoning_output_tokens: i64,
}

impl CodexUsageAggregate {
    fn real_total_tokens(self) -> i64 {
        self.total_input_tokens
            + self.total_output_tokens
            + self.total_cache_read_tokens
            + self.total_cache_creation_tokens
    }

    fn cache_hit_rate(self) -> f64 {
        let denominator = self.total_input_tokens + self.total_cache_read_tokens;
        if denominator > 0 {
            self.total_cache_read_tokens as f64 / denominator as f64
        } else {
            0.0
        }
    }
}

fn read_codex_usage_aggregate(
    row: &rusqlite::Row<'_>,
    start_index: usize,
) -> Result<CodexUsageAggregate, rusqlite::Error> {
    Ok(CodexUsageAggregate {
        request_count: row.get(start_index)?,
        total_cost_usd: row.get(start_index + 1)?,
        total_input_tokens: row.get(start_index + 2)?,
        total_output_tokens: row.get(start_index + 3)?,
        total_cache_read_tokens: row.get(start_index + 4)?,
        total_cache_creation_tokens: row.get(start_index + 5)?,
        total_reasoning_output_tokens: row.get(start_index + 6)?,
    })
}

fn backfill_zero_costs(conn: &Connection) -> Result<(), rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT request_id, model, input_tokens, cache_read_tokens, cache_creation_tokens, output_tokens
         FROM codex_usage_logs
         WHERE total_cost_usd = '0'"
    )?;

    struct CostUpdate {
        request_id: String,
        cost: String,
    }

    let rows = stmt.query_map([], |row| {
        let request_id: String = row.get(0)?;
        let model: String = row.get(1)?;
        let input_tokens: i64 = row.get(2)?;
        let cache_read_tokens: i64 = row.get(3)?;
        let cache_creation_tokens: i64 = row.get(4)?;
        let output_tokens: i64 = row.get(5)?;

        let cost = estimate_codex_usage_cost_usd(
            &model,
            input_tokens,
            cache_read_tokens,
            cache_creation_tokens,
            output_tokens,
        );

        Ok(CostUpdate { request_id, cost })
    })?;

    let mut updates = Vec::new();
    for row in rows {
        let update = row?;
        updates.push(update);
    }

    if !updates.is_empty() {
        conn.execute("BEGIN TRANSACTION", [])?;
        {
            let mut update_stmt = conn.prepare_cached(
                "UPDATE codex_usage_logs SET total_cost_usd = ?1 WHERE request_id = ?2"
            )?;
            for update in updates {
                update_stmt.execute(rusqlite::params![update.cost, update.request_id])?;
            }
        }
        conn.execute("COMMIT", [])?;
    }

    Ok(())
}

fn read_codex_usage_stats_summary(
    conn: &Connection,
    filter: &CodexUsageStatsFilter,
) -> Result<CodexUsageStatsSummary, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!(
        "SELECT
            COUNT(*),
            COALESCE(SUM(CAST(total_cost_usd AS REAL)), 0.0),
            COALESCE(SUM(input_tokens), 0),
            COALESCE(SUM(output_tokens), 0),
            COALESCE(SUM(cache_read_tokens), 0),
            COALESCE(SUM(cache_creation_tokens), 0),
            COALESCE(SUM(reasoning_output_tokens), 0)
         FROM codex_usage_logs
         WHERE {CODEX_USAGE_FILTER_SQL}"
    ))?;
    let (start_date, end_date, model, effort) = usage_filter_params(filter);
    let aggregate = stmt.query_row(
        rusqlite::params![start_date, end_date, model, effort],
        |row| read_codex_usage_aggregate(row, 0),
    )?;

    Ok(CodexUsageStatsSummary {
        total_requests: aggregate.request_count,
        total_cost_usd: format_usd(aggregate.total_cost_usd),
        total_input_tokens: aggregate.total_input_tokens,
        total_output_tokens: aggregate.total_output_tokens,
        total_cache_read_tokens: aggregate.total_cache_read_tokens,
        total_cache_creation_tokens: aggregate.total_cache_creation_tokens,
        total_reasoning_output_tokens: aggregate.total_reasoning_output_tokens,
        real_total_tokens: aggregate.real_total_tokens(),
        cache_hit_rate: aggregate.cache_hit_rate(),
    })
}

fn read_codex_usage_stats_trends(
    conn: &Connection,
    filter: &CodexUsageStatsFilter,
) -> Result<Vec<CodexUsageStatsTrend>, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!(
        "SELECT
            substr(created_at, 1, 10) AS usage_date,
            COUNT(*),
            COALESCE(SUM(CAST(total_cost_usd AS REAL)), 0.0),
            COALESCE(SUM(input_tokens), 0),
            COALESCE(SUM(output_tokens), 0),
            COALESCE(SUM(cache_read_tokens), 0),
            COALESCE(SUM(cache_creation_tokens), 0),
            COALESCE(SUM(reasoning_output_tokens), 0)
         FROM codex_usage_logs
         WHERE {CODEX_USAGE_FILTER_SQL}
         GROUP BY usage_date
         ORDER BY usage_date ASC",
    ))?;
    let (start_date, end_date, model, effort) = usage_filter_params(filter);
    let rows = stmt.query_map(
        rusqlite::params![start_date, end_date, model, effort],
        |row| {
            let aggregate = read_codex_usage_aggregate(row, 1)?;
            Ok(CodexUsageStatsTrend {
                date: row.get(0)?,
                request_count: aggregate.request_count,
                total_cost_usd: format_usd(aggregate.total_cost_usd),
                total_input_tokens: aggregate.total_input_tokens,
                total_output_tokens: aggregate.total_output_tokens,
                total_cache_read_tokens: aggregate.total_cache_read_tokens,
                total_cache_creation_tokens: aggregate.total_cache_creation_tokens,
                total_reasoning_output_tokens: aggregate.total_reasoning_output_tokens,
                real_total_tokens: aggregate.real_total_tokens(),
            })
        },
    )?;

    let mut trends = Vec::new();
    for row in rows {
        trends.push(row?);
    }
    Ok(trends)
}

fn read_codex_usage_stats_breakdown(
    conn: &Connection,
    filter: &CodexUsageStatsFilter,
    column: &str,
) -> Result<Vec<CodexUsageStatsBreakdown>, rusqlite::Error> {
    let column = match column {
        "model" => "model",
        "effort" => "effort",
        _ => "model",
    };
    let mut stmt = conn.prepare(&format!(
        "SELECT
            {column},
            COUNT(*),
            COALESCE(SUM(CAST(total_cost_usd AS REAL)), 0.0),
            COALESCE(SUM(input_tokens), 0),
            COALESCE(SUM(output_tokens), 0),
            COALESCE(SUM(cache_read_tokens), 0),
            COALESCE(SUM(cache_creation_tokens), 0),
            COALESCE(SUM(reasoning_output_tokens), 0)
         FROM codex_usage_logs
         WHERE {CODEX_USAGE_FILTER_SQL}
         GROUP BY {column}
         ORDER BY COALESCE(SUM(CAST(total_cost_usd AS REAL)), 0.0) DESC, COUNT(*) DESC, {column} ASC",
    ))?;
    let (start_date, end_date, model, effort) = usage_filter_params(filter);
    let rows = stmt.query_map(
        rusqlite::params![start_date, end_date, model, effort],
        |row| {
            let aggregate = read_codex_usage_aggregate(row, 1)?;
            Ok(CodexUsageStatsBreakdown {
                name: row.get(0)?,
                request_count: aggregate.request_count,
                total_cost_usd: format_usd(aggregate.total_cost_usd),
                total_input_tokens: aggregate.total_input_tokens,
                total_output_tokens: aggregate.total_output_tokens,
                total_cache_read_tokens: aggregate.total_cache_read_tokens,
                total_cache_creation_tokens: aggregate.total_cache_creation_tokens,
                total_reasoning_output_tokens: aggregate.total_reasoning_output_tokens,
                real_total_tokens: aggregate.real_total_tokens(),
            })
        },
    )?;

    let mut breakdown = Vec::new();
    for row in rows {
        breakdown.push(row?);
    }
    Ok(breakdown)
}

fn read_codex_usage_stats_distinct_values(
    conn: &Connection,
    column: &str,
) -> Result<Vec<String>, rusqlite::Error> {
    let column = match column {
        "model" => "model",
        "effort" => "effort",
        _ => "model",
    };
    let mut stmt = conn.prepare(&format!(
        "SELECT DISTINCT {column}
         FROM codex_usage_logs
         WHERE TRIM({column}) != ''
         ORDER BY {column} ASC"
    ))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut values = Vec::new();
    for row in rows {
        values.push(row?);
    }
    Ok(values)
}

fn read_codex_usage_stats_logs(
    conn: &Connection,
    filter: &CodexUsageStatsFilter,
) -> Result<Vec<CodexUsageStatsLog>, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!(
        "SELECT
            request_id,
            session_id,
            model,
            provider,
            effort,
            created_at,
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cache_creation_tokens,
            reasoning_output_tokens,
            total_cost_usd,
            source_path
         FROM codex_usage_logs
         WHERE {CODEX_USAGE_FILTER_SQL}
         ORDER BY created_at DESC, request_id DESC
         LIMIT 500",
    ))?;
    let (start_date, end_date, model, effort) = usage_filter_params(filter);
    let rows = stmt.query_map(
        rusqlite::params![start_date, end_date, model, effort],
        |row| {
            let created_at_text: String = row.get(5)?;
            let created_at = DateTime::parse_from_rfc3339(&created_at_text)
                .map(|parsed| parsed.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc.timestamp_opt(0, 0).single().unwrap());
            Ok(CodexUsageStatsLog {
                request_id: row.get(0)?,
                session_id: row.get(1)?,
                model: row.get(2)?,
                provider: row.get(3)?,
                effort: row.get(4)?,
                created_at,
                input_tokens: row.get(6)?,
                output_tokens: row.get(7)?,
                cache_read_tokens: row.get(8)?,
                cache_creation_tokens: row.get(9)?,
                reasoning_output_tokens: row.get(10)?,
                total_cost_usd: row.get(11)?,
                source_path: row.get(12)?,
            })
        },
    )?;

    let mut logs = Vec::new();
    for row in rows {
        logs.push(row?);
    }
    Ok(logs)
}

fn open_valid_state_database(path: &Path) -> Option<Connection> {
    let mut file = fs::File::open(path).ok()?;
    let mut header = [0_u8; 16];
    if file.read_exact(&mut header).is_err() {
        return None;
    }
    if &header != b"SQLite format 3\0" {
        return None;
    }

    Connection::open(path).ok()
}

fn read_session_provider_repair_candidates(
    conn: &Connection,
    provider: &str,
) -> Result<Vec<SessionProviderRepairCandidate>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, rollout_path, archived
         FROM threads
         WHERE archived = 0
           AND has_user_event = 1
           AND (model_provider IS NULL OR model_provider != ?1)
         ORDER BY updated_at_ms DESC, id DESC",
    )?;
    let rows = stmt.query_map([provider], |row| {
        Ok(SessionProviderRepairCandidate {
            id: row.get(0)?,
            rollout_path: row.get::<_, Option<String>>(1)?.map(PathBuf::from),
            archived: row.get::<_, i64>(2)? == 1,
        })
    })?;

    let mut candidates = Vec::new();
    for row in rows {
        candidates.push(row?);
    }
    Ok(candidates)
}

fn sqlite_integrity_check(conn: &Connection) -> Result<String, rusqlite::Error> {
    conn.query_row("PRAGMA integrity_check;", [], |row| row.get(0))
}

fn read_session_recovery_index_entries(
    path: &Path,
) -> Result<HashMap<String, SessionRecoveryIndexEntry>, AppError> {
    let file = fs::File::open(path)?;
    let mut entries = HashMap::new();

    for line in BufReader::new(file).lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let Ok(entry) = serde_json::from_str::<SessionIndexEntry>(trimmed) else {
            continue;
        };
        let Ok(parsed) = DateTime::parse_from_rfc3339(&entry.updated_at) else {
            continue;
        };
        let ms = parsed.timestamp_millis();
        entries.insert(
            entry.id.clone(),
            SessionRecoveryIndexEntry {
                ms,
                sec: ms.div_euclid(1_000),
            },
        );
    }

    Ok(entries)
}

fn read_session_recovery_threads(
    conn: &Connection,
) -> Result<Vec<SessionRecoveryThread>, rusqlite::Error> {
    let columns = thread_table_columns(conn)?;
    let model_provider_expr = if columns.iter().any(|column| column == "model_provider") {
        "model_provider"
    } else {
        "NULL"
    };
    let sql = format!(
        "SELECT id, rollout_path, updated_at, updated_at_ms, cwd, title, has_user_event, archived, {model_provider_expr}
         FROM threads
         ORDER BY updated_at_ms DESC, id DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(SessionRecoveryThread {
            id: row.get(0)?,
            rollout_path: row.get::<_, Option<String>>(1)?.map(PathBuf::from),
            updated_at: row.get(2)?,
            updated_at_ms: row.get(3)?,
            cwd: row.get(4)?,
            title: row.get(5)?,
            has_user_event: row.get::<_, i64>(6)? == 1,
            archived: row.get::<_, i64>(7)? == 1,
            model_provider: row.get(8)?,
        })
    })?;

    let mut threads = Vec::new();
    for row in rows {
        threads.push(row?);
    }
    Ok(threads)
}

fn assemble_session_recovery_report(
    target_dir: &Path,
    db_path: &Path,
    session_index_path: &Path,
    session_index: HashMap<String, SessionRecoveryIndexEntry>,
    threads: Vec<SessionRecoveryThread>,
    sqlite_integrity: String,
    recent_limit: usize,
) -> Result<SessionRecoveryReport, AppError> {
    let mut missing_rollout_files = Vec::new();
    let mut has_user_event_false_but_rollout_has_user_message = Vec::new();
    let mut db_time_mismatch_with_session_index = Vec::new();
    let mut rollout_mtime_mismatch_with_session_index = Vec::new();
    let indexed_thread_ids = session_index.keys().cloned().collect::<HashSet<_>>();
    let thread_ids = threads
        .iter()
        .map(|thread| thread.id.clone())
        .collect::<HashSet<_>>();

    let mut archived = 0;
    let mut unarchived = 0;
    let mut has_user_event_true = 0;
    let mut has_user_event_false = 0;
    let mut model_provider_counts = HashMap::<String, usize>::new();

    for thread in &threads {
        if thread.archived {
            archived += 1;
        } else {
            unarchived += 1;
        }
        if thread.has_user_event {
            has_user_event_true += 1;
        } else {
            has_user_event_false += 1;
        }
        let provider = thread
            .model_provider
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("openai");
        let provider_key = format!(
            "{provider}\tarchived={}\thasUserEvent={}",
            thread.archived, thread.has_user_event
        );
        *model_provider_counts.entry(provider_key).or_insert(0) += 1;

        let Some(rollout_path) = thread.rollout_path.as_ref() else {
            missing_rollout_files.push(MissingRolloutSample {
                id: thread.id.clone(),
                archived: thread.archived,
                rollout_path: None,
            });
            continue;
        };
        if !rollout_path.exists() {
            missing_rollout_files.push(MissingRolloutSample {
                id: thread.id.clone(),
                archived: thread.archived,
                rollout_path: Some(rollout_path.to_string_lossy().to_string()),
            });
            continue;
        }

        if !thread.has_user_event && rollout_has_user_message(rollout_path) {
            has_user_event_false_but_rollout_has_user_message.push(HasUserEventMismatchSample {
                id: thread.id.clone(),
                archived: thread.archived,
                cwd: thread.cwd.clone(),
                title: thread.title.clone(),
            });
        }

        let Some(indexed) = session_index.get(&thread.id) else {
            continue;
        };
        if thread.updated_at != indexed.sec || thread.updated_at_ms != indexed.ms {
            db_time_mismatch_with_session_index.push(SessionTimeMismatchSample {
                id: thread.id.clone(),
                cwd: thread.cwd.clone(),
                db_updated_at_ms: thread.updated_at_ms,
                indexed_updated_at_ms: indexed.ms,
            });
        }

        let rollout_mtime_ms = file_mtime_millis(rollout_path)?;
        if (rollout_mtime_ms - indexed.ms).abs() > 1_000 {
            rollout_mtime_mismatch_with_session_index.push(RolloutMtimeMismatchSample {
                id: thread.id.clone(),
                rollout_path: rollout_path.to_string_lossy().to_string(),
                rollout_mtime_ms,
                indexed_updated_at_ms: indexed.ms,
            });
        }
    }

    let db_thread_ids_missing_from_session_index = threads
        .iter()
        .filter(|thread| !indexed_thread_ids.contains(&thread.id))
        .count();
    let session_index_ids_missing_from_db = session_index
        .keys()
        .filter(|id| !thread_ids.contains(*id))
        .count();
    let saved_roots_with_chats_outside_recent_window = find_saved_roots_outside_recent_window(
        target_dir.join(".codex-global-state.json"),
        &threads,
        recent_limit,
    );
    let inferred_current_model_provider = threads
        .iter()
        .filter(|thread| !thread.archived && thread.has_user_event)
        .max_by(|left, right| {
            left.updated_at_ms
                .cmp(&right.updated_at_ms)
                .then_with(|| left.id.cmp(&right.id))
        })
        .and_then(|thread| {
            thread
                .model_provider
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string)
        });
    let app_default_model_provider_mismatch = inferred_current_model_provider
        .as_deref()
        .map(|provider| {
            threads
                .iter()
                .filter(|thread| !thread.archived && thread.has_user_event)
                .filter(|thread| {
                    thread
                        .model_provider
                        .as_deref()
                        .filter(|value| !value.trim().is_empty())
                        .unwrap_or("openai")
                        != provider
                })
                .count()
        })
        .unwrap_or(0);

    Ok(SessionRecoveryReport {
        codex_home: target_dir.to_string_lossy().to_string(),
        db_path: db_path.to_string_lossy().to_string(),
        session_index_path: session_index_path.to_string_lossy().to_string(),
        recent_limit,
        sqlite_integrity,
        counts: SessionRecoveryCounts {
            session_index_entries: session_index.len(),
            db_threads: threads.len(),
            archived,
            unarchived,
            has_user_event_true,
            has_user_event_false,
            inferred_current_model_provider,
            model_provider_counts,
        },
        repair_candidates: SessionRecoveryCandidates {
            missing_rollout_files: missing_rollout_files.len(),
            has_user_event_false_but_rollout_has_user_message:
                has_user_event_false_but_rollout_has_user_message.len(),
            db_time_mismatch_with_session_index: db_time_mismatch_with_session_index.len(),
            rollout_mtime_mismatch_with_session_index:
                rollout_mtime_mismatch_with_session_index.len(),
            db_thread_ids_missing_from_session_index,
            session_index_ids_missing_from_db,
            app_default_model_provider_mismatch,
        },
        samples: SessionRecoverySamples {
            missing_rollout_files: missing_rollout_files.into_iter().take(20).collect(),
            has_user_event_false_but_rollout_has_user_message:
                has_user_event_false_but_rollout_has_user_message
                    .into_iter()
                    .take(20)
                    .collect(),
            db_time_mismatch_with_session_index: db_time_mismatch_with_session_index
                .into_iter()
                .take(20)
                .collect(),
            rollout_mtime_mismatch_with_session_index:
                rollout_mtime_mismatch_with_session_index
                    .into_iter()
                    .take(20)
                    .collect(),
            saved_roots_with_chats_outside_recent_window:
                saved_roots_with_chats_outside_recent_window
                    .into_iter()
                    .take(30)
                    .collect(),
        },
        notes: vec![
            "savedRootsWithChatsOutsideRecentWindow 通常只是侧边栏 recent-window 限制，不代表会话损坏。".into(),
            "默认安全修复不会改旧会话时间戳，也不会把旧聊天强行顶回最近列表。".into(),
            "只有在批量时间戳被异常污染时，才建议使用高级时间修复。".into(),
        ],
    })
}

fn find_saved_roots_outside_recent_window(
    global_state_path: PathBuf,
    threads: &[SessionRecoveryThread],
    recent_limit: usize,
) -> Vec<SavedRootOutsideRecentWindowSample> {
    let Ok(content) = fs::read_to_string(global_state_path) else {
        return Vec::new();
    };
    let Ok(state) = serde_json::from_str::<serde_json::Value>(&content) else {
        return Vec::new();
    };
    let saved_roots = state
        .get("electron-saved-workspace-roots")
        .and_then(|value| value.as_array())
        .map(|entries| {
            entries
                .iter()
                .filter_map(|value| value.as_str())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut visible_threads = threads
        .iter()
        .filter(|thread| !thread.archived && thread.has_user_event)
        .cloned()
        .collect::<Vec<_>>();
    visible_threads.sort_by(|left, right| {
        right
            .updated_at_ms
            .cmp(&left.updated_at_ms)
            .then_with(|| right.id.cmp(&left.id))
    });
    let visible_roots = visible_threads
        .into_iter()
        .take(recent_limit)
        .filter_map(|thread| thread.cwd)
        .collect::<HashSet<_>>();

    let mut latest_by_cwd = HashMap::<String, &SessionRecoveryThread>::new();
    for thread in threads
        .iter()
        .filter(|thread| !thread.archived && thread.has_user_event)
    {
        let Some(cwd) = thread.cwd.as_ref() else {
            continue;
        };
        match latest_by_cwd.get(cwd) {
            Some(existing)
                if existing.updated_at_ms > thread.updated_at_ms
                    || (existing.updated_at_ms == thread.updated_at_ms
                        && existing.id.as_str() >= thread.id.as_str()) => {}
            _ => {
                latest_by_cwd.insert(cwd.clone(), thread);
            }
        }
    }

    saved_roots
        .into_iter()
        .filter_map(|root| {
            let latest = latest_by_cwd.get(&root)?;
            if visible_roots.contains(&root) {
                return None;
            }

            Some(SavedRootOutsideRecentWindowSample {
                root,
                latest_thread_id: latest.id.clone(),
                latest_title: latest.title.clone(),
                latest_updated_at: Utc
                    .timestamp_millis_opt(latest.updated_at_ms)
                    .single()
                    .map(|value| value.to_rfc3339_opts(SecondsFormat::Millis, true))
                    .unwrap_or_else(|| "1970-01-01T00:00:00.000Z".into()),
            })
        })
        .collect()
}

fn rollout_has_user_message(path: &Path) -> bool {
    let Ok(file) = fs::File::open(path) else {
        return false;
    };

    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        if contains_user_message(&value) {
            return true;
        }
    }

    false
}

fn contains_user_message(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Array(entries) => entries.iter().any(contains_user_message),
        serde_json::Value::Object(map) => {
            let role = map
                .get("role")
                .and_then(|value| value.as_str())
                .map(|value| value.to_ascii_lowercase());
            let kind = map
                .get("type")
                .and_then(|value| value.as_str())
                .map(|value| value.to_ascii_lowercase());

            if role.as_deref() == Some("user") {
                return true;
            }
            if matches!(
                kind.as_deref(),
                Some("user-message") | Some("usermessage") | Some("user_message")
            ) {
                return true;
            }

            map.values().any(contains_user_message)
        }
        _ => false,
    }
}

fn file_mtime_millis(path: &Path) -> Result<i64, AppError> {
    let metadata = fs::metadata(path)?;
    let modified = FileTime::from_last_modification_time(&metadata);
    Ok(modified.unix_seconds() * 1_000 + i64::from(modified.nanoseconds() / 1_000_000))
}

fn set_rollout_mtime_millis(path: &Path, millis: i64) -> Result<(), AppError> {
    let seconds = millis.div_euclid(1_000);
    let millis = millis.rem_euclid(1_000) as u32;
    set_file_mtime(path, FileTime::from_unix_time(seconds, millis * 1_000_000))?;
    Ok(())
}

fn thread_table_columns(conn: &Connection) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn.prepare("PRAGMA table_info(threads)")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;

    let mut columns = Vec::new();
    for row in rows {
        columns.push(row?);
    }

    Ok(columns)
}

const COMMON_PROFILE_SCALAR_KEYS: &[&str] = &["model", "model_reasoning_effort"];
const THIRD_PARTY_PROFILE_SCALAR_KEYS: &[&str] = &[
    "openai_base_url",
    "supports_websockets",
    "model_provider",
    "review_model",
    "plan_mode_reasoning_effort",
    "model_context_window",
    "model_auto_compact_token_limit",
    "show_raw_agent_reasoning",
    "approval_policy",
    "sandbox_mode",
    "personality",
    "web_search",
    "network_access",
];
const THIRD_PARTY_PROFILE_TABLE_KEYS: &[&str] =
    &["model_providers", "tui", "sandbox_workspace_write"];
const THIRD_PARTY_PROFILE_FEATURE_KEYS: &[&str] = &[
    "guardian_approval",
    "remote_connections",
    "remote_control",
    "memories",
];
const ALL_PROFILE_SCALAR_KEYS: &[&str] = &[
    "openai_base_url",
    "supports_websockets",
    "model_provider",
    "model",
    "review_model",
    "model_reasoning_effort",
    "plan_mode_reasoning_effort",
    "model_context_window",
    "model_auto_compact_token_limit",
    "disable_response_storage",
    "show_raw_agent_reasoning",
    "approval_policy",
    "sandbox_mode",
    "personality",
    "web_search",
    "network_access",
];
const ALL_PROFILE_TABLE_KEYS: &[&str] = &["model_providers", "tui", "sandbox_workspace_write"];
const DEFAULT_CODEX_USAGE_ENDPOINT: &str = "https://chatgpt.com/backend-api/wham/usage";
const DEFAULT_YLSCODE_USAGE_ENDPOINT: &str = "https://code.ylsagi.com/codex/info";
const REFRESH_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const REFRESH_TOKEN_URL_OVERRIDE_ENV_VAR: &str = "CODEX_REFRESH_TOKEN_URL_OVERRIDE";
const REFRESH_TOKEN_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_HTTP_CONNECT_TIMEOUT_MS: u64 = 5_000;
const DEFAULT_CODEX_USAGE_TIMEOUT_MS: u64 = 15_000;
const DEFAULT_LATENCY_PROBE_TIMEOUT_MS: u64 = 12_000;
const DEFAULT_THIRD_PARTY_USAGE_TIMEOUT_MS: u64 = 15_000;

#[derive(Debug, Deserialize)]
struct OAuthRefreshResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
}

#[derive(Debug)]
struct ResolvedCodexUsageAuthSource {
    auth_json: String,
    config_toml: String,
    should_sync_runtime_state: bool,
}

fn is_official_oauth_auth(auth_json: &str) -> Result<bool, AppError> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json)
        .map_err(|error| AppError::InvalidAuthJson(error.to_string()))?;

    Ok(auth
        .get("auth_mode")
        .and_then(|value| value.as_str())
        .is_some_and(|value| value == "chatgpt")
        || auth.get("tokens").is_some())
}

fn validate_auth_json(contents: &str) -> Result<(), AppError> {
    serde_json::from_str::<serde_json::Value>(contents)
        .map(|_| ())
        .map_err(|error| AppError::InvalidAuthJson(error.to_string()))
}

fn validate_config_toml(contents: &str) -> Result<(), AppError> {
    toml::from_str::<toml::Value>(contents)
        .map(|_| ())
        .map_err(|error| AppError::InvalidConfigToml(error.to_string()))
}

fn parse_toml_table(contents: &str) -> Result<toml::map::Map<String, toml::Value>, AppError> {
    if contents.trim().is_empty() {
        return Ok(toml::map::Map::new());
    }

    let parsed = toml::from_str::<toml::Value>(contents)
        .map_err(|error| AppError::InvalidConfigToml(error.to_string()))?;

    match parsed {
        toml::Value::Table(table) => Ok(table),
        _ => Err(AppError::InvalidConfigToml(
            "config.toml must have a table at the top level.".into(),
        )),
    }
}

fn shared_config_table(
    table: &toml::map::Map<String, toml::Value>,
) -> toml::map::Map<String, toml::Value> {
    let mut shared = table.clone();

    for key in ALL_PROFILE_SCALAR_KEYS {
        shared.remove(*key);
    }

    for key in ALL_PROFILE_TABLE_KEYS {
        shared.remove(*key);
    }

    shared
}

fn managed_config_table(
    auth_json: &str,
    table: &toml::map::Map<String, toml::Value>,
) -> Result<toml::map::Map<String, toml::Value>, AppError> {
    let mut managed = toml::map::Map::new();

    for key in COMMON_PROFILE_SCALAR_KEYS {
        if let Some(value) = table.get(*key) {
            managed.insert((*key).to_string(), value.clone());
        }
    }

    if !is_official_oauth_auth(auth_json)? || config_has_symbiotic_provider(table) {
        for key in THIRD_PARTY_PROFILE_SCALAR_KEYS {
            if let Some(value) = table.get(*key) {
                managed.insert((*key).to_string(), value.clone());
            }
        }

        for key in THIRD_PARTY_PROFILE_TABLE_KEYS {
            if let Some(value) = table.get(*key) {
                managed.insert((*key).to_string(), value.clone());
            }
        }

        if let Some(features) = table.get("features").and_then(|value| value.as_table()) {
            let mut managed_features = toml::map::Map::new();
            for key in THIRD_PARTY_PROFILE_FEATURE_KEYS {
                if let Some(value) = features.get(*key) {
                    managed_features.insert((*key).to_string(), value.clone());
                }
            }
            if !managed_features.is_empty() {
                managed.insert("features".to_string(), toml::Value::Table(managed_features));
            }
        }
    }

    Ok(managed)
}

fn config_has_symbiotic_provider(table: &toml::map::Map<String, toml::Value>) -> bool {
    table
        .get("model_providers")
        .and_then(|value| value.as_table())
        .is_some_and(|providers| {
            providers.values().any(|provider| {
                let Some(provider) = provider.as_table() else {
                    return false;
                };
                let requires_openai_auth = provider
                    .get("requires_openai_auth")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
                let has_bearer_token = provider
                    .get("experimental_bearer_token")
                    .and_then(|value| value.as_str())
                    .is_some_and(|value| !value.trim().is_empty());
                requires_openai_auth && has_bearer_token
            })
        })
}

fn has_non_empty_string(table: &toml::map::Map<String, toml::Value>, key: &str) -> bool {
    table
        .get(key)
        .and_then(|value| value.as_str())
        .is_some_and(|value| !value.trim().is_empty())
}

fn table_has_third_party_base_url(table: &toml::map::Map<String, toml::Value>) -> bool {
    if has_non_empty_string(table, "openai_base_url") {
        return true;
    }

    table
        .get("model_providers")
        .and_then(|value| value.as_table())
        .is_some_and(|providers| {
            providers.values().any(|provider| {
                provider
                    .as_table()
                    .is_some_and(|provider| has_non_empty_string(provider, "base_url"))
            })
        })
}

fn third_party_websockets_default_target(
    auth_json: &str,
    table: &toml::map::Map<String, toml::Value>,
) -> Result<bool, AppError> {
    if is_official_oauth_auth(auth_json)? {
        return Ok(config_has_symbiotic_provider(table));
    }

    Ok(table_has_third_party_base_url(table))
}

fn apply_third_party_websockets_default(
    auth_json: &str,
    table: &mut toml::map::Map<String, toml::Value>,
) -> Result<(), AppError> {
    if !third_party_websockets_default_target(auth_json, table)? {
        return Ok(());
    }

    let mut wrote_provider_default = false;
    if let Some(providers) = table
        .get_mut("model_providers")
        .and_then(|value| value.as_table_mut())
    {
        let provider_keys = providers.keys().cloned().collect::<Vec<_>>();
        for provider_key in provider_keys {
            let Some(provider) = providers
                .get_mut(&provider_key)
                .and_then(|value| value.as_table_mut())
            else {
                continue;
            };
            if has_non_empty_string(provider, "base_url") {
                provider.insert("supports_websockets".into(), toml::Value::Boolean(false));
                wrote_provider_default = true;
            }
        }
    }

    if !wrote_provider_default && has_non_empty_string(table, "openai_base_url") {
        table.insert("supports_websockets".into(), toml::Value::Boolean(false));
    }

    Ok(())
}

fn managed_config_hash(auth_json: &str, contents: &str) -> Result<String, AppError> {
    let table = parse_toml_table(contents)?;
    let serialized = toml::to_string(&toml::Value::Table(managed_config_table(
        auth_json, &table,
    )?))
    .map_err(|error| AppError::Message(error.to_string()))?;
    Ok(sha256_bytes(serialized.as_bytes()))
}

fn normalize_config_toml_for_auth(auth_json: &str, config_toml: &str) -> Result<String, AppError> {
    let table = parse_toml_table(config_toml)?;
    let mut normalized = shared_config_table(&table);
    let mut managed = managed_config_table(auth_json, &table)?;
    apply_third_party_websockets_default(auth_json, &mut managed)?;
    for (key, value) in managed {
        normalized.insert(key, value);
    }

    toml::to_string_pretty(&toml::Value::Table(normalized))
        .map_err(|error| AppError::Message(error.to_string()))
}

fn migrate_legacy_third_party_config_toml(
    auth_json: &str,
    config_toml: &str,
) -> Result<Option<String>, AppError> {
    if is_official_oauth_auth(auth_json)? {
        return Ok(None);
    }

    let table = parse_toml_table(config_toml)?;
    if table
        .get("openai_base_url")
        .and_then(|value| value.as_str())
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Ok(None);
    }

    let Some(providers) = table
        .get("model_providers")
        .and_then(|value| value.as_table())
    else {
        return Ok(None);
    };
    let Some(provider_key) = table
        .get("model_provider")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| providers.keys().next().cloned())
    else {
        return Ok(None);
    };
    let Some(provider) = providers
        .get(&provider_key)
        .or_else(|| providers.values().next())
        .and_then(|value| value.as_table())
    else {
        return Ok(None);
    };
    let Some(base_url) = provider
        .get("base_url")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };

    let model = table
        .get("model")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "gpt-5.5".into());
    let review_model = table
        .get("review_model")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| model.clone());

    Ok(Some(standard_third_party_config_toml(
        &base_url,
        &model,
        &review_model,
    )))
}

fn standard_third_party_config_toml(base_url: &str, model: &str, review_model: &str) -> String {
    format!(
        r#"openai_base_url = "{}"
supports_websockets = false
model_provider = "openai"
model = "{}"
review_model = "{}"
model_reasoning_effort = "high"
plan_mode_reasoning_effort = "xhigh"
show_raw_agent_reasoning = true
approval_policy = "never"
sandbox_mode = "danger-full-access"
personality = "pragmatic"
web_search = "live"
model_context_window = 1000000
model_auto_compact_token_limit = 400000

[tui]
terminal_title = []
status_line = ["model-with-reasoning", "context-usage", "current-dir", "git-branch"]

[features]
guardian_approval = true
remote_connections = true
memories = true

[sandbox_workspace_write]
network_access = true
"#,
        escape_toml_basic_string(base_url),
        escape_toml_basic_string(model),
        escape_toml_basic_string(review_model),
    )
}

fn escape_toml_basic_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn merge_profile_managed_config(
    current_config_toml: &str,
    next_auth_json: &str,
    profile_config_toml: &str,
) -> Result<String, AppError> {
    let current_table = parse_toml_table(current_config_toml)?;
    let profile_table = parse_toml_table(profile_config_toml)?;
    let mut merged = shared_config_table(&current_table);

    for (key, value) in managed_config_table(next_auth_json, &profile_table)? {
        if key == "features" {
            merge_features_table(&mut merged, value);
        } else {
            merged.insert(key, value);
        }
    }

    toml::to_string_pretty(&toml::Value::Table(merged))
        .map_err(|error| AppError::Message(error.to_string()))
}

fn merge_features_table(target: &mut toml::map::Map<String, toml::Value>, value: toml::Value) {
    let toml::Value::Table(next_features) = value else {
        target.insert("features".to_string(), value);
        return;
    };

    let mut merged_features = target
        .remove("features")
        .and_then(|value| match value {
            toml::Value::Table(table) => Some(table),
            _ => None,
        })
        .unwrap_or_default();

    for (key, value) in next_features {
        merged_features.insert(key, value);
    }

    target.insert("features".to_string(), toml::Value::Table(merged_features));
}

fn detect_auth_type_label(auth_json: &str, config_toml: &str) -> Result<String, AppError> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json)
        .map_err(|error| AppError::InvalidAuthJson(error.to_string()))?;
    let config = parse_toml_table(config_toml)?;

    if is_official_oauth_auth(auth_json)? && config_has_symbiotic_provider(&config) {
        return Ok("共生配置".into());
    }

    if is_official_oauth_auth(auth_json)? {
        return Ok("官方 OAuth".into());
    }

    let has_openai_api_key = auth
        .get("OPENAI_API_KEY")
        .and_then(|value| value.as_str())
        .is_some_and(|value| !value.trim().is_empty());

    if has_openai_api_key {
        let has_openai_base_url = config
            .get("openai_base_url")
            .and_then(|value| value.as_str())
            .is_some_and(|value| !value.trim().is_empty());
        let has_custom_provider = has_openai_base_url
            || config
                .get("model_providers")
                .and_then(|value| value.as_table())
                .is_some_and(|providers| {
                    providers.values().any(|provider| {
                        provider
                            .as_table()
                            .and_then(|table| table.get("base_url"))
                            .is_some()
                    })
                });

        if has_custom_provider {
            return Ok("第三方 API".into());
        }

        return Ok("API Key".into());
    }

    Ok(unknown_auth_type_label())
}

fn auth_match_hash(auth_json: &str) -> Result<String, AppError> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json)
        .map_err(|error| AppError::InvalidAuthJson(error.to_string()))?;

    if is_official_oauth_auth(auth_json)? {
        if let Some(id_token) = auth
            .get("tokens")
            .and_then(|value| value.as_object())
            .and_then(|tokens| tokens.get("id_token"))
            .and_then(|value| value.as_str())
        {
            if let Some(identity_payload) = oauth_identity_payload(id_token) {
                return Ok(sha256_bytes(identity_payload.as_bytes()));
            }
        }
    }

    if let Some(api_key) = auth.get("OPENAI_API_KEY").and_then(|value| value.as_str()) {
        return Ok(sha256_bytes(api_key.as_bytes()));
    }

    Ok(sha256_bytes(auth_json.as_bytes()))
}

fn oauth_identity_payload(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let json = serde_json::from_slice::<serde_json::Value>(&decoded).ok()?;

    let email = json
        .get("email")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let auth_section = json.get("https://api.openai.com/auth");
    let user_id = auth_section
        .and_then(|section| section.get("chatgpt_user_id"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let account_id = auth_section
        .and_then(|section| section.get("chatgpt_account_id"))
        .and_then(|value| value.as_str())
        .unwrap_or("");

    if email.is_empty() && user_id.is_empty() && account_id.is_empty() {
        return None;
    }

    Some(format!(
        "email={email};user_id={user_id};account_id={account_id}"
    ))
}

fn oauth_account_id(auth_json: &str) -> Option<String> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json).ok()?;
    auth.get("tokens")
        .and_then(|value| value.as_object())
        .and_then(|tokens| tokens.get("id_token"))
        .and_then(|value| value.as_str())
        .and_then(|id_token| {
            let payload = id_token.split('.').nth(1)?;
            let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
            let json = serde_json::from_slice::<serde_json::Value>(&decoded).ok()?;
            json.get("https://api.openai.com/auth")
                .and_then(|section| section.get("chatgpt_account_id"))
                .and_then(|value| value.as_str())
                .map(|value| value.to_string())
        })
}

fn oauth_api_account_id(auth_json: &str) -> Option<String> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json).ok()?;
    auth.get("tokens")
        .and_then(|value| value.as_object())
        .and_then(|tokens| tokens.get("account_id"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .or_else(|| oauth_account_id(auth_json))
}

fn oauth_access_token(auth_json: &str) -> Option<String> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json).ok()?;
    auth.get("tokens")
        .and_then(|value| value.as_object())
        .and_then(|tokens| tokens.get("access_token"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}

fn oauth_refresh_token(auth_json: &str) -> Option<String> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json).ok()?;
    auth.get("tokens")
        .and_then(|value| value.as_object())
        .and_then(|tokens| tokens.get("refresh_token"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}

fn oauth_id_token(auth_json: &str) -> Option<String> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json).ok()?;
    auth.get("tokens")
        .and_then(|value| value.as_object())
        .and_then(|tokens| tokens.get("id_token"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}

fn oauth_plan_type(auth_json: &str) -> Option<String> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json).ok()?;
    auth.get("tokens")
        .and_then(|value| value.as_object())
        .and_then(|tokens| tokens.get("id_token"))
        .and_then(|value| value.as_str())
        .and_then(|id_token| {
            let payload = id_token.split('.').nth(1)?;
            let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
            let json = serde_json::from_slice::<serde_json::Value>(&decoded).ok()?;
            json.get("https://api.openai.com/auth")
                .and_then(|section| section.get("chatgpt_plan_type"))
                .and_then(|value| value.as_str())
                .map(|value| value.to_ascii_lowercase())
        })
}

fn codex_usage_endpoint() -> String {
    std::env::var("CODEX_AUTH_SWITCH_CODEX_USAGE_ENDPOINT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_CODEX_USAGE_ENDPOINT.to_string())
}

fn ylscode_usage_endpoint() -> String {
    std::env::var("CODEX_AUTH_SWITCH_YLSCODE_USAGE_ENDPOINT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_YLSCODE_USAGE_ENDPOINT.to_string())
}

fn refresh_token_endpoint() -> String {
    std::env::var(REFRESH_TOKEN_URL_OVERRIDE_ENV_VAR)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| REFRESH_TOKEN_URL.to_string())
}

fn duration_from_env_ms(name: &str, default_ms: u64) -> Duration {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .map(Duration::from_millis)
        .unwrap_or_else(|| Duration::from_millis(default_ms))
}

fn http_connect_timeout() -> Duration {
    duration_from_env_ms(
        "CODEX_AUTH_SWITCH_HTTP_CONNECT_TIMEOUT_MS",
        DEFAULT_HTTP_CONNECT_TIMEOUT_MS,
    )
}

fn codex_usage_timeout() -> Duration {
    duration_from_env_ms(
        "CODEX_AUTH_SWITCH_CODEX_USAGE_TIMEOUT_MS",
        DEFAULT_CODEX_USAGE_TIMEOUT_MS,
    )
}

fn latency_probe_timeout() -> Duration {
    duration_from_env_ms(
        "CODEX_AUTH_SWITCH_LATENCY_PROBE_TIMEOUT_MS",
        DEFAULT_LATENCY_PROBE_TIMEOUT_MS,
    )
}

fn third_party_usage_timeout() -> Duration {
    duration_from_env_ms(
        "CODEX_AUTH_SWITCH_THIRD_PARTY_USAGE_TIMEOUT_MS",
        DEFAULT_THIRD_PARTY_USAGE_TIMEOUT_MS,
    )
}

fn oauth_refresh_timeout() -> Duration {
    duration_from_env_ms(
        "CODEX_AUTH_SWITCH_REFRESH_TOKEN_TIMEOUT_MS",
        DEFAULT_CODEX_USAGE_TIMEOUT_MS,
    )
}

fn build_http_agent(timeout: Duration) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(http_connect_timeout())
        .timeout(timeout)
        .build()
}

fn is_ureq_timeout(error: &ureq::Error) -> bool {
    error.kind() == ureq::ErrorKind::Io
        && error.to_string().to_ascii_lowercase().contains("timed out")
}

fn format_timeout_error(action: &str, timeout: Duration) -> AppError {
    AppError::Message(format!(
        "{action}: request timeout after {} ms.",
        timeout.as_millis()
    ))
}

fn persist_refreshed_oauth_auth_json(
    auth_json: &str,
    refreshed: OAuthRefreshResponse,
) -> Result<String, AppError> {
    let mut auth = serde_json::from_str::<serde_json::Value>(auth_json)
        .map_err(|error| AppError::InvalidAuthJson(error.to_string()))?;
    let root = auth
        .as_object_mut()
        .ok_or_else(|| AppError::InvalidAuthJson("auth.json must be a JSON object.".into()))?;

    let tokens = root
        .entry("tokens")
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    let tokens = tokens.as_object_mut().ok_or_else(|| {
        AppError::InvalidAuthJson("auth.json `tokens` must be a JSON object.".into())
    })?;

    tokens.insert(
        "access_token".into(),
        serde_json::Value::String(refreshed.access_token),
    );
    if let Some(refresh_token) = refreshed
        .refresh_token
        .or_else(|| oauth_refresh_token(auth_json))
    {
        tokens.insert(
            "refresh_token".into(),
            serde_json::Value::String(refresh_token),
        );
    }
    if let Some(id_token) = refreshed.id_token.or_else(|| oauth_id_token(auth_json)) {
        tokens.insert("id_token".into(), serde_json::Value::String(id_token));
    }

    root.insert(
        "last_refresh".into(),
        serde_json::Value::String(Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true)),
    );

    serde_json::to_string_pretty(&auth)
        .map_err(|error| AppError::InvalidAuthJson(error.to_string()))
}

fn refresh_oauth_auth_json(auth_json: &str) -> Result<String, AppError> {
    if !is_official_oauth_auth(auth_json)? {
        return Ok(auth_json.to_string());
    }

    let Some(refresh_token) = oauth_refresh_token(auth_json) else {
        return Ok(auth_json.to_string());
    };
    let timeout = oauth_refresh_timeout();

    let response = build_http_agent(timeout)
        .post(&refresh_token_endpoint())
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_form(&[
            ("grant_type", "refresh_token"),
            ("client_id", REFRESH_TOKEN_CLIENT_ID),
            ("refresh_token", refresh_token.as_str()),
        ])
        .map_err(|error| {
            if is_ureq_timeout(&error) {
                format_timeout_error("Failed to refresh ChatGPT access token", timeout)
            } else {
                match &error {
                    ureq::Error::Status(401, _) => {
                        AppError::Message("Failed to refresh ChatGPT access token: 官方 OAuth 登录已过期或已被撤销，请重新导入/登录您的 ChatGPT 账号。 (status code 401)".into())
                    }
                    ureq::Error::Status(400, _) => {
                        AppError::Message("Failed to refresh ChatGPT access token: 刷新请求无效，可能是 Token 已失效或已被撤销。 (status code 400)".into())
                    }
                    _ => AppError::Message(format!("Failed to refresh ChatGPT access token: {error}")),
                }
            }
        })?;

    let refreshed = response
        .into_json::<OAuthRefreshResponse>()
        .map_err(|error| {
            AppError::Message(format!(
                "Failed to parse ChatGPT token refresh response: {error}"
            ))
        })?;

    persist_refreshed_oauth_auth_json(auth_json, refreshed)
}

fn refresh_oauth_auth_json_for_switch(auth_json: &str) -> Result<String, AppError> {
    match refresh_oauth_auth_json(auth_json) {
        Ok(refreshed_auth_json) => Ok(refreshed_auth_json),
        Err(_)
            if oauth_access_token(auth_json).is_some() && oauth_id_token(auth_json).is_some() =>
        {
            Ok(auth_json.to_string())
        }
        Err(error) => Err(error),
    }
}

fn fetch_codex_usage_snapshot(auth_json: &str) -> Result<CodexUsageSnapshot, AppError> {
    let access_token = oauth_access_token(auth_json).ok_or_else(|| {
        AppError::Message("The selected profile does not contain a ChatGPT access token.".into())
    })?;
    let account_id = oauth_api_account_id(auth_json).ok_or_else(|| {
        AppError::Message("The selected profile does not contain a ChatGPT account id.".into())
    })?;
    let endpoint = codex_usage_endpoint();
    let timeout = codex_usage_timeout();

    let response = build_http_agent(timeout)
        .get(&endpoint)
        .set("Authorization", &format!("Bearer {access_token}"))
        .set("ChatGPT-Account-Id", &account_id)
        .set("User-Agent", "codex-auth-switch")
        .call()
        .map_err(|error| {
            if is_ureq_timeout(&error) {
                format_timeout_error("Failed to fetch Codex usage", timeout)
            } else {
                AppError::Message(format!("Failed to fetch Codex usage: {error}"))
            }
        })?;
    let body = response.into_string().map_err(|error| {
        AppError::Message(format!("Failed to read Codex usage response: {error}"))
    })?;

    parse_codex_usage_response(&body, auth_json)
}

fn parse_codex_usage_response(body: &str, auth_json: &str) -> Result<CodexUsageSnapshot, AppError> {
    let root = serde_json::from_str::<serde_json::Value>(body)?;
    let rate_limit = root.get("rate_limit");
    let primary = rate_limit
        .and_then(|value| value.get("primary_window"))
        .and_then(parse_codex_usage_window);
    let secondary = rate_limit
        .and_then(|value| value.get("secondary_window"))
        .and_then(parse_codex_usage_window);

    if primary.is_none() && secondary.is_none() {
        return Err(AppError::Message(
            "No usable Codex usage window was returned by the upstream endpoint.".into(),
        ));
    }

    Ok(CodexUsageSnapshot {
        source: "api".into(),
        plan_type: root
            .get("plan_type")
            .and_then(|value| value.as_str())
            .map(|value| value.to_ascii_lowercase())
            .or_else(|| oauth_plan_type(auth_json)),
        primary,
        secondary,
        credits: root.get("credits").and_then(parse_codex_usage_credits),
        updated_at: Utc::now(),
        error: None,
    })
}

fn codex_usage_failure_snapshot(error: String) -> CodexUsageSnapshot {
    CodexUsageSnapshot {
        source: "api".into(),
        plan_type: None,
        primary: None,
        secondary: None,
        credits: None,
        updated_at: Utc::now(),
        error: Some(error),
    }
}

fn parse_codex_usage_window(value: &serde_json::Value) -> Option<CodexUsageWindow> {
    if value.is_null() {
        return None;
    }

    Some(CodexUsageWindow {
        used_percent: value.get("used_percent").and_then(parse_usage_percent)?,
        window_minutes: value
            .get("limit_window_seconds")
            .and_then(|seconds| seconds.as_i64())
            .and_then(ceil_minutes),
        resets_at: value
            .get("reset_at")
            .and_then(|timestamp| timestamp.as_i64())
            .and_then(|timestamp| Utc.timestamp_opt(timestamp, 0).single()),
    })
}

fn parse_codex_usage_credits(value: &serde_json::Value) -> Option<CodexUsageCredits> {
    if value.is_null() {
        return None;
    }

    Some(CodexUsageCredits {
        has_credits: value
            .get("has_credits")
            .and_then(|field| field.as_bool())
            .unwrap_or(false),
        unlimited: value
            .get("unlimited")
            .and_then(|field| field.as_bool())
            .unwrap_or(false),
        balance: value
            .get("balance")
            .and_then(|field| field.as_str())
            .map(|field| field.to_string()),
    })
}

fn parse_usage_percent(value: &serde_json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|number| number as f64))
}

fn ceil_minutes(seconds: i64) -> Option<i64> {
    if seconds <= 0 {
        return None;
    }
    Some((seconds + 59) / 60)
}

fn fetch_third_party_usage_snapshot(auth_json: &str, config_toml: &str) -> ThirdPartyUsageSnapshot {
    match resolve_third_party_probe_target(auth_json, config_toml) {
        Ok(target) if target.provider_name.eq_ignore_ascii_case("ylscode") => {
            fetch_ylscode_usage_snapshot(&target)
        }
        Ok(target) => third_party_usage_failure(
            Some(target.provider_name),
            "第三方 API 用量查询目前仅支持 ylscode provider。".into(),
        ),
        Err(error) => third_party_usage_failure(None, error.to_string()),
    }
}

fn fetch_ylscode_usage_snapshot(target: &ThirdPartyProbeTarget) -> ThirdPartyUsageSnapshot {
    let timeout = third_party_usage_timeout();
    let response = build_http_agent(timeout)
        .get(&ylscode_usage_endpoint())
        .set("Authorization", &format!("Bearer {}", target.api_key))
        .set("User-Agent", "cc-switch/1.0")
        .call();

    match response {
        Ok(response) => match response.into_string() {
            Ok(body) => parse_ylscode_usage_response(&body, &target.provider_name),
            Err(error) => third_party_usage_failure(
                Some(target.provider_name.clone()),
                format!("读取 ylscode 用量响应失败：{error}"),
            ),
        },
        Err(ureq::Error::Status(code, response)) => {
            let body = response.into_string().unwrap_or_default();
            third_party_usage_failure(
                Some(target.provider_name.clone()),
                format!(
                    "ylscode 用量接口返回 HTTP {}{}",
                    code,
                    if body.trim().is_empty() {
                        String::new()
                    } else {
                        format!("：{}", truncate_probe_error(&body))
                    }
                ),
            )
        }
        Err(error) => {
            let message = if is_ureq_timeout(&error) {
                format_timeout_error("Failed to fetch ylscode usage", timeout).to_string()
            } else {
                format!("请求 ylscode 用量接口失败：{error}")
            };
            third_party_usage_failure(Some(target.provider_name.clone()), message)
        }
    }
}

fn parse_ylscode_usage_response(body: &str, provider: &str) -> ThirdPartyUsageSnapshot {
    match serde_json::from_str::<serde_json::Value>(body) {
        Ok(root) => {
            let daily = root
                .pointer("/state/userPackgeUsage")
                .and_then(parse_ylscode_usage_quota);
            let weekly = root
                .pointer("/state/userPackgeUsage_week")
                .and_then(parse_ylscode_usage_quota);
            let subscription = root
                .pointer("/state/package")
                .and_then(parse_ylscode_subscription);
            let credit = root
                .pointer("/state/userAccountInfo")
                .and_then(parse_ylscode_credit);
            let remaining = daily
                .as_ref()
                .and_then(|quota| quota.remaining.clone())
                .or_else(|| {
                    root.pointer("/state/userPackgeUsage/remaining_quota")
                        .and_then(json_scalar_to_string)
                });
            match remaining {
                Some(remaining) => ThirdPartyUsageSnapshot {
                    provider: Some(provider.to_string()),
                    remaining: Some(remaining),
                    unit: Some("USD".into()),
                    daily,
                    weekly,
                    subscription,
                    credit,
                    updated_at: Utc::now(),
                    error: None,
                },
                None => third_party_usage_failure(
                    Some(provider.to_string()),
                    "ylscode 用量响应缺少 state.userPackgeUsage.remaining_quota。".into(),
                ),
            }
        }
        Err(error) => third_party_usage_failure(
            Some(provider.to_string()),
            format!("解析 ylscode 用量响应失败：{error}"),
        ),
    }
}

fn parse_ylscode_usage_quota(value: &serde_json::Value) -> Option<ThirdPartyUsageQuotaSnapshot> {
    if !value.is_object() {
        return None;
    }

    let used = value.get("total_cost").and_then(json_scalar_to_string);
    let total = value.get("total_quota").and_then(json_scalar_to_string);
    let remaining = value.get("remaining_quota").and_then(json_scalar_to_string);
    if used.is_none() && total.is_none() && remaining.is_none() {
        return None;
    }

    let used_percent = value
        .get("used_percentage")
        .and_then(parse_percentage_value)
        .or_else(|| {
            let used = value.get("total_cost").and_then(json_scalar_to_f64)?;
            let total = value.get("total_quota").and_then(json_scalar_to_f64)?;
            if total <= 0.0 {
                return None;
            }
            Some((used / total) * 100.0)
        });

    Some(ThirdPartyUsageQuotaSnapshot {
        used,
        total,
        remaining,
        used_percent,
    })
}

fn parse_ylscode_subscription(value: &serde_json::Value) -> Option<ThirdPartySubscriptionSnapshot> {
    if !value.is_object() {
        return None;
    }

    let first_package = value
        .get("packages")
        .and_then(|packages| packages.as_array())
        .and_then(|packages| packages.first());
    let daily_quota = value
        .get("total_quota")
        .and_then(json_scalar_to_string)
        .or_else(|| {
            first_package
                .and_then(|package| package.get("package_quota").and_then(json_scalar_to_string))
        });
    let weekly_quota = value.get("weeklyQuota").and_then(json_scalar_to_string);
    let monthly_quota = daily_quota
        .as_ref()
        .and_then(|daily| parse_quota_decimal(daily))
        .map(|daily| format_compact_number(daily * 31.0));
    let expires_at = first_package
        .and_then(|package| package.get("expires_at"))
        .and_then(|value| value.as_str())
        .and_then(parse_utc_datetime);
    let amount =
        first_package.and_then(|package| package.get("amount").and_then(json_scalar_to_string));
    let package_type = first_package
        .and_then(|package| package.get("package_type").and_then(json_scalar_to_string));

    if daily_quota.is_none()
        && weekly_quota.is_none()
        && monthly_quota.is_none()
        && expires_at.is_none()
        && amount.is_none()
        && package_type.is_none()
    {
        return None;
    }

    Some(ThirdPartySubscriptionSnapshot {
        daily_quota,
        weekly_quota,
        monthly_quota,
        expires_at,
        amount,
        package_type,
    })
}

fn parse_ylscode_credit(value: &serde_json::Value) -> Option<ThirdPartyCreditSnapshot> {
    if !value.is_object() {
        return None;
    }

    let free_balance = value.get("free_balance").and_then(json_scalar_to_string);
    let paid_balance = value.get("paid_balance").and_then(json_scalar_to_string);
    let total_balance = value.get("total_balance").and_then(json_scalar_to_string);
    if free_balance.is_none() && paid_balance.is_none() && total_balance.is_none() {
        return None;
    }

    Some(ThirdPartyCreditSnapshot {
        free_balance,
        paid_balance,
        total_balance,
    })
}

fn json_scalar_to_string(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.trim().to_string()).filter(|text| !text.is_empty());
    }
    if let Some(number) = value.as_i64() {
        return Some(number.to_string());
    }
    if let Some(number) = value.as_u64() {
        return Some(number.to_string());
    }
    value.as_f64().map(|number| number.to_string())
}

fn parse_quota_decimal(value: &str) -> Option<f64> {
    value
        .trim()
        .trim_start_matches('$')
        .replace(',', "")
        .parse()
        .ok()
}

fn format_compact_number(value: f64) -> String {
    if value.is_finite() && value.fract().abs() < f64::EPSILON {
        format!("{}", value as i64)
    } else {
        value.to_string()
    }
}

fn parse_utc_datetime(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

fn json_scalar_to_f64(value: &serde_json::Value) -> Option<f64> {
    value.as_f64().or_else(|| {
        value
            .as_str()
            .and_then(|text| text.trim().trim_end_matches('%').parse::<f64>().ok())
    })
}

fn parse_percentage_value(value: &serde_json::Value) -> Option<f64> {
    json_scalar_to_f64(value)
}

fn fetch_third_party_latency_snapshot(
    auth_json: &str,
    config_toml: &str,
) -> ThirdPartyLatencySnapshot {
    match resolve_third_party_probe_target(auth_json, config_toml) {
        Ok(target) => match target.wire_api.as_str() {
            "responses" => {
                probe_third_party_stream(&target, "/responses", responses_probe_body(&target))
            }
            "chat_completions" => probe_third_party_stream(
                &target,
                "/chat/completions",
                chat_completions_probe_body(&target),
            ),
            other => latency_probe_failure(
                Some(other.to_string()),
                Some(target.model),
                None,
                None,
                format!("暂不支持 {other} 流式协议。"),
            ),
        },
        Err(error) => latency_probe_failure(None, None, None, None, error.to_string()),
    }
}

fn resolve_third_party_probe_target(
    auth_json: &str,
    config_toml: &str,
) -> Result<ThirdPartyProbeTarget, AppError> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json)
        .map_err(|error| AppError::InvalidAuthJson(error.to_string()))?;
    let auth_api_key = auth
        .get("OPENAI_API_KEY")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let config = parse_toml_table(config_toml)?;
    let model = config
        .get("model")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Message("当前卡片缺少 model，无法执行测速。".into()))?;

    let provider_name = config
        .get("model_provider")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "openai".into());

    let provider_from_table = config
        .get("model_providers")
        .and_then(|value| value.as_table())
        .and_then(|providers| {
            providers
                .get(&provider_name)
                .or_else(|| providers.values().next())
        })
        .and_then(|value| value.as_table());

    let api_key = auth_api_key.or_else(|| {
        provider_from_table
            .and_then(|provider| provider.get("experimental_bearer_token"))
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    });

    let Some(api_key) = api_key else {
        return Err(AppError::Message(
            "当前卡片缺少 OPENAI_API_KEY 或 experimental_bearer_token，无法执行第三方 API 请求。"
                .into(),
        ));
    };

    let base_url = config
        .get("openai_base_url")
        .and_then(|value| value.as_str())
        .or_else(|| {
            provider_from_table
                .and_then(|provider| provider.get("base_url"))
                .and_then(|value| value.as_str())
        })
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Message("当前卡片缺少 openai_base_url 配置。".into()))?;
    let provider_name = infer_third_party_provider_name(&provider_name, &base_url);

    let wire_api = provider_from_table
        .and_then(|provider| provider.get("wire_api"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "responses".into());

    Ok(ThirdPartyProbeTarget {
        provider_name,
        api_key,
        base_url,
        model,
        wire_api,
    })
}

fn infer_third_party_provider_name(provider_name: &str, base_url: &str) -> String {
    let normalized_provider = provider_name.trim();
    let normalized_base_url = base_url.trim().to_ascii_lowercase();
    if normalized_base_url.contains("ylsagi.com")
        || normalized_base_url.contains("ylscode")
        || normalized_base_url.contains("code.ylsagi.com")
    {
        return "ylscode".into();
    }

    if normalized_provider.is_empty() {
        "openai".into()
    } else {
        normalized_provider.to_string()
    }
}

fn responses_probe_body(target: &ThirdPartyProbeTarget) -> String {
    serde_json::json!({
        "model": target.model,
        "input": "Reply with exactly: ok",
        "stream": true,
        "max_output_tokens": 8,
        "temperature": 0
    })
    .to_string()
}

fn chat_completions_probe_body(target: &ThirdPartyProbeTarget) -> String {
    serde_json::json!({
        "model": target.model,
        "stream": true,
        "temperature": 0,
        "max_tokens": 8,
        "messages": [
            {
                "role": "user",
                "content": "Reply with exactly: ok"
            }
        ]
    })
    .to_string()
}

fn probe_third_party_stream(
    target: &ThirdPartyProbeTarget,
    path: &str,
    body: String,
) -> ThirdPartyLatencySnapshot {
    let started_at = Utc::now();
    let started = Instant::now();
    let endpoint = format!("{}{}", target.base_url, path);
    let timeout = latency_probe_timeout();
    let response = build_http_agent(timeout)
        .post(&endpoint)
        .set("Authorization", &format!("Bearer {}", target.api_key))
        .set("Content-Type", "application/json")
        .set("Accept", "text/event-stream")
        .set("User-Agent", "codex-auth-switch")
        .send_string(&body);

    match response {
        Ok(response) => {
            let status_code = Some(response.status() as u16);
            let mut reader = BufReader::new(response.into_reader());
            let mut ttft_ms = None;

            loop {
                let event = match next_sse_event(&mut reader) {
                    Ok(Some(event)) => event,
                    Ok(None) => break,
                    Err(error) => {
                        let read_error = if error.kind() == std::io::ErrorKind::TimedOut {
                            format!("读取流式响应超时（{} ms）。", timeout.as_millis())
                        } else {
                            format!("读取流式响应失败：{error}")
                        };
                        return latency_probe_failure(
                            Some(target.wire_api.clone()),
                            Some(target.model.clone()),
                            status_code,
                            Some(started.elapsed().as_millis() as u64),
                            read_error,
                        );
                    }
                };

                if event.data.trim() == "[DONE]" {
                    break;
                }

                let first_text = match target.wire_api.as_str() {
                    "responses" => extract_first_responses_delta(&event),
                    "chat_completions" => extract_first_chat_completions_delta(&event),
                    _ => None,
                };

                if ttft_ms.is_none()
                    && first_text
                        .as_deref()
                        .is_some_and(|value| !value.trim().is_empty())
                {
                    ttft_ms = Some(started.elapsed().as_millis() as u64);
                }
            }

            let total_ms = Some(started.elapsed().as_millis() as u64);
            if ttft_ms.is_none() {
                return latency_probe_failure(
                    Some(target.wire_api.clone()),
                    Some(target.model.clone()),
                    status_code,
                    total_ms,
                    "上游没有返回可识别的首个文本 token。".into(),
                );
            }

            ThirdPartyLatencySnapshot {
                wire_api: Some(target.wire_api.clone()),
                model: Some(target.model.clone()),
                ttft_ms,
                total_ms,
                status_code,
                updated_at: started_at,
                error: None,
            }
        }
        Err(ureq::Error::Status(code, response)) => {
            let body = response.into_string().unwrap_or_default();
            latency_probe_failure(
                Some(target.wire_api.clone()),
                Some(target.model.clone()),
                Some(code as u16),
                Some(started.elapsed().as_millis() as u64),
                format!(
                    "上游返回 HTTP {}{}",
                    code,
                    if body.trim().is_empty() {
                        String::new()
                    } else {
                        format!("：{}", truncate_probe_error(&body))
                    }
                ),
            )
        }
        Err(error @ ureq::Error::Transport(_)) => {
            let request_error = if is_ureq_timeout(&error) {
                format!("请求测速接口超时（{} ms）。", timeout.as_millis())
            } else {
                format!("请求失败：{error}")
            };
            latency_probe_failure(
                Some(target.wire_api.clone()),
                Some(target.model.clone()),
                None,
                Some(started.elapsed().as_millis() as u64),
                request_error,
            )
        }
    }
}

fn next_sse_event(reader: &mut impl BufRead) -> Result<Option<SseEvent>, std::io::Error> {
    let mut event = None;
    let mut data_lines = Vec::new();
    let mut saw_payload = false;

    loop {
        let mut line = String::new();
        let bytes_read = reader.read_line(&mut line)?;
        if bytes_read == 0 {
            if !saw_payload {
                return Ok(None);
            }
            break;
        }

        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            if saw_payload {
                break;
            }
            continue;
        }

        saw_payload = true;
        if let Some(value) = trimmed.strip_prefix("event:") {
            event = Some(value.trim().to_string());
            continue;
        }
        if let Some(value) = trimmed.strip_prefix("data:") {
            data_lines.push(value.trim_start().to_string());
        }
    }

    Ok(Some(SseEvent {
        event,
        data: data_lines.join("\n"),
    }))
}

fn extract_first_responses_delta(event: &SseEvent) -> Option<String> {
    if let Some(name) = event.event.as_deref() {
        if !name.contains("delta") && !name.contains("output_text") {
            return None;
        }
    }

    let payload = serde_json::from_str::<serde_json::Value>(&event.data).ok()?;
    payload
        .get("delta")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .filter(|value| !value.trim().is_empty())
}

fn extract_first_chat_completions_delta(event: &SseEvent) -> Option<String> {
    let payload = serde_json::from_str::<serde_json::Value>(&event.data).ok()?;
    payload
        .get("choices")
        .and_then(|value| value.as_array())
        .and_then(|choices| {
            choices.iter().find_map(|choice| {
                choice
                    .get("delta")
                    .and_then(|delta| delta.get("content"))
                    .and_then(|content| content.as_str())
                    .map(|content| content.to_string())
                    .filter(|content| !content.trim().is_empty())
            })
        })
}

fn latency_probe_failure(
    wire_api: Option<String>,
    model: Option<String>,
    status_code: Option<u16>,
    total_ms: Option<u64>,
    error: String,
) -> ThirdPartyLatencySnapshot {
    ThirdPartyLatencySnapshot {
        wire_api,
        model,
        ttft_ms: None,
        total_ms,
        status_code,
        updated_at: Utc::now(),
        error: Some(error),
    }
}

fn third_party_usage_failure(provider: Option<String>, error: String) -> ThirdPartyUsageSnapshot {
    ThirdPartyUsageSnapshot {
        provider,
        remaining: None,
        unit: Some("USD".into()),
        daily: None,
        weekly: None,
        subscription: None,
        credit: None,
        updated_at: Utc::now(),
        error: Some(error),
    }
}

fn truncate_probe_error(value: &str) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= 120 {
        return compact;
    }
    compact.chars().take(120).collect::<String>() + "..."
}

fn suggested_profile_name(auth_json: &str, config_toml: &str) -> Result<String, AppError> {
    let auth_type_label = detect_auth_type_label(auth_json, config_toml)?;

    if auth_type_label == "官方 OAuth" {
        if let Some(account_id) = oauth_account_id(auth_json) {
            if let Some(segment) = account_id
                .split(['-', '_'])
                .find(|segment| !segment.trim().is_empty())
            {
                return Ok(segment.to_string());
            }
            return Ok(account_id);
        }
    }

    Ok(format!("{auth_type_label} 当前配置"))
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}
