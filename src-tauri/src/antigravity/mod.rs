pub mod db;
pub mod manager;
pub mod models;
pub mod paths;
pub mod process;
pub mod storage;

use thiserror::Error;

pub const REQUIRED_KEYS: &[&str] = &[
    "antigravityUnifiedStateSync.oauthToken",
    "antigravityUnifiedStateSync.userStatus",
];

pub const OPTIONAL_KEYS: &[&str] = &[
    "antigravityAuthStatus",
    "antigravityUnifiedStateSync.enterprisePreferences",
    "antigravityUnifiedStateSync.modelCredits",
    "antigravity.profileUrl",
];

#[derive(Debug, Error)]
pub enum AntigravityError {
    #[error("Failed to access the filesystem: {0}")]
    Io(#[from] std::io::Error),
    #[error("Failed to access SQLite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Failed to process Antigravity JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Message(String),
}
