use super::*;

impl ProfileManager {
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
            sync.errors
                .push(format!("Failed to backfill usage costs: {error}"));
        }

        self.read_codex_usage_stats_snapshot(&conn, sync, filter)
    }

    pub fn set_codex_usage_api_enabled(&mut self, enabled: bool) -> Result<(), AppError> {
        self.state.codex_usage_api_enabled = enabled;
        self.persist_state()?;
        Ok(())
    }

    pub(crate) fn resolve_codex_usage_auth_source(
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

    pub(crate) fn refresh_profile_codex_usage_attempt(
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

    pub(crate) fn record_codex_usage_failure(
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

    pub(crate) fn usage_stats_db_path(&self) -> PathBuf {
        self.app_data_dir.join("usage_logs.sqlite3")
    }

    pub(crate) fn open_usage_stats_connection(&self) -> Result<Connection, AppError> {
        fs::create_dir_all(&self.app_data_dir)?;
        let conn = Connection::open(self.usage_stats_db_path())?;
        initialize_codex_usage_stats_schema(&conn)?;
        Ok(conn)
    }

    pub(crate) fn read_codex_usage_stats_snapshot(
        &self,
        conn: &Connection,
        sync: CodexUsageStatsSyncResult,
        filter: CodexUsageStatsFilter,
    ) -> Result<CodexUsageStatsSnapshot, AppError> {
        let normalized_filter = filter.normalized();
        let summary = read_codex_usage_stats_summary(conn, &normalized_filter)?;
        let trends = read_codex_usage_stats_trends(conn, &normalized_filter)?;
        let model_breakdown = read_codex_usage_stats_breakdown(conn, &normalized_filter, "model")?;
        let effort_breakdown =
            read_codex_usage_stats_breakdown(conn, &normalized_filter, "effort")?;
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
}
