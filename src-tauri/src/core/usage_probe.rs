use super::*;

pub(crate) fn fetch_codex_usage_snapshot(auth_json: &str) -> Result<CodexUsageSnapshot, AppError> {
    let access_token = oauth_access_token(auth_json).ok_or_else(|| {
        AppError::Message("The selected profile does not contain a ChatGPT access token.".into())
    })?;
    let account_id = oauth_api_account_id(auth_json).ok_or_else(|| {
        AppError::Message("The selected profile does not contain a ChatGPT account id.".into())
    })?;
    let endpoint = codex_usage_endpoint();
    let timeout = codex_usage_timeout();

    let response = build_http_agent(timeout)
        .get(&endpoint)
        .set("Authorization", &format!("Bearer {access_token}"))
        .set("ChatGPT-Account-Id", &account_id)
        .set("User-Agent", "codex-auth-switch")
        .call()
        .map_err(|error| {
            if is_ureq_timeout(&error) {
                format_timeout_error("Failed to fetch Codex usage", timeout)
            } else {
                AppError::Message(format!("Failed to fetch Codex usage: {error}"))
            }
        })?;
    let body = response.into_string().map_err(|error| {
        AppError::Message(format!("Failed to read Codex usage response: {error}"))
    })?;

    parse_codex_usage_response(&body, auth_json)
}

pub(crate) fn parse_codex_usage_response(
    body: &str,
    auth_json: &str,
) -> Result<CodexUsageSnapshot, AppError> {
    let root = serde_json::from_str::<serde_json::Value>(body)?;
    let rate_limit = root.get("rate_limit");
    let primary = rate_limit
        .and_then(|value| value.get("primary_window"))
        .and_then(parse_codex_usage_window);
    let secondary = rate_limit
        .and_then(|value| value.get("secondary_window"))
        .and_then(parse_codex_usage_window);

    if primary.is_none() && secondary.is_none() {
        return Err(AppError::Message(
            "No usable Codex usage window was returned by the upstream endpoint.".into(),
        ));
    }

    Ok(CodexUsageSnapshot {
        source: "api".into(),
        plan_type: root
            .get("plan_type")
            .and_then(|value| value.as_str())
            .map(|value| value.to_ascii_lowercase())
            .or_else(|| oauth_plan_type(auth_json)),
        primary,
        secondary,
        credits: root.get("credits").and_then(parse_codex_usage_credits),
        updated_at: Utc::now(),
        error: None,
    })
}

pub(crate) fn codex_usage_failure_snapshot(error: String) -> CodexUsageSnapshot {
    CodexUsageSnapshot {
        source: "api".into(),
        plan_type: None,
        primary: None,
        secondary: None,
        credits: None,
        updated_at: Utc::now(),
        error: Some(error),
    }
}

pub(crate) fn parse_codex_usage_window(value: &serde_json::Value) -> Option<CodexUsageWindow> {
    if value.is_null() {
        return None;
    }

    Some(CodexUsageWindow {
        used_percent: value.get("used_percent").and_then(parse_usage_percent)?,
        window_minutes: value
            .get("limit_window_seconds")
            .and_then(|seconds| seconds.as_i64())
            .and_then(ceil_minutes),
        resets_at: value
            .get("reset_at")
            .and_then(|timestamp| timestamp.as_i64())
            .and_then(|timestamp| Utc.timestamp_opt(timestamp, 0).single()),
    })
}

pub(crate) fn parse_codex_usage_credits(value: &serde_json::Value) -> Option<CodexUsageCredits> {
    if value.is_null() {
        return None;
    }

    Some(CodexUsageCredits {
        has_credits: value
            .get("has_credits")
            .and_then(|field| field.as_bool())
            .unwrap_or(false),
        unlimited: value
            .get("unlimited")
            .and_then(|field| field.as_bool())
            .unwrap_or(false),
        balance: value
            .get("balance")
            .and_then(|field| field.as_str())
            .map(|field| field.to_string()),
    })
}

