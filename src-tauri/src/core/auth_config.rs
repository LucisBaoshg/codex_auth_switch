use super::*;

pub(crate) fn is_official_oauth_auth(auth_json: &str) -> Result<bool, AppError> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json)
        .map_err(|error| AppError::InvalidAuthJson(error.to_string()))?;

    Ok(auth
        .get("auth_mode")
        .and_then(|value| value.as_str())
        .is_some_and(|value| value == "chatgpt")
        || auth.get("tokens").is_some())
}

pub(crate) fn validate_auth_json(contents: &str) -> Result<(), AppError> {
    serde_json::from_str::<serde_json::Value>(contents)
        .map(|_| ())
        .map_err(|error| AppError::InvalidAuthJson(error.to_string()))
}

pub(crate) fn validate_config_toml(contents: &str) -> Result<(), AppError> {
    toml::from_str::<toml::Value>(contents)
        .map(|_| ())
        .map_err(|error| AppError::InvalidConfigToml(error.to_string()))
}

pub(crate) fn parse_toml_table(contents: &str) -> Result<toml::map::Map<String, toml::Value>, AppError> {
    if contents.trim().is_empty() {
        return Ok(toml::map::Map::new());
    }

    let parsed = toml::from_str::<toml::Value>(contents)
        .map_err(|error| AppError::InvalidConfigToml(error.to_string()))?;

    match parsed {
        toml::Value::Table(table) => Ok(table),
        _ => Err(AppError::InvalidConfigToml(
            "config.toml must have a table at the top level.".into(),
        )),
    }
}

pub(crate) fn shared_config_table(
    table: &toml::map::Map<String, toml::Value>,
) -> toml::map::Map<String, toml::Value> {
    let mut shared = table.clone();

    for key in ALL_PROFILE_SCALAR_KEYS {
        shared.remove(*key);
    }

    for key in ALL_PROFILE_TABLE_KEYS {
        shared.remove(*key);
    }

    shared
}

pub(crate) fn managed_config_table(
    auth_json: &str,
    table: &toml::map::Map<String, toml::Value>,
) -> Result<toml::map::Map<String, toml::Value>, AppError> {
    let mut managed = toml::map::Map::new();

    for key in COMMON_PROFILE_SCALAR_KEYS {
        if let Some(value) = table.get(*key) {
            managed.insert((*key).to_string(), value.clone());
        }
    }

    if !is_official_oauth_auth(auth_json)? || config_has_symbiotic_provider(table) {
        for key in THIRD_PARTY_PROFILE_SCALAR_KEYS {
            if let Some(value) = table.get(*key) {
                managed.insert((*key).to_string(), value.clone());
            }
        }

        for key in THIRD_PARTY_PROFILE_TABLE_KEYS {
            if let Some(value) = table.get(*key) {
                managed.insert((*key).to_string(), value.clone());
            }
        }

        if let Some(features) = table.get("features").and_then(|value| value.as_table()) {
            let mut managed_features = toml::map::Map::new();
            for key in THIRD_PARTY_PROFILE_FEATURE_KEYS {
                if let Some(value) = features.get(*key) {
                    managed_features.insert((*key).to_string(), value.clone());
                }
            }
            if !managed_features.is_empty() {
                managed.insert("features".to_string(), toml::Value::Table(managed_features));
            }
        }
    }

    Ok(managed)
}

pub(crate) fn config_has_symbiotic_provider(table: &toml::map::Map<String, toml::Value>) -> bool {
    table
        .get("model_providers")
        .and_then(|value| value.as_table())
        .is_some_and(|providers| {
            providers.values().any(|provider| {
                let Some(provider) = provider.as_table() else {
                    return false;
                };
                let requires_openai_auth = provider
                    .get("requires_openai_auth")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
                let has_bearer_token = provider
                    .get("experimental_bearer_token")
                    .and_then(|value| value.as_str())
                    .is_some_and(|value| !value.trim().is_empty());
                requires_openai_auth && has_bearer_token
            })
        })
}

