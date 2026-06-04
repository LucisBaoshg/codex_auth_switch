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

const sharedConfigRootKeys = new Set([
  "model",
  "review_model",
  "model_provider",
  "openai_base_url",
  "base_url",
  "model_reasoning_effort",
  "plan_mode_reasoning_effort",
  "supports_websockets",
  "network_access",
  "disable_response_storage",
]);

function quoteTomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlBracketDelta(line: string): number {
  let delta = 0;
  let quote: string | null = null;
  let escaped = false;

  for (const char of line) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "[") delta += 1;
    if (char === "]") delta -= 1;
  }

  return delta;
}

function isSharedModelProviderTable(tableHeader: string): boolean {
  return /^\s*\[\s*model_providers(?:\.[^\]]+)?\s*\]\s*(?:#.*)?$/.test(tableHeader);
}

export function sanitizeSharedConfigToml(configToml: string): string {
  const kept: string[] = [];
  let includeCurrentTable = false;
  let skippingDisallowedValue = false;
  let disallowedBracketDepth = 0;

  for (const line of configToml.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (skippingDisallowedValue) {
      disallowedBracketDepth += tomlBracketDelta(line);
      if (disallowedBracketDepth <= 0) {
        skippingDisallowedValue = false;
        disallowedBracketDepth = 0;
      }
      continue;
    }

    if (!trimmed || trimmed.startsWith("#")) {
      if (includeCurrentTable && kept.length > 0 && kept[kept.length - 1] !== "") {
        kept.push("");
      }
      continue;
    }

    if (/^\s*\[/.test(line)) {
      includeCurrentTable = isSharedModelProviderTable(line);
      if (includeCurrentTable) {
        if (kept.length > 0 && kept[kept.length - 1] !== "") kept.push("");
        kept.push(line);
      }
      continue;
    }

    if (includeCurrentTable) {
      kept.push(line);
      continue;
    }

    const assignment = line.match(/^\s*([A-Za-z0-9_-]+)\s*=/);
    if (!assignment) continue;

    if (sharedConfigRootKeys.has(assignment[1])) {
      kept.push(line);
      continue;
    }

    const delta = tomlBracketDelta(line);
    if (delta > 0) {
      skippingDisallowedValue = true;
      disallowedBracketDepth = delta;
    }
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
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
