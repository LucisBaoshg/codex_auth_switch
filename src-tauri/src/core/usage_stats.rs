use super::*;
use rust_decimal::{Decimal, RoundingStrategy};
use std::str::FromStr;
use std::sync::OnceLock;
use std::time::UNIX_EPOCH;

const CODEX_USAGE_PARSER_VERSION: i64 = 2;

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
            input_cost_usd TEXT NOT NULL DEFAULT '0',
            output_cost_usd TEXT NOT NULL DEFAULT '0',
            cache_read_cost_usd TEXT NOT NULL DEFAULT '0',
            cache_creation_cost_usd TEXT NOT NULL DEFAULT '0',
            base_total_cost_usd TEXT NOT NULL DEFAULT '0',
            total_cost_usd TEXT NOT NULL DEFAULT '0',
            pricing_status TEXT NOT NULL DEFAULT 'unpriced',
            pricing_model TEXT,
            pricing_version INTEGER NOT NULL DEFAULT 0,
            prompt_input_tokens INTEGER NOT NULL DEFAULT 0,
            long_context_applied INTEGER NOT NULL DEFAULT 0,
            long_context_threshold_tokens INTEGER,
            input_multiplier TEXT NOT NULL DEFAULT '1',
            output_multiplier TEXT NOT NULL DEFAULT '1',
            source_path TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS codex_usage_file_sync (
            source_path TEXT PRIMARY KEY,
            modified_nanos INTEGER NOT NULL,
            size_bytes INTEGER NOT NULL,
            parser_version INTEGER NOT NULL
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
    ensure_sqlite_column(
        conn,
        "codex_usage_logs",
        "input_cost_usd",
        "ALTER TABLE codex_usage_logs ADD COLUMN input_cost_usd TEXT NOT NULL DEFAULT '0'",
    )?;
    ensure_sqlite_column(
        conn,
        "codex_usage_logs",
        "output_cost_usd",
        "ALTER TABLE codex_usage_logs ADD COLUMN output_cost_usd TEXT NOT NULL DEFAULT '0'",
    )?;
    ensure_sqlite_column(
        conn,
        "codex_usage_logs",
        "cache_read_cost_usd",
        "ALTER TABLE codex_usage_logs ADD COLUMN cache_read_cost_usd TEXT NOT NULL DEFAULT '0'",
    )?;
    ensure_sqlite_column(
        conn,
        "codex_usage_logs",
        "cache_creation_cost_usd",
        "ALTER TABLE codex_usage_logs ADD COLUMN cache_creation_cost_usd TEXT NOT NULL DEFAULT '0'",
    )?;
    ensure_sqlite_column(
        conn,
        "codex_usage_logs",
        "base_total_cost_usd",
        "ALTER TABLE codex_usage_logs ADD COLUMN base_total_cost_usd TEXT NOT NULL DEFAULT '0'",
    )?;
    ensure_sqlite_column(
        conn,
        "codex_usage_logs",
        "pricing_status",
        "ALTER TABLE codex_usage_logs ADD COLUMN pricing_status TEXT NOT NULL DEFAULT 'unpriced'",
    )?;
    ensure_sqlite_column(
        conn,
        "codex_usage_logs",
        "pricing_model",
        "ALTER TABLE codex_usage_logs ADD COLUMN pricing_model TEXT",
    )?;
    ensure_sqlite_column(
        conn,
        "codex_usage_logs",
        "pricing_version",
        "ALTER TABLE codex_usage_logs ADD COLUMN pricing_version INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_sqlite_column(
        conn,
        "codex_usage_logs",
        "prompt_input_tokens",
        "ALTER TABLE codex_usage_logs ADD COLUMN prompt_input_tokens INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_sqlite_column(
        conn,
        "codex_usage_logs",
        "long_context_applied",
        "ALTER TABLE codex_usage_logs ADD COLUMN long_context_applied INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_sqlite_column(
        conn,
        "codex_usage_logs",
        "long_context_threshold_tokens",
        "ALTER TABLE codex_usage_logs ADD COLUMN long_context_threshold_tokens INTEGER",
    )?;
    ensure_sqlite_column(
        conn,
        "codex_usage_logs",
        "input_multiplier",
        "ALTER TABLE codex_usage_logs ADD COLUMN input_multiplier TEXT NOT NULL DEFAULT '1'",
    )?;
    ensure_sqlite_column(
        conn,
        "codex_usage_logs",
        "output_multiplier",
        "ALTER TABLE codex_usage_logs ADD COLUMN output_multiplier TEXT NOT NULL DEFAULT '1'",
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

pub(crate) fn codex_usage_file_signature(session_path: &Path) -> Result<(i64, i64), AppError> {
    let metadata = fs::metadata(session_path)?;
    let modified_nanos = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .min(i64::MAX as u128) as i64;
    let size_bytes = metadata.len().min(i64::MAX as u64) as i64;
    Ok((modified_nanos, size_bytes))
}

pub(crate) fn codex_usage_thread_identity(session_path: &Path) -> String {
    let stem = session_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("unknown");
    if stem.len() >= 36 {
        let candidate = &stem[stem.len() - 36..];
        if Uuid::parse_str(candidate).is_ok() {
            return candidate.to_ascii_lowercase();
        }
    }

    let digest = Sha256::digest(session_path.to_string_lossy().as_bytes());
    let short_hash = digest[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("path-{short_hash}")
}

pub(crate) fn import_codex_usage_file(
    conn: &mut Connection,
    session_path: &Path,
) -> Result<CodexUsageStatsSyncResult, AppError> {
    let source_path = session_path.to_string_lossy().to_string();
    let (modified_nanos, size_bytes) = codex_usage_file_signature(session_path)?;
    let unchanged = conn
        .query_row(
            "SELECT modified_nanos = ?2 AND size_bytes = ?3 AND parser_version = ?4
             FROM codex_usage_file_sync
             WHERE source_path = ?1",
            rusqlite::params![
                source_path,
                modified_nanos,
                size_bytes,
                CODEX_USAGE_PARSER_VERSION
            ],
            |row| row.get::<_, bool>(0),
        )
        .unwrap_or(false);
    if unchanged {
        return Ok(CodexUsageStatsSyncResult {
            files_scanned: 1,
            files_unchanged: 1,
            ..Default::default()
        });
    }

    let previous_count = conn.query_row(
        "SELECT COUNT(*) FROM codex_usage_logs WHERE source_path = ?1",
        rusqlite::params![source_path],
        |row| row.get::<_, i64>(0),
    )?;
    let file = fs::File::open(session_path)?;
    let mut sync = CodexUsageStatsSyncResult {
        files_scanned: 1,
        ..Default::default()
    };
    let transaction = conn.transaction()?;
    transaction.execute(
        "DELETE FROM codex_usage_logs WHERE source_path = ?1",
        rusqlite::params![source_path],
    )?;
    let mut session_id: Option<String> = None;
    let thread_identity = codex_usage_thread_identity(session_path);
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
                    request_id: format!("codex_session:v2:{thread_identity}:{token_event_index}"),
                    session_id,
                    model: model.clone(),
                    provider: provider.clone(),
                    effort: effort.clone(),
                    created_at,
                    input_tokens: usage
                        .input_tokens
                        .saturating_sub(usage.cache_read_tokens)
                        .saturating_sub(usage.cache_creation_tokens),
                    output_tokens: usage.output_tokens,
                    cache_read_tokens: usage.cache_read_tokens,
                    cache_creation_tokens: usage.cache_creation_tokens,
                    reasoning_output_tokens: usage.reasoning_output_tokens,
                    source_path: source_path.clone(),
                };
                if insert_codex_usage_log(&transaction, &log)? {
                    sync.imported += 1;
                } else {
                    sync.skipped += 1;
                }
            }
            _ => {}
        }
    }

    transaction.execute(
        "INSERT INTO codex_usage_file_sync (
            source_path, modified_nanos, size_bytes, parser_version
         ) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(source_path) DO UPDATE SET
            modified_nanos = excluded.modified_nanos,
            size_bytes = excluded.size_bytes,
            parser_version = excluded.parser_version",
        rusqlite::params![
            source_path,
            modified_nanos,
            size_bytes,
            CODEX_USAGE_PARSER_VERSION
        ],
    )?;
    transaction.commit()?;
    sync.imported = sync.imported.saturating_sub(previous_count);

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexUsagePricingCatalog {
    version: i64,
    models: Vec<CodexUsagePricingRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexUsagePricingRecord {
    model_id: String,
    #[serde(default)]
    aliases: Vec<String>,
    input_per_million: String,
    cached_input_per_million: String,
    cache_creation_per_million: String,
    output_per_million: String,
    #[serde(default)]
    long_context: Option<CodexUsageLongContextRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexUsageLongContextRecord {
    threshold_input_tokens: i64,
    input_multiplier: String,
    output_multiplier: String,
}

#[derive(Debug, Clone)]
pub(crate) struct CodexUsagePrice {
    model_id: String,
    pricing_version: i64,
    input_per_million: Decimal,
    cached_input_per_million: Decimal,
    cache_creation_per_million: Decimal,
    output_per_million: Decimal,
    long_context: Option<CodexUsageLongContextPrice>,
}

#[derive(Debug, Clone)]
pub(crate) struct CodexUsageLongContextPrice {
    threshold_input_tokens: i64,
    input_multiplier: Decimal,
    output_multiplier: Decimal,
}

#[derive(Debug, Clone)]
pub(crate) struct CodexUsageCostEstimate {
    input_cost_usd: String,
    output_cost_usd: String,
    cache_read_cost_usd: String,
    cache_creation_cost_usd: String,
    base_total_cost_usd: String,
    total_cost_usd: String,
    pricing_status: String,
    pricing_model: Option<String>,
    pricing_version: i64,
    prompt_input_tokens: i64,
    long_context_applied: bool,
    long_context_threshold_tokens: Option<i64>,
    input_multiplier: String,
    output_multiplier: String,
}

fn codex_usage_pricing_catalog() -> &'static CodexUsagePricingCatalog {
    static CATALOG: OnceLock<CodexUsagePricingCatalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../../resources/codex-model-pricing.json"))
            .expect("bundled Codex usage pricing catalog must be valid")
    })
}

