use super::*;

/// Portable catalog settings travel with config.toml; the JSON path is generated locally.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ThirdPartyModel {
    pub id: String,
    pub display_name: String,
    pub reasoning_effort: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supported_reasoning_efforts: Option<Vec<String>>,
    pub context_window: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThirdPartyModelSettings {
    pub version: u32,
    pub models: Vec<ThirdPartyModel>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredModel {
    pub id: String,
    pub display_name: String,
}

pub fn normalize_third_party_base_url(value: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::Message("请填写接口地址。".into()));
    }
    // A bare host:port is useful for LAN gateways. Explicit schemes are preserved.
    let candidate = if value.contains("://") {
        value.to_string()
    } else {
        format!("http://{value}")
    };
    let mut url = url::Url::parse(&candidate)
        .map_err(|_| AppError::Message("接口地址格式不正确。".into()))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::Message(
            "请使用不含账号、查询参数或片段的 HTTP/HTTPS 接口地址。".into(),
        ));
    }
    let path = url.path().trim_end_matches('/');
    let path = if path.is_empty() { "/v1" } else { path }.to_string();
    url.set_path(&path);
    Ok(url.as_str().trim_end_matches('/').to_string())
}

pub fn discover_third_party_models(
    base_url: &str,
    api_key: &str,
) -> Result<Vec<DiscoveredModel>, AppError> {
    let base_url = normalize_third_party_base_url(base_url)?;
    let api_key = api_key.trim();
    if api_key.is_empty() || api_key.contains(['\r', '\n']) {
        return Err(AppError::Message("请填写有效的 API 密钥。".into()));
    }
    // Do not redirect authenticated discovery requests to a different destination.
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(15))
        .redirects(0)
        .build();
    let response = agent
        .get(&format!("{base_url}/models"))
        .set("Authorization", &format!("Bearer {api_key}"))
        .set("Accept", "application/json")
        .call()
        .map_err(|error| match error {
            ureq::Error::Status(status, _) => AppError::Message(match status {
                401 | 403 => "接口拒绝了此密钥，请检查密钥及模型访问权限。".into(),
                404 => "接口没有模型列表，可手动添加模型名称。".into(),
                _ => format!("模型列表请求失败（HTTP {status}）。"),
            }),
            _ => AppError::Message("无法连接模型接口，请检查地址、网络或代理。".into()),
        })?;
    if response.status() != 200 {
        return Err(AppError::Message(format!(
            "模型列表请求未成功（HTTP {}），请填写最终接口地址。",
            response.status()
        )));
    }
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(2_000_001)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 2_000_000 {
        return Err(AppError::Message("模型列表响应过大。".into()));
    }
    let json: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::Message("模型列表不是有效的 JSON。".into()))?;
    let entries = json
        .get("data")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AppError::Message("模型列表缺少 data 数组，可手动添加模型名称。".into()))?;
    let mut seen = HashSet::new();
    let mut models = Vec::new();
    for item in entries {
        let Some(id) = item.get("id").and_then(|v| v.as_str()).map(str::trim) else {
            continue;
        };
        if id.is_empty()
            || id.len() > 256
            || id.chars().any(char::is_control)
            || !seen.insert(id.to_string())
        {
            continue;
        }
        let name = item
            .get("display_name")
            .or_else(|| item.get("name"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|v| !v.is_empty() && v.len() <= 256)
            .unwrap_or(id);
        models.push(DiscoveredModel {
            id: id.into(),
            display_name: name.into(),
        });
        if models.len() >= 1000 {
            break;
        }
    }
    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}

pub(crate) fn third_party_model_settings(
    config: &str,
) -> Result<Option<ThirdPartyModelSettings>, AppError> {
    let table = parse_toml_table(config)?;
    let Some(value) = table.get("codex_auth_switch") else {
        return Ok(None);
    };
    let settings: ThirdPartyModelSettings = value
        .clone()
        .try_into()
        .map_err(|_| AppError::Message("第三方模型设置格式不正确。".into()))?;
    if settings.version != 1 || settings.models.is_empty() || settings.models.len() > 100 {
        return Err(AppError::Message("请选择 1 至 100 个第三方模型。".into()));
    }
    let mut ids = HashSet::new();
    for model in &settings.models {
        let efforts = model
            .supported_reasoning_efforts
            .as_deref()
            .unwrap_or_else(|| std::slice::from_ref(&model.reasoning_effort));
        if efforts.is_empty()
            || efforts.len() > 6
            || efforts.iter().any(|effort| {
                !matches!(
                    effort.as_str(),
                    "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
                )
            })
            || efforts.iter().collect::<HashSet<_>>().len() != efforts.len()
            || !efforts.contains(&model.reasoning_effort)
        {
            return Err(AppError::Message(
                "请选择有效且不重复的推理档位，默认强度必须在可选档位中。".into(),
            ));
        }
        if model.id.trim().is_empty()
            || model.id.len() > 256
            || model.id.chars().any(char::is_control)
            || model.id != model.id.trim()
            || !ids.insert(&model.id)
            || model.display_name.trim().is_empty()
            || model.display_name.len() > 256
            || !(4096..=2_000_000).contains(&model.context_window)
            || !matches!(
                model.reasoning_effort.as_str(),
                "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
            )
        {
            return Err(AppError::Message(
                "模型名称、推理设置或上下文预算不正确。".into(),
            ));
        }
    }
    if !table
        .get("model")
        .and_then(|v| v.as_str())
        .is_some_and(|id| ids.contains(&id.to_string()))
    {
        return Err(AppError::Message("默认模型必须在所选模型列表中。".into()));
    }
    Ok(Some(settings))
}

