import { newThirdPartyModel, normalizeThirdPartyBaseUrl, reasoningEffortsForModel, validateThirdPartyModels, type ThirdPartyModel } from "./third-party-models";
export type NewProfileTemplate = "standaloneThirdParty" | "symbioticThirdParty";

export type ThirdPartyConfigDraft = {
  template: NewProfileTemplate;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  oauthProfileId: string;
  models?: ThirdPartyModel[];
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
  return JSON.stringify(value).slice(1, -1);
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

  const normalizedUrl = baseUrl ? normalizeThirdPartyBaseUrl(baseUrl) : "https://api.example.com/v1";
  const models = editor.thirdParty.models?.length ? editor.thirdParty.models : [newThirdPartyModel(model || "your-model")];
  if (strict) {
    if (/[\r\n]/.test(apiKey)) throw new Error("API 密钥不能包含换行。");
    validateThirdPartyModels(models, model);
  }
  const selected = models.find((entry) => entry.id === model) ?? models[0];
  const catalogSettings = JSON.stringify({ version: 1, models: models.map((entry) => ({
    ...entry, supported_reasoning_efforts: reasoningEffortsForModel(entry),
  })) });
  return {
    name: editor.name.trim(),
    notes: editor.notes.trim(),
    authJson: JSON.stringify({ OPENAI_API_KEY: apiKey || "<your_api_key_here>" }, null, 2),
    configToml: `# codex-auth-switch-models: ${catalogSettings}
openai_base_url = "${escapeTomlString(normalizedUrl)}"
model_provider = "openai"
model = "${escapeTomlString(model || selected.id)}"
review_model = "${escapeTomlString(model || selected.id)}"
model_reasoning_effort = "${escapeTomlString(selected.reasoning_effort)}"

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
