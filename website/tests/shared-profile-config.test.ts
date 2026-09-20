import { describe, expect, test } from "vitest";
import { createEditorState } from "../../src/profile-editor-state";
import { standaloneThirdPartyConfigInputFromDraft } from "../../src/profile-input-builders";

test("shared configs retain every reasoning level from desktop and strip local paths", () => {
  const editor = createEditorState();
  editor.thirdParty = { ...editor.thirdParty, baseUrl: "10.12.0.20:8317", apiKey: "test-only", model: "grok-4.6", models: [
    { id: "grok-4.6", display_name: "Grok", reasoning_effort: "xhigh", supported_reasoning_efforts: ["low", "medium", "high", "xhigh"], context_window: 128000 },
    { id: "gemini-3.8-flash-high", display_name: "Gemini", reasoning_effort: "high", supported_reasoning_efforts: ["low", "medium", "high"], context_window: 128000 },
  ] };
  const generated = standaloneThirdPartyConfigInputFromDraft(editor).configToml;
  const shared = sanitizeSharedConfigToml(generated + '\nmodel_catalog_json = "/Users/first/catalog.json"\n');
  expect(shared).not.toContain("/Users/first");
  expect(shared).not.toContain("test-only");
  const settings = JSON.parse(shared.split("\n")[0].slice("# codex-auth-switch-models: ".length));
  expect(settings.models).toEqual(editor.thirdParty.models);
  for (const levels of [[], ["high", "high"], ["low"], ["xhigh", "unknown"]]) {
    settings.models[0].supported_reasoning_efforts = levels;
    expect(sanitizeSharedConfigToml(`# codex-auth-switch-models: ${JSON.stringify(settings)}\nmodel = "grok-4.6"`)).not.toContain("codex-auth-switch-models");
  }
});
import {
  buildLegacyProfileFiles,
  formatSharedProfileConfig,
  sanitizeSharedConfigToml,
} from "../src/lib/shared-profile-config";

describe("shared profile config display", () => {
  test("shows only OPENAI_API_KEY and base_url from the uploaded config files", () => {
    const display = formatSharedProfileConfig({
      "auth.json": JSON.stringify({
        OPENAI_API_KEY: "yls-test-key",
        tokens: {
          access_token: "hidden-access-token",
        },
      }),
      "config.toml": [
        'model = "gpt-5.4"',
        'network_access = "enabled"',
        "",
        "[model_providers.ylscode]",
        'base_url = "https://code.ylsagi.com/codex"',
        'wire_api = "responses"',
      ].join("\n"),
    });

    expect(display).toBe(
      ['OPENAI_API_KEY = "yls-test-key"', 'base_url = "https://code.ylsagi.com/codex"'].join("\n"),
    );
    expect(display).not.toContain("hidden-access-token");
    expect(display).not.toContain("gpt-5.4");
    expect(display).not.toContain("wire_api");
  });

  test("builds legacy raw files from the simplified shared config fields", () => {
    const files = buildLegacyProfileFiles({
      openAiApiKey: "yls-new-key",
      baseUrl: "https://code.ylsagi.com/codex",
    });

    expect(JSON.parse(files.authContent)).toEqual({ OPENAI_API_KEY: "yls-new-key" });
    expect(files.configContent).toContain('model_provider = "ylscode"');
    expect(files.configContent).toContain('[model_providers.ylscode]');
    expect(files.configContent).toContain('base_url = "https://code.ylsagi.com/codex"');
    expect(files.configContent).toContain('requires_openai_auth = true');
    expect(files.configContent).toContain('wire_api = "responses"');
  });

  test("sanitizes shared config.toml to auth and third-party api settings only", () => {
    const sanitized = sanitizeSharedConfigToml([
      'model = "gpt-5.5"',
      'model_provider = "ylscode"',
      'openai_base_url = "https://code.ylsagi.com/v1"',
      'model_reasoning_effort = "xhigh"',
      'notify = [',
      '  "/Users/lucifer/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseClient",',
      '  "turn-ended",',
      ']',
      'service_tier = "default"',
      '',
      '[desktop]',
      'conversationDetailMode = "STEPS_COMMANDS"',
      'selected-avatar-id = "custom"',
      '',
      '[projects."/Users/lucifer/secret-project"]',
      'trust_level = "trusted"',
      '',
      '[model_providers.ylscode]',
      'base_url = "https://code.ylsagi.com/v1"',
      'name = "ylscode"',
      'wire_api = "responses"',
      'requires_openai_auth = true',
    ].join("\n"));

    expect(sanitized).toContain('model = "gpt-5.5"');
    expect(sanitized).toContain('model_provider = "ylscode"');
    expect(sanitized).toContain('openai_base_url = "https://code.ylsagi.com/v1"');
    expect(sanitized).toContain("[model_providers.ylscode]");
    expect(sanitized).toContain('wire_api = "responses"');
    expect(sanitized).not.toContain("notify");
    expect(sanitized).not.toContain("SkyComputerUseClient");
    expect(sanitized).not.toContain("[desktop]");
    expect(sanitized).not.toContain("[projects");
    expect(sanitized).not.toContain("secret-project");
    expect(sanitized).not.toContain("service_tier");
  });

  test("does not reinterpret assignments embedded in multiline strings", () => {
    const sanitized = sanitizeSharedConfigToml([
      'instructions = """',
      'openai_base_url = "https://secret.example"',
      'model = "secret-model"',
      '"""',
      'model = "gpt-5.5"',
    ].join("\n"));

    expect(sanitized).toBe('model = "gpt-5.5"');
    expect(sanitized).not.toContain("secret.example");
    expect(sanitized).not.toContain("secret-model");
  });
});

test("preserves portable model settings while removing local paths and extra fields", () => {
  const model = { id: "grok-4.6", display_name: "Grok", reasoning_effort: "none", context_window: 32768, secret: "not-shared" };
  const input = `# codex-auth-switch-models: ${JSON.stringify({ version: 1, models: [model], command: "not-shared" })}\nmodel = "grok-4.6"\nmodel_catalog_json = "/Users/local/catalog.json"\n`;
  const result = sanitizeSharedConfigToml(input);
  expect(result).toContain('# codex-auth-switch-models: ');
  expect(result).toContain('"id":"grok-4.6"');
  expect(result).not.toContain("not-shared");
  expect(result).not.toContain("/Users/local");
  expect(sanitizeSharedConfigToml(result)).toBe(result);
  expect(sanitizeSharedConfigToml('# codex-auth-switch-models: {"version":1,"models":[null]}\nmodel = "x"')).not.toContain("codex-auth-switch-models");
});

test("does not interpret model metadata embedded inside a multiline value", () => {
  const input = `instructions = """\n# codex-auth-switch-models: {"version":1,"models":[]}\n"""\nmodel = "safe"`;
  expect(sanitizeSharedConfigToml(input)).toBe('model = "safe"');
});
