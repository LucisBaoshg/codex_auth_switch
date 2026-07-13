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

mod auth_config;
mod config_recovery;
mod manager_sessions;
mod manager_usage;
mod pac_proxy;
mod profile_io;
mod restart;
mod session_recovery;
mod updates;
mod usage_probe;
mod usage_stats;

pub(crate) use auth_config::*;
use config_recovery::{
    acknowledge_pending_notices, atomic_write_json, merge_recovery_notices,
    quarantine_corrupt_file, read_pending_notices, record_pending_notices, recovery_dir,
    stable_invalid_file_notice,
};
pub use config_recovery::{ConfigRecoveryKind, ConfigRecoveryNotice};
pub use pac_proxy::{
    get_pac_proxy_status, pac_proxy_status_from_macos_services,
    pac_proxy_status_from_macos_services_with_selection,
    pac_proxy_status_from_macos_services_with_selection_and_pac_key, parse_macos_auto_proxy_status,
    parse_windows_auto_config_url, set_pac_proxy_enabled, set_pac_proxy_selected_option,
    set_pac_proxy_selected_services, unsupported_pac_proxy_status,
    windows_pac_proxy_status_from_auto_config_url, windows_registry_command_creation_flags,
    MacosAutoProxyStatus, PacProxyOption, PacProxyStatus, DEFAULT_PAC_PROXY_KEY, PAC_PROXY_CA_URL,
    PAC_PROXY_URL, PAC_PROXY_US_URL,
};
pub use profile_io::*;
pub use restart::{
    codex_restart_plan_for_platform, restart_codex_app, restart_codex_script, CodexRestartPlatform,
};
pub(crate) use session_recovery::*;
pub use updates::{
    check_for_update, check_install_location, install_update, InstallLocationStatus,
    UpdateCheckResult, UpdateInstallRequest,
};
pub(crate) use usage_probe::*;
pub(crate) use usage_stats::*;

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
#[derive(Default)]
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
    #[serde(default)]
    pub remote_profile_id: Option<String>,
    #[serde(default)]
    pub remote_content_version: Option<u64>,
    #[serde(default)]
    pub remote_content_hash: Option<String>,
    #[serde(default)]
    pub remote_updated_at: Option<DateTime<Utc>>,
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
    #[serde(default)]
    pub remote_profile_id: Option<String>,
    #[serde(default)]
    pub remote_content_version: Option<u64>,
    #[serde(default)]
    pub remote_content_hash: Option<String>,
    #[serde(default)]
    pub remote_updated_at: Option<DateTime<Utc>>,
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
    #[serde(default)]
    pub config_recovery_notices: Vec<ConfigRecoveryNotice>,
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
pub(crate) struct RemoteProfileRecord {
    id: String,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    updated_at: Option<DateTime<Utc>>,
    #[serde(default)]
    content_version: Option<u64>,
    #[serde(default)]
    content_hash: Option<String>,
    #[serde(default)]
    content_updated_at: Option<DateTime<Utc>>,
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
    #[serde(default)]
    pub remote_content_version: Option<u64>,
    #[serde(default)]
    pub remote_content_hash: Option<String>,
    #[serde(default)]
    pub remote_updated_at: Option<DateTime<Utc>>,
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
pub(crate) struct SessionRecoveryIndexEntry {
    ms: i64,
    sec: i64,
}

#[derive(Debug, Clone)]
pub(crate) struct SessionRecoveryThread {
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
pub(crate) struct SessionProviderRepairAudit {
    db_backup_path: String,
    rollout_backup_dir: String,
    provider: String,
    db_updates: Vec<String>,
    rollout_updates: Vec<String>,
    skipped_missing_rollout_files: Vec<MissingRolloutSample>,
    skipped_without_session_meta: Vec<String>,
}

#[derive(Debug)]
pub(crate) struct SessionProviderRepairCandidate {
    id: String,
    rollout_path: Option<PathBuf>,
    archived: bool,
}

#[derive(Debug)]
pub(crate) struct ThirdPartyProbeTarget {
    provider_name: String,
    api_key: String,
    base_url: String,
    model: String,
    wire_api: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ThirdPartyProviderDescriptor {
    provider_id: String,
    api_key_id: String,
    provider_key: String,
    provider_name: String,
    base_url: String,
    wire_api: String,
    api_key: String,
}

#[derive(Debug)]
pub(crate) struct SseEvent {
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
const ACTIVE_PROFILE_DELETE_ERROR: &str =
    "这是当前 Codex 正在使用的配置，不能直接删除。请先切换到其他配置后再删除。";

pub struct ProfileManager {
    app_data_dir: PathBuf,
    target_dir: PathBuf,
    state: StateFile,
    startup_recovery_notices: Vec<ConfigRecoveryNotice>,
}

struct TargetConfigSnapshot {
    active_profile: Option<ProfileSummary>,
    auth_type_label: Option<String>,
    recovery_notices: Vec<ConfigRecoveryNotice>,
}

impl ProfileManager {
    pub fn new(app_data_dir: PathBuf, target_dir: PathBuf) -> Result<Self, AppError> {
        let state = StateFile {
            target_dir: Some(target_dir.to_string_lossy().to_string()),
            ..StateFile::default()
        };

        let manager = Self {
            app_data_dir,
            target_dir,
            state,
            startup_recovery_notices: Vec::new(),
        };

        manager.ensure_storage_dirs()?;
        manager.persist_state()?;
        Ok(manager)
    }

