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

function isSharedModelProviderTable(tableHeader: string): boolean {
  return /^\s*\[\s*model_providers(?:\.[^\]]+)?\s*\]\s*(?:#.*)?$/.test(tableHeader);
}

type TomlStringMode = "basic" | "literal" | "multiline-basic" | "multiline-literal" | null;

function splitTomlStatements(configToml: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let squareDepth = 0;
  let curlyDepth = 0;
  let stringMode: TomlStringMode = null;
  let escaped = false;
  let inComment = false;

  for (let index = 0; index < configToml.length; index += 1) {
    const char = configToml[index];
    const nextThree = configToml.slice(index, index + 3);

    if (inComment) {
      if (char !== "\n") continue;
      inComment = false;
    } else if (stringMode === "multiline-basic") {
      if (nextThree === '\"\"\"' && !escaped) {
        stringMode = null;
        index += 2;
        continue;
      }
      if (char === "\\" && !escaped) {
        escaped = true;
      } else {
        escaped = false;
      }
      continue;
    } else if (stringMode === "multiline-literal") {
      if (nextThree === "'''") {
        stringMode = null;
        index += 2;
      }
      continue;
    } else if (stringMode === "basic") {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '\"') {
        stringMode = null;
      }
      continue;
    } else if (stringMode === "literal") {
      if (char === "'") stringMode = null;
      continue;
    } else if (nextThree === '\"\"\"') {
      stringMode = "multiline-basic";
      index += 2;
      continue;
    } else if (nextThree === "'''") {
      stringMode = "multiline-literal";
      index += 2;
      continue;
    } else if (char === '\"') {
      stringMode = "basic";
      continue;
    } else if (char === "'") {
      stringMode = "literal";
      continue;
    } else if (char === "#") {
      inComment = true;
      continue;
    } else if (char === "[") {
      squareDepth += 1;
    } else if (char === "]") {
      squareDepth = Math.max(0, squareDepth - 1);
    } else if (char === "{") {
      curlyDepth += 1;
    } else if (char === "}") {
      curlyDepth = Math.max(0, curlyDepth - 1);
    }

    if (char === "\n" && squareDepth === 0 && curlyDepth === 0) {
      statements.push(configToml.slice(start, index).trim());
      start = index + 1;
    }
  }

  const tail = configToml.slice(start).trim();
  if (tail) statements.push(tail);
  return statements.filter(Boolean);
}

// A validated comment carries portable model choices. Machine-local catalog paths stay private.
function sanitizeModelCatalogComment(statement: string): string | null {
  const prefix = "# codex-auth-switch-models: ";
  if (!statement.startsWith(prefix) || statement.length > 100_000) return null;
  try {
    const settings = JSON.parse(statement.slice(prefix.length));
    if (settings?.version !== 1 || !Array.isArray(settings.models) || settings.models.length < 1 || settings.models.length > 100) return null;
    const ids = new Set<string>();
    const models = settings.models.map((model: Record<string, unknown>) => {
      const { id, display_name, reasoning_effort, context_window } = model;
      if (typeof id !== "string" || !id || id !== id.trim() || id.length > 256 || /[\x00-\x1f\x7f]/.test(id) || ids.has(id)
        || typeof display_name !== "string" || !display_name.trim() || display_name.length > 256
        || typeof reasoning_effort !== "string" || !["none", "minimal", "low", "medium", "high", "xhigh"].includes(reasoning_effort)
        || typeof context_window !== "number" || !Number.isInteger(context_window) || context_window < 4096 || context_window > 2_000_000) throw new Error("Invalid model settings");
      ids.add(id);
      return { id, display_name, reasoning_effort, context_window };
    });
    return prefix + JSON.stringify({ version: 1, models });
  } catch { return null; }
}

export function sanitizeSharedConfigToml(configToml: string): string {
  const kept: string[] = [];
  const catalogComment = sanitizeModelCatalogComment(configToml.split("\n", 1)[0].trim());
  if (catalogComment) kept.push(catalogComment);
  let includeCurrentTable = false;

  for (const statement of splitTomlStatements(configToml)) {
    const trimmed = statement.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (/^\s*\[/.test(statement)) {
      includeCurrentTable = isSharedModelProviderTable(statement);
      if (includeCurrentTable) {
        if (kept.length > 0 && kept[kept.length - 1] !== "") kept.push("");
        kept.push(statement);
      }
      continue;
    }

    if (includeCurrentTable) {
      kept.push(statement);
      continue;
    }

    const assignment = statement.match(/^\s*([A-Za-z0-9_-]+)\s*=/);
    if (!assignment) continue;

    if (sharedConfigRootKeys.has(assignment[1])) {
      kept.push(statement);
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