pub(crate) fn has_non_empty_string(table: &toml::map::Map<String, toml::Value>, key: &str) -> bool {
    table
        .get(key)
        .and_then(|value| value.as_str())
        .is_some_and(|value| !value.trim().is_empty())
}

pub(crate) fn table_has_third_party_base_url(table: &toml::map::Map<String, toml::Value>) -> bool {
    if has_non_empty_string(table, "openai_base_url") {
        return true;
    }

    table
        .get("model_providers")
        .and_then(|value| value.as_table())
        .is_some_and(|providers| {
            providers.values().any(|provider| {
                provider
                    .as_table()
                    .is_some_and(|provider| has_non_empty_string(provider, "base_url"))
            })
        })
}

pub(crate) fn third_party_websockets_default_target(
    auth_json: &str,
    table: &toml::map::Map<String, toml::Value>,
) -> Result<bool, AppError> {
    if is_official_oauth_auth(auth_json)? {
        return Ok(config_has_symbiotic_provider(table));
    }

    Ok(table_has_third_party_base_url(table))
}

pub(crate) fn apply_third_party_websockets_default(
    auth_json: &str,
    table: &mut toml::map::Map<String, toml::Value>,
) -> Result<(), AppError> {
    if !third_party_websockets_default_target(auth_json, table)? {
        return Ok(());
    }

    let mut wrote_provider_default = false;
    if let Some(providers) = table
        .get_mut("model_providers")
        .and_then(|value| value.as_table_mut())
    {
        let provider_keys = providers.keys().cloned().collect::<Vec<_>>();
        for provider_key in provider_keys {
            let Some(provider) = providers
                .get_mut(&provider_key)
                .and_then(|value| value.as_table_mut())
            else {
                continue;
            };
            if has_non_empty_string(provider, "base_url") {
                provider.insert("supports_websockets".into(), toml::Value::Boolean(false));
                wrote_provider_default = true;
            }
        }
    }

    if !wrote_provider_default && has_non_empty_string(table, "openai_base_url") {
        table.insert("supports_websockets".into(), toml::Value::Boolean(false));
    }

    Ok(())
}

pub(crate) fn managed_config_hash(auth_json: &str, contents: &str) -> Result<String, AppError> {
    let table = parse_toml_table(contents)?;
    let mut managed = managed_config_table(auth_json, &table)?;
    apply_third_party_websockets_default(auth_json, &mut managed)?;
    let serialized = toml::to_string(&toml::Value::Table(managed))
        .map_err(|error| AppError::Message(error.to_string()))?;
    Ok(sha256_bytes(serialized.as_bytes()))
}

pub(crate) fn normalize_config_toml_for_auth(auth_json: &str, config_toml: &str) -> Result<String, AppError> {
    let table = parse_toml_table(config_toml)?;
    let mut normalized = shared_config_table(&table);
    let mut managed = managed_config_table(auth_json, &table)?;
    apply_third_party_websockets_default(auth_json, &mut managed)?;
    for (key, value) in managed {
        normalized.insert(key, value);
    }

    toml::to_string_pretty(&toml::Value::Table(normalized))
        .map_err(|error| AppError::Message(error.to_string()))
}

pub(crate) fn migrate_legacy_third_party_config_toml(
    auth_json: &str,
    config_toml: &str,
) -> Result<Option<String>, AppError> {
    if is_official_oauth_auth(auth_json)? {
        return Ok(None);
    }

    let table = parse_toml_table(config_toml)?;
    if table
        .get("openai_base_url")
        .and_then(|value| value.as_str())
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Ok(None);
    }

    let Some(providers) = table
        .get("model_providers")
        .and_then(|value| value.as_table())
    else {
        return Ok(None);
    };
    let Some(provider_key) = table
        .get("model_provider")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| providers.keys().next().cloned())
    else {
        return Ok(None);
    };
    let Some(provider) = providers
        .get(&provider_key)
        .or_else(|| providers.values().next())
        .and_then(|value| value.as_table())
    else {
        return Ok(None);
    };
    let Some(base_url) = provider
        .get("base_url")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };

    let model = table
        .get("model")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "gpt-5.5".into());
    let review_model = table
        .get("review_model")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| model.clone());

    Ok(Some(standard_third_party_config_toml(
        &base_url,
        &model,
        &review_model,
    )))
}