fn parse_price(value: &str) -> Option<Decimal> {
    Decimal::from_str(value).ok()
}

pub(crate) fn codex_usage_price_for_model(model: &str) -> Option<CodexUsagePrice> {
    let normalized = normalize_codex_usage_model(model);
    let catalog = codex_usage_pricing_catalog();
    let record = catalog.models.iter().find(|record| {
        record.model_id.eq_ignore_ascii_case(&normalized)
            || record
                .aliases
                .iter()
                .any(|alias| alias.eq_ignore_ascii_case(&normalized))
    })?;
    Some(CodexUsagePrice {
        model_id: record.model_id.clone(),
        pricing_version: catalog.version,
        input_per_million: parse_price(&record.input_per_million)?,
        cached_input_per_million: parse_price(&record.cached_input_per_million)?,
        cache_creation_per_million: parse_price(&record.cache_creation_per_million)?,
        output_per_million: parse_price(&record.output_per_million)?,
        long_context: match &record.long_context {
            Some(rule) => Some(CodexUsageLongContextPrice {
                threshold_input_tokens: rule.threshold_input_tokens,
                input_multiplier: parse_price(&rule.input_multiplier)?,
                output_multiplier: parse_price(&rule.output_multiplier)?,
            }),
            None => None,
        },
    })
}

