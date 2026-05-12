use chrono::{TimeZone, Utc};
use codex_auth_switch_lib::core::{
    AppSnapshot, CodexUsageCredits, CodexUsageSnapshot, CodexUsageWindow, ProfileSummary,
    ThirdPartyUsageQuotaSnapshot, ThirdPartyUsageSnapshot,
};
use codex_auth_switch_lib::menu_bar::{
    menu_bar_action_labels, menu_bar_refresh_target, menu_bar_usage_status, MenuBarRefreshKind,
};

fn usage_window(used_percent: f64, minutes: i64) -> CodexUsageWindow {
    CodexUsageWindow {
        used_percent,
        window_minutes: Some(minutes),
        resets_at: Some(Utc.with_ymd_and_hms(2026, 5, 6, 12, 0, 0).unwrap()),
    }
}

fn codex_usage(primary_used: f64, weekly_used: f64) -> CodexUsageSnapshot {
    CodexUsageSnapshot {
        source: "api".into(),
        plan_type: Some("team".into()),
        primary: Some(usage_window(primary_used, 300)),
        secondary: Some(usage_window(weekly_used, 10080)),
        credits: Some(CodexUsageCredits {
            has_credits: true,
            unlimited: false,
            balance: Some("12.50".into()),
        }),
        updated_at: Utc.with_ymd_and_hms(2026, 5, 6, 10, 30, 0).unwrap(),
        error: None,
    }
}

fn third_party_usage(
    daily_used: &str,
    daily_total: &str,
    weekly_used: &str,
    weekly_total: &str,
) -> ThirdPartyUsageSnapshot {
    ThirdPartyUsageSnapshot {
        provider: Some("ylscode".into()),
        remaining: Some("19.38".into()),
        unit: Some("USD".into()),
        daily: Some(ThirdPartyUsageQuotaSnapshot {
            used: Some(daily_used.into()),
            total: Some(daily_total.into()),
            remaining: Some("19.38".into()),
            used_percent: None,
        }),
        weekly: Some(ThirdPartyUsageQuotaSnapshot {
            used: Some(weekly_used.into()),
            total: Some(weekly_total.into()),
            remaining: Some("419.38".into()),
            used_percent: None,
        }),
        updated_at: Utc.with_ymd_and_hms(2026, 5, 6, 10, 30, 0).unwrap(),
        error: None,
    }
}

fn profile(id: &str, name: &str, usage: Option<CodexUsageSnapshot>) -> ProfileSummary {
    ProfileSummary {
        id: id.into(),
        name: name.into(),
        notes: String::new(),
        auth_type_label: "官方 OAuth".into(),
        model_provider_id: None,
        model_provider_api_key_id: None,
        model_provider_key: None,
        model_provider_name: None,
        model_provider_base_url: None,
        model_provider_wire_api: None,
        created_at: Utc.with_ymd_and_hms(2026, 5, 6, 9, 0, 0).unwrap(),
        updated_at: Utc.with_ymd_and_hms(2026, 5, 6, 9, 0, 0).unwrap(),
        auth_hash: format!("{id}-auth"),
        config_hash: format!("{id}-config"),
        codex_usage: usage,
        third_party_latency: None,
        third_party_usage: None,
    }
}

fn third_party_profile(
    id: &str,
    name: &str,
    usage: Option<ThirdPartyUsageSnapshot>,
) -> ProfileSummary {
    ProfileSummary {
        auth_type_label: "第三方 API".into(),
        third_party_usage: usage,
        ..profile(id, name, None)
    }
}

fn snapshot(active_profile_id: Option<&str>, profiles: Vec<ProfileSummary>) -> AppSnapshot {
    AppSnapshot {
        target_dir: "/tmp/.codex".into(),
        using_default_target_dir: false,
        target_exists: true,
        target_auth_exists: true,
        target_config_exists: true,
        target_updated_at: None,
        target_auth_type_label: Some("官方 OAuth".into()),
        active_profile_id: active_profile_id.map(str::to_string),
        last_selected_profile_id: None,
        last_switch_profile_id: active_profile_id.map(str::to_string),
        last_switched_at: None,
        codex_usage_api_enabled: true,
        profiles,
    }
}