pub(crate) fn standard_third_party_config_toml(base_url: &str, model: &str, review_model: &str) -> String {
    format!(
        r#"openai_base_url = "{}"
supports_websockets = false
model_provider = "openai"
model = "{}"
review_model = "{}"
model_reasoning_effort = "high"
plan_mode_reasoning_effort = "xhigh"
show_raw_agent_reasoning = true
approval_policy = "never"
sandbox_mode = "danger-full-access"
personality = "pragmatic"
web_search = "live"
model_context_window = 1000000
model_auto_compact_token_limit = 400000

[tui]
terminal_title = []
status_line = ["model-with-reasoning", "context-usage", "current-dir", "git-branch"]

[features]
guardian_approval = true
remote_connections = true
memories = true

[sandbox_workspace_write]
network_access = true
"#,
        escape_toml_basic_string(base_url),
        escape_toml_basic_string(model),
        escape_toml_basic_string(review_model),
    )
}

pub(crate) fn escape_toml_basic_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

pub(crate) fn merge_profile_managed_config(
    current_config_toml: &str,
    next_auth_json: &str,
    profile_config_toml: &str,
) -> Result<String, AppError> {
    let current_table = parse_toml_table(current_config_toml)?;
    let profile_table = parse_toml_table(profile_config_toml)?;
    let mut merged = shared_config_table(&current_table);

    for (key, value) in managed_config_table(next_auth_json, &profile_table)? {
        if key == "features" {
            merge_features_table(&mut merged, value);
        } else {
            merged.insert(key, value);
        }
    }

    toml::to_string_pretty(&toml::Value::Table(merged))
        .map_err(|error| AppError::Message(error.to_string()))
}

pub(crate) fn merge_features_table(target: &mut toml::map::Map<String, toml::Value>, value: toml::Value) {
    let toml::Value::Table(next_features) = value else {
        target.insert("features".to_string(), value);
        return;
    };

    let mut merged_features = target
        .remove("features")
        .and_then(|value| match value {
            toml::Value::Table(table) => Some(table),
            _ => None,
        })
        .unwrap_or_default();

    for (key, value) in next_features {
        merged_features.insert(key, value);
    }

    target.insert("features".to_string(), toml::Value::Table(merged_features));
}

pub(crate) fn detect_auth_type_label(auth_json: &str, config_toml: &str) -> Result<String, AppError> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json)
        .map_err(|error| AppError::InvalidAuthJson(error.to_string()))?;
    let config = parse_toml_table(config_toml)?;

    if is_official_oauth_auth(auth_json)? && config_has_symbiotic_provider(&config) {
        return Ok("共生配置".into());
    }

    if is_official_oauth_auth(auth_json)? {
        return Ok("官方 OAuth".into());
    }

    let has_openai_api_key = auth
        .get("OPENAI_API_KEY")
        .and_then(|value| value.as_str())
        .is_some_and(|value| !value.trim().is_empty());

    if has_openai_api_key {
        let has_openai_base_url = config
            .get("openai_base_url")
            .and_then(|value| value.as_str())
            .is_some_and(|value| !value.trim().is_empty());
        let has_custom_provider = has_openai_base_url
            || config
                .get("model_providers")
                .and_then(|value| value.as_table())
                .is_some_and(|providers| {
                    providers.values().any(|provider| {
                        provider
                            .as_table()
                            .and_then(|table| table.get("base_url"))
                            .is_some()
                    })
                });

        if has_custom_provider {
            return Ok("第三方 API".into());
        }

        return Ok("API Key".into());
    }

    Ok(unknown_auth_type_label())
}

