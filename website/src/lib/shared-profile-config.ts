function readOpenAiApiKey(authJson: string | undefined): string | null {
  if (!authJson) return null;

  try {
    const parsed = JSON.parse(authJson) as { OPENAI_API_KEY?: unknown };
    return typeof parsed.OPENAI_API_KEY === "string" ? parsed.OPENAI_API_KEY : null;
  } catch {
    return null;
  }
}

function readBaseUrl(configToml: string | undefined): string | null {
  if (!configToml) return null;

  const match = configToml.match(/^\s*base_url\s*=\s*(['"])(.*?)\1\s*$/m);
  return match?.[2] ?? null;
}

type SharedProfileFields = {
  openAiApiKey: string;
  baseUrl: string;
};

function quoteTomlString(value: string): string {
  return JSON.stringify(value);
}

export function buildLegacyProfileFiles(fields: SharedProfileFields) {
  const openAiApiKey = fields.openAiApiKey.trim();
  const baseUrl = fields.baseUrl.trim();

  return {
    authContent: JSON.stringify({ OPENAI_API_KEY: openAiApiKey }, null, 2),
    configContent: [
      'disable_response_storage = true',
      'model = "gpt-5.4"',
      'model_provider = "ylscode"',
      'model_reasoning_effort = "high"',
      'network_access = "enabled"',
      '',
      '[model_providers.ylscode]',
      `base_url = ${quoteTomlString(baseUrl)}`,
      'name = "ylscode"',
      'requires_openai_auth = true',
      'wire_api = "responses"',
      '',
    ].join("\n"),
  };
}

export function formatSharedProfileConfig(fileContents: Record<string, string>): string {
  const openAiApiKey = readOpenAiApiKey(fileContents["auth.json"]);
  const baseUrl = readBaseUrl(fileContents["config.toml"]);
  const lines: string[] = [];

  if (openAiApiKey) lines.push(`OPENAI_API_KEY = "${openAiApiKey}"`);
  if (baseUrl) lines.push(`base_url = "${baseUrl}"`);

  return lines.join("\n");
}
