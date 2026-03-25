#[allow(dead_code)]
#[path = "../../src-tauri/src/core/mod.rs"]
mod core;

use chrono::{DateTime, Local, Utc};
use core::{default_cli_app_data_dir, CodexUsageSnapshot, CodexUsageWindow, ProfileManager, ProfileSummary};
use std::path::PathBuf;

const DEFAULT_REMOTE_PROFILES_URL: &str = "http://sub2api.ite.tapcash.com/codex/api/profiles";

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let Some(command) = args.next() else {
        print_usage();
        return Ok(());
    };

    let app_data_dir = default_cli_app_data_dir().map_err(|error| error.to_string())?;
    let mut manager =
        ProfileManager::load_or_default(app_data_dir).map_err(|error| error.to_string())?;

    if let Ok(target_dir) = std::env::var("CODEX_AUTH_SWITCH_TARGET_DIR") {
        let target_dir = target_dir.trim();
        if !target_dir.is_empty() {
            manager
                .set_target_dir(Some(PathBuf::from(target_dir)))
                .map_err(|error| error.to_string())?;
        }
    }

    match command.as_str() {
        "sync-remote" => {
            let profiles_url = std::env::var("CODEX_AUTH_SWITCH_REMOTE_BASE_URL")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_REMOTE_PROFILES_URL.to_string());
            let result = manager
                .sync_remote_profiles(&profiles_url)
                .map_err(|error| error.to_string())?;

            println!(
                "synced={} imported={} updated={}",
                result.synced, result.imported, result.updated
            );
            for profile in result.profiles {
                println!("{} {}", profile.id, profile.name);
            }
        }
        "switch" => {
            let selector = args
                .next()
                .ok_or_else(|| "Missing profile selector. Usage: codex-auth-switch-cli switch <profile-id-or-name>".to_string())?;
            let profile = manager
                .resolve_profile_selector(&selector)
                .map_err(|error| error.to_string())?;
            manager
                .switch_profile(&profile.id)
                .map_err(|error| error.to_string())?;
            println!("switched={} {}", profile.id, profile.name);
        }
        "list" => {
            let profiles = manager.list_profiles().map_err(|error| error.to_string())?;
            print_profiles(profiles);
        }
        "usage" => {
            let subcommand = args.next().ok_or_else(|| {
                "Missing usage subcommand. Usage: codex-auth-switch-cli usage <enable|disable|status|refresh|refresh-all>".to_string()
            })?;
            match subcommand.as_str() {
                "enable" => {
                    manager
                        .set_codex_usage_api_enabled(true)
                        .map_err(|error| error.to_string())?;
                    println!("codex_usage_api_enabled=true");
                    println!("warning=This feature queries chatgpt.com/backend-api/wham/usage using stored ChatGPT tokens.");
                }
                "disable" => {
                    manager
                        .set_codex_usage_api_enabled(false)
                        .map_err(|error| error.to_string())?;
                    println!("codex_usage_api_enabled=false");
                }
                "status" => {
                    let snapshot = manager.snapshot().map_err(|error| error.to_string())?;
                    println!(
                        "codex_usage_api_enabled={}",
                        snapshot.codex_usage_api_enabled
                    );
                }
                "refresh" => {
                    let selector = args.next().ok_or_else(|| {
                        "Missing profile selector. Usage: codex-auth-switch-cli usage refresh <profile-id-or-name>".to_string()
                    })?;
                    let profile = manager
                        .resolve_profile_selector(&selector)
                        .map_err(|error| error.to_string())?;
                    let refreshed = manager
                        .refresh_profile_codex_usage(&profile.id)
                        .map_err(|error| error.to_string())?;
                    println!(
                        "refreshed={} plan={} 5h={} weekly={}",
                        refreshed.name,
                        refreshed
                            .codex_usage
                            .as_ref()
                            .and_then(|usage| usage.plan_type.as_deref())
                            .unwrap_or("-"),
                        format_usage_window(
                            refreshed
                                .codex_usage
                                .as_ref()
                                .and_then(|usage| select_window(usage, 300, true))
                        ),
                        format_usage_window(
                            refreshed
                                .codex_usage
                                .as_ref()
                                .and_then(|usage| select_window(usage, 10080, false))
                        )
                    );
                }
                "refresh-all" => {
                    let refreshed = manager
                        .refresh_all_codex_usage()
                        .map_err(|error| error.to_string())?;
                    println!("refreshed={}", refreshed.len());
                    print_profiles(manager.list_profiles().map_err(|error| error.to_string())?);
                }
                other => {
                    return Err(format!("Unknown usage subcommand: {other}"));
                }
            }
        }
        "help" | "--help" | "-h" => {
            print_usage();
        }
        other => {
            return Err(format!("Unknown command: {other}\n"));
        }
    }

    Ok(())
}

