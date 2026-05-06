use crate::core::{
    AppSnapshot, CodexUsageCredits, CodexUsageSnapshot, CodexUsageWindow,
    ThirdPartyUsageQuotaSnapshot,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Emitter, Manager, Runtime, Wry,
};

const TRAY_ID: &str = "codex-auth-switch-usage";
pub const MENU_REFRESH_ID: &str = "menu-bar-refresh-usage";
const MENU_SHOW_ID: &str = "menu-bar-show-window";
const MENU_QUIT_ID: &str = "menu-bar-quit";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuBarUsageStatus {
    pub title: String,
    pub summary: String,
    pub detail_lines: Vec<String>,
    pub progress_percent: Option<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MenuBarRefreshKind {
    CodexUsage,
    ThirdPartyUsage,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuBarRefreshTarget {
    pub profile_id: String,
    pub kind: MenuBarRefreshKind,
}

#[derive(Clone)]
struct MenuBarState<R: Runtime> {
    summary_item: MenuItem<R>,
    primary_item: MenuItem<R>,
    secondary_item: MenuItem<R>,
    credits_item: MenuItem<R>,
}

pub fn install_menu_bar(app: &mut App<Wry>, snapshot: &AppSnapshot) -> tauri::Result<()> {
    let status = menu_bar_usage_status(snapshot);
    let summary_item = MenuItem::new(app, &status.summary, false, None::<&str>)?;
    let primary_item = MenuItem::new(app, detail_line(&status, 1, "--"), false, None::<&str>)?;
    let secondary_item = MenuItem::new(app, detail_line(&status, 2, "--"), false, None::<&str>)?;
    let credits_item = MenuItem::new(
        app,
        detail_line(&status, 3, "余额：--"),
        false,
        None::<&str>,
    )?;
    let refresh_item = MenuItem::with_id(app, MENU_REFRESH_ID, "刷新额度", true, None::<&str>)?;
    let show_item = MenuItem::with_id(app, MENU_SHOW_ID, "打开主窗口", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, MENU_QUIT_ID, "退出", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let separator_2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &summary_item,
            &primary_item,
            &secondary_item,
            &credits_item,
            &separator,
            &refresh_item,
            &show_item,
            &separator_2,
            &quit_item,
        ],
    )?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(menu_bar_icon(status.progress_percent))
        .icon_as_template(false)
        .title(&status.title)
        .tooltip(&status.summary)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().0.as_str() {
            MENU_REFRESH_ID => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = app.emit("menu-bar-refresh-usage-requested", ());
                });
            }
            MENU_SHOW_ID => show_main_window(app),
            MENU_QUIT_ID => app.exit(0),
            _ => {}
        })
        .build(app)?;

    app.manage(MenuBarState {
        summary_item,
        primary_item,
        secondary_item,
        credits_item,
    });

    Ok(())
}

pub fn sync_menu_bar_usage(app: &AppHandle<Wry>, snapshot: &AppSnapshot) -> tauri::Result<()> {
    let status = menu_bar_usage_status(snapshot);
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_icon(Some(menu_bar_icon(status.progress_percent)))?;
        tray.set_title(Some(&status.title))?;
        tray.set_tooltip(Some(&status.summary))?;
    }

    if let Some(state) = app.try_state::<MenuBarState<Wry>>() {
        state.summary_item.set_text(&status.summary)?;
        state.primary_item.set_text(detail_line(&status, 1, "--"))?;
        state
            .secondary_item
            .set_text(detail_line(&status, 2, "--"))?;
        state
            .credits_item
            .set_text(detail_line(&status, 3, "余额：--"))?;
    }

    Ok(())
}

pub fn menu_bar_refresh_target(snapshot: &AppSnapshot) -> Option<MenuBarRefreshTarget> {
    let active_profile_id = snapshot.active_profile_id.as_deref()?;
    let profile = snapshot
        .profiles
        .iter()
        .find(|profile| profile.id == active_profile_id)?;

    match profile.auth_type_label.as_str() {
        "官方 OAuth" if snapshot.codex_usage_api_enabled => Some(MenuBarRefreshTarget {
            profile_id: profile.id.clone(),
            kind: MenuBarRefreshKind::CodexUsage,
        }),
        "第三方 API" => Some(MenuBarRefreshTarget {
            profile_id: profile.id.clone(),
            kind: MenuBarRefreshKind::ThirdPartyUsage,
        }),
        _ => None,
    }
}