    pub fn load_or_default(app_data_dir: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&app_data_dir)?;

        let state_path = app_data_dir.join("state.json");
        let mut startup_recovery_notices = Vec::new();
        let mut persist_default_state = !state_path.exists();
        let state = if !state_path.exists() {
            StateFile::default()
        } else {
            match fs::read_to_string(&state_path) {
                Ok(contents) => match serde_json::from_str::<StateFile>(&contents) {
                    Ok(state) => state,
                    Err(error) => {
                        let mut notice = stable_invalid_file_notice(
                            ConfigRecoveryKind::State,
                            &state_path,
                            contents.as_bytes(),
                            format!("state.json 无法解析：{error}"),
                            "请检查自动恢复后的 Codex 目标目录是否正确。".into(),
                        );
                        match quarantine_corrupt_file(&app_data_dir, &state_path, "state") {
                            Ok(recovery_path) => {
                                notice.recovery_path =
                                    Some(recovery_path.to_string_lossy().to_string());
                                persist_default_state = true;
                            }
                            Err(quarantine_error) => {
                                notice.summary = format!(
                                    "state.json 无法解析，且未能隔离原文件：{quarantine_error}"
                                );
                            }
                        }
                        record_pending_notices(&app_data_dir, std::slice::from_ref(&notice));
                        startup_recovery_notices.push(notice);
                        StateFile::default()
                    }
                },
                Err(error) => {
                    let notice = stable_invalid_file_notice(
                        ConfigRecoveryKind::State,
                        &state_path,
                        error.to_string().as_bytes(),
                        format!("state.json 无法读取：{error}"),
                        "请备份原文件并检查文件权限，然后确认 Codex 目标目录。".into(),
                    );
                    record_pending_notices(&app_data_dir, std::slice::from_ref(&notice));
                    startup_recovery_notices.push(notice);
                    StateFile::default()
                }
            }
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
            startup_recovery_notices,
        };

        manager.ensure_storage_dirs()?;
        if persist_default_state {
            manager.persist_state()?;
        }
        Ok(manager)
    }

    pub fn pending_config_recovery_notices(&self) -> Vec<ConfigRecoveryNotice> {
        merge_recovery_notices(
            self.startup_recovery_notices.clone(),
            read_pending_notices(&self.app_data_dir),
        )
    }

    pub fn acknowledge_config_recovery(&self, notice_ids: &[String]) -> Result<(), AppError> {
        acknowledge_pending_notices(&self.app_data_dir, notice_ids)
    }

    pub fn list_profiles(&self) -> Result<Vec<ProfileSummary>, AppError> {
        self.collect_profiles_with_recovery()
            .map(|(profiles, _)| profiles)
    }

