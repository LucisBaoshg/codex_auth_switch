import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const documentsImportPath = `../src/${"profile-documents"}`;

function createProfileSummary(overrides = {}) {
  return {
    id: "work",
    name: "Work Account",
    notes: "Daily driver",
    authTypeLabel: "官方 OAuth",
    modelProviderId: undefined,
    modelProviderApiKeyId: undefined,
    modelProviderKey: undefined,
    modelProviderName: undefined,
    modelProviderBaseUrl: undefined,
    modelProviderWireApi: undefined,
    createdAt: "2026-01-02T03:04:05Z",
    updatedAt: "2026-01-03T03:04:05Z",
    authHash: "auth",
    configHash: "config",
    codexUsage: null,
    thirdPartyLatency: null,
    thirdPartyUsage: null,
    ...overrides,
  };
}

test("creates a browser preview profile document from a profile summary", async () => {
  expect(existsSync(join(root, "src/profile-documents.ts"))).toBe(true);
  const { createMockProfileDocument } = await import(documentsImportPath);

  const document = createMockProfileDocument(
    createProfileSummary({
      modelProviderKey: "openai",
      modelProviderName: "OpenAI",
      modelProviderBaseUrl: "https://api.example.com/v1",
      modelProviderWireApi: "responses",
    }),
  );

  expect(document).toMatchObject({
    id: "work",
    name: "Work Account",
    notes: "Daily driver",
    authTypeLabel: "官方 OAuth",
    modelProviderId: null,
    modelProviderApiKeyId: null,
    modelProviderKey: "openai",
    modelProviderName: "OpenAI",
    modelProviderBaseUrl: "https://api.example.com/v1",
    modelProviderWireApi: "responses",
    createdAt: "2026-01-02T03:04:05Z",
    updatedAt: "2026-01-03T03:04:05Z",
    loadedFromTarget: false,
    hasTargetChanges: false,
  });
  expect(JSON.parse(document.authJson)).toEqual({
    user: { email: "work account@example.com" },
    token: "token-for-work",
  });
  expect(document.configToml).toContain('default_model = "gpt-5"');
  expect(document.configToml).toContain('profile = "work"');
});

test("creates a blank profile document for non-strict symbiotic drafts", async () => {
  expect(existsSync(join(root, "src/profile-documents.ts"))).toBe(true);
  const { createEmptyProfileDocument } = await import(documentsImportPath);

  const document = createEmptyProfileDocument();

  expect(document).toEqual({
    id: "",
    name: "",
    notes: "",
    authTypeLabel: "",
    modelProviderId: null,
    modelProviderApiKeyId: null,
    modelProviderKey: null,
    modelProviderName: null,
    modelProviderBaseUrl: null,
    modelProviderWireApi: null,
    createdAt: "",
    updatedAt: "",
    authJson: "{}",
    configToml: "",
    loadedFromTarget: false,
    hasTargetChanges: false,
  });
  expect(createEmptyProfileDocument()).not.toBe(document);
});