pub(crate) fn parse_usage_percent(value: &serde_json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|number| number as f64))
}

pub(crate) fn ceil_minutes(seconds: i64) -> Option<i64> {
    if seconds <= 0 {
        return None;
    }
    Some((seconds + 59) / 60)
}

pub(crate) fn fetch_third_party_usage_snapshot(
    auth_json: &str,
    config_toml: &str,
) -> ThirdPartyUsageSnapshot {
    match resolve_third_party_probe_target(auth_json, config_toml) {
        Ok(target) if target.provider_name.eq_ignore_ascii_case("ylscode") => {
            fetch_ylscode_usage_snapshot(&target)
        }
        Ok(target) => third_party_usage_failure(
            Some(target.provider_name),
            "第三方 API 用量查询目前仅支持 ylscode provider。".into(),
        ),
        Err(error) => third_party_usage_failure(None, error.to_string()),
    }
}

pub(crate) fn fetch_ylscode_usage_snapshot(
    target: &ThirdPartyProbeTarget,
) -> ThirdPartyUsageSnapshot {
    let timeout = third_party_usage_timeout();
    let response = build_http_agent(timeout)
        .get(&ylscode_usage_endpoint())
        .set("Authorization", &format!("Bearer {}", target.api_key))
        .set("User-Agent", "cc-switch/1.0")
        .call();

    match response {
        Ok(response) => match response.into_string() {
            Ok(body) => parse_ylscode_usage_response(&body, &target.provider_name),
            Err(error) => third_party_usage_failure(
                Some(target.provider_name.clone()),
                format!("读取 ylscode 用量响应失败：{error}"),
            ),
        },
        Err(ureq::Error::Status(code, response)) => {
            let body = response.into_string().unwrap_or_default();
            third_party_usage_failure(
                Some(target.provider_name.clone()),
                format!(
                    "ylscode 用量接口返回 HTTP {}{}",
                    code,
                    if body.trim().is_empty() {
                        String::new()
                    } else {
                        format!("：{}", truncate_probe_error(&body))
                    }
                ),
            )
        }
        Err(error) => {
            let message = if is_ureq_timeout(&error) {
                format_timeout_error("Failed to fetch ylscode usage", timeout).to_string()
            } else {
                format!("请求 ylscode 用量接口失败：{error}")
            };
            third_party_usage_failure(Some(target.provider_name.clone()), message)
        }
    }
}

pub(crate) fn parse_ylscode_usage_response(body: &str, provider: &str) -> ThirdPartyUsageSnapshot {
    match serde_json::from_str::<serde_json::Value>(body) {
        Ok(root) => {
            let daily = root
                .pointer("/state/userPackgeUsage")
                .and_then(parse_ylscode_usage_quota);
            let weekly = root
                .pointer("/state/userPackgeUsage_week")
                .and_then(parse_ylscode_usage_quota);
            let subscription = root
                .pointer("/state/package")
                .and_then(parse_ylscode_subscription);
            let credit = root
                .pointer("/state/userAccountInfo")
                .and_then(parse_ylscode_credit);
            let remaining = daily
                .as_ref()
                .and_then(|quota| quota.remaining.clone())
                .or_else(|| {
                    root.pointer("/state/userPackgeUsage/remaining_quota")
                        .and_then(json_scalar_to_string)
                });
            match remaining {
                Some(remaining) => ThirdPartyUsageSnapshot {
                    provider: Some(provider.to_string()),
                    remaining: Some(remaining),
                    unit: Some("USD".into()),
                    daily,
                    weekly,
                    subscription,
                    credit,
                    updated_at: Utc::now(),
                    error: None,
                },
                None => third_party_usage_failure(
                    Some(provider.to_string()),
                    "ylscode 用量响应缺少 state.userPackgeUsage.remaining_quota。".into(),
                ),
            }
        }
        Err(error) => third_party_usage_failure(
            Some(provider.to_string()),
            format!("解析 ylscode 用量响应失败：{error}"),
        ),
    }
}