fn decimal_token_cost(tokens: i64, price_per_million: Decimal) -> Decimal {
    Decimal::from(tokens.max(0)) * price_per_million / Decimal::from(1_000_000_i64)
}

fn format_decimal_usd(value: Decimal) -> String {
    format!(
        "{:.6}",
        value
            .max(Decimal::ZERO)
            .round_dp_with_strategy(6, RoundingStrategy::MidpointAwayFromZero)
    )
}

pub(crate) fn estimate_codex_usage_cost_usd(
    model: &str,
    input_tokens: i64,
    cache_read_tokens: i64,
    cache_creation_tokens: i64,
    output_tokens: i64,
) -> CodexUsageCostEstimate {
    let prompt_input_tokens = input_tokens
        .max(0)
        .saturating_add(cache_read_tokens.max(0))
        .saturating_add(cache_creation_tokens.max(0));
    let Some(price) = codex_usage_price_for_model(model) else {
        return CodexUsageCostEstimate {
            input_cost_usd: "0.000000".to_string(),
            output_cost_usd: "0.000000".to_string(),
            cache_read_cost_usd: "0.000000".to_string(),
            cache_creation_cost_usd: "0.000000".to_string(),
            base_total_cost_usd: "0.000000".to_string(),
            total_cost_usd: "0.000000".to_string(),
            pricing_status: "unpriced".to_string(),
            pricing_model: None,
            pricing_version: codex_usage_pricing_catalog().version,
            prompt_input_tokens,
            long_context_applied: false,
            long_context_threshold_tokens: None,
            input_multiplier: "1".to_string(),
            output_multiplier: "1".to_string(),
        };
    };
    let base_input_cost = decimal_token_cost(input_tokens, price.input_per_million);
    let base_output_cost = decimal_token_cost(output_tokens, price.output_per_million);
    let base_cache_read_cost =
        decimal_token_cost(cache_read_tokens, price.cached_input_per_million);
    let base_cache_creation_cost =
        decimal_token_cost(cache_creation_tokens, price.cache_creation_per_million);
    let long_context_applied = price
        .long_context
        .as_ref()
        .is_some_and(|rule| prompt_input_tokens > rule.threshold_input_tokens);
    let input_multiplier = if long_context_applied {
        price
            .long_context
            .as_ref()
            .map(|rule| rule.input_multiplier)
            .unwrap_or(Decimal::ONE)
    } else {
        Decimal::ONE
    };
    let output_multiplier = if long_context_applied {
        price
            .long_context
            .as_ref()
            .map(|rule| rule.output_multiplier)
            .unwrap_or(Decimal::ONE)
    } else {
        Decimal::ONE
    };
    let input_cost = base_input_cost * input_multiplier;
    let output_cost = base_output_cost * output_multiplier;
    let cache_read_cost = base_cache_read_cost * input_multiplier;
    let cache_creation_cost = base_cache_creation_cost * input_multiplier;
    let base_total_cost =
        base_input_cost + base_output_cost + base_cache_read_cost + base_cache_creation_cost;
    CodexUsageCostEstimate {
        input_cost_usd: format_decimal_usd(input_cost),
        output_cost_usd: format_decimal_usd(output_cost),
        cache_read_cost_usd: format_decimal_usd(cache_read_cost),
        cache_creation_cost_usd: format_decimal_usd(cache_creation_cost),
        base_total_cost_usd: format_decimal_usd(base_total_cost),
        total_cost_usd: format_decimal_usd(
            input_cost + output_cost + cache_read_cost + cache_creation_cost,
        ),
        pricing_status: "priced".to_string(),
        pricing_model: Some(price.model_id),
        pricing_version: price.pricing_version,
        prompt_input_tokens,
        long_context_applied,
        long_context_threshold_tokens: price
            .long_context
            .as_ref()
            .map(|rule| rule.threshold_input_tokens),
        input_multiplier: input_multiplier.normalize().to_string(),
        output_multiplier: output_multiplier.normalize().to_string(),
    }
}

