import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const buildersImportPath = `../src/${"profile-input-builders"}`;

function createDraft(overrides = {}) {
  return {
    name: " My API ",
    notes: " Notes ",
    thirdParty: {
      template: "standaloneThirdParty",
      provider: " custom.provider ",
      baseUrl: " https://api.example.com/v1 ",
      apiKey: " sk-test ",
      model: " gpt-test ",
      oauthProfileId: "",
    },
    ...overrides,
  };
}

test("escapes TOML strings and table keys", async () => {
  expect(existsSync(join(root, "src/profile-input-builders.ts"))).toBe(true);
  const { escapeTomlString, tomlTableKey } = await import(buildersImportPath);

  expect(escapeTomlString('a "quoted" \\ value')).toBe('a \\"quoted\\" \\\\ value');
  expect(tomlTableKey("openai")).toBe("openai");
  expect(tomlTableKey("custom.provider")).toBe('"custom.provider"');
});

test("builds standalone third-party profile input from a draft", async () => {
  expect(existsSync(join(root, "src/profile-input-builders.ts"))).toBe(true);
  const { standaloneThirdPartyConfigInputFromDraft } = await import(buildersImportPath);

  const input = standaloneThirdPartyConfigInputFromDraft(createDraft());

  expect(input.name).toBe("My API");
  expect(input.notes).toBe("Notes");
  expect(JSON.parse(input.authJson)).toEqual({ OPENAI_API_KEY: "sk-test" });
  expect(input.configToml).toContain('openai_base_url = "https://api.example.com/v1"');
  expect(input.configToml).toContain('model = "gpt-test"');
  expect(input.configToml).toContain("supports_websockets = false");
});

test("keeps standalone validation errors in the builder", async () => {
  expect(existsSync(join(root, "src/profile-input-builders.ts"))).toBe(true);
  const { standaloneThirdPartyConfigInputFromDraft } = await import(buildersImportPath);

  expect(() =>
    standaloneThirdPartyConfigInputFromDraft(
      createDraft({
        thirdParty: {
          template: "standaloneThirdParty",
          provider: "",
          baseUrl: "",
          apiKey: "sk-test",
          model: "gpt-test",
          oauthProfileId: "",
        },
      }),
    ),
  ).toThrow("openai_base_url");
});

test("builds symbiotic auth json and provider TOML from a draft", async () => {
  expect(existsSync(join(root, "src/profile-input-builders.ts"))).toBe(true);
  const { symbioticAuthJsonFromOfficial, symbioticThirdPartyConfigTomlFromDraft } = await import(buildersImportPath);

  expect(JSON.parse(symbioticAuthJsonFromOfficial('{"tokens":{"access_token":"x"},"OPENAI_API_KEY":"old"}'))).toEqual({
    tokens: { access_token: "x" },
    OPENAI_API_KEY: null,
    auth_mode: "chatgpt",
  });
  const toml = symbioticThirdPartyConfigTomlFromDraft(createDraft());

  expect(toml).toContain('model_provider = "custom.provider"');
  expect(toml).toContain('[model_providers."custom.provider"]');
  expect(toml).toContain('experimental_bearer_token = "sk-test"');
  expect(toml).toContain("requires_openai_auth = true");
});

test("builds profile input from a saved profile document without metadata", async () => {
  expect(existsSync(join(root, "src/profile-input-builders.ts"))).toBe(true);
  const { profileInputFromDocument } = await import(buildersImportPath);

  expect(
    profileInputFromDocument({
      id: "network-1",
      name: "Shared",
      notes: "From library",
      authJson: "{\"OPENAI_API_KEY\":\"sk\"}",
      configToml: "model = \"gpt-5\"",
      loadedFromTarget: true,
      readOnly: true,
    }),
  ).toEqual({
    name: "Shared",
    notes: "From library",
    authJson: "{\"OPENAI_API_KEY\":\"sk\"}",
    configToml: "model = \"gpt-5\"",
  });
});
