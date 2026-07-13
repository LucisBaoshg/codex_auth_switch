use super::*;

pub(crate) fn normalize_remote_profiles_url(input: &str) -> String {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.ends_with("/profiles") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/profiles")
    }
}

pub(crate) fn remote_request(url: &str) -> ureq::Request {
    let mut request = ureq::get(url).set("User-Agent", "codex-auth-switch-cli");
    if let Ok(token) = std::env::var("CODEX_AUTH_SWITCH_REMOTE_TOKEN") {
        let header_value = format!("Bearer {}", token.trim());
        request = request.set("Authorization", &header_value);
    }
    request
}

pub(crate) fn fetch_remote_profile_index(url: &str) -> Result<Vec<RemoteProfileRecord>, AppError> {
    let response = remote_request(&normalize_remote_profiles_url(url))
        .call()
        .map_err(|error| AppError::Message(format!("Failed to fetch remote profiles: {error}")))?;

    response
        .into_json::<Vec<RemoteProfileRecord>>()
        .map_err(|error| AppError::Message(format!("Failed to parse remote profiles: {error}")))
}

pub(crate) fn fetch_remote_profile_detail(url: &str) -> Result<RemoteProfileRecord, AppError> {
    let response = remote_request(url).call().map_err(|error| {
        AppError::Message(format!("Failed to fetch remote profile detail: {error}"))
    })?;

    response
        .into_json::<RemoteProfileRecord>()
        .map_err(|error| {
            AppError::Message(format!("Failed to parse remote profile detail: {error}"))
        })
}

pub(crate) fn fetch_remote_text_file(url: &str) -> Result<String, AppError> {
    let response = remote_request(url)
        .call()
        .map_err(|error| AppError::Message(format!("Failed to fetch remote file: {error}")))?;

    response
        .into_string()
        .map_err(|error| AppError::Message(format!("Failed to read remote file: {error}")))
}

pub fn default_cli_app_data_dir() -> Result<PathBuf, AppError> {
    if let Ok(path) = std::env::var("CODEX_AUTH_SWITCH_APP_DATA_DIR") {
        let path = path.trim();
        if !path.is_empty() {
            return Ok(PathBuf::from(path));
        }
    }

    let base_dir = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .or_else(dirs::home_dir)
        .ok_or_else(|| AppError::Message("Unable to resolve the CLI app data directory.".into()))?;

    Ok(base_dir.join("com.lucifer.codex-auth-switch"))
}

pub fn default_codex_target_dir() -> Result<PathBuf, AppError> {
    let home_dir = dirs::home_dir()
        .ok_or_else(|| AppError::Message("Unable to resolve the user home directory.".into()))?;
    Ok(home_dir.join(".codex"))
}

pub(crate) fn unknown_auth_type_label() -> String {
    "未识别".to_string()
}

pub(crate) fn is_third_party_backed_profile(auth_type_label: &str) -> bool {
    matches!(auth_type_label, "第三方 API" | "共生配置")
}

pub fn repair_illegal_config_toml(config_toml: &str) -> String {
    if config_toml.contains("[model_providers.openai]") {
        config_toml
            .replace(
                "[model_providers.openai]",
                "[model_providers.openai_custom]",
            )
            .replace(
                "model_provider = \"openai\"",
                "model_provider = \"openai_custom\"",
            )
            .replace(
                "model_provider = 'openai'",
                "model_provider = 'openai_custom'",
            )
    } else {
        config_toml.to_string()
    }
}

pub(crate) fn session_model_provider_key_from_config_toml(
    config_toml: &str,
) -> Result<String, AppError> {
    let table = parse_toml_table(config_toml)?;
    let provider = table
        .get("model_provider")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("openai");

    Ok(provider.to_string())
}