pub(crate) fn format_usd(value: f64) -> String {
    let rounded = ((value.max(0.0) * 1_000_000.0) + 0.000_000_001).round() / 1_000_000.0;
    format!("{rounded:.6}")
}

pub(crate) fn insert_codex_usage_log(
    conn: &Connection,
    log: &PendingCodexUsageLog,
) -> Result<bool, rusqlite::Error> {
    let estimate = estimate_codex_usage_cost_usd(
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
            input_cost_usd,
            output_cost_usd,
            cache_read_cost_usd,
            cache_creation_cost_usd,
            base_total_cost_usd,
            total_cost_usd,
            pricing_status,
            pricing_model,
            pricing_version,
            prompt_input_tokens,
            long_context_applied,
            long_context_threshold_tokens,
            input_multiplier,
            output_multiplier,
            source_path
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
            ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21,
            ?22, ?23, ?24, ?25, ?26
        )",
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
            estimate.input_cost_usd,
            estimate.output_cost_usd,
            estimate.cache_read_cost_usd,
            estimate.cache_creation_cost_usd,
            estimate.base_total_cost_usd,
            estimate.total_cost_usd,
            estimate.pricing_status,
            estimate.pricing_model,
            estimate.pricing_version,
            estimate.prompt_input_tokens,
            estimate.long_context_applied,
            estimate.long_context_threshold_tokens,
            estimate.input_multiplier,
            estimate.output_multiplier,
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
        let denominator = self.total_input_tokens
            + self.total_cache_read_tokens
            + self.total_cache_creation_tokens;
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
        priced_requests: row.get(start_index + 1)?,
        unpriced_requests: row.get(start_index + 2)?,
        long_context_requests: row.get(start_index + 3)?,
        total_cost_usd: row.get(start_index + 4)?,
        total_input_tokens: row.get(start_index + 5)?,
        total_output_tokens: row.get(start_index + 6)?,
        total_cache_read_tokens: row.get(start_index + 7)?,
        total_cache_creation_tokens: row.get(start_index + 8)?,
        total_reasoning_output_tokens: row.get(start_index + 9)?,
    })
}

