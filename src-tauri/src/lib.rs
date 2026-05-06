pub mod antigravity;
pub mod core;
pub mod menu_bar;

use crate::antigravity::manager::AntigravityManager;
use crate::antigravity::models::{
    AntigravityProfileSummary, AntigravitySnapshot, AntigravitySwitchResult,
};
use crate::core::{
    check_for_update, check_install_location as resolve_install_location,
    install_update as perform_install_update, restart_codex_app, AppSnapshot,
    InstallLocationStatus, ModelProviderSummary, ProfileDocument, ProfileInput, ProfileManager,
    SessionRecoveryReport, SessionRepairResult, UpdateCheckResult, UpdateInstallRequest,
};
use crate::menu_bar::{
    install_menu_bar, menu_bar_refresh_target, sync_menu_bar_usage, MenuBarRefreshKind,
};
use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Listener, Manager};

const MENU_BAR_REFRESH_INTERVAL: Duration = Duration::from_secs(30);

fn manager_from_app(app: &AppHandle) -> Result<ProfileManager, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    ProfileManager::load_or_default(app_data_dir).map_err(|error| error.to_string())
}

fn antigravity_manager_from_app(app: &AppHandle) -> Result<AntigravityManager, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    AntigravityManager::load_or_default(app_data_dir).map_err(|error| error.to_string())
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
fn load_antigravity_snapshot(app: AppHandle) -> Result<AntigravitySnapshot, String> {
    antigravity_manager_from_app(&app)?
        .snapshot()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn import_current_antigravity_profile(
    app: AppHandle,
    name: String,
    notes: String,
) -> Result<AntigravityProfileSummary, String> {
    antigravity_manager_from_app(&app)?
        .import_current_profile(name, notes)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn switch_antigravity_profile(
    app: AppHandle,
    profile_id: String,
) -> Result<AntigravitySwitchResult, String> {
    let mut manager = antigravity_manager_from_app(&app)?;
    manager
        .switch_profile(&profile_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn restore_last_antigravity_backup(app: AppHandle) -> Result<AntigravitySwitchResult, String> {
    let mut manager = antigravity_manager_from_app(&app)?;
    manager
        .restore_latest_backup()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn reveal_antigravity_source(app: AppHandle) -> Result<(), String> {
    antigravity_manager_from_app(&app)?
        .reveal_source_dir()
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
            load_antigravity_snapshot,
            import_current_antigravity_profile,
            switch_antigravity_profile,
            restore_last_antigravity_backup,
            reveal_antigravity_source,
            import_profile,
            import_from_target_dir,
            get_target_profile_input,
            get_profile_document,
            update_profile,
            switch_profile,
            delete_profile,
            set_target_dir,
            set_codex_usage_api_enabled,
            refresh_profile_codex_usage,
            refresh_profile_latency_probe,
            refresh_profile_third_party_usage,
            refresh_all_codex_usage,
            open_target_dir,
            restart_codex,
            fix_session_database,
            diagnose_codex_sessions,
            repair_codex_sessions,
            check_update,
            install_update,
            check_install_location
        ])
        .run(tauri::generate_context!())
        .expect("error while running Codex Auth Switch");
}
