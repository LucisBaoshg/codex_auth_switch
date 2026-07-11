use super::*;

pub(crate) fn initialize_codex_usage_stats_schema(
    conn: &Connection,
) -> Result<(), rusqlite::Error> {
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

pub(crate) fn ensure_sqlite_column(
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

pub(crate) fn collect_codex_session_log_files(target_dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    collect_jsonl_files_recursive(&target_dir.join("sessions"), &mut files);
    collect_jsonl_files_recursive(&target_dir.join("archived_sessions"), &mut files);
    files
}

pub(crate) fn collect_jsonl_files_recursive(dir: &Path, files: &mut Vec<PathBuf>) {
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

pub(crate) fn import_codex_usage_file(
    conn: &Connection,
    session_path: &Path,
) -> Result<CodexUsageStatsSyncResult, AppError> {
    let file = fs::File::open(session_path)?;
    let mut sync = CodexUsageStatsSyncResult {
        files_scanned: 1,
        ..Default::default()
    };
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
                    if let Some(raw_model) = payload.get("model").and_then(|model| model.as_str()) {
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
    pub(crate) fn saturating_sub(self, previous: Self) -> Self {
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

pub(crate) fn read_token_usage_counters(value: &serde_json::Value) -> TokenUsageCounters {
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

pub(crate) fn read_i64_field(value: &serde_json::Value, keys: &[&str]) -> i64 {
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

pub(crate) fn read_codex_usage_effort(payload: &serde_json::Value) -> Option<String> {
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

pub(crate) fn parse_usage_timestamp(timestamp: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(timestamp)
        .map(|parsed| parsed.with_timezone(&Utc))
        .ok()
}

pub(crate) fn normalize_codex_usage_model(model: &str) -> String {
    let provider_stripped = model
        .rsplit('/')
        .next()
        .unwrap_or(model)
        .trim()
        .to_ascii_lowercase();
    strip_date_suffix(&provider_stripped)
}

pub(crate) fn extract_codex_usage_provider(model: &str) -> String {
    let trimmed = model.trim();
    if let Some(slash_idx) = trimmed.find('/') {
        let p = trimmed[..slash_idx].trim().to_ascii_lowercase();
        if !p.is_empty() {
            return p;
        }
    }

    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("gpt-")
        || lower.starts_with("o1-")
        || lower.starts_with("o3-")
        || lower.starts_with("text-davinci")
    {
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

pub(crate) fn normalize_codex_usage_effort(effort: &str) -> String {
    let normalized = effort.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        "unknown".to_string()
    } else {
        normalized
    }
}

pub(crate) fn strip_date_suffix(model: &str) -> String {
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

pub(crate) fn codex_usage_price_for_model(model: &str) -> Option<CodexUsagePrice> {
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

pub(crate) fn estimate_codex_usage_cost_usd(
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

pub(crate) fn format_usd(value: f64) -> String {
    let rounded = ((value.max(0.0) * 1_000_000.0) + 0.000_000_001).round() / 1_000_000.0;
    format!("{rounded:.6}")
}

pub(crate) fn insert_codex_usage_log(
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
    pub(crate) fn normalized(self) -> Self {
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

pub(crate) fn normalize_usage_filter_date(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("all") {
        return None;
    }
    NaiveDate::parse_from_str(&trimmed, "%Y-%m-%d")
        .ok()
        .map(|date| date.format("%Y-%m-%d").to_string())
}

pub(crate) fn normalize_usage_filter_value(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("all") {
        None
    } else {
        Some(trimmed)
    }
}

pub(crate) fn usage_filter_params(
    filter: &CodexUsageStatsFilter,
) -> (Option<&str>, Option<&str>, Option<&str>, Option<&str>) {
    (
        filter.start_date.as_deref(),
        filter.end_date.as_deref(),
        filter.model.as_deref(),
        filter.effort.as_deref(),
    )
}

pub(crate) const CODEX_USAGE_FILTER_SQL: &str = "
    (?1 IS NULL OR substr(created_at, 1, 10) >= ?1)
    AND (?2 IS NULL OR substr(created_at, 1, 10) <= ?2)
    AND (?3 IS NULL OR model = ?3)
    AND (?4 IS NULL OR effort = ?4)
";

impl CodexUsageAggregate {
    pub(crate) fn real_total_tokens(self) -> i64 {
        self.total_input_tokens
            + self.total_output_tokens
            + self.total_cache_read_tokens
            + self.total_cache_creation_tokens
    }

    pub(crate) fn cache_hit_rate(self) -> f64 {
        let denominator = self.total_input_tokens + self.total_cache_read_tokens;
        if denominator > 0 {
            self.total_cache_read_tokens as f64 / denominator as f64
        } else {
            0.0
        }
    }
}

pub(crate) fn read_codex_usage_aggregate(
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

pub(crate) fn backfill_zero_costs(conn: &Connection) -> Result<(), rusqlite::Error> {
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
                "UPDATE codex_usage_logs SET total_cost_usd = ?1 WHERE request_id = ?2",
            )?;
            for update in updates {
                update_stmt.execute(rusqlite::params![update.cost, update.request_id])?;
            }
        }
        conn.execute("COMMIT", [])?;
    }

    Ok(())
}

pub(crate) fn read_codex_usage_stats_summary(
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

pub(crate) fn read_codex_usage_stats_trends(
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

pub(crate) fn read_codex_usage_stats_breakdown(
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

pub(crate) fn read_codex_usage_stats_distinct_values(
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

pub(crate) fn read_codex_usage_stats_logs(
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
