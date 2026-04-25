use crate::antigravity::db::{
    build_account_snapshot, ensure_payload_has_oauth_token, read_live_payload, replace_live_payload,
};
use crate::antigravity::models::{
    AntigravityBackupMeta, AntigravityIdentity, AntigravityPayload, AntigravityProfileMeta,
    AntigravityProfileSummary, AntigravityRecoveryPointMeta, AntigravitySnapshot,
    AntigravitySwitchResult,
};
use crate::antigravity::paths::default_state_db_path;
use crate::antigravity::process::{
    AntigravityProcessController, SystemAntigravityProcessController,
};
use crate::antigravity::storage::read_storage_json_flags;
use crate::antigravity::AntigravityError;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AntigravityStateFile {
    pub last_selected_profile_id: Option<String>,
    pub last_switch_profile_id: Option<String>,
    pub last_switched_at: Option<DateTime<Utc>>,
}

pub struct AntigravityManager {
    app_data_dir: PathBuf,
    state_db_path: PathBuf,
    state: AntigravityStateFile,
    process: Box<dyn AntigravityProcessController>,
}

impl AntigravityManager {
    pub fn load_or_default(app_data_dir: PathBuf) -> Result<Self, AntigravityError> {
        Self::new(
            app_data_dir,
            default_state_db_path()?,
            Box::new(SystemAntigravityProcessController),
        )
    }

    pub fn new(
        app_data_dir: PathBuf,
        state_db_path: PathBuf,
        process: Box<dyn AntigravityProcessController>,
    ) -> Result<Self, AntigravityError> {
        let state_path = app_data_dir.join("antigravity").join("state.json");
        let state = if state_path.exists() {
            serde_json::from_str::<AntigravityStateFile>(&fs::read_to_string(&state_path)?)?
        } else {
            AntigravityStateFile::default()
        };

        let manager = Self {
            app_data_dir,
            state_db_path,
            state,
            process,
        };
        manager.ensure_storage_dirs()?;
        if !state_path.exists() {
            manager.persist_state()?;
        }
        Ok(manager)
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
        ensure_payload_has_oauth_token(&payload.values)?;
        let profile_name = if name.trim().is_empty() {
            payload
                .display_name
                .clone()
                .or_else(|| payload.email.clone())
                .ok_or_else(|| {
                    AntigravityError::Message(
                        "Antigravity profile name cannot be derived from the payload.".into(),
                    )
                })?
        } else {
            name.trim().to_string()
        };
        let now = Utc::now();
        let id = Uuid::new_v4().to_string();
        let profile_dir = self.profiles_dir().join(&id);
        fs::create_dir_all(&profile_dir)?;

        let meta = AntigravityProfileMeta {
            id: id.clone(),
            name: profile_name,
            notes: notes.trim().to_string(),
            email: payload.email.clone().unwrap_or_default(),
            display_name: payload.display_name.clone(),
            source_db_path: self.state_db_path.to_string_lossy().to_string(),
            created_at: now,
            updated_at: now,
        };
        self.write_profile_meta(&profile_dir, &meta)?;
        fs::write(
            profile_dir.join("payload.json"),
            serde_json::to_string_pretty(&payload)?,
        )?;
        let account_snapshot = build_account_snapshot(
            &payload,
            read_storage_json_flags(&self.storage_json_path())?,
        );
        fs::write(
            profile_dir.join("account_snapshot.json"),
            serde_json::to_string_pretty(&account_snapshot)?,
        )?;

        Ok(Self::summary_from_meta(meta))
    }

    pub fn snapshot(&self) -> Result<AntigravitySnapshot, AntigravityError> {
        let profiles = self.list_profiles()?;
        Ok(AntigravitySnapshot {
            source_db_path: self.state_db_path.to_string_lossy().to_string(),
            source_exists: self.state_db_path.exists(),
            active_profile_id: self.detect_active_profile_id(&profiles)?,
            last_selected_profile_id: self.state.last_selected_profile_id.clone(),
            last_switch_profile_id: self.state.last_switch_profile_id.clone(),
            last_switched_at: self.state.last_switched_at,
            profiles,
        })
    }

