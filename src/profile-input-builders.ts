export type NewProfileTemplate = "standaloneThirdParty" | "symbioticThirdParty";

export type ThirdPartyConfigDraft = {
  template: NewProfileTemplate;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  oauthProfileId: string;
};

export type ProfileInput = {
  name: string;
  notes: string;
  authJson: string;
  configToml: string;
};

export type ProfileInputDocument = ProfileInput & Record<string, unknown>;

export type ProfileInputDraft = {
  name: string;
  notes: string;
  thirdParty: ThirdPartyConfigDraft;
};

export function escapeTomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function tomlTableKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : `"${escapeTomlString(value)}"`;
}

export function standaloneThirdPartyConfigInputFromDraft(
  editor: ProfileInputDraft,
  strict: boolean = true,
): ProfileInput {
  const baseUrl = editor.thirdParty.baseUrl.trim();
  const apiKey = editor.thirdParty.apiKey.trim();
  const model = editor.thirdParty.model.trim();

  if (strict) {
    if (!baseUrl) {
      throw new Error("请填写第三方 API 的 openai_base_url。");
    }
    if (!apiKey) {
      throw new Error("请填写 auth.json 中 OPENAI_API_KEY 的 value。");
    }
    if (!model) {
      throw new Error("请填写 model。");
    }
  }

  return {
    name: editor.name.trim(),
    notes: editor.notes.trim(),
    authJson: JSON.stringify({ OPENAI_API_KEY: apiKey || "<your_api_key_here>" }, null, 2),
    configToml: `openai_base_url = "${escapeTomlString(baseUrl || "https://api.openai.com/v1")}"
supports_websockets = false
model_provider = "openai"
model = "${escapeTomlString(model || "gpt-5.5")}"
review_model = "${escapeTomlString(model || "gpt-5.5")}"
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
`,
  };
}

export function profileInputFromDocument(document: ProfileInputDocument): ProfileInput {
  return {
    name: document.name,
    notes: document.notes,
    authJson: document.authJson,
    configToml: document.configToml,
  };
}

export function symbioticAuthJsonFromOfficial(authJson: string): string {
  const parsed = JSON.parse(authJson) as Record<string, unknown>;
  parsed.auth_mode = "chatgpt";
  parsed.OPENAI_API_KEY = null;
  return JSON.stringify(parsed, null, 2);
}

export function symbioticThirdPartyConfigTomlFromDraft(
  editor: ProfileInputDraft,
  strict: boolean = true,
): string {
  const provider = editor.thirdParty.provider.trim();
  const baseUrl = editor.thirdParty.baseUrl.trim();
  const token = editor.thirdParty.apiKey.trim();
  const model = editor.thirdParty.model.trim();

  if (strict) {
    if (!provider) {
      throw new Error("请填写共生配置的 model_provider。");
    }
    if (!baseUrl) {
      throw new Error("请填写第三方 API 的 base_url。");
    }
    if (!token) {
      throw new Error("请填写第三方 API 的 experimental_bearer_token。");
    }
    if (!model) {
      throw new Error("请填写 model。");
    }
  }

  const resolvedProvider = provider || "custom-provider";
  return `model_provider = "${escapeTomlString(resolvedProvider)}"
model = "${escapeTomlString(model || "gpt-5.5")}"
review_model = "${escapeTomlString(model || "gpt-5.5")}"
model_reasoning_effort = "high"
plan_mode_reasoning_effort = "xhigh"
show_raw_agent_reasoning = true
approval_policy = "never"
sandbox_mode = "danger-full-access"

[model_providers.${tomlTableKey(resolvedProvider)}]
name = "${escapeTomlString(resolvedProvider)}"
base_url = "${escapeTomlString(baseUrl || "https://api.openai.com/v1")}"
experimental_bearer_token = "${escapeTomlString(token || "<your_bearer_token_here>")}"
requires_openai_auth = true
supports_websockets = false

[features]
remote_connections = true
remote_control = true
`;
}
