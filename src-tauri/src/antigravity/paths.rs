use crate::antigravity::AntigravityError;
use std::path::PathBuf;

pub fn default_state_db_path() -> Result<PathBuf, AntigravityError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AntigravityError::Message("Failed to resolve home directory.".into()))?;

    Ok(home.join("Library/Application Support/Antigravity/User/globalStorage/state.vscdb"))
}