pub(crate) fn parse_ylscode_usage_quota(
    value: &serde_json::Value,
) -> Option<ThirdPartyUsageQuotaSnapshot> {
    if !value.is_object() {
        return None;
    }

    let used = value.get("total_cost").and_then(json_scalar_to_string);
    let total = value.get("total_quota").and_then(json_scalar_to_string);
    let remaining = value.get("remaining_quota").and_then(json_scalar_to_string);
    if used.is_none() && total.is_none() && remaining.is_none() {
        return None;
    }

    let used_percent = value
        .get("used_percentage")
        .and_then(parse_percentage_value)
        .or_else(|| {
            let used = value.get("total_cost").and_then(json_scalar_to_f64)?;
            let total = value.get("total_quota").and_then(json_scalar_to_f64)?;
            if total <= 0.0 {
                return None;
            }
            Some((used / total) * 100.0)
        });

    Some(ThirdPartyUsageQuotaSnapshot {
        used,
        total,
        remaining,
        used_percent,
    })
}

pub(crate) fn parse_ylscode_subscription(
    value: &serde_json::Value,
) -> Option<ThirdPartySubscriptionSnapshot> {
    if !value.is_object() {
        return None;
    }

    let first_package = value
        .get("packages")
        .and_then(|packages| packages.as_array())
        .and_then(|packages| packages.first());
    let daily_quota = value
        .get("total_quota")
        .and_then(json_scalar_to_string)
        .or_else(|| {
            first_package
                .and_then(|package| package.get("package_quota").and_then(json_scalar_to_string))
        });
    let weekly_quota = value.get("weeklyQuota").and_then(json_scalar_to_string);
    let monthly_quota = daily_quota
        .as_ref()
        .and_then(|daily| parse_quota_decimal(daily))
        .map(|daily| format_compact_number(daily * 31.0));
    let expires_at = first_package
        .and_then(|package| package.get("expires_at"))
        .and_then(|value| value.as_str())
        .and_then(parse_utc_datetime);
    let amount =
        first_package.and_then(|package| package.get("amount").and_then(json_scalar_to_string));
    let package_type = first_package
        .and_then(|package| package.get("package_type").and_then(json_scalar_to_string));

    if daily_quota.is_none()
        && weekly_quota.is_none()
        && monthly_quota.is_none()
        && expires_at.is_none()
        && amount.is_none()
        && package_type.is_none()
    {
        return None;
    }

    Some(ThirdPartySubscriptionSnapshot {
        daily_quota,
        weekly_quota,
        monthly_quota,
        expires_at,
        amount,
        package_type,
    })
}

pub(crate) fn parse_ylscode_credit(value: &serde_json::Value) -> Option<ThirdPartyCreditSnapshot> {
    if !value.is_object() {
        return None;
    }

    let free_balance = value.get("free_balance").and_then(json_scalar_to_string);
    let paid_balance = value.get("paid_balance").and_then(json_scalar_to_string);
    let total_balance = value.get("total_balance").and_then(json_scalar_to_string);
    if free_balance.is_none() && paid_balance.is_none() && total_balance.is_none() {
        return None;
    }

    Some(ThirdPartyCreditSnapshot {
        free_balance,
        paid_balance,
        total_balance,
    })
}

pub(crate) fn json_scalar_to_string(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.trim().to_string()).filter(|text| !text.is_empty());
    }
    if let Some(number) = value.as_i64() {
        return Some(number.to_string());
    }
    if let Some(number) = value.as_u64() {
        return Some(number.to_string());
    }
    value.as_f64().map(|number| number.to_string())
}

pub(crate) fn parse_quota_decimal(value: &str) -> Option<f64> {
    value
        .trim()
        .trim_start_matches('$')
        .replace(',', "")
        .parse()
        .ok()
}