    fn collect_profiles_with_recovery(
        &self,
    ) -> Result<(Vec<ProfileSummary>, Vec<ConfigRecoveryNotice>), AppError> {
        let mut profiles = Vec::new();
        let mut notices = Vec::new();

        if !self.profiles_dir().exists() {
            return Ok((profiles, notices));
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

            let profile_id = entry.file_name().to_string_lossy().to_string();
            match fs::read_to_string(&meta_path) {
                Ok(contents) => match serde_json::from_str::<ProfileMetadata>(&contents) {
                    Ok(metadata) => profiles.push(ProfileSummary::from(metadata)),
                    Err(error) => {
                        let mut notice = stable_invalid_file_notice(
                            ConfigRecoveryKind::ProfileMetadata,
                            &meta_path,
                            contents.as_bytes(),
                            format!("档案 {profile_id} 的 meta.json 无法解析：{error}"),
                            "请从恢复文件修复元数据，或重新导入这个档案。".into(),
                        );
                        notice.profile_id = Some(profile_id.clone());
                        match quarantine_corrupt_file(
                            &self.app_data_dir,
                            &meta_path,
                            &format!("profiles/{profile_id}/meta"),
                        ) {
                            Ok(recovery_path) => {
                                notice.recovery_path =
                                    Some(recovery_path.to_string_lossy().to_string());
                            }
                            Err(quarantine_error) => {
                                notice.summary = format!(
                                    "档案 {profile_id} 的 meta.json 无法解析，且未能隔离原文件：{quarantine_error}"
                                );
                            }
                        }
                        record_pending_notices(&self.app_data_dir, std::slice::from_ref(&notice));
                        notices.push(notice);
                    }
                },
                Err(error) => {
                    let mut notice = stable_invalid_file_notice(
                        ConfigRecoveryKind::ProfileMetadata,
                        &meta_path,
                        error.to_string().as_bytes(),
                        format!("档案 {profile_id} 的 meta.json 无法读取：{error}"),
                        "请备份原档案目录并检查文件权限，然后重新导入这个档案。".into(),
                    );
                    notice.profile_id = Some(profile_id);
                    record_pending_notices(&self.app_data_dir, std::slice::from_ref(&notice));
                    notices.push(notice);
                }
            }
        }

        profiles.sort_by_key(|profile| std::cmp::Reverse(profile.updated_at));
        Ok((profiles, notices))
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
                metadata.remote_content_version,
                metadata.remote_content_hash.clone(),
                metadata.remote_updated_at,
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
                metadata.remote_content_version,
                metadata.remote_content_hash.clone(),
                metadata.remote_updated_at,
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
            None,
            None,
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
            remote_profile_id: metadata.remote_profile_id,
            remote_content_version: metadata.remote_content_version,
            remote_content_hash: metadata.remote_content_hash,
            remote_updated_at: metadata.remote_updated_at,
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
            existing_metadata.remote_content_version,
            existing_metadata.remote_content_hash.clone(),
            existing_metadata.remote_updated_at,
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

    pub fn set_profile_remote_metadata(
        &self,
        profile_id: &str,
        remote_profile_id: String,
        remote_content_version: Option<u64>,
        remote_content_hash: Option<String>,
        remote_updated_at: Option<DateTime<Utc>>,
    ) -> Result<ProfileSummary, AppError> {
        let remote_profile_id = remote_profile_id.trim();
        if remote_profile_id.is_empty() {
            return Err(AppError::Message(
                "Remote profile id cannot be empty.".into(),
            ));
        }

        let profile_dir = self.profile_dir(profile_id)?;
        let mut metadata = self.read_profile_metadata(&profile_dir)?;
        metadata.remote_profile_id = Some(remote_profile_id.to_string());
        metadata.remote_content_version = remote_content_version;
        metadata.remote_content_hash = remote_content_hash
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        metadata.remote_updated_at = remote_updated_at;
        self.write_profile_metadata(&profile_dir, &metadata)?;
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
            let remote_updated_at = detail.content_updated_at.or(detail.updated_at);
            let profile = self.set_profile_remote_metadata(
                &profile.id,
                detail.id.clone(),
                detail.content_version,
                detail.content_hash.clone(),
                remote_updated_at,
            )?;

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

        if self
            .detect_active_profile()?
            .is_some_and(|profile| profile.id == profile_id)
        {
            return Err(AppError::Message(ACTIVE_PROFILE_DELETE_ERROR.into()));
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
        let profiles = self.list_profiles()?;
        self.detect_active_profile_from_profiles(&profiles)
    }

    fn detect_active_profile_from_profiles(
        &self,
        profiles: &[ProfileSummary],
    ) -> Result<Option<ProfileSummary>, AppError> {
        if !self.target_auth_path().exists() || !self.target_config_path().exists() {
            return Ok(None);
        }

        let auth_hash = auth_match_hash(&fs::read_to_string(self.target_auth_path())?)?;
        let auth_json = fs::read_to_string(self.target_auth_path())?;
        let config_hash =
            managed_config_hash(&auth_json, &fs::read_to_string(self.target_config_path())?)?;

        if let Some(marker) = self.read_target_marker()? {
            if marker.auth_hash == auth_hash && marker.config_hash == config_hash {
                if let Some(profile) = profiles
                    .iter()
                    .find(|profile| profile.id == marker.profile_id)
                {
                    return Ok(Some(profile.clone()));
                }
            }
        }

        for profile in profiles {
            if profile.auth_hash == auth_hash && profile.config_hash == config_hash {
                return Ok(Some(profile.clone()));
            }
        }

        if let Some(last_switch_profile_id) = self.state.last_switch_profile_id.as_deref() {
            if let Some(profile) = profiles
                .iter()
                .find(|profile| profile.id == last_switch_profile_id)
            {
                if profile.auth_hash == auth_hash {
                    return Ok(Some(profile.clone()));
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

    pub fn open_config_recovery_dir(&self) -> Result<(), AppError> {
        let recovery_dir = recovery_dir(&self.app_data_dir);
        fs::create_dir_all(&recovery_dir)?;

        #[cfg(target_os = "macos")]
        let status = Command::new("open").arg(&recovery_dir).status()?;

        #[cfg(target_os = "windows")]
        let status = Command::new("explorer").arg(&recovery_dir).status()?;

        #[cfg(all(unix, not(target_os = "macos")))]
        let status = Command::new("xdg-open").arg(&recovery_dir).status()?;

        if status.success() {
            Ok(())
        } else {
            Err(AppError::Message(
                "Failed to open the recovery directory.".into(),
            ))
        }
    }

    fn inspect_target_config_for_snapshot(
        &self,
        profiles: &[ProfileSummary],
    ) -> Result<TargetConfigSnapshot, AppError> {
        let mut notices = Vec::new();
        if !self.target_auth_path().exists() || !self.target_config_path().exists() {
            return Ok(TargetConfigSnapshot {
                active_profile: None,
                auth_type_label: None,
                recovery_notices: notices,
            });
        }

        let auth_path = self.target_auth_path();
        let auth_json = match fs::read_to_string(&auth_path) {
            Ok(contents) => contents,
            Err(error) => {
                let notice = stable_invalid_file_notice(
                    ConfigRecoveryKind::TargetAuth,
                    &auth_path,
                    error.to_string().as_bytes(),
                    format!("活动 auth.json 无法读取：{error}"),
                    "请检查文件权限、从备份恢复，或切换到一套有效档案。".into(),
                );
                record_pending_notices(&self.app_data_dir, std::slice::from_ref(&notice));
                notices.push(notice);
                return Ok(TargetConfigSnapshot {
                    active_profile: None,
                    auth_type_label: None,
                    recovery_notices: notices,
                });
            }
        };
        if let Err(error) = validate_auth_json(&auth_json) {
            let notice = stable_invalid_file_notice(
                ConfigRecoveryKind::TargetAuth,
                &auth_path,
                auth_json.as_bytes(),
                format!("活动 auth.json 无效：{error}"),
                "请从备份恢复、手工修复，或切换到一套有效档案。".into(),
            );
            record_pending_notices(&self.app_data_dir, std::slice::from_ref(&notice));
            notices.push(notice);
            return Ok(TargetConfigSnapshot {
                active_profile: None,
                auth_type_label: None,
                recovery_notices: notices,
            });
        }

        let config_path = self.target_config_path();
        let config_toml = match fs::read_to_string(&config_path) {
            Ok(contents) => contents,
            Err(error) => {
                let notice = stable_invalid_file_notice(
                    ConfigRecoveryKind::TargetConfig,
                    &config_path,
                    error.to_string().as_bytes(),
                    format!("活动 config.toml 无法读取：{error}"),
                    "请检查文件权限、从备份恢复，或切换到一套有效档案。".into(),
                );
                record_pending_notices(&self.app_data_dir, std::slice::from_ref(&notice));
                notices.push(notice);
                return Ok(TargetConfigSnapshot {
                    active_profile: None,
                    auth_type_label: None,
                    recovery_notices: notices,
                });
            }
        };
        if let Err(error) = validate_config_toml(&config_toml) {
            let notice = stable_invalid_file_notice(
                ConfigRecoveryKind::TargetConfig,
                &config_path,
                config_toml.as_bytes(),
                format!("活动 config.toml 无效：{error}"),
                "请从备份恢复、手工修复，或切换到一套有效档案。".into(),
            );
            record_pending_notices(&self.app_data_dir, std::slice::from_ref(&notice));
            notices.push(notice);
            return Ok(TargetConfigSnapshot {
                active_profile: None,
                auth_type_label: None,
                recovery_notices: notices,
            });
        }

        let auth_hash = auth_match_hash(&auth_json)?;
        let config_hash = managed_config_hash(&auth_json, &config_toml)?;
        let marker = self.read_target_marker_with_recovery(&mut notices);
        let active_profile = marker
            .as_ref()
            .filter(|marker| marker.auth_hash == auth_hash && marker.config_hash == config_hash)
            .and_then(|marker| {
                profiles
                    .iter()
                    .find(|profile| profile.id == marker.profile_id)
            })
            .or_else(|| {
                profiles.iter().find(|profile| {
                    profile.auth_hash == auth_hash && profile.config_hash == config_hash
                })
            })
            .or_else(|| {
                self.state
                    .last_switch_profile_id
                    .as_deref()
                    .and_then(|profile_id| {
                        profiles.iter().find(|profile| {
                            profile.id == profile_id && profile.auth_hash == auth_hash
                        })
                    })
            })
            .cloned();
        let auth_type_label = Some(detect_auth_type_label(&auth_json, &config_toml)?);

        Ok(TargetConfigSnapshot {
            active_profile,
            auth_type_label,
            recovery_notices: notices,
        })
    }

    pub fn snapshot(&self) -> Result<AppSnapshot, AppError> {
        let default_target_dir = default_codex_target_dir()?;
        let (profiles, profile_recovery_notices) = self.collect_profiles_with_recovery()?;
        let target_snapshot = self.inspect_target_config_for_snapshot(&profiles)?;
        let active_profile_id = target_snapshot.active_profile.map(|profile| profile.id);
        let config_recovery_notices = merge_recovery_notices(
            merge_recovery_notices(
                self.pending_config_recovery_notices(),
                profile_recovery_notices,
            ),
            target_snapshot.recovery_notices,
        );

        Ok(AppSnapshot {
            target_dir: self.target_dir.to_string_lossy().to_string(),
            using_default_target_dir: self.target_dir == default_target_dir,
            target_exists: self.target_dir.exists(),
            target_auth_exists: self.target_auth_path().exists(),
            target_config_exists: self.target_config_path().exists(),
            target_updated_at: self.resolve_target_updated_at()?,
            target_auth_type_label: target_snapshot.auth_type_label,
            active_profile_id,
            last_selected_profile_id: self.state.last_selected_profile_id.clone(),
            last_switch_profile_id: self.state.last_switch_profile_id.clone(),
            last_switched_at: self.state.last_switched_at,
            codex_usage_api_enabled: self.state.codex_usage_api_enabled,
            profiles,
            config_recovery_notices,
        })
    }

    fn ensure_storage_dirs(&self) -> Result<(), AppError> {
        fs::create_dir_all(self.profiles_dir())?;
        fs::create_dir_all(self.backups_dir())?;
        Ok(())
    }

    fn persist_state(&self) -> Result<(), AppError> {
        atomic_write_json(&self.state_path(), &self.state)
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
        atomic_write_json(&profile_dir.join("meta.json"), metadata)
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

    #[allow(clippy::too_many_arguments)]
    fn compose_profile_metadata(
        &self,
        id: String,
        name: String,
        notes: String,
        remote_profile_id: Option<String>,
        remote_content_version: Option<u64>,
        remote_content_hash: Option<String>,
        remote_updated_at: Option<DateTime<Utc>>,
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
            remote_content_version,
            remote_content_hash,
            remote_updated_at,
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

        // Guard: never let an automatic runtime capture flip a profile's auth type.
        // codex's own OAuth login rewrites auth.json but leaves the previous
        // third-party `[model_providers.*]` / `requires_openai_auth` routing in
        // config.toml. Without this check, a routine usage refresh or a pre-switch
        // capture would write that mismatched runtime state back into a clean
        // profile, silently turning e.g. 官方 OAuth into 共生配置 / 第三方 API.
        let incoming_auth_type = detect_auth_type_label(auth_json, &normalized_config)?;
        if incoming_auth_type != existing_metadata.auth_type_label {
            return Ok(());
        }

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
            existing_metadata.remote_content_version,
            existing_metadata.remote_content_hash.clone(),
            existing_metadata.remote_updated_at,
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

    fn read_target_marker(&self) -> Result<Option<TargetMarkerFile>, AppError> {
        let marker_path = self.target_marker_path();
        if !marker_path.exists() {
            return Ok(None);
        }

        Ok(Some(serde_json::from_str::<TargetMarkerFile>(
            &fs::read_to_string(marker_path)?,
        )?))
    }

    fn read_target_marker_with_recovery(
        &self,
        notices: &mut Vec<ConfigRecoveryNotice>,
    ) -> Option<TargetMarkerFile> {
        let marker_path = self.target_marker_path();
        if !marker_path.exists() {
            return None;
        }

        let contents = match fs::read_to_string(&marker_path) {
            Ok(contents) => contents,
            Err(error) => {
                let notice = stable_invalid_file_notice(
                    ConfigRecoveryKind::TargetMarker,
                    &marker_path,
                    error.to_string().as_bytes(),
                    format!("活动档案标记无法读取：{error}"),
                    "请检查文件权限；应用仍会尝试按配置内容识别当前档案。".into(),
                );
                record_pending_notices(&self.app_data_dir, std::slice::from_ref(&notice));
                notices.push(notice);
                return None;
            }
        };

        match serde_json::from_str::<TargetMarkerFile>(&contents) {
            Ok(marker) => Some(marker),
            Err(error) => {
                let mut notice = stable_invalid_file_notice(
                    ConfigRecoveryKind::TargetMarker,
                    &marker_path,
                    contents.as_bytes(),
                    format!("活动档案标记无法解析：{error}"),
                    "无需手工修复；下次成功切换档案时会重新生成标记。".into(),
                );
                match quarantine_corrupt_file(
                    &self.app_data_dir,
                    &marker_path,
                    "target/codex-auth-switch",
                ) {
                    Ok(recovery_path) => {
                        notice.recovery_path = Some(recovery_path.to_string_lossy().to_string());
                    }
                    Err(quarantine_error) => {
                        notice.summary =
                            format!("活动档案标记无法解析，且未能隔离：{quarantine_error}");
                    }
                }
                record_pending_notices(&self.app_data_dir, std::slice::from_ref(&notice));
                notices.push(notice);
                None
            }
        }
    }

    fn persist_target_marker(&self, marker: TargetMarkerFile) -> Result<(), AppError> {
        atomic_write_json(&self.target_marker_path(), &marker)
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
            if marker.auth_hash == auth_hash
                && marker.config_hash == config_hash
                && self.load_profile_summary(&marker.profile_id)?.is_some()
            {
                return Ok(());
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
            remote_profile_id: value.remote_profile_id,
            remote_content_version: value.remote_content_version,
            remote_content_hash: value.remote_content_hash,
            remote_updated_at: value.remote_updated_at,
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

#[derive(Debug)]
pub(crate) struct StateDatabaseCandidate {
    path: PathBuf,
    name: String,
    version: u32,
    has_threads: bool,
    latest_thread_ms: Option<i64>,
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct TokenUsageCounters {
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_creation_tokens: i64,
    reasoning_output_tokens: i64,
}

#[derive(Debug, Clone)]
pub(crate) struct PendingCodexUsageLog {
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

#[derive(Debug, Clone, Copy)]
pub(crate) struct CodexUsagePrice {
    input_per_million: f64,
    cached_input_per_million: f64,
    output_per_million: f64,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct CodexUsageAggregate {
    request_count: i64,
    total_cost_usd: f64,
    total_input_tokens: i64,
    total_output_tokens: i64,
    total_cache_read_tokens: i64,
    total_cache_creation_tokens: i64,
    total_reasoning_output_tokens: i64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OAuthRefreshResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
}

#[derive(Debug)]
pub(crate) struct ResolvedCodexUsageAuthSource {
    auth_json: String,
    config_toml: String,
    should_sync_runtime_state: bool,
}
