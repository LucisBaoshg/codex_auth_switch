use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, SecondsFormat, TimeZone, Utc};
use rusqlite::Connection;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(target_os = "macos")]
use std::thread;
#[cfg(target_os = "macos")]
use std::time::Duration;
use thiserror::Error;
use uuid::Uuid;

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub id: String,
    pub name: String,
    pub notes: String,
    pub auth_type_label: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub auth_hash: String,
    pub config_hash: String,
    pub codex_usage: Option<CodexUsageSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDocument {
    pub id: String,
    pub name: String,
    pub notes: String,
    pub auth_type_label: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub auth_json: String,
    pub config_toml: String,
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
pub struct UpdateCheckResult {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_url: String,
    pub published_at: Option<String>,
    pub release_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallLocationStatus {
    pub update_safe: bool,
    pub requires_applications_install: bool,
    pub install_path: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncResult {
    pub synced: usize,
    pub imported: usize,
    pub updated: usize,
    pub profiles: Vec<ProfileSummary>,
}

#[derive(Debug, Deserialize)]
struct GithubLatestRelease {
    tag_name: String,
    html_url: String,
    published_at: Option<String>,
    name: Option<String>,
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
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub auth_hash: String,
    pub config_hash: String,
    #[serde(default)]
    pub codex_usage: Option<CodexUsageSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
struct SessionIndexEntry {
    id: String,
    thread_name: String,
    updated_at: String,
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
}

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
        let auth_json = fs::read_to_string(profile_dir.join("auth.json"))?;
        let config_toml = fs::read_to_string(profile_dir.join("config.toml"))?;

        Ok(ProfileDocument {
            id: metadata.id,
            name: metadata.name,
            notes: metadata.notes,
            auth_type_label: metadata.auth_type_label,
            created_at: metadata.created_at,
            updated_at: metadata.updated_at,
            auth_json,
            config_toml,
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
        let next_auth_hash = auth_match_hash(&input.auth_json)?;
        let preserved_codex_usage = if existing_metadata.auth_hash == next_auth_hash {
            existing_metadata.codex_usage.clone()
        } else {
            None
        };

        fs::write(profile_dir.join("auth.json"), input.auth_json)?;
        fs::write(profile_dir.join("config.toml"), &normalized_config)?;

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
        )?;

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
        let target_config = target_dir.join("config.toml");
        let target_auth = target_dir.join("auth.json");
        let mut active_provider = "openai".to_string();

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

                for line in repaired.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("model_provider") && trimmed.contains('=') {
                        if let Some(start) = trimmed.find('"').or_else(|| trimmed.find('\'')) {
                            if let Some(end) = trimmed.rfind('"').or_else(|| trimmed.rfind('\'')) {
                                if start < end {
                                    active_provider = trimmed[start + 1..end].to_string();
                                }
                            }
                        }
                        break;
                    }
                }
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

        self.update_session_databases(&target_dir, &active_provider);
        self.update_session_jsonl(&target_dir, &active_provider);
        self.rebuild_session_index(&target_dir);

        Ok(())
    }

    fn update_session_databases(&self, target_dir: &Path, provider: &str) {
        if let Ok(entries) = fs::read_dir(target_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if !name_str.starts_with("state_") || !name_str.ends_with(".sqlite") {
                    continue;
                }

                if let Ok(conn) = Connection::open(entry.path()) {
                    let _ = conn.execute("UPDATE threads SET model_provider = ?1", [provider]);
                }
            }
        }
    }

    fn update_session_jsonl(&self, target_dir: &Path, provider: &str) {
        let sessions_dir = target_dir.join("sessions");
        let archived_dir = target_dir.join("archived_sessions");

        for dir in [sessions_dir, archived_dir] {
            self.update_jsonl_dir(&dir, provider);
        }
    }

    fn update_jsonl_dir(&self, dir: &Path, provider: &str) {
        if !dir.exists() {
            return;
        }

        let mut stack = vec![dir.to_path_buf()];
        while let Some(current) = stack.pop() {
            let Ok(entries) = fs::read_dir(&current) else {
                continue;
            };

            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }

                if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                    continue;
                }

                let Ok(content) = fs::read_to_string(&path) else {
                    continue;
                };
                let updated = replace_model_provider_values(&content, provider);
                if updated != content {
                    let _ = fs::write(&path, updated);
                }
            }
        }
    }

    fn rebuild_session_index(&self, target_dir: &Path) {
        let Some(state_db_path) = primary_state_database_path(target_dir) else {
            return;
        };

        let Ok(conn) = Connection::open(state_db_path) else {
            return;
        };
        let Ok(columns) = thread_table_columns(&conn) else {
            return;
        };

        if !columns.iter().any(|column| column == "id")
            || !columns.iter().any(|column| column == "title")
            || !columns.iter().any(|column| column == "updated_at")
        {
            return;
        }

        let sql = if columns.iter().any(|column| column == "archived") {
            "SELECT id, title, updated_at FROM threads WHERE archived = 0 ORDER BY updated_at ASC, id ASC"
        } else {
            "SELECT id, title, updated_at FROM threads ORDER BY updated_at ASC, id ASC"
        };

        let Ok(mut stmt) = conn.prepare(sql) else {
            return;
        };
        let Ok(rows) = stmt.query_map([], |row| {
            let updated_at = row.get::<_, i64>(2)?;
            let updated_at = Utc
                .timestamp_opt(updated_at, 0)
                .single()
                .map(|value| value.to_rfc3339_opts(SecondsFormat::Micros, true))
                .unwrap_or_else(|| "1970-01-01T00:00:00.000000Z".to_string());

            Ok(SessionIndexEntry {
                id: row.get(0)?,
                thread_name: row.get(1)?,
                updated_at,
            })
        }) else {
            return;
        };

        let mut entries = Vec::new();
        for row in rows.flatten() {
            entries.push(row);
        }

        let Ok(file) = fs::File::create(target_dir.join("session_index.jsonl")) else {
            return;
        };
        let mut writer = BufWriter::new(file);
        for entry in entries {
            if serde_json::to_writer(&mut writer, &entry).is_err() {
                return;
            }
            if writer.write_all(b"\n").is_err() {
                return;
            }
        }
        let _ = writer.flush();
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

        if let (Some(current_auth_json), Some(current_config_toml), Some(active_profile)) = (
            current_auth_json.as_ref(),
            current_config_toml.as_ref(),
            self.detect_active_profile()?,
        ) {
            if active_profile.id != profile_id {
                self.sync_runtime_state_to_profile(
                    &active_profile.id,
                    current_auth_json,
                    current_config_toml,
                )?;
            }
        }

        let next_auth_json = fs::read_to_string(profile_dir.join("auth.json"))?;
        let next_profile_config = fs::read_to_string(profile_dir.join("config.toml"))?;
        let next_config_toml = match current_config_toml {
            Some(current_config_toml) => {
                merge_profile_managed_config(&current_config_toml, &next_profile_config)?
            }
            None => managed_config_toml(&next_profile_config)?,
        };

        fs::write(self.target_auth_path(), &next_auth_json)?;
        fs::write(self.target_config_path(), &next_config_toml)?;

        let switched_at = Utc::now();
        self.state.last_selected_profile_id = Some(profile_id.to_string());
        self.state.last_switch_profile_id = Some(profile_id.to_string());
        self.state.last_switched_at = Some(switched_at);
        self.persist_target_marker(TargetMarkerFile {
            profile_id: profile_id.to_string(),
            auth_hash: auth_match_hash(&next_auth_json)?,
            config_hash: managed_config_hash(&next_config_toml)?,
            updated_at: switched_at,
        })?;
        self.persist_state()?;

        // 自动触发一次底层的全域会话搬迁，使得每次 Switch 后无需手动点击按钮也能享受会话无缝流转
        let _ = self.fix_session_database_and_configs();

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
        let config_hash = managed_config_hash(&fs::read_to_string(self.target_config_path())?)?;

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

    pub fn refresh_profile_codex_usage(&self, profile_id: &str) -> Result<ProfileSummary, AppError> {
        let profile_dir = self.profile_dir(profile_id)?;
        let auth_json = fs::read_to_string(profile_dir.join("auth.json"))?;
        if !is_official_oauth_auth(&auth_json)? {
            return Err(AppError::Message(
                "Codex usage is only available for 官方 OAuth profiles.".into(),
            ));
        }
        if !self.state.codex_usage_api_enabled {
            return Err(AppError::Message(
                "Codex usage query is disabled. Run the explicit enable action first.".into(),
            ));
        }

        let mut metadata = self.read_profile_metadata(&profile_dir)?;
        metadata.codex_usage = Some(fetch_codex_usage_snapshot(&auth_json)?);
        self.write_profile_metadata(&profile_dir, &metadata)?;
        Ok(ProfileSummary::from(metadata))
    }

    pub fn refresh_all_codex_usage(&self) -> Result<Vec<ProfileSummary>, AppError> {
        let mut refreshed = Vec::new();
        for profile in self.list_profiles()? {
            if profile.auth_type_label != "官方 OAuth" {
                continue;
            }
            refreshed.push(self.refresh_profile_codex_usage(&profile.id)?);
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
    ) -> Result<ProfileMetadata, AppError> {
        Ok(ProfileMetadata {
            id,
            name,
            notes,
            remote_profile_id,
            auth_type_label: detect_auth_type_label(auth_json, config_toml)?,
            created_at,
            updated_at,
            auth_hash: auth_match_hash(auth_json)?,
            config_hash: managed_config_hash(config_toml)?,
            codex_usage,
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
        let preserved_codex_usage = if existing_metadata.auth_hash == next_auth_hash {
            existing_metadata.codex_usage.clone()
        } else {
            None
        };

        fs::write(profile_dir.join("auth.json"), auth_json)?;
        fs::write(profile_dir.join("config.toml"), &normalized_config)?;

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
        let config_hash = managed_config_hash(&config_toml)?;

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
            created_at: value.created_at,
            updated_at: value.updated_at,
            auth_hash: value.auth_hash,
            config_hash: value.config_hash,
            codex_usage: value.codex_usage,
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

pub fn check_for_update() -> Result<UpdateCheckResult, AppError> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let api_url = "https://api.github.com/repos/LucisBaoshg/codex_auth_switch/releases/latest";

    let response = ureq::get(api_url)
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", "codex-auth-switch")
        .call()
        .map_err(|error| AppError::Message(format!("检查更新失败：{error}")))?;

    let release: GithubLatestRelease = response
        .into_json()
        .map_err(|error| AppError::Message(format!("解析更新信息失败：{error}")))?;

    let latest_version = normalize_version_string(&release.tag_name);
    let current_semver = Version::parse(&current_version).ok();
    let latest_semver = Version::parse(&latest_version).ok();
    let has_update = match (current_semver, latest_semver) {
        (Some(current), Some(latest)) => latest > current,
        _ => latest_version != current_version,
    };

    Ok(UpdateCheckResult {
        has_update,
        current_version,
        latest_version,
        release_url: release.html_url,
        published_at: release.published_at,
        release_name: release.name,
    })
}

pub fn check_install_location() -> Result<InstallLocationStatus, AppError> {
    let exe_path = std::env::current_exe()?;
    Ok(install_location_status_for_path(&exe_path))
}

fn install_location_status_for_path(path: &Path) -> InstallLocationStatus {
    #[cfg(target_os = "macos")]
    {
        let install_root = macos_app_bundle_root(path).unwrap_or_else(|| path.to_path_buf());
        let system_applications = Path::new("/Applications");
        let user_applications = dirs::home_dir().map(|home| home.join("Applications"));
        let in_valid_applications_dir = install_root.starts_with(system_applications)
            || user_applications
                .as_ref()
                .is_some_and(|applications| install_root.starts_with(applications));

        if in_valid_applications_dir {
            return InstallLocationStatus {
                update_safe: true,
                requires_applications_install: false,
                install_path: install_root.display().to_string(),
                message: None,
            };
        }

        return InstallLocationStatus {
            update_safe: false,
            requires_applications_install: true,
            install_path: install_root.display().to_string(),
            message: Some(
                "当前应用不在 Applications 文件夹中。请先将 Codex Auth Switch 拖到 Applications 后再重新打开，然后再执行更新。".into(),
            ),
        };
    }

    #[cfg(not(target_os = "macos"))]
    {
        InstallLocationStatus {
            update_safe: true,
            requires_applications_install: false,
            install_path: path.display().to_string(),
            message: None,
        }
    }
}

#[cfg(target_os = "macos")]
fn macos_app_bundle_root(path: &Path) -> Option<PathBuf> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        if candidate
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("app"))
        {
            return Some(candidate.to_path_buf());
        }
        current = candidate.parent();
    }
    None
}

fn normalize_version_string(version: &str) -> String {
    version
        .trim()
        .trim_start_matches('v')
        .trim_start_matches('V')
        .to_string()
}

pub fn open_url(url: &str) -> Result<(), AppError> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::Message("仅允许打开 http/https 链接。".into()));
    }

    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(url).status()?;

    #[cfg(target_os = "windows")]
    let status = Command::new("cmd")
        .args(["/C", "start", "", url])
        .status()?;

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(url).status()?;

    if status.success() {
        Ok(())
    } else {
        Err(AppError::Message("无法打开更新页面。".into()))
    }
}

