use codex_auth_switch_lib::codex_enhance::{
    build_codex_debug_arguments, build_codex_executable, build_codex_launch_command,
    build_plugin_unlock_script, find_latest_windows_codex_app_dir,
    open_pet_overlay_for_enhanced_launch, packaged_app_user_model_id, pick_cdp_page_target,
    stop_windows_codex_script, CodexCdpTarget,
};
use serde_json::Value;
use std::path::PathBuf;
use tempfile::TempDir;

#[test]
fn codex_debug_arguments_enable_local_cdp() {
    let args = build_codex_debug_arguments(9229);

    assert_eq!(
        args,
        vec![
            "--remote-debugging-port=9229".to_string(),
            "--remote-allow-origins=http://127.0.0.1:9229".to_string(),
        ],
    );
}

#[test]
fn pick_cdp_page_target_prefers_codex_page() {
    let targets = vec![
        CodexCdpTarget {
            id: "devtools".into(),
            target_type: "page".into(),
            title: "DevTools".into(),
            url: "devtools://devtools/bundled/inspector.html".into(),
            web_socket_debugger_url: Some("ws://127.0.0.1/devtools".into()),
        },
        CodexCdpTarget {
            id: "codex".into(),
            target_type: "page".into(),
            title: "Codex".into(),
            url: "tauri://codex".into(),
            web_socket_debugger_url: Some("ws://127.0.0.1/codex".into()),
        },
    ];

    let target = pick_cdp_page_target(&targets).expect("target");

    assert_eq!(target.id, "codex");
    assert_eq!(
        target.web_socket_debugger_url.as_deref(),
        Some("ws://127.0.0.1/codex"),
    );
}

#[test]
fn plugin_unlock_script_spoofs_auth_context_and_enables_plugin_buttons() {
    let script = build_plugin_unlock_script();

    assert!(script.contains("authMethod"));
    assert!(script.contains("setAuthMethod(\"chatgpt\")"));
    assert!(script.contains("pluginEntryUnlock"));
    assert!(script.contains("forcePluginInstall"));
    assert!(script.contains("disabled = false"));
    assert!(script.contains("Plugins - Unlocked"));
    assert!(script.contains("插件 - 已解锁"));
}

#[test]
fn enhanced_launch_marks_pet_overlay_open_before_starting_codex() {
    let codex_dir = TempDir::new().expect("temp codex dir");

    open_pet_overlay_for_enhanced_launch(codex_dir.path()).expect("open pet overlay");

    let state_path = codex_dir.path().join(".codex-global-state.json");
    let state: Value =
        serde_json::from_str(&std::fs::read_to_string(state_path).expect("state")).expect("json");
    assert_eq!(
        state
            .get("electron-avatar-overlay-open")
            .and_then(|value| value.as_bool()),
        Some(true),
    );
}

#[test]
fn windows_app_dir_detection_uses_highest_version_and_app_subdir() {
    let root = TempDir::new().expect("windows apps root");
    let older = root
        .path()
        .join("OpenAI.Codex_1.2.3.0_x64__abc")
        .join("app");
    let newer = root
        .path()
        .join("OpenAI.Codex_26.506.2212.0_x64__abc")
        .join("app");
    std::fs::create_dir_all(&older).expect("older");
    std::fs::create_dir_all(&newer).expect("newer");

    let app_dir = find_latest_windows_codex_app_dir(root.path()).expect("app dir");

    assert_eq!(app_dir, newer);
}

#[test]
fn packaged_app_user_model_id_matches_windowsapps_package_path() {
    let app_dir = PathBuf::from(
        r"C:\Program Files\WindowsApps\OpenAI.Codex_26.506.2212.0_x64__2p2nqsd0c76g0\app",
    );

    assert_eq!(
        packaged_app_user_model_id(&app_dir).as_deref(),
        Some("OpenAI.Codex_2p2nqsd0c76g0!App"),
    );
}

#[test]
fn codex_launch_command_adds_cdp_args_to_windows_executable() {
    let app_dir = PathBuf::from(r"C:\Codex\app");
    let command = build_codex_launch_command(&app_dir, 9229);

    assert_eq!(command[0], r"C:\Codex\app\Codex.exe");
    assert!(command.contains(&"--remote-debugging-port=9229".to_string()));
    assert!(command.contains(&"--remote-allow-origins=http://127.0.0.1:9229".to_string()));
}

#[test]
fn codex_executable_defaults_to_windows_binary_name() {
    let root = TempDir::new().expect("app root");
    let app_dir = root.path().join("app");
    std::fs::create_dir_all(&app_dir).expect("app dir");

    assert_eq!(build_codex_executable(&app_dir), app_dir.join("Codex.exe"));
}

#[test]
fn stop_windows_codex_script_targets_codex_processes() {
    let script = stop_windows_codex_script();

    assert!(script.contains("Name='Codex.exe' OR Name='codex.exe'"));
    assert!(script.contains("Stop-Process"));
}
