use std::{fs, path::Path};

#[test]
fn antigravity_tauri_surface_is_removed() {
    let lib_rs = fs::read_to_string("src/lib.rs").expect("read src/lib.rs");

    assert!(
        !lib_rs.to_lowercase().contains("antigravity"),
        "deprecated Antigravity commands and module exports should not stay wired into Tauri"
    );
    assert!(
        !Path::new("src/antigravity").exists(),
        "deprecated Antigravity backend source directory should be removed"
    );
}

#[test]
fn deprecated_antigravity_planning_docs_are_removed() {
    for path in [
        "../docs/plans/2026-04-10-antigravity-auth-switch-design.md",
        "../docs/superpowers/specs/2026-04-10-antigravity-account-snapshot-design.md",
        "../docs/superpowers/plans/2026-04-10-antigravity-account-snapshot.md",
        "../docs/superpowers/plans/2026-04-10-antigravity-auth-switch.md",
    ] {
        assert!(
            !Path::new(path).exists(),
            "deprecated Antigravity planning doc should be removed: {path}"
        );
    }
}

#[test]
fn update_subsystem_is_split_out_of_core_mod() {
    let core_mod_rs = fs::read_to_string("src/core/mod.rs").expect("read src/core/mod.rs");

    assert!(
        Path::new("src/core/updates.rs").exists(),
        "update checking and installation should live in src/core/updates.rs"
    );
    assert!(
        !core_mod_rs.contains("fn install_in_app_update"),
        "core/mod.rs should not keep the update installer implementation inline"
    );
    assert!(
        core_mod_rs.contains("pub use updates::"),
        "core/mod.rs should re-export the update API for existing callers"
    );
}

#[test]
fn restart_subsystem_is_split_out_of_core_mod() {
    let core_mod_rs = fs::read_to_string("src/core/mod.rs").expect("read src/core/mod.rs");

    assert!(
        Path::new("src/core/restart.rs").exists(),
        "Codex restart process planning should live in src/core/restart.rs"
    );
    assert!(
        !core_mod_rs.contains("pub fn codex_restart_plan_for_platform"),
        "core/mod.rs should not keep the restart planning implementation inline"
    );
    assert!(
        core_mod_rs.contains("pub use restart::"),
        "core/mod.rs should re-export the restart API for existing callers"
    );
}
