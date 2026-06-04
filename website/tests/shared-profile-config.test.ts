import { describe, expect, test } from "vitest";
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
});
