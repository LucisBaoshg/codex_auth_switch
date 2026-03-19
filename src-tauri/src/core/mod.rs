use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
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
pub struct ProfileSummary {
    pub id: String,
    pub name: String,
    pub notes: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub auth_hash: String,
    pub config_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDocument {
    pub id: String,
    pub name: String,
    pub notes: String,
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
    pub active_profile_id: Option<String>,
    pub last_selected_profile_id: Option<String>,
    pub last_switch_profile_id: Option<String>,
    pub last_switched_at: Option<DateTime<Utc>>,
    pub profiles: Vec<ProfileSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StateFile {
    pub target_dir: Option<String>,
    pub last_selected_profile_id: Option<String>,
    pub last_switch_profile_id: Option<String>,
    pub last_switched_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileMetadata {
    pub id: String,
    pub name: String,
    pub notes: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub auth_hash: String,
    pub config_hash: String,
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
        validate_config_toml(&input.config_toml)?;

        let now = Utc::now();
        let profile_id = Uuid::new_v4().to_string();
        let profile_dir = self.profiles_dir().join(&profile_id);
        fs::create_dir_all(&profile_dir)?;

        fs::write(profile_dir.join("auth.json"), input.auth_json)?;
        fs::write(profile_dir.join("config.toml"), input.config_toml)?;

        let metadata = ProfileMetadata {
            id: profile_id,
            name: name.to_string(),
            notes: input.notes.trim().to_string(),
            created_at: now,
            updated_at: now,
            auth_hash: sha256_of_file(profile_dir.join("auth.json"))?,
            config_hash: sha256_of_file(profile_dir.join("config.toml"))?,
        };

        fs::write(
            profile_dir.join("meta.json"),
            serde_json::to_string_pretty(&metadata)?,
        )?;

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
        validate_config_toml(&input.config_toml)?;

        let profile_dir = self.profile_dir(profile_id)?;
        let existing_metadata = self.read_profile_metadata(&profile_dir)?;

        fs::write(profile_dir.join("auth.json"), input.auth_json)?;
        fs::write(profile_dir.join("config.toml"), input.config_toml)?;

        let metadata = ProfileMetadata {
            id: existing_metadata.id,
            name: name.to_string(),
            notes: input.notes.trim().to_string(),
            created_at: existing_metadata.created_at,
            updated_at: Utc::now(),
            auth_hash: sha256_of_file(profile_dir.join("auth.json"))?,
            config_hash: sha256_of_file(profile_dir.join("config.toml"))?,
        };

        self.write_profile_metadata(&profile_dir, &metadata)?;
        Ok(ProfileSummary::from(metadata))
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

        self.persist_state()?;
        Ok(())
    }

    pub fn switch_profile(&self, profile_id: &str) -> Result<SwitchResult, AppError> {
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

        fs::copy(profile_dir.join("auth.json"), self.target_auth_path())?;
        fs::copy(profile_dir.join("config.toml"), self.target_config_path())?;

        let switched_at = Utc::now();
        let mut manager = self.clone_for_mutation();
        manager.state.last_selected_profile_id = Some(profile_id.to_string());
        manager.state.last_switch_profile_id = Some(profile_id.to_string());
        manager.state.last_switched_at = Some(switched_at);
        manager.persist_state()?;

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

        let auth_hash = sha256_of_file(self.target_auth_path())?;
        let config_hash = sha256_of_file(self.target_config_path())?;

        for profile in self.list_profiles()? {
            if profile.auth_hash == auth_hash && profile.config_hash == config_hash {
                return Ok(Some(profile));
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

    pub fn snapshot(&self) -> Result<AppSnapshot, AppError> {
        let default_target_dir = default_codex_target_dir()?;
        let active_profile_id = self.detect_active_profile()?.map(|profile| profile.id);

        Ok(AppSnapshot {
            target_dir: self.target_dir.to_string_lossy().to_string(),
            using_default_target_dir: self.target_dir == default_target_dir,
            target_exists: self.target_dir.exists(),
            target_auth_exists: self.target_auth_path().exists(),
            target_config_exists: self.target_config_path().exists(),
            target_updated_at: self.resolve_target_updated_at()?,
            active_profile_id,
            last_selected_profile_id: self.state.last_selected_profile_id.clone(),
            last_switch_profile_id: self.state.last_switch_profile_id.clone(),
            last_switched_at: self.state.last_switched_at.clone(),
            profiles: self.list_profiles()?,
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
        Ok(serde_json::from_str::<ProfileMetadata>(&fs::read_to_string(meta_path)?)?)
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

    fn profile_dir(&self, profile_id: &str) -> Result<PathBuf, AppError> {
        let profile_dir = self.profiles_dir().join(profile_id);
        if !profile_dir.exists() {
            return Err(AppError::ProfileNotFound(profile_id.to_string()));
        }
        Ok(profile_dir)
    }

    fn profiles_dir(&self) -> PathBuf {
        self.app_data_dir.join("profiles")
    }

    fn backups_dir(&self) -> PathBuf {
        self.app_data_dir.join("backups")
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
}

impl From<ProfileMetadata> for ProfileSummary {
    fn from(value: ProfileMetadata) -> Self {
        Self {
            id: value.id,
            name: value.name,
            notes: value.notes,
            created_at: value.created_at,
            updated_at: value.updated_at,
            auth_hash: value.auth_hash,
            config_hash: value.config_hash,
        }
    }
}

pub fn default_codex_target_dir() -> Result<PathBuf, AppError> {
    let home_dir = dirs::home_dir()
        .ok_or_else(|| AppError::Message("Unable to resolve the user home directory.".into()))?;
    Ok(home_dir.join(".codex"))
}

pub fn restart_codex_script() -> Option<&'static str> {
    #[cfg(target_os = "macos")]
    {
        Some(r#"if application "Codex" is running then
  tell application "Codex" to quit
end if"#)
    }

    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

pub fn restart_codex_app() -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let script = restart_codex_script()
            .ok_or_else(|| AppError::Message("Unable to prepare Codex restart script.".into()))?;

        let quit_status = Command::new("osascript").arg("-e").arg(script).status()?;
        if !quit_status.success() {
            return Err(AppError::Message(
                "Failed to ask Codex.app to quit.".into(),
            ));
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

fn sha256_of_file(path: PathBuf) -> Result<String, AppError> {
    let bytes = fs::read(path)?;
    Ok(sha256_bytes(&bytes))
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}
