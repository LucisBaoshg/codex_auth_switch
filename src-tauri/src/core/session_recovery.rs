use super::*;

pub(crate) fn open_valid_state_database(path: &Path) -> Option<Connection> {
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

pub(crate) fn read_session_provider_repair_candidates(
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

pub(crate) fn sqlite_integrity_check(conn: &Connection) -> Result<String, rusqlite::Error> {
    conn.query_row("PRAGMA integrity_check;", [], |row| row.get(0))
}

pub(crate) fn read_session_recovery_index_entries(
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

pub(crate) fn read_session_recovery_threads(
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

pub(crate) fn assemble_session_recovery_report(
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

pub(crate) fn find_saved_roots_outside_recent_window(
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

pub(crate) fn rollout_has_user_message(path: &Path) -> bool {
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

pub(crate) fn contains_user_message(value: &serde_json::Value) -> bool {
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

pub(crate) fn file_mtime_millis(path: &Path) -> Result<i64, AppError> {
    let metadata = fs::metadata(path)?;
    let modified = FileTime::from_last_modification_time(&metadata);
    Ok(modified.unix_seconds() * 1_000 + i64::from(modified.nanoseconds() / 1_000_000))
}

pub(crate) fn set_rollout_mtime_millis(path: &Path, millis: i64) -> Result<(), AppError> {
    let seconds = millis.div_euclid(1_000);
    let millis = millis.rem_euclid(1_000) as u32;
    set_file_mtime(path, FileTime::from_unix_time(seconds, millis * 1_000_000))?;
    Ok(())
}

pub(crate) fn thread_table_columns(conn: &Connection) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn.prepare("PRAGMA table_info(threads)")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;

    let mut columns = Vec::new();
    for row in rows {
        columns.push(row?);
    }

    Ok(columns)
}

pub(crate) const COMMON_PROFILE_SCALAR_KEYS: &[&str] = &["model", "model_reasoning_effort"];
pub(crate) const THIRD_PARTY_PROFILE_SCALAR_KEYS: &[&str] = &[
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
pub(crate) const THIRD_PARTY_PROFILE_TABLE_KEYS: &[&str] =
    &["model_providers", "tui", "sandbox_workspace_write"];
pub(crate) const THIRD_PARTY_PROFILE_FEATURE_KEYS: &[&str] = &[
    "guardian_approval",
    "remote_connections",
    "remote_control",
    "memories",
];
pub(crate) const ALL_PROFILE_SCALAR_KEYS: &[&str] = &[
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
pub(crate) const ALL_PROFILE_TABLE_KEYS: &[&str] = &["model_providers", "tui", "sandbox_workspace_write"];
pub(crate) const DEFAULT_CODEX_USAGE_ENDPOINT: &str = "https://chatgpt.com/backend-api/wham/usage";
pub(crate) const DEFAULT_YLSCODE_USAGE_ENDPOINT: &str = "https://code.ylsagi.com/codex/info";
pub(crate) const REFRESH_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
pub(crate) const REFRESH_TOKEN_URL_OVERRIDE_ENV_VAR: &str = "CODEX_REFRESH_TOKEN_URL_OVERRIDE";
pub(crate) const REFRESH_TOKEN_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
pub(crate) const DEFAULT_HTTP_CONNECT_TIMEOUT_MS: u64 = 5_000;
pub(crate) const DEFAULT_CODEX_USAGE_TIMEOUT_MS: u64 = 15_000;
pub(crate) const DEFAULT_LATENCY_PROBE_TIMEOUT_MS: u64 = 12_000;
pub(crate) const DEFAULT_THIRD_PARTY_USAGE_TIMEOUT_MS: u64 = 15_000;
