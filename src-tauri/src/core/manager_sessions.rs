use super::*;

impl ProfileManager {
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
                let chunk_size = num_items.div_ceil(num_workers);
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

            for (t, file_size) in threads.into_iter().zip(file_sizes) {
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
                let name = target_obj
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
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

    pub(crate) fn repair_configs_and_resolve_session_provider(&self) -> Result<String, AppError> {
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

    pub(crate) fn build_session_recovery_report(
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

    pub(crate) fn repair_codex_sessions_internal(
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

    pub(crate) fn repair_session_model_provider_for_switch(
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

    pub(crate) fn repair_workspace_project_order(&self, target_dir: &Path) {
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
}
