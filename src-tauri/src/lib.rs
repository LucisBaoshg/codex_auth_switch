pub mod core;

use crate::core::{
    check_for_update, check_install_location as resolve_install_location, open_url,
    restart_codex_app, AppSnapshot, InstallLocationStatus, ProfileDocument, ProfileInput,
    ProfileManager, UpdateCheckResult,
};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn manager_from_app(app: &AppHandle) -> Result<ProfileManager, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    ProfileManager::load_or_default(app_data_dir).map_err(|error| error.to_string())
}

#[tauri::command]
fn load_snapshot(app: AppHandle) -> Result<AppSnapshot, String> {
    let manager = manager_from_app(&app)?;
    // 在程序初次获取快照或用户手动刷新时，主动牵引/同步一次会话数据库，保证启动即对齐
    let _ = manager.fix_session_database_and_configs();
    manager.snapshot().map_err(|error| error.to_string())
}

#[tauri::command]
fn import_profile(app: AppHandle, payload: ProfileInput) -> Result<AppSnapshot, String> {
    let manager = manager_from_app(&app)?;
    manager
        .import_profile(payload)
        .map_err(|error| error.to_string())?;
    manager.snapshot().map_err(|error| error.to_string())
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
    manager.snapshot().map_err(|error| error.to_string())
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
    manager.snapshot().map_err(|error| error.to_string())
}

#[tauri::command]
fn switch_profile(app: AppHandle, profile_id: String) -> Result<AppSnapshot, String> {
    let mut manager = manager_from_app(&app)?;
    manager
        .switch_profile(&profile_id)
        .map_err(|error| error.to_string())?;
    manager.snapshot().map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_profile(app: AppHandle, profile_id: String) -> Result<AppSnapshot, String> {
    let mut manager = manager_from_app(&app)?;
    manager
        .delete_profile(&profile_id)
        .map_err(|error| error.to_string())?;
    manager.snapshot().map_err(|error| error.to_string())
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
    manager.snapshot().map_err(|error| error.to_string())
}

#[tauri::command]
fn set_codex_usage_api_enabled(app: AppHandle, enabled: bool) -> Result<AppSnapshot, String> {
    let mut manager = manager_from_app(&app)?;
    manager
        .set_codex_usage_api_enabled(enabled)
        .map_err(|error| error.to_string())?;
    manager.snapshot().map_err(|error| error.to_string())
}

#[tauri::command]
fn refresh_profile_codex_usage(app: AppHandle, profile_id: String) -> Result<AppSnapshot, String> {
    let manager = manager_from_app(&app)?;
    manager
        .refresh_profile_codex_usage(&profile_id)
        .map_err(|error| error.to_string())?;
    manager.snapshot().map_err(|error| error.to_string())
}

#[tauri::command]
fn refresh_profile_latency_probe(app: AppHandle, profile_id: String) -> Result<AppSnapshot, String> {
    let manager = manager_from_app(&app)?;
    manager
        .refresh_profile_latency_probe(&profile_id)
        .map_err(|error| error.to_string())?;
    manager.snapshot().map_err(|error| error.to_string())
}

#[tauri::command]
fn refresh_all_codex_usage(app: AppHandle) -> Result<AppSnapshot, String> {
    let manager = manager_from_app(&app)?;
    manager
        .refresh_all_codex_usage()
        .map_err(|error| error.to_string())?;
    manager.snapshot().map_err(|error| error.to_string())
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
fn check_update() -> Result<UpdateCheckResult, String> {
    check_for_update().map_err(|error| error.to_string())
}

#[tauri::command]
fn open_update_page(url: String) -> Result<(), String> {
    open_url(&url).map_err(|error| error.to_string())
}

#[tauri::command]
fn check_install_location() -> Result<InstallLocationStatus, String> {
    resolve_install_location().map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            load_snapshot,
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
            refresh_all_codex_usage,
            open_target_dir,
            restart_codex,
            fix_session_database,
            check_update,
            open_update_page,
            check_install_location
        ])
        .run(tauri::generate_context!())
        .expect("error while running Codex Auth Switch");
}