    pub fn switch_profile(
        &mut self,
        profile_id: &str,
    ) -> Result<AntigravitySwitchResult, AntigravityError> {
        let current = read_live_payload(&self.state_db_path)?;
        let recovery_point_id = self.create_recovery_point(&current)?;
        self.process.stop()?;
        let source_profile_id = self.detect_active_profile_id(&self.list_profiles()?)?;
        let switched_at = Utc::now();
        let backup_id = format!(
            "{}-{}",
            switched_at.format("%Y%m%d-%H%M%S"),
            &Uuid::new_v4().simple().to_string()[..8]
        );
        let backup_dir = self.backups_dir().join(&backup_id);
        fs::create_dir_all(&backup_dir)?;
        let backup_meta = AntigravityBackupMeta {
            id: backup_id.clone(),
            source_profile_id,
            db_path: self.state_db_path.to_string_lossy().to_string(),
            created_at: switched_at,
        };
        fs::write(
            backup_dir.join("meta.json"),
            serde_json::to_string_pretty(&backup_meta)?,
        )?;
        fs::write(
            backup_dir.join("payload.json"),
            serde_json::to_string_pretty(&current)?,
        )?;

        let target = self.read_profile_payload(profile_id)?;
        ensure_payload_has_oauth_token(&target.values)?;
        replace_live_payload(&self.state_db_path, &target)?;
        if let Err(error) = self.process.restart() {
            self.restore_recovery_point(&recovery_point_id)?;
            return Err(error);
        }
        let verified = match read_live_payload(&self.state_db_path) {
            Ok(payload) => payload,
            Err(error) => {
                self.process.stop()?;
                self.restore_recovery_point(&recovery_point_id)?;
                self.process.restart()?;
                return Err(error);
            }
        };
        if verified.values != target.values {
            self.process.stop()?;
            self.restore_recovery_point(&recovery_point_id)?;
            self.process.restart()?;
            return Err(AntigravityError::Message(
                "Antigravity post-switch validation failed.".into(),
            ));
        }

        self.state.last_selected_profile_id = Some(profile_id.to_string());
        self.state.last_switch_profile_id = Some(profile_id.to_string());
        self.state.last_switched_at = Some(switched_at);
        self.persist_state()?;

        Ok(AntigravitySwitchResult {
            profile_id: profile_id.to_string(),
            backup_id,
            switched_at,
        })
    }

    pub fn restore_latest_backup(&mut self) -> Result<AntigravitySwitchResult, AntigravityError> {
        let latest = fs::read_dir(self.backups_dir())?
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_dir())
            .max_by_key(|entry| entry.file_name())
            .ok_or_else(|| {
                AntigravityError::Message("No Antigravity backup is available.".into())
            })?;
        let backup_id = latest.file_name().to_string_lossy().to_string();
        let payload: AntigravityPayload =
            serde_json::from_str(&fs::read_to_string(latest.path().join("payload.json"))?)?;
        let source_profile_id = latest
            .path()
            .join("meta.json")
            .exists()
            .then(|| fs::read_to_string(latest.path().join("meta.json")))
            .transpose()?
            .map(|content| serde_json::from_str::<AntigravityBackupMeta>(&content))
            .transpose()?
            .and_then(|meta| meta.source_profile_id);

        self.process.stop()?;
        replace_live_payload(&self.state_db_path, &payload)?;
        let verified = read_live_payload(&self.state_db_path)?;
        if verified.values != payload.values {
            return Err(AntigravityError::Message(
                "Antigravity post-restore verification failed.".into(),
            ));
        }

        let switched_at = Utc::now();
        self.state.last_selected_profile_id = source_profile_id.clone();
        self.state.last_switch_profile_id = source_profile_id.clone();
        self.state.last_switched_at = Some(switched_at);
        self.persist_state()?;

        self.process.restart()?;