pub(crate) fn reprice_codex_usage_logs(conn: &Connection) -> Result<(), rusqlite::Error> {
    let pricing_version = codex_usage_pricing_catalog().version;
    let mut stmt = conn.prepare(
        "SELECT request_id, model, input_tokens, cache_read_tokens, cache_creation_tokens, output_tokens
         FROM codex_usage_logs
         WHERE pricing_version != ?1"
    )?;

    struct CostUpdate {
        request_id: String,
        estimate: CodexUsageCostEstimate,
    }

    let rows = stmt.query_map(rusqlite::params![pricing_version], |row| {
        let request_id: String = row.get(0)?;
        let model: String = row.get(1)?;
        let input_tokens: i64 = row.get(2)?;
        let cache_read_tokens: i64 = row.get(3)?;
        let cache_creation_tokens: i64 = row.get(4)?;
        let output_tokens: i64 = row.get(5)?;

        let estimate = estimate_codex_usage_cost_usd(
            &model,
            input_tokens,
            cache_read_tokens,
            cache_creation_tokens,
            output_tokens,
        );

        Ok(CostUpdate {
            request_id,
            estimate,
        })
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
                "UPDATE codex_usage_logs SET
                    input_cost_usd = ?1,
                    output_cost_usd = ?2,
                    cache_read_cost_usd = ?3,
                    cache_creation_cost_usd = ?4,
                    base_total_cost_usd = ?5,
                    total_cost_usd = ?6,
                    pricing_status = ?7,
                    pricing_model = ?8,
                    pricing_version = ?9,
                    prompt_input_tokens = ?10,
                    long_context_applied = ?11,
                    long_context_threshold_tokens = ?12,
                    input_multiplier = ?13,
                    output_multiplier = ?14
                 WHERE request_id = ?15",
            )?;
            for update in updates {
                let estimate = update.estimate;
                update_stmt.execute(rusqlite::params![
                    estimate.input_cost_usd,
                    estimate.output_cost_usd,
                    estimate.cache_read_cost_usd,
                    estimate.cache_creation_cost_usd,
                    estimate.base_total_cost_usd,
                    estimate.total_cost_usd,
                    estimate.pricing_status,
                    estimate.pricing_model,
                    estimate.pricing_version,
                    estimate.prompt_input_tokens,
                    estimate.long_context_applied,
                    estimate.long_context_threshold_tokens,
                    estimate.input_multiplier,
                    estimate.output_multiplier,
                    update.request_id,
                ])?;
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
            COALESCE(SUM(CASE WHEN pricing_status = 'priced' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN pricing_status != 'priced' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN long_context_applied != 0 THEN 1 ELSE 0 END), 0),
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
        priced_requests: aggregate.priced_requests,
        unpriced_requests: aggregate.unpriced_requests,
        long_context_requests: aggregate.long_context_requests,
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
            COALESCE(SUM(CASE WHEN pricing_status = 'priced' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN pricing_status != 'priced' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN long_context_applied != 0 THEN 1 ELSE 0 END), 0),
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
                unpriced_requests: aggregate.unpriced_requests,
                long_context_requests: aggregate.long_context_requests,
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
            COALESCE(SUM(CASE WHEN pricing_status = 'priced' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN pricing_status != 'priced' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN long_context_applied != 0 THEN 1 ELSE 0 END), 0),
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
                unpriced_requests: aggregate.unpriced_requests,
                long_context_requests: aggregate.long_context_requests,
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
            input_cost_usd,
            output_cost_usd,
            cache_read_cost_usd,
            cache_creation_cost_usd,
            base_total_cost_usd,
            total_cost_usd,
            pricing_status,
            pricing_model,
            pricing_version,
            prompt_input_tokens,
            long_context_applied,
            long_context_threshold_tokens,
            input_multiplier,
            output_multiplier,
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
                input_cost_usd: row.get(11)?,
                output_cost_usd: row.get(12)?,
                cache_read_cost_usd: row.get(13)?,
                cache_creation_cost_usd: row.get(14)?,
                base_total_cost_usd: row.get(15)?,
                total_cost_usd: row.get(16)?,
                pricing_status: row.get(17)?,
                pricing_model: row.get(18)?,
                pricing_version: row.get(19)?,
                prompt_input_tokens: row.get(20)?,
                long_context_applied: row.get(21)?,
                long_context_threshold_tokens: row.get(22)?,
                input_multiplier: row.get(23)?,
                output_multiplier: row.get(24)?,
                source_path: row.get(25)?,
            })
        },
    )?;

    let mut logs = Vec::new();
    for row in rows {
        logs.push(row?);
    }
    Ok(logs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_model_names_and_strips_date_suffixes() {
        assert_eq!(normalize_codex_usage_model("openai/GPT-5.5"), "gpt-5.5");
        assert_eq!(normalize_codex_usage_model("gpt-4o-2024-08-06"), "gpt-4o");
        assert_eq!(normalize_codex_usage_model("gpt-4o-20240806"), "gpt-4o");
        assert_eq!(
            normalize_codex_usage_model("  claude-opus-4-8  "),
            "claude-opus-4-8"
        );
    }

    #[test]
    fn strip_date_suffix_keeps_non_date_endings() {
        assert_eq!(strip_date_suffix("gpt-4-turbo"), "gpt-4-turbo");
        assert_eq!(strip_date_suffix("model-2024-13"), "model-2024-13");
        assert_eq!(strip_date_suffix("x"), "x");
    }

    #[test]
    fn extracts_provider_from_prefix_or_model_family() {
        assert_eq!(extract_codex_usage_provider("openai/gpt-5.5"), "openai");
        assert_eq!(extract_codex_usage_provider("gpt-4o"), "openai");
        assert_eq!(extract_codex_usage_provider("claude-sonnet-5"), "anthropic");
        assert_eq!(extract_codex_usage_provider("gemini-2.5-pro"), "google");
        assert_eq!(extract_codex_usage_provider("deepseek-v3"), "deepseek");
        assert_eq!(extract_codex_usage_provider("llama-3"), "unknown");
    }

    #[test]
    fn normalizes_effort_with_unknown_fallback() {
        assert_eq!(normalize_codex_usage_effort("  HIGH "), "high");
        assert_eq!(normalize_codex_usage_effort(""), "unknown");
    }

    #[test]
    fn formats_usd_with_six_decimals_and_floor_at_zero() {
        assert_eq!(format_usd(0.1234567), "0.123457");
        assert_eq!(format_usd(-1.0), "0.000000");
        assert_eq!(format_usd(2.0), "2.000000");
    }

    #[test]
    fn prices_current_catalog_models_with_decimal_components() {
        let estimate =
            estimate_codex_usage_cost_usd("openai/gpt-5.6", 100_000, 200_000, 300_000, 10_000);
        assert_eq!(estimate.pricing_status, "priced");
        assert_eq!(estimate.pricing_model.as_deref(), Some("gpt-5.6-sol"));
        assert_eq!(estimate.base_total_cost_usd, "2.775000");
        assert_eq!(estimate.input_cost_usd, "1.000000");
        assert_eq!(estimate.cache_read_cost_usd, "0.200000");
        assert_eq!(estimate.cache_creation_cost_usd, "3.750000");
        assert_eq!(estimate.output_cost_usd, "0.450000");
        assert_eq!(estimate.total_cost_usd, "5.400000");
        assert!(estimate.long_context_applied);
        assert_eq!(estimate.prompt_input_tokens, 600_000);
        assert_eq!(estimate.long_context_threshold_tokens, Some(272_000));
        assert_eq!(estimate.input_multiplier, "2");
        assert_eq!(estimate.output_multiplier, "1.5");
    }

    #[test]
    fn long_context_threshold_is_strict_and_model_specific() {
        let at_threshold = estimate_codex_usage_cost_usd("gpt-5.6-sol", 200_000, 72_000, 0, 1_000);
        assert!(!at_threshold.long_context_applied);
        assert_eq!(at_threshold.input_multiplier, "1");
        assert_eq!(at_threshold.output_multiplier, "1");

        let above_threshold =
            estimate_codex_usage_cost_usd("gpt-5.6-sol", 200_001, 72_000, 0, 1_000);
        assert!(above_threshold.long_context_applied);

        let mini = estimate_codex_usage_cost_usd("gpt-5.4-mini", 300_000, 0, 0, 1_000);
        assert!(!mini.long_context_applied);
        assert_eq!(mini.long_context_threshold_tokens, None);
    }

    #[test]
    fn reports_unknown_models_as_unpriced() {
        let estimate = estimate_codex_usage_cost_usd("gpt-future", 100, 0, 0, 10);
        assert_eq!(estimate.pricing_status, "unpriced");
        assert_eq!(estimate.pricing_model, None);
        assert_eq!(estimate.total_cost_usd, "0.000000");
        assert_eq!(estimate.pricing_version, 2);
    }
}