pub(crate) fn auth_match_hash(auth_json: &str) -> Result<String, AppError> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json)
        .map_err(|error| AppError::InvalidAuthJson(error.to_string()))?;

    if is_official_oauth_auth(auth_json)? {
        if let Some(id_token) = auth
            .get("tokens")
            .and_then(|value| value.as_object())
            .and_then(|tokens| tokens.get("id_token"))
            .and_then(|value| value.as_str())
        {
            if let Some(identity_payload) = oauth_identity_payload(id_token) {
                return Ok(sha256_bytes(identity_payload.as_bytes()));
            }
        }
    }

    if let Some(api_key) = auth.get("OPENAI_API_KEY").and_then(|value| value.as_str()) {
        return Ok(sha256_bytes(api_key.as_bytes()));
    }

    Ok(sha256_bytes(auth_json.as_bytes()))
}

pub(crate) fn oauth_identity_payload(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let json = serde_json::from_slice::<serde_json::Value>(&decoded).ok()?;

    let email = json
        .get("email")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let auth_section = json.get("https://api.openai.com/auth");
    let user_id = auth_section
        .and_then(|section| section.get("chatgpt_user_id"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let account_id = auth_section
        .and_then(|section| section.get("chatgpt_account_id"))
        .and_then(|value| value.as_str())
        .unwrap_or("");

    if email.is_empty() && user_id.is_empty() && account_id.is_empty() {
        return None;
    }

    Some(format!(
        "email={email};user_id={user_id};account_id={account_id}"
    ))
}

pub(crate) fn oauth_email(auth_json: &str) -> Option<String> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json).ok()?;
    auth.get("tokens")
        .and_then(|value| value.as_object())
        .and_then(|tokens| tokens.get("id_token"))
        .and_then(|value| value.as_str())
        .and_then(|id_token| {
            let payload = id_token.split('.').nth(1)?;
            let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
            let json = serde_json::from_slice::<serde_json::Value>(&decoded).ok()?;
            json.get("email")
                .and_then(|value| value.as_str())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
}

pub(crate) fn oauth_account_id(auth_json: &str) -> Option<String> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json).ok()?;
    auth.get("tokens")
        .and_then(|value| value.as_object())
        .and_then(|tokens| tokens.get("id_token"))
        .and_then(|value| value.as_str())
        .and_then(|id_token| {
            let payload = id_token.split('.').nth(1)?;
            let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
            let json = serde_json::from_slice::<serde_json::Value>(&decoded).ok()?;
            json.get("https://api.openai.com/auth")
                .and_then(|section| section.get("chatgpt_account_id"))
                .and_then(|value| value.as_str())
                .map(|value| value.to_string())
        })
}

pub(crate) fn oauth_api_account_id(auth_json: &str) -> Option<String> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json).ok()?;
    auth.get("tokens")
        .and_then(|value| value.as_object())
        .and_then(|tokens| tokens.get("account_id"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .or_else(|| oauth_account_id(auth_json))
}

pub(crate) fn oauth_access_token(auth_json: &str) -> Option<String> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json).ok()?;
    auth.get("tokens")
        .and_then(|value| value.as_object())
        .and_then(|tokens| tokens.get("access_token"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}

pub(crate) fn oauth_refresh_token(auth_json: &str) -> Option<String> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json).ok()?;
    auth.get("tokens")
        .and_then(|value| value.as_object())
        .and_then(|tokens| tokens.get("refresh_token"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}

pub(crate) fn oauth_id_token(auth_json: &str) -> Option<String> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json).ok()?;
    auth.get("tokens")
        .and_then(|value| value.as_object())
        .and_then(|tokens| tokens.get("id_token"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}

pub(crate) fn oauth_plan_type(auth_json: &str) -> Option<String> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json).ok()?;
    auth.get("tokens")
        .and_then(|value| value.as_object())
        .and_then(|tokens| tokens.get("id_token"))
        .and_then(|value| value.as_str())
        .and_then(|id_token| {
            let payload = id_token.split('.').nth(1)?;
            let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
            let json = serde_json::from_slice::<serde_json::Value>(&decoded).ok()?;
            json.get("https://api.openai.com/auth")
                .and_then(|section| section.get("chatgpt_plan_type"))
                .and_then(|value| value.as_str())
                .map(|value| value.to_ascii_lowercase())
        })
}