pub fn menu_bar_usage_status(snapshot: &AppSnapshot) -> MenuBarUsageStatus {
    let profile = snapshot
        .active_profile_id
        .as_deref()
        .and_then(|profile_id| {
            snapshot
                .profiles
                .iter()
                .find(|profile| profile.id == profile_id)
        })
        .or_else(|| snapshot.profiles.first());

    let Some(profile) = profile else {
        return status_without_progress(
            "--",
            "还没有 Codex profile",
            vec!["还没有 Codex profile".into()],
        );
    };

    if profile.auth_type_label == "第三方 API" {
        return third_party_usage_status(&profile.name, profile.third_party_usage.as_ref());
    }

    codex_usage_status(&profile.name, profile.codex_usage.as_ref())
}

fn codex_usage_status(name: &str, usage: Option<&CodexUsageSnapshot>) -> MenuBarUsageStatus {
    let Some(usage) = usage else {
        return status_without_progress(
            "--",
            &format!("{name}：还没有额度快照"),
            vec![
                format!("当前：{name}"),
                "还没有额度快照".into(),
                "请在主窗口刷新额度".into(),
            ],
        );
    };

    if usage.error.is_some() {
        return status_without_progress(
            "!",
            &format!("{name}：额度刷新失败"),
            vec![
                format!("当前：{name}"),
                format!(
                    "额度刷新失败：{}",
                    usage.error.as_deref().unwrap_or("未知错误")
                ),
            ],
        );
    }

    let primary = select_usage_window(usage, 300, true);
    let weekly = select_usage_window(usage, 10080, false);
    let primary_remaining = primary.map(remaining_percent);
    let weekly_remaining = weekly.map(remaining_percent);
    let primary_used = primary.map(|window| window.used_percent.clamp(0.0, 100.0).round() as u8);

    let title = primary_remaining
        .map(|remaining| format!("{remaining}%"))
        .unwrap_or_else(|| "--".into());
    let primary_summary = primary_remaining
        .map(|remaining| format!("5H 剩余 {remaining}%"))
        .unwrap_or_else(|| "5H 剩余 --".into());
    let weekly_summary = weekly_remaining
        .map(|remaining| format!("本周剩余 {remaining}%"))
        .unwrap_or_else(|| "本周剩余 --".into());

    let mut detail_lines = vec![
        format!("当前：{name}"),
        primary_remaining
            .map(|remaining| format!("5H 剩余：{remaining}%"))
            .unwrap_or_else(|| "5H 剩余：--".into()),
        weekly_remaining
            .map(|remaining| format!("本周剩余：{remaining}%"))
            .unwrap_or_else(|| "本周剩余：--".into()),
    ];

    if let Some(credits) = usage.credits.as_ref().and_then(format_credits) {
        detail_lines.push(credits);
    }

    MenuBarUsageStatus {
        title,
        summary: format!("{name}：{primary_summary}，{weekly_summary}"),
        detail_lines,
        progress_percent: primary_used,
    }
}

fn third_party_usage_status(
    name: &str,
    usage: Option<&crate::core::ThirdPartyUsageSnapshot>,
) -> MenuBarUsageStatus {
    let Some(usage) = usage else {
        return status_without_progress(
            "--",
            &format!("{name}：还没有用量快照"),
            vec![
                format!("当前：{name}"),
                "还没有用量快照".into(),
                "请在主窗口刷新用量".into(),
            ],
        );
    };

    if usage.error.is_some() {
        return status_without_progress(
            "!",
            &format!("{name}：用量刷新失败"),
            vec![
                format!("当前：{name}"),
                format!(
                    "用量刷新失败：{}",
                    usage.error.as_deref().unwrap_or("未知错误")
                ),
            ],
        );
    }

    let daily_percent = quota_percent(usage.daily.as_ref());
    let weekly_percent = quota_percent(usage.weekly.as_ref());
    let title = daily_percent
        .map(|percent| format!("{percent}%"))
        .unwrap_or_else(|| "--".into());
    let daily_summary = daily_percent
        .map(|percent| format!("今日已用 {percent}%"))
        .unwrap_or_else(|| "今日已用 --".into());
    let weekly_summary = weekly_percent
        .map(|percent| format!("本周已用 {percent}%"))
        .unwrap_or_else(|| "本周已用 --".into());

    let mut detail_lines = vec![
        format!("当前：{name}"),
        format!("今日：{}", format_quota_pair(usage.daily.as_ref())),
        format!("本周：{}", format_quota_pair(usage.weekly.as_ref())),
    ];
    if let Some(remaining) = usage
        .remaining
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        detail_lines.push(format!(
            "余额：{}",
            [remaining.trim(), usage.unit.as_deref().unwrap_or("")]
                .into_iter()
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        ));
    }

    MenuBarUsageStatus {
        title,
        summary: format!("{name}：{daily_summary}，{weekly_summary}"),
        detail_lines,
        progress_percent: daily_percent,
    }
}

