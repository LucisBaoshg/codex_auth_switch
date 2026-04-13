use crate::antigravity::{
    models::{
        AntigravityAccountSnapshot, AntigravityIdentity, AntigravityPayload,
        AntigravityStorageJsonFlags,
    },
    AntigravityError, OPTIONAL_KEYS, REQUIRED_KEYS,
};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::Path;

fn ensure_existing_state_db(db_path: &Path) -> Result<(), AntigravityError> {
    if db_path.exists() {
        return Ok(());
    }

    Err(AntigravityError::Message(format!(
        "Antigravity state database was not found: {}",
        db_path.display()
    )))
}

fn is_base64ish_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'=' | b'-' | b'_')
}

fn looks_like_email(candidate: &str) -> bool {
    let Some((local, domain)) = candidate.split_once('@') else {
        return false;
    };

    !local.is_empty()
        && !domain.is_empty()
        && domain.contains('.')
        && candidate.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'%' | b'+' | b'-' | b'@')
        })
}

fn extract_email_from_text(text: &str) -> Option<String> {
    text.split(|ch: char| {
        !matches!(ch, 'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '_' | '%' | '+' | '-' | '@')
    })
    .find(|candidate| looks_like_email(candidate))
    .map(str::to_owned)
}

fn decode_base64_relaxed(value: &str) -> Option<Vec<u8>> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut padded = trimmed.to_string();
    while !padded.len().is_multiple_of(4) {
        padded.push('=');
    }

    STANDARD.decode(padded).ok()
}

fn extract_email_from_user_status(encoded: &str) -> Option<String> {
    let decoded = decode_base64_relaxed(encoded)?;
    let decoded_text = String::from_utf8_lossy(&decoded);

    if let Some(email) = extract_email_from_text(&decoded_text) {
        return Some(email);
    }

    for token in decoded
        .split(|byte| !is_base64ish_byte(*byte))
        .filter(|token| token.len() >= 16)
    {
        let token = String::from_utf8_lossy(token);
        let Some(inner) = decode_base64_relaxed(&token) else {
            continue;
        };
        let inner_text = String::from_utf8_lossy(&inner);
        if let Some(email) = extract_email_from_text(&inner_text) {
            return Some(email);
        }
    }

    None
}

fn fallback_identifier_from_profile_url(profile_url: &str) -> Option<String> {
    let trimmed = profile_url.trim();
    if trimmed.is_empty() {
        return None;
    }

    let candidate = trimmed
        .rsplit('/')
        .next()
        .unwrap_or(trimmed)
        .split(['?', '#', '='])
        .next()
        .unwrap_or(trimmed)
        .trim();
    if !candidate.is_empty() {
        let short = candidate.chars().take(12).collect::<String>();
        return Some(format!("profile:{short}"));
    }

    let digest = Sha256::digest(trimmed.as_bytes());
    let hex = format!("{digest:x}");
    Some(format!("profile:{}", &hex[..12]))
}

pub fn ensure_payload_has_oauth_token(
    values: &BTreeMap<String, String>,
) -> Result<(), AntigravityError> {
    let oauth_token = values
        .get("antigravityUnifiedStateSync.oauthToken")
        .map(String::as_str)
        .unwrap_or("")
        .trim();

    if oauth_token.is_empty() {
        return Err(AntigravityError::Message(
            "Antigravity OAuth token is missing. The local Antigravity auth state is incomplete, so importing or switching this account would log the app out.".into(),
        ));
    }

    Ok(())
}

pub fn read_live_payload(db_path: &Path) -> Result<AntigravityPayload, AntigravityError> {
    ensure_existing_state_db(db_path)?;
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut values = BTreeMap::new();

    for key in REQUIRED_KEYS.iter().chain(OPTIONAL_KEYS.iter()) {
        let value = conn
            .query_row(
                "SELECT CAST(value AS TEXT) FROM ItemTable WHERE key = ?1",
                [*key],
                |row| row.get::<_, String>(0),
            )
            .ok();

        if let Some(value) = value {
            values.insert((*key).to_string(), value);
        }
    }

    let missing = REQUIRED_KEYS
        .iter()
        .filter(|key| !values.contains_key(**key))
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(AntigravityError::Message(format!(
            "Missing required Antigravity keys: {}",
            missing.join(", ")
        )));
    }

    ensure_payload_has_oauth_token(&values)?;

    let (email, display_name) = if let Some(auth_status) = values.get("antigravityAuthStatus") {
        let auth_json = serde_json::from_str::<serde_json::Value>(auth_status)?;
        let email = auth_json
            .get("email")
            .and_then(|value| value.as_str())
            .map(str::to_owned);
        let display_name = auth_json
            .get("name")
            .and_then(|value| value.as_str())
            .map(str::to_owned);
        (email, display_name)
    } else {
        let email = values
            .get("antigravityUnifiedStateSync.userStatus")
            .and_then(|value| extract_email_from_user_status(value));
        (email, None)
    };

    let email = if email.as_deref().map(str::trim).unwrap_or("").is_empty() {
        values
            .get("antigravity.profileUrl")
            .and_then(|value| fallback_identifier_from_profile_url(value))
    } else {
        email
    };

    if email.as_deref().map(str::trim).unwrap_or("").is_empty() {
        return Err(AntigravityError::Message(
            "Antigravity account email is empty.".into(),
        ));
    }

    Ok(AntigravityPayload {
        values,
        email,
        display_name,
    })
}

pub fn replace_live_payload(
    db_path: &Path,
    payload: &AntigravityPayload,
) -> Result<(), AntigravityError> {
    ensure_existing_state_db(db_path)?;
    let conn = Connection::open(db_path)?;
    let tx = conn.unchecked_transaction()?;

    for key in REQUIRED_KEYS.iter().chain(OPTIONAL_KEYS.iter()) {
        if let Some(value) = payload.values.get(*key) {
            tx.execute(
                "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?1, ?2)",
                [*key, value.as_str()],
            )?;
        } else if OPTIONAL_KEYS.contains(key) {
            tx.execute("DELETE FROM ItemTable WHERE key = ?1", [*key])?;
        }
    }

    tx.commit()?;
    Ok(())
}

pub fn build_account_snapshot(
    payload: &AntigravityPayload,
    storage_json_flags: AntigravityStorageJsonFlags,
) -> AntigravityAccountSnapshot {
    AntigravityAccountSnapshot {
        format_version: 1,
        identity: AntigravityIdentity {
            email: payload.email.clone(),
            display_name: payload.display_name.clone(),
            profile_url: payload.values.get("antigravity.profileUrl").cloned(),
            source: "db".into(),
        },
        values: payload.values.clone(),
        storage_json_flags,
    }
}