        Ok(AntigravitySwitchResult {
            profile_id: source_profile_id.unwrap_or_else(|| "backup-restore".into()),
            backup_id,
            switched_at,
        })
    }

    pub fn reveal_source_dir(&self) -> Result<(), AntigravityError> {
        let directory = self
            .state_db_path
            .parent()
            .ok_or_else(|| {
                AntigravityError::Message("Antigravity source directory is missing.".into())
            })?
            .to_path_buf();

        #[cfg(target_os = "macos")]
        {
            let status = std::process::Command::new("open").arg(directory).status()?;
            if !status.success() {
                return Err(AntigravityError::Message(
                    "Failed to open the Antigravity source directory.".into(),
                ));
            }

            Ok(())
        }

        #[cfg(not(target_os = "macos"))]
        {
            Err(AntigravityError::Message(
                "Revealing the Antigravity source directory is currently only supported on macOS."
                    .into(),
            ))
        }
    }

    pub fn read_profile_payload(
        &self,
        profile_id: &str,
    ) -> Result<AntigravityPayload, AntigravityError> {
        let path = self.profile_dir(profile_id)?.join("payload.json");
        Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
    }

    pub fn read_live_payload_for_tests(&self) -> Result<AntigravityPayload, AntigravityError> {
        read_live_payload(&self.state_db_path)
    }

    pub fn write_live_payload_for_tests(
        &self,
        payload: AntigravityPayload,
    ) -> Result<(), AntigravityError> {
        replace_live_payload(&self.state_db_path, &payload)
    }

    fn list_profiles(&self) -> Result<Vec<AntigravityProfileSummary>, AntigravityError> {
        if !self.profiles_dir().exists() {
            return Ok(Vec::new());
        }

        let mut profiles = Vec::new();
        for entry in fs::read_dir(self.profiles_dir())? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let meta_path = entry.path().join("meta.json");
            if !meta_path.exists() {
                continue;
            }

            let meta =
                serde_json::from_str::<AntigravityProfileMeta>(&fs::read_to_string(meta_path)?)?;
            profiles.push(Self::summary_from_meta(meta));
        }

        profiles.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        Ok(profiles)
    }

    fn detect_active_profile_id(
        &self,
        profiles: &[AntigravityProfileSummary],
    ) -> Result<Option<String>, AntigravityError> {
        if !self.state_db_path.exists() {
            return Ok(None);
        }

        let Ok(live) = read_live_payload(&self.state_db_path) else {
            return Ok(None);
        };

        for profile in profiles {
            let saved = self.read_profile_payload(&profile.id)?;
            if saved.values == live.values {
                return Ok(Some(profile.id.clone()));
            }
        }

        Ok(None)
    }

    fn ensure_storage_dirs(&self) -> Result<(), AntigravityError> {
        fs::create_dir_all(self.profiles_dir())?;
        fs::create_dir_all(self.backups_dir())?;
        Ok(())
    }

    fn persist_state(&self) -> Result<(), AntigravityError> {
        fs::create_dir_all(self.antigravity_dir())?;
        fs::write(
            self.state_path(),
            serde_json::to_string_pretty(&self.state)?,
        )?;
        Ok(())
    }

    fn write_profile_meta(
        &self,
        profile_dir: &Path,
        meta: &AntigravityProfileMeta,
    ) -> Result<(), AntigravityError> {
        fs::write(
            profile_dir.join("meta.json"),
            serde_json::to_string_pretty(meta)?,
        )?;
        Ok(())
    }

    fn profile_dir(&self, profile_id: &str) -> Result<PathBuf, AntigravityError> {
        let path = self.profiles_dir().join(profile_id);
        if !path.exists() {
            return Err(AntigravityError::Message(format!(
                "Antigravity profile `{profile_id}` was not found."
            )));
        }
        Ok(path)
    }

    fn antigravity_dir(&self) -> PathBuf {
        self.app_data_dir.join("antigravity")
    }

    fn profiles_dir(&self) -> PathBuf {
        self.antigravity_dir().join("profiles")
    }

    fn recovery_points_dir(&self) -> PathBuf {
        self.antigravity_dir().join("recovery-points")
    }

    fn backups_dir(&self) -> PathBuf {
        self.antigravity_dir().join("backups")
    }

    fn storage_json_path(&self) -> PathBuf {
        self.state_db_path
            .parent()
            .map(|path| path.join("storage.json"))
            .unwrap_or_else(|| PathBuf::from("storage.json"))
    }

    fn state_path(&self) -> PathBuf {
        self.antigravity_dir().join("state.json")
    }

    fn summary_from_meta(meta: AntigravityProfileMeta) -> AntigravityProfileSummary {
        AntigravityProfileSummary {
            id: meta.id,
            name: meta.name,
            notes: meta.notes,
            email: meta.email,
            display_name: meta.display_name,
            created_at: meta.created_at,
            updated_at: meta.updated_at,
        }
    }

    fn create_recovery_point(
        &self,
        current: &AntigravityPayload,
    ) -> Result<String, AntigravityError> {
        let recovery_id = format!(
            "{}-{}",
            Utc::now().format("%Y%m%d-%H%M%S"),
            &Uuid::new_v4().simple().to_string()[..8]
        );
        let recovery_dir = self.recovery_points_dir().join(&recovery_id);
        fs::create_dir_all(&recovery_dir)?;
        fs::write(
            recovery_dir.join("payload.json"),
            serde_json::to_string_pretty(current)?,
        )?;
        if self.state_db_path.exists() {
            fs::copy(&self.state_db_path, recovery_dir.join("state.vscdb"))?;
        }
        let storage_json_path = self.storage_json_path();
        if storage_json_path.exists() {
            fs::copy(&storage_json_path, recovery_dir.join("storage.json"))?;
        }
        let meta = AntigravityRecoveryPointMeta {
            id: recovery_id.clone(),
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
        fs::write(
            recovery_dir.join("meta.json"),
            serde_json::to_string_pretty(&meta)?,
        )?;
        Ok(recovery_id)
    }

    fn restore_recovery_point(&self, recovery_point_id: &str) -> Result<(), AntigravityError> {
        let recovery_dir = self.recovery_points_dir().join(recovery_point_id);
        let backup_state_db = recovery_dir.join("state.vscdb");
        if !backup_state_db.exists() {
            return Err(AntigravityError::Message(format!(
                "Antigravity recovery point `{recovery_point_id}` is missing its state database."
            )));
        }
        fs::copy(backup_state_db, &self.state_db_path)?;
        let backup_storage_json = recovery_dir.join("storage.json");
        if backup_storage_json.exists() {
            fs::copy(backup_storage_json, self.storage_json_path())?;
        }
        Ok(())
    }
}

pub use crate::antigravity::process::NoopProcessController;
