use codex_auth_switch_lib::codex_enhance::{
    build_codex_debug_arguments, build_plugin_unlock_script, open_pet_overlay_for_enhanced_launch,
    pick_cdp_page_target, CodexCdpTarget,
};
use serde_json::Value;
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
    let state: Value = serde_json::from_str(&std::fs::read_to_string(state_path).expect("state"))
        .expect("json");
    assert_eq!(
        state
            .get("electron-avatar-overlay-open")
            .and_then(|value| value.as_bool()),
        Some(true),
    );
}
