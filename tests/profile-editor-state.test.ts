import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const editorStateImportPath = `../src/${"profile-editor-state"}`;

test("creates the default manual profile editor state", async () => {
  expect(existsSync(join(root, "src/profile-editor-state.ts"))).toBe(true);
  const { createEditorState } = await import(editorStateImportPath);

  const state = createEditorState();

  expect(state.mode).toBe("new");
  expect(state.profileId).toBeNull();
  expect(state.thirdParty.template).toBe("standaloneThirdParty");
  expect(state.thirdParty.model).toBe("gpt-5.5");
  expect(state.source).toBe("local");
  expect(state.newTab).toBe("manual-delta");
});

test("creates the default local share draft", async () => {
  expect(existsSync(join(root, "src/profile-editor-state.ts"))).toBe(true);
  const { createLocalShareDraft } = await import(editorStateImportPath);

  expect(createLocalShareDraft()).toEqual({
    profileId: null,
    visibility: "selected",
    selectedUserIds: [],
  });
});

test("creates the mock current Codex input", async () => {
  expect(existsSync(join(root, "src/profile-editor-state.ts"))).toBe(true);
  const { createMockCurrentInput } = await import(editorStateImportPath);

  const input = createMockCurrentInput();

  expect(input.notes).toBe("来自当前 Codex 目录");
  expect(input.authJson).toContain("mock-access-token");
  expect(input.configToml).toContain('model = "gpt-5.4"');
});

test("creates editor state from a profile input without carrying target metadata", async () => {
  expect(existsSync(join(root, "src/profile-editor-state.ts"))).toBe(true);
  const { createEditorFromInput } = await import(editorStateImportPath);

  const state = createEditorFromInput("fromCurrent", {
    name: "Current",
    notes: "Imported",
    authJson: "{}",
    configToml: "model = \"gpt-5\"",
  });

  expect(state).toMatchObject({
    mode: "fromCurrent",
    profileId: null,
    name: "Current",
    notes: "Imported",
    loadedFromTarget: false,
    hasTargetChanges: false,
    readOnly: false,
    source: "local",
  });
  expect(state.thirdParty.template).toBe("standaloneThirdParty");
  expect(state.newTab).toBeUndefined();
});

test("creates editor state from a saved profile document", async () => {
  expect(existsSync(join(root, "src/profile-editor-state.ts"))).toBe(true);
  const { createEditorFromDocument } = await import(editorStateImportPath);

  const state = createEditorFromDocument({
    id: "team",
    name: "Team Profile",
    notes: "Shared settings",
    authTypeLabel: "第三方 API",
    createdAt: "2026-01-02T03:04:05Z",
    updatedAt: "2026-01-03T03:04:05Z",
    authJson: "{\"OPENAI_API_KEY\":\"sk\"}",
    configToml: "model = \"gpt-5\"",
    loadedFromTarget: true,
    hasTargetChanges: true,
    readOnly: true,
    source: "network",
  });

  expect(state).toMatchObject({
    mode: "existing",
    profileId: "team",
    name: "Team Profile",
    notes: "Shared settings",
    authJson: "{\"OPENAI_API_KEY\":\"sk\"}",
    configToml: "model = \"gpt-5\"",
    createdAt: "2026-01-02T03:04:05Z",
    updatedAt: "2026-01-03T03:04:05Z",
    loadedFromTarget: true,
    hasTargetChanges: true,
    readOnly: true,
    source: "network",
  });
  expect(state.thirdParty.template).toBe("standaloneThirdParty");
  expect(state.newTab).toBeUndefined();
});

test("creates a symbiotic editor state from an existing third-party document", async () => {
  expect(existsSync(join(root, "src/profile-editor-state.ts"))).toBe(true);
  const { createSymbioticEditorFromDocument } = await import(editorStateImportPath);

  const state = createSymbioticEditorFromDocument(
    {
      id: "api",
      name: "API Profile",
      notes: "Paid API",
      authTypeLabel: "第三方 API",
      createdAt: "2026-01-02T03:04:05Z",
      updatedAt: "2026-01-03T03:04:05Z",
      authJson: "{\"OPENAI_API_KEY\":\"sk-test\"}",
      configToml: [
        "openai_base_url = \"https://api.example.com/v1\"",
        "model_provider = \"custom.provider\"",
        "model = \"gpt-test\"",
      ].join("\n"),
      loadedFromTarget: false,
      hasTargetChanges: false,
    },
    "oauth-work",
  );

  expect(state).toMatchObject({
    mode: "new",
    profileId: null,
    name: "API Profile (共生)",
    notes: "Paid API",
    authJson: "",
    configToml: "",
    createdAt: null,
    updatedAt: null,
    loadedFromTarget: false,
    hasTargetChanges: false,
    readOnly: false,
    source: "local",
    newTab: "manual-delta",
    thirdParty: {
      template: "symbioticThirdParty",
      oauthProfileId: "oauth-work",
      provider: "custom.provider",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "gpt-test",
    },
  });
});

test("falls back when symbiotic editor source fields are missing", async () => {
  expect(existsSync(join(root, "src/profile-editor-state.ts"))).toBe(true);
  const { createSymbioticEditorFromDocument } = await import(editorStateImportPath);

  const state = createSymbioticEditorFromDocument(
    {
      id: "api",
      name: "API Profile",
      notes: "",
      authTypeLabel: "第三方 API",
      createdAt: "",
      updatedAt: "",
      authJson: "not-json",
      configToml: "base_url = \"https://fallback.example.com/v1\"",
      loadedFromTarget: false,
      hasTargetChanges: false,
    },
    "",
  );

  expect(state.notes).toBe("");
  expect(state.thirdParty).toMatchObject({
    provider: "openai",
    baseUrl: "https://fallback.example.com/v1",
    apiKey: "",
    model: "gpt-5.5",
  });
});