pub(crate) fn codex_usage_endpoint() -> String {
    std::env::var("CODEX_AUTH_SWITCH_CODEX_USAGE_ENDPOINT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_CODEX_USAGE_ENDPOINT.to_string())
}

pub(crate) fn ylscode_usage_endpoint() -> String {
    std::env::var("CODEX_AUTH_SWITCH_YLSCODE_USAGE_ENDPOINT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_YLSCODE_USAGE_ENDPOINT.to_string())
}

pub(crate) fn refresh_token_endpoint() -> String {
    std::env::var(REFRESH_TOKEN_URL_OVERRIDE_ENV_VAR)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| REFRESH_TOKEN_URL.to_string())
}

pub(crate) fn duration_from_env_ms(name: &str, default_ms: u64) -> Duration {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .map(Duration::from_millis)
        .unwrap_or_else(|| Duration::from_millis(default_ms))
}

pub(crate) fn http_connect_timeout() -> Duration {
    duration_from_env_ms(
        "CODEX_AUTH_SWITCH_HTTP_CONNECT_TIMEOUT_MS",
        DEFAULT_HTTP_CONNECT_TIMEOUT_MS,
    )
}

pub(crate) fn codex_usage_timeout() -> Duration {
    duration_from_env_ms(
        "CODEX_AUTH_SWITCH_CODEX_USAGE_TIMEOUT_MS",
        DEFAULT_CODEX_USAGE_TIMEOUT_MS,
    )
}

pub(crate) fn latency_probe_timeout() -> Duration {
    duration_from_env_ms(
        "CODEX_AUTH_SWITCH_LATENCY_PROBE_TIMEOUT_MS",
        DEFAULT_LATENCY_PROBE_TIMEOUT_MS,
    )
}

pub(crate) fn third_party_usage_timeout() -> Duration {
    duration_from_env_ms(
        "CODEX_AUTH_SWITCH_THIRD_PARTY_USAGE_TIMEOUT_MS",
        DEFAULT_THIRD_PARTY_USAGE_TIMEOUT_MS,
    )
}

pub(crate) fn oauth_refresh_timeout() -> Duration {
    duration_from_env_ms(
        "CODEX_AUTH_SWITCH_REFRESH_TOKEN_TIMEOUT_MS",
        DEFAULT_CODEX_USAGE_TIMEOUT_MS,
    )
}

pub(crate) fn build_http_agent(timeout: Duration) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(http_connect_timeout())
        .timeout(timeout)
        .build()
}

pub(crate) fn is_ureq_timeout(error: &ureq::Error) -> bool {
    error.kind() == ureq::ErrorKind::Io
        && error.to_string().to_ascii_lowercase().contains("timed out")
}

pub(crate) fn format_timeout_error(action: &str, timeout: Duration) -> AppError {
    AppError::Message(format!(
        "{action}: request timeout after {} ms.",
        timeout.as_millis()
    ))
}