pub(crate) fn resolve_third_party_provider_descriptor(
    auth_json: &str,
    config_toml: &str,
) -> Result<Option<ThirdPartyProviderDescriptor>, AppError> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json)
        .map_err(|error| AppError::InvalidAuthJson(error.to_string()))?;
    let auth_api_key = auth
        .get("OPENAI_API_KEY")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let config = parse_toml_table(config_toml)?;
    let provider_key = config
        .get("model_provider")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "openai".into());

    let provider_from_table = config
        .get("model_providers")
        .and_then(|value| value.as_table())
        .and_then(|providers| {
            providers
                .get(&provider_key)
                .or_else(|| providers.values().next())
        })
        .and_then(|value| value.as_table());

    if is_official_oauth_auth(auth_json)?
        && !provider_from_table
            .and_then(|provider| provider.get("requires_openai_auth"))
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
    {
        return Ok(None);
    }

    let base_url = config
        .get("openai_base_url")
        .and_then(|value| value.as_str())
        .or_else(|| {
            provider_from_table
                .and_then(|provider| provider.get("base_url"))
                .and_then(|value| value.as_str())
        })
        .map(normalize_base_url_for_store)
        .filter(|value| !value.is_empty());

    let Some(base_url) = base_url else {
        return Ok(None);
    };

    let provider_name = provider_from_table
        .and_then(|provider| provider.get("name"))
        .and_then(|name| name.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| infer_third_party_provider_name(&provider_key, &base_url));
    let wire_api = provider_from_table
        .and_then(|provider| provider.get("wire_api"))
        .and_then(|wire_api| wire_api.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "responses".into());
    let api_key = auth_api_key.or_else(|| {
        provider_from_table
            .and_then(|provider| provider.get("experimental_bearer_token"))
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    });

    let Some(api_key) = api_key else {
        return Ok(None);
    };

    let provider_id = stable_model_provider_id(&provider_key, &base_url);
    let api_key_id = stable_model_provider_key_id(&api_key);

    Ok(Some(ThirdPartyProviderDescriptor {
        provider_id,
        api_key_id,
        provider_key,
        provider_name,
        base_url,
        wire_api,
        api_key,
    }))
}