fn status_without_progress(
    title: &str,
    summary: &str,
    detail_lines: Vec<String>,
) -> MenuBarUsageStatus {
    MenuBarUsageStatus {
        title: title.into(),
        summary: summary.into(),
        detail_lines,
        progress_percent: None,
    }
}

fn select_usage_window(
    usage: &CodexUsageSnapshot,
    minutes: i64,
    fallback_primary: bool,
) -> Option<&CodexUsageWindow> {
    if usage.primary.as_ref()?.window_minutes == Some(minutes) {
        return usage.primary.as_ref();
    }
    if usage.secondary.as_ref()?.window_minutes == Some(minutes) {
        return usage.secondary.as_ref();
    }
    if fallback_primary {
        usage.primary.as_ref()
    } else {
        usage.secondary.as_ref()
    }
}

fn remaining_percent(window: &CodexUsageWindow) -> u8 {
    (100.0 - window.used_percent).clamp(0.0, 100.0).round() as u8
}

fn quota_percent(quota: Option<&ThirdPartyUsageQuotaSnapshot>) -> Option<u8> {
    let quota = quota?;
    if let Some(percent) = quota.used_percent {
        return Some(percent.clamp(0.0, 100.0).round() as u8);
    }
    let used = parse_quota_number(quota.used.as_deref()?)?;
    let total = parse_quota_number(quota.total.as_deref()?)?;
    if total <= 0.0 {
        return None;
    }
    Some(((used / total) * 100.0).clamp(0.0, 100.0).round() as u8)
}

fn format_quota_pair(quota: Option<&ThirdPartyUsageQuotaSnapshot>) -> String {
    let Some(quota) = quota else {
        return "-- / --".into();
    };
    format!(
        "{} / {}",
        quota.used.as_deref().unwrap_or("--"),
        quota.total.as_deref().unwrap_or("--")
    )
}

fn parse_quota_number(value: &str) -> Option<f64> {
    let normalized = value.trim().trim_start_matches('$').replace(',', "");
    normalized.parse::<f64>().ok()
}

fn format_credits(credits: &CodexUsageCredits) -> Option<String> {
    if credits.unlimited {
        return Some("余额：无限".into());
    }
    credits
        .balance
        .as_ref()
        .filter(|balance| !balance.trim().is_empty())
        .map(|balance| format!("余额：{}", balance.trim()))
}

fn detail_line<'a>(status: &'a MenuBarUsageStatus, index: usize, fallback: &'a str) -> &'a str {
    status
        .detail_lines
        .get(index)
        .map(String::as_str)
        .unwrap_or(fallback)
}

fn show_main_window(app: &AppHandle<Wry>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn menu_bar_icon(progress_percent: Option<u8>) -> tauri::image::Image<'static> {
    let size = 32;
    let center = 15.5_f32;
    let radius = 11.5_f32;
    let thickness = 3.4_f32;
    let progress = progress_percent.map(|value| value.min(100) as f32 / 100.0);
    let mut rgba = vec![0_u8; size * size * 4];

    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 - center;
            let dy = y as f32 - center;
            let distance = (dx * dx + dy * dy).sqrt();
            let edge = (distance - radius).abs();
            if edge > thickness / 2.0 {
                continue;
            }

            let index = (y * size + x) * 4;
            let mut color = [130_u8, 142_u8, 160_u8, 210_u8];
            if let Some(progress) = progress {
                let angle =
                    (dy.atan2(dx) + std::f32::consts::FRAC_PI_2).rem_euclid(std::f32::consts::TAU);
                let segment = angle / std::f32::consts::TAU;
                if segment <= progress {
                    color = progress_color(progress_percent.unwrap_or(0));
                }
            }
            rgba[index] = color[0];
            rgba[index + 1] = color[1];
            rgba[index + 2] = color[2];
            rgba[index + 3] = color[3];
        }
    }

    tauri::image::Image::new_owned(rgba, size as u32, size as u32)
}

fn progress_color(percent: u8) -> [u8; 4] {
    if percent >= 90 {
        [239, 68, 68, 255]
    } else if percent >= 70 {
        [245, 158, 11, 255]
    } else {
        [34, 197, 94, 255]
    }
}