#[test]
fn menu_bar_usage_status_prefers_active_profile_remaining_percent() {
    let snapshot = snapshot(
        Some("active"),
        vec![
            profile("inactive", "Personal", Some(codex_usage(90.0, 20.0))),
            profile("active", "Work Team", Some(codex_usage(37.2, 51.0))),
        ],
    );

    let status = menu_bar_usage_status(&snapshot);

    assert_eq!(status.title, "63%");
    assert_eq!(status.progress_percent, Some(37));
    assert_eq!(status.summary, "Work Team：5H 剩余 63%，本周剩余 49%");
    assert_eq!(status.detail_lines[0], "当前：Work Team");
    assert_eq!(status.detail_lines[1], "5H 剩余：63%");
    assert_eq!(status.detail_lines[2], "本周剩余：49%");
    assert_eq!(status.detail_lines[3], "余额：12.50");
}

#[test]
fn menu_bar_usage_status_reports_missing_or_failed_usage() {
    let mut failed = codex_usage(20.0, 20.0);
    failed.primary = None;
    failed.secondary = None;
    failed.error = Some("upstream failed".into());
    let snapshot = snapshot(
        Some("active"),
        vec![profile("active", "Work Team", Some(failed))],
    );

    let status = menu_bar_usage_status(&snapshot);

    assert_eq!(status.title, "!");
    assert_eq!(status.summary, "Work Team：额度刷新失败");
    assert_eq!(status.detail_lines[1], "额度刷新失败：upstream failed");
}

#[test]
fn menu_bar_usage_status_uses_third_party_daily_quota_for_active_api_profile() {
    let snapshot = snapshot(
        Some("third-party"),
        vec![third_party_profile(
            "third-party",
            "API Profile",
            Some(third_party_usage("80.62", "100", "80.62", "500")),
        )],
    );

    let status = menu_bar_usage_status(&snapshot);

    assert_eq!(status.title, "81%");
    assert_eq!(status.progress_percent, Some(81));
    assert_eq!(status.summary, "API Profile：今日已用 81%，本周已用 16%");
    assert_eq!(status.detail_lines[0], "当前：API Profile");
    assert_eq!(status.detail_lines[1], "今日：80.62 / 100");
    assert_eq!(status.detail_lines[2], "本周：80.62 / 500");
    assert_eq!(status.detail_lines[3], "余额：19.38 USD");
}

#[test]
fn menu_bar_refresh_target_supports_active_official_and_third_party_profiles() {
    let snapshot = snapshot(
        Some("active"),
        vec![
            third_party_profile("third-party", "API Profile", None),
            profile("active", "Work Team", None),
        ],
    );

    let official = menu_bar_refresh_target(&snapshot).expect("official target");
    assert_eq!(official.profile_id, "active");
    assert_eq!(official.kind, MenuBarRefreshKind::CodexUsage);

    let disabled = AppSnapshot {
        codex_usage_api_enabled: false,
        ..snapshot.clone()
    };
    assert_eq!(menu_bar_refresh_target(&disabled), None);

    let third_party_active = AppSnapshot {
        active_profile_id: Some("third-party".into()),
        ..snapshot
    };
    let third_party = menu_bar_refresh_target(&third_party_active).expect("third-party target");
    assert_eq!(third_party.profile_id, "third-party");
    assert_eq!(third_party.kind, MenuBarRefreshKind::ThirdPartyUsage);
}

#[test]
fn menu_bar_actions_include_wake_pet_between_refresh_and_show_window() {
    let labels = menu_bar_action_labels();

    assert_eq!(labels[0], ("menu-bar-refresh-usage", "刷新额度"));
    assert_eq!(labels[1], ("menu-bar-wake-pet", "唤起宠物"));
    assert_eq!(labels[2], ("menu-bar-show-window", "打开主窗口"));
}