pub(crate) fn format_compact_number(value: f64) -> String {
    if value.is_finite() && value.fract().abs() < f64::EPSILON {
        format!("{}", value as i64)
    } else {
        value.to_string()
    }
}

pub(crate) fn parse_utc_datetime(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

pub(crate) fn json_scalar_to_f64(value: &serde_json::Value) -> Option<f64> {
    value.as_f64().or_else(|| {
        value
            .as_str()
            .and_then(|text| text.trim().trim_end_matches('%').parse::<f64>().ok())
    })
}

pub(crate) fn parse_percentage_value(value: &serde_json::Value) -> Option<f64> {
    json_scalar_to_f64(value)
}

pub(crate) fn fetch_third_party_latency_snapshot(
    auth_json: &str,
    config_toml: &str,
) -> ThirdPartyLatencySnapshot {
    match resolve_third_party_probe_target(auth_json, config_toml) {
        Ok(target) => match target.wire_api.as_str() {
            "responses" => {
                probe_third_party_stream(&target, "/responses", responses_probe_body(&target))
            }
            "chat_completions" => probe_third_party_stream(
                &target,
                "/chat/completions",
                chat_completions_probe_body(&target),
            ),
            other => latency_probe_failure(
                Some(other.to_string()),
                Some(target.model),
                None,
                None,
                format!("暂不支持 {other} 流式协议。"),
            ),
        },
        Err(error) => latency_probe_failure(None, None, None, None, error.to_string()),
    }
}

pub(crate) fn resolve_third_party_probe_target(
    auth_json: &str,
    config_toml: &str,
) -> Result<ThirdPartyProbeTarget, AppError> {
    let auth = serde_json::from_str::<serde_json::Value>(auth_json)
        .map_err(|error| AppError::InvalidAuthJson(error.to_string()))?;
    let auth_api_key = auth
        .get("OPENAI_API_KEY")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let config = parse_toml_table(config_toml)?;
    let model = config
        .get("model")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Message("当前卡片缺少 model，无法执行测速。".into()))?;

    let provider_name = config
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
                .get(&provider_name)
                .or_else(|| providers.values().next())
        })
        .and_then(|value| value.as_table());

    let api_key = auth_api_key.or_else(|| {
        provider_from_table
            .and_then(|provider| provider.get("experimental_bearer_token"))
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    });

    let Some(api_key) = api_key else {
        return Err(AppError::Message(
            "当前卡片缺少 OPENAI_API_KEY 或 experimental_bearer_token，无法执行第三方 API 请求。"
                .into(),
        ));
    };

    let base_url = config
        .get("openai_base_url")
        .and_then(|value| value.as_str())
        .or_else(|| {
            provider_from_table
                .and_then(|provider| provider.get("base_url"))
                .and_then(|value| value.as_str())
        })
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Message("当前卡片缺少 openai_base_url 配置。".into()))?;
    let provider_name = infer_third_party_provider_name(&provider_name, &base_url);

    let wire_api = provider_from_table
        .and_then(|provider| provider.get("wire_api"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "responses".into());

    Ok(ThirdPartyProbeTarget {
        provider_name,
        api_key,
        base_url,
        model,
        wire_api,
    })
}

pub(crate) fn infer_third_party_provider_name(provider_name: &str, base_url: &str) -> String {
    let normalized_provider = provider_name.trim();
    let normalized_base_url = base_url.trim().to_ascii_lowercase();
    if normalized_base_url.contains("ylsagi.com")
        || normalized_base_url.contains("ylscode")
        || normalized_base_url.contains("code.ylsagi.com")
    {
        return "ylscode".into();
    }

    if normalized_provider.is_empty() {
        "openai".into()
    } else {
        normalized_provider.to_string()
    }
}

pub(crate) fn responses_probe_body(target: &ThirdPartyProbeTarget) -> String {
    serde_json::json!({
        "model": target.model,
        "input": "Reply with exactly: ok",
        "stream": true,
        "max_output_tokens": 8,
        "temperature": 0
    })
    .to_string()
}

