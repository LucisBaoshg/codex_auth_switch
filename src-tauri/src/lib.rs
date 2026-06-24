pub mod core;
pub mod menu_bar;

use crate::core::{
    check_for_update, check_install_location as resolve_install_location,
    get_pac_proxy_status as read_pac_proxy_status, install_update as perform_install_update,
    restart_codex_app, set_pac_proxy_enabled as write_pac_proxy_enabled,
    set_pac_proxy_selected_option as write_pac_proxy_selected_option,
    set_pac_proxy_selected_services as write_pac_proxy_selected_services, AppSnapshot,
    CodexMessage, CodexSessionInfo, CodexUsageStatsFilter, CodexUsageStatsSnapshot,
    InstallLocationStatus, LegacyThirdPartyMigrationResult, ModelProviderSummary, PacProxyStatus,
    ProfileDocument, ProfileInput, ProfileManager, SessionRecoveryReport, SessionRepairResult,
    ThirdPartyWebsocketsDefaultResult, UpdateCheckResult, UpdateInstallRequest,
};
use crate::menu_bar::{
    install_menu_bar, menu_bar_refresh_target, sync_menu_bar_pac_proxy, sync_menu_bar_usage,
    MenuBarRefreshKind,
};
use chrono::{DateTime, Utc};
use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Listener, Manager};

const MENU_BAR_REFRESH_INTERVAL: Duration = Duration::from_secs(30);

#[derive(serde::Serialize)]
struct NetworkHttpResponse {
    status: u16,
    body: String,
}

fn manager_from_app(app: &AppHandle) -> Result<ProfileManager, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    ProfileManager::load_or_default(app_data_dir).map_err(|error| error.to_string())
}