fn catalog_model(model: &ThirdPartyModel, priority: usize) -> serde_json::Value {
    let efforts = model
        .supported_reasoning_efforts
        .as_deref()
        .unwrap_or_else(|| std::slice::from_ref(&model.reasoning_effort));
    serde_json::json!({
        "slug": model.id, "display_name": model.display_name,
        "description": "通过配置的第三方接口运行", "visibility": "list", "supported_in_api": true,
        "priority": priority, "default_reasoning_level": model.reasoning_effort,
        "supported_reasoning_levels": efforts.iter().map(|effort| serde_json::json!({"effort": effort, "description": match effort.as_str() {
            "none" => "关闭额外推理", "minimal" => "最低推理强度", "low" => "低推理强度", "medium" => "中等推理强度", "high" => "高推理强度", _ => "超高推理强度"
        }})).collect::<Vec<_>>(),
        "shell_type": "shell_command", "additional_speed_tiers": [], "service_tiers": [],
        "model_messages": {"instructions_template": "You are a coding assistant. Work with the user to complete their task. Use the available tools when needed, respect the configured permissions, verify your changes, and report results accurately.", "instructions_variables": {}},
        "include_skills_usage_instructions": true, "include_plugin_usage_instructions": true, "include_apps_usage_instructions": true,
        "default_reasoning_summary": "none", "support_verbosity": false,
        "apply_patch_tool_type": "freeform", "web_search_tool_type": "text_and_image",
        "truncation_policy": {"mode": "tokens", "limit": 10000},
        "supports_image_detail_original": false, "context_window": model.context_window,
        "max_context_window": model.context_window, "effective_context_window_percent": 95,
        "experimental_supported_tools": [], "input_modalities": ["text"], "supports_search_tool": false,
        "use_responses_lite": false
    })
}

impl ProfileManager {
    pub(crate) fn materialize_third_party_catalog(
        &self,
        auth: &str,
        config: &str,
    ) -> Result<String, AppError> {
        if is_official_oauth_auth(auth)? {
            return Ok(config.to_string());
        }
        let Some(settings) = third_party_model_settings(config)? else {
            return Ok(config.to_string());
        };
        let catalog = serde_json::json!({"models": settings.models.iter().enumerate().map(|(i, m)| catalog_model(m, i)).collect::<Vec<_>>()});
        let bytes = serde_json::to_vec_pretty(&catalog)?;
        // Immutable content-addressed files keep old config backups usable and make downloads portable.
        let directory = self.app_data_dir.join("model-catalogs");
        fs::create_dir_all(&directory)?;
        let path = directory.join(format!("{}.json", sha256_bytes(&bytes)));
        atomic_write_sensitive(&path, &bytes)?;
        let mut table = parse_toml_table(config)?;
        table.insert(
            "model_catalog_json".into(),
            toml::Value::String(path.to_string_lossy().into_owned()),
        );
        serialize_config_table(table)
    }
}

pub(crate) fn standalone_model_draft(
    auth: &str,
    config: &str,
) -> Result<Option<serde_json::Value>, AppError> {
    if is_official_oauth_auth(auth)? {
        return Ok(None);
    }
    let Some(settings) = third_party_model_settings(config)? else {
        return Ok(None);
    };
    let table = parse_toml_table(config)?;
    let auth: serde_json::Value = serde_json::from_str(auth)?;
    Ok(Some(serde_json::json!({
        "template": "standaloneThirdParty", "oauthProfileId": "", "provider": "",
        "baseUrl": table.get("openai_base_url").and_then(|v| v.as_str()).unwrap_or_default(),
        "apiKey": auth.get("OPENAI_API_KEY").and_then(|v| v.as_str()).unwrap_or_default(),
        "model": table.get("model").and_then(|v| v.as_str()).unwrap_or_default(),
        "models": settings.models
    })))
}

/// Editing a managed form changes only its own fields; custom tools and permissions survive.
pub fn merge_standalone_model_config(existing: &str, generated: &str) -> Result<String, AppError> {
    if third_party_model_settings(generated)?.is_none() {
        return Err(AppError::Message("缺少第三方模型设置。".into()));
    }
    let mut table = parse_toml_table(existing)?;
    for key in [
        "openai_base_url",
        "supports_websockets",
        "model_provider",
        "model_providers",
        "model",
        "review_model",
        "model_reasoning_effort",
        "plan_mode_reasoning_effort",
        "model_catalog_json",
        "model_context_window",
        "model_auto_compact_token_limit",
        "codex_auth_switch",
    ] {
        table.remove(key);
    }
    table.extend(parse_toml_table(generated)?);
    serialize_config_table(table)
}
