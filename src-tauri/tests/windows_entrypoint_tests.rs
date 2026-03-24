use std::fs;

#[test]
fn windows_entrypoint_hides_console_window_in_release_builds() {
    let main_rs = fs::read_to_string("src/main.rs").expect("read main.rs");

    assert!(
        main_rs.contains(r#"#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]"#),
        "src/main.rs should opt into the Windows GUI subsystem for release builds",
    );
}