async fn run_blocking_manager_task<T, F>(app: AppHandle, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(ProfileManager) -> Result<T, String> + Send + 'static,
{
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        let manager =
            ProfileManager::load_or_default(app_data_dir).map_err(|error| error.to_string())?;
        task(manager)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn load_snapshot(app: AppHandle) -> Result<AppSnapshot, String> {
    let manager = manager_from_app(&app)?;
    snapshot_and_sync(&app, &manager)
}

#[tauri::command]
fn list_model_providers(app: AppHandle) -> Result<Vec<ModelProviderSummary>, String> {
    manager_from_app(&app)?
        .list_model_providers()
        .map(|providers| {
            providers
                .into_iter()
                .map(ModelProviderSummary::from)
                .collect()
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn import_profile(app: AppHandle, payload: ProfileInput) -> Result<AppSnapshot, String> {
    let manager = manager_from_app(&app)?;
    manager
        .import_profile(payload)
        .map_err(|error| error.to_string())?;
    snapshot_and_sync(&app, &manager)
}

#[tauri::command]
fn import_from_target_dir(
    app: AppHandle,
    name: String,
    notes: String,
) -> Result<AppSnapshot, String> {
    let manager = manager_from_app(&app)?;
    manager
        .import_profile_from_target_dir(name, notes)
        .map_err(|error| error.to_string())?;
    snapshot_and_sync(&app, &manager)
}

#[tauri::command]
fn get_target_profile_input(app: AppHandle) -> Result<ProfileInput, String> {
    manager_from_app(&app)?
        .get_target_profile_input()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_profile_document(app: AppHandle, profile_id: String) -> Result<ProfileDocument, String> {
    manager_from_app(&app)?
        .get_profile_document(&profile_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn update_profile(
    app: AppHandle,
    profile_id: String,
    payload: ProfileInput,
) -> Result<AppSnapshot, String> {
    let manager = manager_from_app(&app)?;
    manager
        .update_profile(&profile_id, payload)
        .map_err(|error| error.to_string())?;
    snapshot_and_sync(&app, &manager)
}

#[tauri::command]
fn set_profile_remote_metadata(
    app: AppHandle,
    profile_id: String,
    remote_profile_id: String,
    remote_content_version: Option<u64>,
    remote_content_hash: Option<String>,
    remote_updated_at: Option<DateTime<Utc>>,
) -> Result<AppSnapshot, String> {
    let manager = manager_from_app(&app)?;
    manager
        .set_profile_remote_metadata(
            &profile_id,
            remote_profile_id,
            remote_content_version,
            remote_content_hash,
            remote_updated_at,
        )
        .map_err(|error| error.to_string())?;
    snapshot_and_sync(&app, &manager)
}

#[tauri::command]
fn delete_network_profile(
    url: String,
    token: Option<String>,
) -> Result<NetworkHttpResponse, String> {
    let parsed = url::Url::parse(&url).map_err(|error| error.to_string())?;
    match parsed.scheme() {
        "http" | "https" => (),
        scheme => return Err(format!("unsupported URL scheme: {scheme}")),
    }

    let mut request = ureq::delete(parsed.as_str()).set("User-Agent", "codex-auth-switch");
    if let Some(token) = token {
        let token = token.trim();
        if !token.is_empty() {
            request = request.set("Authorization", &format!("Bearer {token}"));
        }
    }

    match request.call() {
        Ok(response) => Ok(NetworkHttpResponse {
            status: response.status(),
            body: response.into_string().unwrap_or_default(),
        }),
        Err(ureq::Error::Status(status, response)) => Ok(NetworkHttpResponse {
            status,
            body: response.into_string().unwrap_or_default(),
        }),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn network_request(
    method: String,
    url: String,
    token: Option<String>,
    body: Option<String>,
) -> Result<NetworkHttpResponse, String> {
    let parsed = url::Url::parse(&url).map_err(|error| error.to_string())?;
    match parsed.scheme() {
        "http" | "https" => (),
        scheme => return Err(format!("unsupported URL scheme: {scheme}")),
    }

    let method = method.trim().to_ascii_uppercase();
    let mut request = match method.as_str() {
        "GET" => ureq::get(parsed.as_str()),
        "POST" => ureq::post(parsed.as_str()),
        _ => return Err(format!("unsupported HTTP method: {method}")),
    }
    .set("User-Agent", "codex-auth-switch");

    if let Some(token) = token {
        let token = token.trim();
        if !token.is_empty() {
            request = request.set("Authorization", &format!("Bearer {token}"));
        }
    }

    let response = if let Some(body) = body {
        request
            .set("Content-Type", "application/json")
            .send_string(&body)
    } else {
        request.call()
    };

    match response {
        Ok(response) => Ok(NetworkHttpResponse {
            status: response.status(),
            body: response.into_string().unwrap_or_default(),
        }),
        Err(ureq::Error::Status(status, response)) => Ok(NetworkHttpResponse {
            status,
            body: response.into_string().unwrap_or_default(),
        }),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn switch_profile(app: AppHandle, profile_id: String) -> Result<AppSnapshot, String> {
    let mut manager = manager_from_app(&app)?;
    manager
        .switch_profile(&profile_id)
        .map_err(|error| error.to_string())?;
    snapshot_and_sync(&app, &manager)
}

#[tauri::command]
fn delete_profile(app: AppHandle, profile_id: String) -> Result<AppSnapshot, String> {
    let mut manager = manager_from_app(&app)?;
    manager
        .delete_profile(&profile_id)
        .map_err(|error| error.to_string())?;
    snapshot_and_sync(&app, &manager)
}

#[tauri::command]
fn set_target_dir(app: AppHandle, target_dir: Option<String>) -> Result<AppSnapshot, String> {
    let mut manager = manager_from_app(&app)?;
    let next_target_dir = target_dir
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    manager
        .set_target_dir(next_target_dir)
        .map_err(|error| error.to_string())?;
    snapshot_and_sync(&app, &manager)
}

#[tauri::command]
fn set_codex_usage_api_enabled(app: AppHandle, enabled: bool) -> Result<AppSnapshot, String> {
    let mut manager = manager_from_app(&app)?;
    manager
        .set_codex_usage_api_enabled(enabled)
        .map_err(|error| error.to_string())?;
    snapshot_and_sync(&app, &manager)
}

#[tauri::command]
fn migrate_legacy_third_party_profiles(
    app: AppHandle,
) -> Result<LegacyThirdPartyMigrationResult, String> {
    let manager = manager_from_app(&app)?;
    let result = manager
        .migrate_legacy_third_party_profiles()
        .map_err(|error| error.to_string())?;
    let snapshot = manager.snapshot().map_err(|error| error.to_string())?;
    sync_menu_bar_usage(&app, &snapshot).map_err(|error| error.to_string())?;
    Ok(result)
}

#[tauri::command]
fn write_third_party_websockets_defaults(
    app: AppHandle,
) -> Result<ThirdPartyWebsocketsDefaultResult, String> {
    let manager = manager_from_app(&app)?;
    let result = manager
        .write_third_party_websockets_defaults()
        .map_err(|error| error.to_string())?;
    let snapshot = manager.snapshot().map_err(|error| error.to_string())?;
    sync_menu_bar_usage(&app, &snapshot).map_err(|error| error.to_string())?;
    Ok(result)
}

#[tauri::command]
async fn refresh_profile_codex_usage(
    app: AppHandle,
    profile_id: String,
) -> Result<AppSnapshot, String> {
    let app_for_sync = app.clone();
    let snapshot = run_blocking_manager_task(app, move |manager| {
        manager
            .refresh_profile_codex_usage(&profile_id)
            .map_err(|error| error.to_string())?;
        manager.snapshot().map_err(|error| error.to_string())
    })
    .await?;
    sync_menu_bar_usage(&app_for_sync, &snapshot).map_err(|error| error.to_string())?;
    Ok(snapshot)
}

#[tauri::command]
async fn refresh_profile_latency_probe(
    app: AppHandle,
    profile_id: String,
) -> Result<AppSnapshot, String> {
    run_blocking_manager_task(app, move |manager| {
        manager
            .refresh_profile_latency_probe(&profile_id)
            .map_err(|error| error.to_string())?;
        manager.snapshot().map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn refresh_profile_third_party_usage(
    app: AppHandle,
    profile_id: String,
) -> Result<AppSnapshot, String> {
    let app_for_sync = app.clone();
    let snapshot = run_blocking_manager_task(app, move |manager| {
        manager
            .refresh_profile_third_party_usage(&profile_id)
            .map_err(|error| error.to_string())?;
        manager.snapshot().map_err(|error| error.to_string())
    })
    .await?;
    sync_menu_bar_usage(&app_for_sync, &snapshot).map_err(|error| error.to_string())?;
    Ok(snapshot)
}

#[tauri::command]
async fn refresh_all_codex_usage(app: AppHandle) -> Result<AppSnapshot, String> {
    let app_for_sync = app.clone();
    let snapshot = run_blocking_manager_task(app, move |manager| {
        manager
            .refresh_all_codex_usage()
            .map_err(|error| error.to_string())?;
        manager.snapshot().map_err(|error| error.to_string())
    })
    .await?;
    sync_menu_bar_usage(&app_for_sync, &snapshot).map_err(|error| error.to_string())?;
    Ok(snapshot)
}

async fn refresh_menu_bar_active_codex_usage(app: AppHandle) -> Result<(), String> {
    let app_for_sync = app.clone();
    let snapshot = run_blocking_manager_task(app, move |manager| {
        let snapshot = manager.snapshot().map_err(|error| error.to_string())?;
        let Some(target) = menu_bar_refresh_target(&snapshot) else {
            return Ok(snapshot);
        };

        match target.kind {
            MenuBarRefreshKind::CodexUsage => {
                let _ = manager.refresh_profile_codex_usage(&target.profile_id);
            }
            MenuBarRefreshKind::ThirdPartyUsage => {
                let _ = manager.refresh_profile_third_party_usage(&target.profile_id);
            }
        }
        manager.snapshot().map_err(|error| error.to_string())
    })
    .await?;
    sync_menu_bar_usage(&app_for_sync, &snapshot).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_target_dir(app: AppHandle) -> Result<(), String> {
    manager_from_app(&app)?
        .open_target_dir()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn restart_codex() -> Result<(), String> {
    restart_codex_app().map_err(|error| error.to_string())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|error| error.to_string())?;
    match parsed.scheme() {
        "http" | "https" => (),
        scheme => return Err(format!("unsupported URL scheme: {scheme}")),
    }

    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "macos")]
    command.arg(parsed.as_str());

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("rundll32");
        command.args(["url.dll,FileProtocolHandler", parsed.as_str()]);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(parsed.as_str());
        command
    };

    command.spawn().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn fix_session_database(app: tauri::AppHandle) -> Result<(), String> {
    let manager = manager_from_app(&app)?;
    manager
        .fix_session_database_and_configs()
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn diagnose_codex_sessions(app: AppHandle) -> Result<SessionRecoveryReport, String> {
    run_blocking_manager_task(app, move |manager| {
        manager
            .diagnose_codex_sessions()
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn repair_codex_sessions(
    app: AppHandle,
    repair_times_from_session_index: bool,
) -> Result<SessionRepairResult, String> {
    run_blocking_manager_task(app, move |manager| {
        manager
            .repair_codex_sessions(repair_times_from_session_index)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
fn check_update() -> Result<UpdateCheckResult, String> {
    check_for_update().map_err(|error| error.to_string())
}

#[tauri::command]
fn install_update(payload: UpdateInstallRequest) -> Result<(), String> {
    perform_install_update(payload).map_err(|error| error.to_string())
}

#[tauri::command]
fn check_install_location() -> Result<InstallLocationStatus, String> {
    resolve_install_location().map_err(|error| error.to_string())
}

#[tauri::command]
fn get_pac_proxy_status(app: AppHandle) -> Result<PacProxyStatus, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    read_pac_proxy_status(app_data_dir).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_pac_proxy_enabled(app: AppHandle, enabled: bool) -> Result<PacProxyStatus, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let status =
        write_pac_proxy_enabled(app_data_dir, enabled).map_err(|error| error.to_string())?;
    sync_menu_bar_pac_proxy(&app, &status).map_err(|error| error.to_string())?;
    Ok(status)
}

#[tauri::command]
fn set_pac_proxy_selected_services(
    app: AppHandle,
    selected_services: Vec<String>,
) -> Result<PacProxyStatus, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let status = write_pac_proxy_selected_services(app_data_dir, selected_services)
        .map_err(|error| error.to_string())?;
    sync_menu_bar_pac_proxy(&app, &status).map_err(|error| error.to_string())?;
    Ok(status)
}

#[tauri::command]
fn set_pac_proxy_selected_option(
    app: AppHandle,
    selected_pac_key: String,
) -> Result<PacProxyStatus, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let status = write_pac_proxy_selected_option(app_data_dir, selected_pac_key)
        .map_err(|error| error.to_string())?;
    sync_menu_bar_pac_proxy(&app, &status).map_err(|error| error.to_string())?;
    Ok(status)
}

#[tauri::command]
async fn list_codex_sessions(app: AppHandle) -> Result<Vec<CodexSessionInfo>, String> {
    run_blocking_manager_task(app, move |manager| {
        manager
            .list_codex_sessions()
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn refresh_codex_usage_stats(
    app: AppHandle,
    filter: Option<CodexUsageStatsFilter>,
) -> Result<CodexUsageStatsSnapshot, String> {
    run_blocking_manager_task(app, move |manager| {
        manager
            .refresh_codex_usage_stats_with_filter(filter.unwrap_or_default())
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_codex_session_messages(
    app: AppHandle,
    thread_id: String,
) -> Result<Vec<CodexMessage>, String> {
    run_blocking_manager_task(app, move |manager| {
        manager
            .get_codex_session_messages(&thread_id)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn archive_codex_session(
    app: AppHandle,
    thread_id: String,
    archive: bool,
) -> Result<(), String> {
    run_blocking_manager_task(app, move |manager| {
        manager
            .archive_codex_session(&thread_id, archive)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn delete_codex_session(app: AppHandle, thread_id: String) -> Result<(), String> {
    run_blocking_manager_task(app, move |manager| {
        manager
            .delete_codex_session(&thread_id)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn rename_codex_session(
    app: AppHandle,
    thread_id: String,
    new_title: String,
) -> Result<(), String> {
    run_blocking_manager_task(app, move |manager| {
        manager
            .rename_codex_session(&thread_id, &new_title)
            .map_err(|error| error.to_string())
    })
    .await
}

fn snapshot_and_sync(app: &AppHandle, manager: &ProfileManager) -> Result<AppSnapshot, String> {
    let snapshot = manager.snapshot().map_err(|error| error.to_string())?;
    sync_menu_bar_usage(app, &snapshot).map_err(|error| error.to_string())?;
    Ok(snapshot)
}

fn spawn_menu_bar_usage_refresher(app: AppHandle) {
    let requested_app = app.clone();
    app.listen("menu-bar-refresh-usage-requested", move |_| {
        let app = requested_app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = refresh_menu_bar_active_codex_usage(app).await;
        });
    });

    let pac_app = app.clone();
    app.listen("menu-bar-toggle-pac-proxy-requested", move |_| {
        let app = pac_app.clone();
        tauri::async_runtime::spawn(async move {
            let result = (|| -> Result<PacProxyStatus, String> {
                let app_data_dir = app
                    .path()
                    .app_data_dir()
                    .map_err(|error| error.to_string())?;
                let current = read_pac_proxy_status(app_data_dir.clone())
                    .map_err(|error| error.to_string())?;
                let status = write_pac_proxy_enabled(app_data_dir, !current.enabled)
                    .map_err(|error| error.to_string())?;
                sync_menu_bar_pac_proxy(&app, &status).map_err(|error| error.to_string())?;
                Ok(status)
            })();
            if let Ok(status) = result {
                let _ = app.emit("pac-proxy-status-changed", status);
            }
        });
    });

    let pac_option_app = app.clone();
    app.listen("menu-bar-select-pac-option-requested", move |event| {
        let app = pac_option_app.clone();
        let selected_pac_key = serde_json::from_str::<String>(event.payload())
            .unwrap_or_else(|_| event.payload().to_string());
        tauri::async_runtime::spawn(async move {
            let result = (|| -> Result<PacProxyStatus, String> {
                let app_data_dir = app
                    .path()
                    .app_data_dir()
                    .map_err(|error| error.to_string())?;
                let status = write_pac_proxy_selected_option(app_data_dir, selected_pac_key)
                    .map_err(|error| error.to_string())?;
                sync_menu_bar_pac_proxy(&app, &status).map_err(|error| error.to_string())?;
                Ok(status)
            })();
            if let Ok(status) = result {
                let _ = app.emit("pac-proxy-status-changed", status);
            }
        });
    });

    tauri::async_runtime::spawn({
        let app = app.clone();
        async move {
            let _ = refresh_menu_bar_active_codex_usage(app).await;
        }
    });

    thread::spawn(move || loop {
        thread::sleep(MENU_BAR_REFRESH_INTERVAL);
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = refresh_menu_bar_active_codex_usage(app).await;
        });
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let manager = ProfileManager::load_or_default(app_data_dir)?;
            let snapshot = manager.snapshot()?;
            install_menu_bar(app, &snapshot)?;
            spawn_menu_bar_usage_refresher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_snapshot,
            list_model_providers,
            import_profile,
            import_from_target_dir,
            get_target_profile_input,
            get_profile_document,
            update_profile,
            set_profile_remote_metadata,
            delete_network_profile,
            network_request,
            switch_profile,
            delete_profile,
            set_target_dir,
            set_codex_usage_api_enabled,
            migrate_legacy_third_party_profiles,
            write_third_party_websockets_defaults,
            refresh_profile_codex_usage,
            refresh_profile_latency_probe,
            refresh_profile_third_party_usage,
            refresh_all_codex_usage,
            open_target_dir,
            restart_codex,
            open_external_url,
            fix_session_database,
            diagnose_codex_sessions,
            repair_codex_sessions,
            check_update,
            install_update,
            check_install_location,
            get_pac_proxy_status,
            set_pac_proxy_enabled,
            set_pac_proxy_selected_services,
            set_pac_proxy_selected_option,
            list_codex_sessions,
            refresh_codex_usage_stats,
            get_codex_session_messages,
            archive_codex_session,
            delete_codex_session,
            rename_codex_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running Codex 助手");
}