pub(crate) fn chat_completions_probe_body(target: &ThirdPartyProbeTarget) -> String {
    serde_json::json!({
        "model": target.model,
        "stream": true,
        "temperature": 0,
        "max_tokens": 8,
        "messages": [
            {
                "role": "user",
                "content": "Reply with exactly: ok"
            }
        ]
    })
    .to_string()
}

pub(crate) fn probe_third_party_stream(
    target: &ThirdPartyProbeTarget,
    path: &str,
    body: String,
) -> ThirdPartyLatencySnapshot {
    let started_at = Utc::now();
    let started = Instant::now();
    let endpoint = format!("{}{}", target.base_url, path);
    let timeout = latency_probe_timeout();
    let response = build_http_agent(timeout)
        .post(&endpoint)
        .set("Authorization", &format!("Bearer {}", target.api_key))
        .set("Content-Type", "application/json")
        .set("Accept", "text/event-stream")
        .set("User-Agent", "codex-auth-switch")
        .send_string(&body);

    match response {
        Ok(response) => {
            let status_code = Some(response.status());
            let mut reader = BufReader::new(response.into_reader());
            let mut ttft_ms = None;

            loop {
                let event = match next_sse_event(&mut reader) {
                    Ok(Some(event)) => event,
                    Ok(None) => break,
                    Err(error) => {
                        let read_error = if error.kind() == std::io::ErrorKind::TimedOut {
                            format!("读取流式响应超时（{} ms）。", timeout.as_millis())
                        } else {
                            format!("读取流式响应失败：{error}")
                        };
                        return latency_probe_failure(
                            Some(target.wire_api.clone()),
                            Some(target.model.clone()),
                            status_code,
                            Some(started.elapsed().as_millis() as u64),
                            read_error,
                        );
                    }
                };

                if event.data.trim() == "[DONE]" {
                    break;
                }

                let first_text = match target.wire_api.as_str() {
                    "responses" => extract_first_responses_delta(&event),
                    "chat_completions" => extract_first_chat_completions_delta(&event),
                    _ => None,
                };

                if ttft_ms.is_none()
                    && first_text
                        .as_deref()
                        .is_some_and(|value| !value.trim().is_empty())
                {
                    ttft_ms = Some(started.elapsed().as_millis() as u64);
                }
            }

            let total_ms = Some(started.elapsed().as_millis() as u64);
            if ttft_ms.is_none() {
                return latency_probe_failure(
                    Some(target.wire_api.clone()),
                    Some(target.model.clone()),
                    status_code,
                    total_ms,
                    "上游没有返回可识别的首个文本 token。".into(),
                );
            }

            ThirdPartyLatencySnapshot {
                wire_api: Some(target.wire_api.clone()),
                model: Some(target.model.clone()),
                ttft_ms,
                total_ms,
                status_code,
                updated_at: started_at,
                error: None,
            }
        }
        Err(ureq::Error::Status(code, response)) => {
            let body = response.into_string().unwrap_or_default();
            latency_probe_failure(
                Some(target.wire_api.clone()),
                Some(target.model.clone()),
                Some(code),
                Some(started.elapsed().as_millis() as u64),
                format!(
                    "上游返回 HTTP {}{}",
                    code,
                    if body.trim().is_empty() {
                        String::new()
                    } else {
                        format!("：{}", truncate_probe_error(&body))
                    }
                ),
            )
        }
        Err(error @ ureq::Error::Transport(_)) => {
            let request_error = if is_ureq_timeout(&error) {
                format!("请求测速接口超时（{} ms）。", timeout.as_millis())
            } else {
                format!("请求失败：{error}")
            };
            latency_probe_failure(
                Some(target.wire_api.clone()),
                Some(target.model.clone()),
                None,
                Some(started.elapsed().as_millis() as u64),
                request_error,
            )
        }
    }
}