pub(crate) fn normalize_base_url_for_store(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

pub(crate) fn normalize_base_url_for_compare(value: &str) -> String {
    normalize_base_url_for_store(value).to_ascii_lowercase()
}

pub(crate) fn stable_model_provider_id(provider_key: &str, base_url: &str) -> String {
    let seed = format!(
        "{}\n{}",
        provider_key.trim().to_ascii_lowercase(),
        normalize_base_url_for_compare(base_url)
    );
    format!("cmp_{}", &sha256_bytes(seed.as_bytes())[..16])
}

pub(crate) fn stable_model_provider_key_id(api_key: &str) -> String {
    format!("cmk_{}", &sha256_bytes(api_key.trim().as_bytes())[..16])
}

pub(crate) fn update_rollout_session_meta_provider(
    path: &Path,
    affected_ids: &HashSet<String>,
    provider: &str,
) -> Result<bool, AppError> {
    let metadata = fs::metadata(path)?;
    let atime = FileTime::from_last_access_time(&metadata);
    let mtime = FileTime::from_last_modification_time(&metadata);
    let content = fs::read_to_string(path)?;
    let had_trailing_newline = content.ends_with('\n');
    let mut changed = false;
    let mut updated_lines = Vec::new();

    for line in content.lines() {
        let Ok(mut value) = serde_json::from_str::<serde_json::Value>(line) else {
            updated_lines.push(line.to_string());
            continue;
        };

        if update_session_meta_value_provider(&mut value, affected_ids, provider) {
            changed = true;
            updated_lines.push(serde_json::to_string(&value)?);
        } else {
            updated_lines.push(line.to_string());
        }
    }

    if changed {
        let mut updated = updated_lines.join("\n");
        if had_trailing_newline {
            updated.push('\n');
        }
        fs::write(path, updated)?;
        set_file_times(path, atime, mtime)?;
    }

    Ok(changed)
}

pub(crate) fn update_session_meta_value_provider(
    value: &mut serde_json::Value,
    affected_ids: &HashSet<String>,
    provider: &str,
) -> bool {
    if value.get("type").and_then(|entry_type| entry_type.as_str()) == Some("session_meta") {
        return update_session_meta_payload_provider(
            value.get_mut("payload"),
            affected_ids,
            provider,
        );
    }

    let payload = value
        .get_mut("session_meta")
        .and_then(|session_meta| session_meta.get_mut("payload"));
    update_session_meta_payload_provider(payload, affected_ids, provider)
}

pub(crate) fn update_session_meta_payload_provider(
    payload: Option<&mut serde_json::Value>,
    affected_ids: &HashSet<String>,
    provider: &str,
) -> bool {
    let Some(payload) = payload else {
        return false;
    };
    let Some(payload_object) = payload.as_object_mut() else {
        return false;
    };
    let Some(id) = payload_object
        .get("id")
        .and_then(|value| value.as_str())
        .or_else(|| {
            payload_object
                .get("session_id")
                .and_then(|value| value.as_str())
        })
    else {
        return false;
    };
    if !affected_ids.contains(id) {
        return false;
    }

    let next_provider = serde_json::Value::String(provider.to_string());
    if payload_object.get("model_provider") == Some(&next_provider) {
        return false;
    }
    payload_object.insert("model_provider".to_string(), next_provider);
    true
}

pub(crate) fn primary_state_database_path(target_dir: &Path) -> Option<PathBuf> {
    let roots = [target_dir.to_path_buf(), target_dir.join("sqlite")];
    roots
        .iter()
        .filter_map(|root| fs::read_dir(root).ok())
        .flat_map(|entries| entries.flatten())
        .filter_map(|entry| state_database_candidate(entry.path()))
        .max_by(|left, right| {
            left.has_threads
                .cmp(&right.has_threads)
                .then_with(|| left.latest_thread_ms.cmp(&right.latest_thread_ms))
                .then_with(|| left.version.cmp(&right.version))
                .then_with(|| left.name.cmp(&right.name))
        })
        .map(|candidate| candidate.path)
}

pub(crate) fn state_database_candidate(path: PathBuf) -> Option<StateDatabaseCandidate> {
    let name = path.file_name()?.to_string_lossy().to_string();
    if !name.starts_with("state_") || !name.ends_with(".sqlite") {
        return None;
    }

    let version = name
        .strip_prefix("state_")
        .and_then(|value| value.strip_suffix(".sqlite"))
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(0);
    let latest_thread_ms = latest_thread_updated_ms(&path);
    Some(StateDatabaseCandidate {
        path,
        name,
        version,
        has_threads: latest_thread_ms.is_some(),
        latest_thread_ms,
    })
}

pub(crate) fn latest_thread_updated_ms(path: &Path) -> Option<i64> {
    let conn = open_valid_state_database(path)?;
    let columns = thread_table_columns(&conn).ok()?;
    if !columns.iter().any(|column| column == "id") {
        return None;
    }

    if columns.iter().any(|column| column == "updated_at_ms") {
        return conn
            .query_row("SELECT MAX(updated_at_ms) FROM threads", [], |row| {
                row.get::<_, Option<i64>>(0)
            })
            .ok()
            .flatten();
    }

    if columns.iter().any(|column| column == "updated_at") {
        return conn
            .query_row("SELECT MAX(updated_at) FROM threads", [], |row| {
                row.get::<_, Option<i64>>(0)
            })
            .ok()
            .flatten()
            .map(|seconds| seconds * 1_000);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_remote_profiles_url_idempotently() {
        assert_eq!(
            normalize_remote_profiles_url("https://example.com/api/"),
            "https://example.com/api/profiles"
        );
        assert_eq!(
            normalize_remote_profiles_url("https://example.com/api/profiles"),
            "https://example.com/api/profiles"
        );
    }

    #[test]
    fn repairs_reserved_openai_provider_key() {
        let fixed =
            repair_illegal_config_toml("[model_providers.openai]\nmodel_provider = \"openai\"\n");
        assert!(fixed.contains("[model_providers.openai_custom]"));
        assert!(fixed.contains("model_provider = \"openai_custom\""));

        let untouched = repair_illegal_config_toml("model = \"gpt-5.5\"\n");
        assert_eq!(untouched, "model = \"gpt-5.5\"\n");
    }
}