fn print_usage() {
    println!("codex-auth-switch-cli");
    println!();
    println!("Commands:");
    println!("  sync-remote            Pull remote profiles into local storage");
    println!("  switch <id-or-name>    Switch to a local profile");
    println!("  list                   List local profiles with cached Codex usage");
    println!("  usage enable           Enable Codex usage queries via ChatGPT private endpoint");
    println!("  usage disable          Disable Codex usage queries");
    println!("  usage status           Show whether Codex usage queries are enabled");
    println!("  usage refresh <id>     Refresh Codex usage for one official OAuth profile");
    println!("  usage refresh-all      Refresh Codex usage for all official OAuth profiles");
}

fn print_profiles(profiles: Vec<ProfileSummary>) {
    let mut widths = [
        "PROFILE".len(),
        "AUTH".len(),
        "PLAN".len(),
        "5H".len(),
        "WEEKLY".len(),
        "UPDATED".len(),
    ];

    let rows = profiles
        .iter()
        .map(|profile| {
            let label = format!("{} ({})", profile.name, short_id(&profile.id));
            let plan = profile
                .codex_usage
                .as_ref()
                .and_then(|usage| usage.plan_type.as_deref())
                .unwrap_or("-")
                .to_string();
            let usage_5h = format_usage_window(
                profile
                    .codex_usage
                    .as_ref()
                    .and_then(|usage| select_window(usage, 300, true)),
            );
            let usage_weekly = format_usage_window(
                profile
                    .codex_usage
                    .as_ref()
                    .and_then(|usage| select_window(usage, 10080, false)),
            );
            let updated = profile
                .codex_usage
                .as_ref()
                .map(|usage| usage.updated_at.with_timezone(&Local).format("%Y-%m-%d %H:%M").to_string())
                .unwrap_or_else(|| "-".to_string());

            widths[0] = widths[0].max(label.len());
            widths[1] = widths[1].max(profile.auth_type_label.len());
            widths[2] = widths[2].max(plan.len());
            widths[3] = widths[3].max(usage_5h.len());
            widths[4] = widths[4].max(usage_weekly.len());
            widths[5] = widths[5].max(updated.len());

            (
                label,
                profile.auth_type_label.clone(),
                plan,
                usage_5h,
                usage_weekly,
                updated,
            )
        })
        .collect::<Vec<_>>();

    println!(
        "{:<w0$}  {:<w1$}  {:<w2$}  {:<w3$}  {:<w4$}  {:<w5$}",
        "PROFILE",
        "AUTH",
        "PLAN",
        "5H",
        "WEEKLY",
        "UPDATED",
        w0 = widths[0],
        w1 = widths[1],
        w2 = widths[2],
        w3 = widths[3],
        w4 = widths[4],
        w5 = widths[5],
    );
    println!(
        "{}",
        "-".repeat(widths.iter().sum::<usize>() + 10)
    );

    for row in rows {
        println!(
            "{:<w0$}  {:<w1$}  {:<w2$}  {:<w3$}  {:<w4$}  {:<w5$}",
            row.0,
            row.1,
            row.2,
            row.3,
            row.4,
            row.5,
            w0 = widths[0],
            w1 = widths[1],
            w2 = widths[2],
            w3 = widths[3],
            w4 = widths[4],
            w5 = widths[5],
        );
    }
}

fn short_id(id: &str) -> &str {
    &id[..id.len().min(8)]
}

fn select_window<'a>(
    usage: &'a CodexUsageSnapshot,
    minutes: i64,
    fallback_primary: bool,
) -> Option<&'a CodexUsageWindow> {
    if let Some(primary) = usage.primary.as_ref() {
        if primary.window_minutes == Some(minutes) {
            return Some(primary);
        }
    }
    if let Some(secondary) = usage.secondary.as_ref() {
        if secondary.window_minutes == Some(minutes) {
            return Some(secondary);
        }
    }
    if fallback_primary {
        usage.primary.as_ref()
    } else {
        usage.secondary.as_ref()
    }
}

fn format_usage_window(window: Option<&CodexUsageWindow>) -> String {
    let Some(window) = window else {
        return "-".into();
    };
    let Some(reset_at) = window.resets_at else {
        return "-".into();
    };
    let now = Utc::now();
    if reset_at <= now {
        return "100%".into();
    }

    let remaining = remaining_percent(window.used_percent);
    let reset_local: DateTime<Local> = reset_at.with_timezone(&Local);
    let now_local: DateTime<Local> = now.with_timezone(&Local);
    let same_day = reset_local.date_naive() == now_local.date_naive();
    let time = reset_local.format("%H:%M").to_string();
    if same_day {
        format!("{remaining}% ({time})")
    } else {
        format!("{remaining}% ({time} on {})", reset_local.format("%-d %b"))
    }
}

fn remaining_percent(used_percent: f64) -> i64 {
    (100.0 - used_percent).clamp(0.0, 100.0) as i64
}