pub(crate) fn next_sse_event(
    reader: &mut impl BufRead,
) -> Result<Option<SseEvent>, std::io::Error> {
    let mut event = None;
    let mut data_lines = Vec::new();
    let mut saw_payload = false;

    loop {
        let mut line = String::new();
        let bytes_read = reader.read_line(&mut line)?;
        if bytes_read == 0 {
            if !saw_payload {
                return Ok(None);
            }
            break;
        }

        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            if saw_payload {
                break;
            }
            continue;
        }

        saw_payload = true;
        if let Some(value) = trimmed.strip_prefix("event:") {
            event = Some(value.trim().to_string());
            continue;
        }
        if let Some(value) = trimmed.strip_prefix("data:") {
            data_lines.push(value.trim_start().to_string());
        }
    }

    Ok(Some(SseEvent {
        event,
        data: data_lines.join("\n"),
    }))
}

pub(crate) fn extract_first_responses_delta(event: &SseEvent) -> Option<String> {
    if let Some(name) = event.event.as_deref() {
        if !name.contains("delta") && !name.contains("output_text") {
            return None;
        }
    }

    let payload = serde_json::from_str::<serde_json::Value>(&event.data).ok()?;
    payload
        .get("delta")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .filter(|value| !value.trim().is_empty())
}

pub(crate) fn extract_first_chat_completions_delta(event: &SseEvent) -> Option<String> {
    let payload = serde_json::from_str::<serde_json::Value>(&event.data).ok()?;
    payload
        .get("choices")
        .and_then(|value| value.as_array())
        .and_then(|choices| {
            choices.iter().find_map(|choice| {
                choice
                    .get("delta")
                    .and_then(|delta| delta.get("content"))
                    .and_then(|content| content.as_str())
                    .map(|content| content.to_string())
                    .filter(|content| !content.trim().is_empty())
            })
        })
}

pub(crate) fn latency_probe_failure(
    wire_api: Option<String>,
    model: Option<String>,
    status_code: Option<u16>,
    total_ms: Option<u64>,
    error: String,
) -> ThirdPartyLatencySnapshot {
    ThirdPartyLatencySnapshot {
        wire_api,
        model,
        ttft_ms: None,
        total_ms,
        status_code,
        updated_at: Utc::now(),
        error: Some(error),
    }
}

pub(crate) fn third_party_usage_failure(
    provider: Option<String>,
    error: String,
) -> ThirdPartyUsageSnapshot {
    ThirdPartyUsageSnapshot {
        provider,
        remaining: None,
        unit: Some("USD".into()),
        daily: None,
        weekly: None,
        subscription: None,
        credit: None,
        updated_at: Utc::now(),
        error: Some(error),
    }
}

pub(crate) fn truncate_probe_error(value: &str) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= 120 {
        return compact;
    }
    compact.chars().take(120).collect::<String>() + "..."
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_quota_decimals_with_currency_formatting() {
        assert_eq!(parse_quota_decimal("$1,234.50"), Some(1234.5));
        assert_eq!(parse_quota_decimal("  42 "), Some(42.0));
        assert_eq!(parse_quota_decimal("n/a"), None);
    }

    #[test]
    fn formats_whole_numbers_compactly() {
        assert_eq!(format_compact_number(5.0), "5");
        assert_eq!(format_compact_number(5.25), "5.25");
    }

    #[test]
    fn truncates_and_compacts_probe_errors() {
        assert_eq!(truncate_probe_error("a  b\n c"), "a b c");
        let long = "x".repeat(200);
        let truncated = truncate_probe_error(&long);
        assert_eq!(truncated.chars().count(), 123);
        assert!(truncated.ends_with("..."));
    }

    #[test]
    fn parses_rfc3339_timestamps_to_utc() {
        assert!(parse_utc_datetime("2026-07-12T00:00:00+08:00").is_some());
        assert!(parse_utc_datetime("not-a-date").is_none());
    }
}