fn unknown_auth_type_label() -> String {
    "未识别".to_string()
}

pub fn restart_codex_script() -> Option<&'static str> {
    #[cfg(target_os = "macos")]
    {
        Some(
            r#"if application "Codex" is running then
  tell application "Codex" to quit
end if"#,
        )
    }

    #[cfg(not(target_os = "macos"))]
    {
        None
    }
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

fn replace_model_provider_values(content: &str, provider: &str) -> String {
    let key = "\"model_provider\"";
    let mut output = String::with_capacity(content.len());
    let mut index = 0;

    while let Some(pos) = content[index..].find(key) {
        let abs = index + pos;
        output.push_str(&content[index..abs]);
        output.push_str(key);
        index = abs + key.len();

        let rest = &content[index..];
        let Some(colon_pos) = rest.find(':') else {
            output.push_str(rest);
            return output;
        };
        output.push_str(&rest[..colon_pos + 1]);
        index += colon_pos + 1;

        let bytes = content.as_bytes();
        while index < content.len() && bytes[index].is_ascii_whitespace() {
            output.push(bytes[index] as char);
            index += 1;
        }

        if index < content.len() && bytes[index] == b'"' {
            output.push('"');
            index += 1;
            while index < content.len() {
                let byte = bytes[index];
                if byte == b'\\' {
                    index = (index + 2).min(content.len());
                    continue;
                }
                if byte == b'"' {
                    index += 1;
                    break;
                }
                index += 1;
            }
            output.push_str(provider);
            output.push('"');
        } else {
            output.push_str(&content[index..]);
            return output;
        }
    }

    output.push_str(&content[index..]);
    output
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

fn thread_table_columns(conn: &Connection) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn.prepare("PRAGMA table_info(threads)")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;

    let mut columns = Vec::new();
    for row in rows {
        columns.push(row?);
    }

    Ok(columns)
}

