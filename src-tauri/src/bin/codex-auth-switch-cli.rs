#![allow(dead_code)]

#[allow(dead_code)]
#[path = "../core/mod.rs"]
mod core;

use core::{default_cli_app_data_dir, ProfileManager};
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
            for profile in profiles {
                println!(
                    "{}\t{}\t{}",
                    profile.id, profile.name, profile.auth_type_label
                );
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
    println!("  list                   List local profiles");
}
