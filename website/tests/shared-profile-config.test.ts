import { describe, expect, test } from "vitest";
import {
  buildLegacyProfileFiles,
  formatSharedProfileConfig,
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
});