pub fn restart_codex_app() -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let script = restart_codex_script()
            .ok_or_else(|| AppError::Message("Unable to prepare Codex restart script.".into()))?;

        let quit_status = Command::new("osascript").arg("-e").arg(script).status()?;
        if !quit_status.success() {
            return Err(AppError::Message("Failed to ask Codex.app to quit.".into()));
        }

        thread::sleep(Duration::from_millis(700));

        let open_status = Command::new("open").arg("-a").arg("Codex").status()?;
        if !open_status.success() {
            return Err(AppError::Message("Failed to reopen Codex.app.".into()));
        }

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err(AppError::Message(
            "Restart Codex is currently only supported on macOS.".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::install_location_status_for_path;
    use std::path::Path;

    #[test]
    fn install_location_check_accepts_system_applications_bundle() {
        let status = install_location_status_for_path(Path::new(
            "/Applications/Codex Auth Switch.app/Contents/MacOS/Codex Auth Switch",
        ));

        assert!(status.update_safe);
        assert!(!status.requires_applications_install);
    }

    #[test]
    fn install_location_check_flags_non_applications_bundle() {
        let status = install_location_status_for_path(Path::new(
            "/Users/lucifer/Downloads/Codex Auth Switch.app/Contents/MacOS/Codex Auth Switch",
        ));

        assert!(!status.update_safe);
        assert!(status.requires_applications_install);
        assert!(status
            .message
            .as_deref()
            .is_some_and(|message| message.contains("Applications")));
    }
}

const PROFILE_MANAGED_SCALAR_KEYS: &[&str] = &[
    "model_provider",
    "model",
    "review_model",
    "model_reasoning_effort",
    "model_context_window",
    "model_auto_compact_token_limit",
    "disable_response_storage",
    "network_access",
];

const PROFILE_MANAGED_TABLE_KEYS: &[&str] = &["model_providers"];
const OAUTH_STRIP_SCALAR_KEYS: &[&str] = &[
    "model_provider",
    "review_model",
    "model_context_window",
    "model_auto_compact_token_limit",
    "disable_response_storage",
    "network_access",
];
const OAUTH_STRIP_TABLE_KEYS: &[&str] = &["model_providers"];
const DEFAULT_CODEX_USAGE_ENDPOINT: &str = "https://chatgpt.com/backend-api/wham/usage";

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

fn managed_config_table(
    table: &toml::map::Map<String, toml::Value>,
) -> toml::map::Map<String, toml::Value> {
    let mut managed = toml::map::Map::new();

    for key in PROFILE_MANAGED_SCALAR_KEYS {
        if let Some(value) = table.get(*key) {
            managed.insert((*key).to_string(), value.clone());
        }
    }

    for key in PROFILE_MANAGED_TABLE_KEYS {
        if let Some(value) = table.get(*key) {
            managed.insert((*key).to_string(), value.clone());
        }
    }

    managed
}

fn managed_config_hash(contents: &str) -> Result<String, AppError> {
    let table = parse_toml_table(contents)?;
    let serialized = toml::to_string(&toml::Value::Table(managed_config_table(&table)))
        .map_err(|error| AppError::Message(error.to_string()))?;
    Ok(sha256_bytes(serialized.as_bytes()))
}

fn managed_config_toml(contents: &str) -> Result<String, AppError> {
    let table = parse_toml_table(contents)?;
    toml::to_string_pretty(&toml::Value::Table(managed_config_table(&table)))
        .map_err(|error| AppError::Message(error.to_string()))
}

fn normalize_config_toml_for_auth(auth_json: &str, config_toml: &str) -> Result<String, AppError> {
    let mut table = parse_toml_table(config_toml)?;

    if is_official_oauth_auth(auth_json)? {
        for key in OAUTH_STRIP_SCALAR_KEYS {
            table.remove(*key);
        }
        for key in OAUTH_STRIP_TABLE_KEYS {
            table.remove(*key);
        }
    }

    toml::to_string_pretty(&toml::Value::Table(table))
        .map_err(|error| AppError::Message(error.to_string()))
}

fn merge_profile_managed_config(
    current_config_toml: &str,
    profile_config_toml: &str,
) -> Result<String, AppError> {
    let mut current_table = parse_toml_table(current_config_toml)?;
    let profile_table = parse_toml_table(profile_config_toml)?;
    let managed_profile = managed_config_table(&profile_table);

    for key in PROFILE_MANAGED_SCALAR_KEYS {
        current_table.remove(*key);
    }

    for key in PROFILE_MANAGED_TABLE_KEYS {
        current_table.remove(*key);
    }

    for (key, value) in managed_profile {
        current_table.insert(key, value);
    }

    toml::to_string_pretty(&toml::Value::Table(current_table))
        .map_err(|error| AppError::Message(error.to_string()))
}

fn detect_auth_type_label(auth_json: &str, config_toml: &str) -> Result<String, AppError> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json)
        .map_err(|error| AppError::InvalidAuthJson(error.to_string()))?;
    let config = parse_toml_table(config_toml)?;

    if is_official_oauth_auth(auth_json)? {
        return Ok("官方 OAuth".into());
    }

    let has_openai_api_key = auth
        .get("OPENAI_API_KEY")
        .and_then(|value| value.as_str())
        .is_some_and(|value| !value.trim().is_empty());

    if has_openai_api_key {
        let has_custom_provider = config
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

fn fetch_codex_usage_snapshot(auth_json: &str) -> Result<CodexUsageSnapshot, AppError> {
    let access_token = oauth_access_token(auth_json).ok_or_else(|| {
        AppError::Message("The selected profile does not contain a ChatGPT access token.".into())
    })?;
    let account_id = oauth_api_account_id(auth_json).ok_or_else(|| {
        AppError::Message("The selected profile does not contain a ChatGPT account id.".into())
    })?;
    let endpoint = codex_usage_endpoint();

    let response = ureq::get(&endpoint)
        .set("Authorization", &format!("Bearer {access_token}"))
        .set("ChatGPT-Account-Id", &account_id)
        .set("User-Agent", "codex-auth-switch")
        .call()
        .map_err(|error| AppError::Message(format!("Failed to fetch Codex usage: {error}")))?;
    let body = response
        .into_string()
        .map_err(|error| AppError::Message(format!("Failed to read Codex usage response: {error}")))?;

    parse_codex_usage_response(&body, auth_json)
}

fn parse_codex_usage_response(
    body: &str,
    auth_json: &str,
) -> Result<CodexUsageSnapshot, AppError> {
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
    })
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
