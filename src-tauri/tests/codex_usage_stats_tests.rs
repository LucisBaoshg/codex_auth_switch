use codex_auth_switch_lib::core::{CodexUsageStatsFilter, ProfileManager};
use std::fs;
use tempfile::TempDir;

fn temp_manager() -> (TempDir, TempDir, ProfileManager) {
    let app_dir = TempDir::new().expect("temp app dir");
    let target_dir = TempDir::new().expect("temp target dir");
    let manager = ProfileManager::new(
        app_dir.path().to_path_buf(),
        target_dir.path().to_path_buf(),
    )
    .expect("create manager");

    (app_dir, target_dir, manager)
}

fn write_session(target_dir: &TempDir) {
    let session_dir = target_dir.path().join("sessions/2026/06/08");
    fs::create_dir_all(&session_dir).expect("create session dir");
    let session_path = session_dir.join("rollout-2026-06-08T10-00-00-usage.jsonl");
    let lines = [
        r#"{"type":"session_meta","timestamp":"2026-06-08T10:00:00Z","payload":{"id":"session-a"}}"#,
        r#"{"type":"turn_context","timestamp":"2026-06-08T10:00:01Z","payload":{"model":"openai/gpt-5.4-2026-06-01","effort":"high"}}"#,
        r#"{"type":"event_msg","timestamp":"2026-06-08T10:00:05Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1200,"cached_input_tokens":800,"output_tokens":100,"reasoning_output_tokens":40}}}}"#,
        r#"{"type":"event_msg","timestamp":"2026-06-08T10:01:05Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1600,"cached_input_tokens":1000,"output_tokens":250,"reasoning_output_tokens":90}}}}"#,
        r#"{"type":"event_msg","timestamp":"2026-06-08T10:02:05Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":300,"cached_input_tokens":50,"output_tokens":75,"reasoning_output_tokens":25}}}}"#,
    ];
    fs::write(session_path, lines.join("\n")).expect("write session");
}

#[test]
fn codex_usage_stats_syncs_session_token_deltas_and_deduplicates() {
    let (_app_dir, target_dir, manager) = temp_manager();
    write_session(&target_dir);

    let first = manager
        .refresh_codex_usage_stats()
        .expect("refresh usage stats");
    assert_eq!(first.sync.imported, 3);
    assert_eq!(first.summary.total_requests, 3);
    assert_eq!(first.summary.total_input_tokens, 850);
    assert_eq!(first.summary.total_cache_read_tokens, 1050);
    assert_eq!(first.summary.total_output_tokens, 325);
    assert_eq!(first.summary.total_reasoning_output_tokens, 115);
    assert_eq!(first.summary.real_total_tokens, 2225);
    assert_eq!(first.summary.total_cost_usd, "0.007263");
    assert!((first.summary.cache_hit_rate - (1050.0 / 1900.0)).abs() < 0.000_001);
    assert_eq!(first.logs.len(), 3);
    assert_eq!(first.logs[0].model, "gpt-5.4");
    assert_eq!(first.logs[0].provider, "openai");
    assert_eq!(first.logs[0].effort, "high");
    assert_eq!(first.trends.len(), 1);
    assert_eq!(first.trends[0].request_count, 3);
    assert_eq!(first.trends[0].total_cost_usd, "0.007263");
    assert_eq!(first.model_breakdown[0].name, "gpt-5.4");
    assert_eq!(first.effort_breakdown[0].name, "high");
    assert_eq!(first.available_models, vec!["gpt-5.4"]);
    assert_eq!(first.available_efforts, vec!["high"]);

    let second = manager
        .refresh_codex_usage_stats()
        .expect("refresh usage stats again");
    assert_eq!(second.sync.imported, 0);
    assert_eq!(second.sync.skipped, 3);
    assert_eq!(second.summary.total_requests, 3);

    let filtered = manager
        .refresh_codex_usage_stats_with_filter(CodexUsageStatsFilter {
            start_date: Some("2026-06-09".to_string()),
            end_date: None,
            model: None,
            effort: None,
        })
        .expect("refresh usage stats with filter");
    assert_eq!(filtered.summary.total_requests, 0);
}

#[test]
fn codex_usage_stats_backfills_zero_costs() {
    let (app_dir, target_dir, manager) = temp_manager();
    write_session(&target_dir); // write dummy files so collect doesn't return empty list of files

    let db_path = app_dir.path().join("usage_logs.sqlite3");
    let conn = rusqlite::Connection::open(&db_path).expect("open test db");

    conn.execute(
        "CREATE TABLE IF NOT EXISTS codex_usage_logs (
            request_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            model TEXT NOT NULL,
            created_at TEXT NOT NULL,
            input_tokens INTEGER NOT NULL,
            output_tokens INTEGER NOT NULL,
            cache_read_tokens INTEGER NOT NULL,
            cache_creation_tokens INTEGER NOT NULL,
            reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
            effort TEXT NOT NULL DEFAULT 'unknown',
            total_cost_usd TEXT NOT NULL DEFAULT '0',
            source_path TEXT NOT NULL
        )",
        [],
    )
    .expect("create test table");

    conn.execute(
        "INSERT INTO codex_usage_logs (
            request_id, session_id, model, created_at, input_tokens, output_tokens,
            cache_read_tokens, cache_creation_tokens, source_path
        ) VALUES (
            'req-1', 'session-1', 'gpt-5.5', '2026-06-08T10:00:00Z', 100000, 10000, 200000, 0, 'dummy'
        )",
        [],
    )
    .expect("insert row");

    conn.execute(
        "INSERT INTO codex_usage_logs (
            request_id, session_id, model, created_at, input_tokens, output_tokens,
            cache_read_tokens, cache_creation_tokens, source_path
        ) VALUES (
            'req-2', 'session-1', 'unknown-model', '2026-06-08T10:00:00Z', 100000, 10000, 200000, 0, 'dummy'
        )",
        [],
    )
    .expect("insert row 2");

    drop(conn);

    let snapshot = manager.refresh_codex_usage_stats().expect("refresh stats");
    assert!(snapshot.sync.errors.is_empty(), "Errors: {:?}", snapshot.sync.errors);

    assert_eq!(snapshot.logs.len(), 5);
    let log1 = snapshot.logs.iter().find(|l| l.request_id == "req-1").unwrap();
    assert_eq!(log1.provider, "openai");
    let log2 = snapshot.logs.iter().find(|l| l.request_id == "req-2").unwrap();
    assert_eq!(log2.provider, "unknown");

    let conn = rusqlite::Connection::open(&db_path).expect("reopen test db");

    let (cost1, provider1): (String, String) = conn.query_row(
        "SELECT total_cost_usd, provider FROM codex_usage_logs WHERE request_id = 'req-1'",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).expect("query cost 1");
    assert_eq!(cost1, "0.900000");
    assert_eq!(provider1, "openai");

    let (cost2, provider2): (String, String) = conn.query_row(
        "SELECT total_cost_usd, provider FROM codex_usage_logs WHERE request_id = 'req-2'",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).expect("query cost 2");
    assert_eq!(cost2, "0.000000");
    assert_eq!(provider2, "unknown");
}

