use std::fs;

#[test]
fn cargo_manifest_pins_gui_binary_as_default_run_target() {
    let cargo_toml = fs::read_to_string("Cargo.toml").expect("read Cargo.toml");

    assert!(
        cargo_toml.contains(r#"default-run = "codex-auth-switch""#),
        "Cargo.toml should pin the GUI app binary as the default run target",
    );
}