pub(crate) fn persist_refreshed_oauth_auth_json(
    auth_json: &str,
    refreshed: OAuthRefreshResponse,
) -> Result<String, AppError> {
    let mut auth = serde_json::from_str::<serde_json::Value>(auth_json)
        .map_err(|error| AppError::InvalidAuthJson(error.to_string()))?;
    let root = auth
        .as_object_mut()
        .ok_or_else(|| AppError::InvalidAuthJson("auth.json must be a JSON object.".into()))?;

    let tokens = root
        .entry("tokens")
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    let tokens = tokens.as_object_mut().ok_or_else(|| {
        AppError::InvalidAuthJson("auth.json `tokens` must be a JSON object.".into())
    })?;

    tokens.insert(
        "access_token".into(),
        serde_json::Value::String(refreshed.access_token),
    );
    if let Some(refresh_token) = refreshed
        .refresh_token
        .or_else(|| oauth_refresh_token(auth_json))
    {
        tokens.insert(
            "refresh_token".into(),
            serde_json::Value::String(refresh_token),
        );
    }
    if let Some(id_token) = refreshed.id_token.or_else(|| oauth_id_token(auth_json)) {
        tokens.insert("id_token".into(), serde_json::Value::String(id_token));
    }

    root.insert(
        "last_refresh".into(),
        serde_json::Value::String(Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true)),
    );

    serde_json::to_string_pretty(&auth)
        .map_err(|error| AppError::InvalidAuthJson(error.to_string()))
}

pub(crate) fn refresh_oauth_auth_json(auth_json: &str) -> Result<String, AppError> {
    if !is_official_oauth_auth(auth_json)? {
        return Ok(auth_json.to_string());
    }

    let Some(refresh_token) = oauth_refresh_token(auth_json) else {
        return Ok(auth_json.to_string());
    };
    let timeout = oauth_refresh_timeout();

    let response = build_http_agent(timeout)
        .post(&refresh_token_endpoint())
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_form(&[
            ("grant_type", "refresh_token"),
            ("client_id", REFRESH_TOKEN_CLIENT_ID),
            ("refresh_token", refresh_token.as_str()),
        ])
        .map_err(|error| {
            if is_ureq_timeout(&error) {
                format_timeout_error("Failed to refresh ChatGPT access token", timeout)
            } else {
                match &error {
                    ureq::Error::Status(401, _) => {
                        AppError::Message("Failed to refresh ChatGPT access token: 官方 OAuth 登录已过期或已被撤销，请重新导入/登录您的 ChatGPT 账号。 (status code 401)".into())
                    }
                    ureq::Error::Status(400, _) => {
                        AppError::Message("Failed to refresh ChatGPT access token: 刷新请求无效，可能是 Token 已失效或已被撤销。 (status code 400)".into())
                    }
                    _ => AppError::Message(format!("Failed to refresh ChatGPT access token: {error}")),
                }
            }
        })?;

    let refreshed = response
        .into_json::<OAuthRefreshResponse>()
        .map_err(|error| {
            AppError::Message(format!(
                "Failed to parse ChatGPT token refresh response: {error}"
            ))
        })?;

    persist_refreshed_oauth_auth_json(auth_json, refreshed)
}

pub(crate) fn refresh_oauth_auth_json_for_switch(auth_json: &str) -> Result<String, AppError> {
    match refresh_oauth_auth_json(auth_json) {
        Ok(refreshed_auth_json) => Ok(refreshed_auth_json),
        Err(_)
            if oauth_access_token(auth_json).is_some() && oauth_id_token(auth_json).is_some() =>
        {
            Ok(auth_json.to_string())
        }
        Err(error) => Err(error),
    }
}


pub(crate) fn suggested_profile_name(auth_json: &str, config_toml: &str) -> Result<String, AppError> {
    let auth_type_label = detect_auth_type_label(auth_json, config_toml)?;

    if auth_type_label == "官方 OAuth" {
        // Prefer the account email so a freshly logged-in OAuth account gets a
        // recognizable name instead of an opaque account-UUID fragment.
        if let Some(email) = oauth_email(auth_json) {
            return Ok(email);
        }
        if let Some(account_id) = oauth_account_id(auth_json) {
            if let Some(segment) = account_id
                .split(['-', '_'])
                .find(|segment| !segment.trim().is_empty())
            {
                return Ok(segment.to_string());
            }
            return Ok(account_id);
        }
    }

    Ok(format!("{auth_type_label} 当前配置"))
}

pub(crate) fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}
