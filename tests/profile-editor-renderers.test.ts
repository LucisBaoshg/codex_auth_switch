import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

import type { AppSnapshot, ProfileSummary } from "../src/desktop-types";
import { createEditorState, type EditorState } from "../src/profile-editor-state";

const root = join(import.meta.dirname, "..");
const renderersImportPath = `../src/${"profile-editor-renderers"}`;

function createProfile(overrides: Partial<ProfileSummary> = {}): ProfileSummary {
  return {
    id: "official-a",
    name: "Official A",
    notes: "OAuth account",
    authTypeLabel: "官方 OAuth",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    authHash: "auth",
    configHash: "config",
    codexUsage: null,
    thirdPartyLatency: null,
    thirdPartyUsage: null,
    ...overrides,
  };
}

function createSnapshot(overrides: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: null,
    targetAuthTypeLabel: null,
    activeProfileId: "official-a",
    lastSelectedProfileId: "official-a",
    lastSwitchProfileId: "official-a",
    lastSwitchedAt: null,
    codexUsageApiEnabled: true,
    profiles: [createProfile()],
    ...overrides,
  };
}

function createEditor(overrides: Partial<EditorState> = {}): EditorState {
  return {
    ...createEditorState(),
    ...overrides,
  };
}

test("renders new profile tab selector active state without app state", async () => {
  expect(existsSync(join(root, "src/profile-editor-renderers.ts"))).toBe(true);
  const { renderNewProfileTabSelector } = await import(renderersImportPath);

  const html = renderNewProfileTabSelector({ currentTab: "manual-full" });

  expect(html).toContain('data-role="editor-template-tabs"');
  expect(html).toContain('data-action="editor-tab-delta"');
  expect(html).toContain('button class="tab-btn active" data-action="editor-tab-full"');
});

test("renders standalone third-party config fields from explicit editor input", async () => {
  expect(existsSync(join(root, "src/profile-editor-renderers.ts"))).toBe(true);
  const { renderThirdPartyConfigFields } = await import(renderersImportPath);
  const editor = createEditor({
    thirdParty: {
      template: "standaloneThirdParty",
      oauthProfileId: "",
      provider: "ylscode",
      baseUrl: "https://api.example.com/<v1>",
      apiKey: "sk-test",
      model: "gpt-5.5",
    },
  });

  const html = renderThirdPartyConfigFields({
    editor,
    snapshot: createSnapshot(),
    busy: true,
    readOnly: false,
  });

  expect(html).toContain('data-role="third-party-delta-form"');
  expect(html).toContain("独立第三方 API");
  expect(html).toContain("openai_base_url");
  expect(html).toContain("https://api.example.com/&lt;v1&gt;");
  expect(html).toContain('value="standaloneThirdParty"');
  expect(html).toContain("checked");
  expect(html).toContain("disabled");
});

test("renders symbiotic third-party fields and missing OAuth warning", async () => {
  expect(existsSync(join(root, "src/profile-editor-renderers.ts"))).toBe(true);
  const { renderThirdPartyConfigFields } = await import(renderersImportPath);
  const editor = createEditor({
    thirdParty: {
      template: "symbioticThirdParty",
      oauthProfileId: "",
      provider: "openai",
      baseUrl: "https://proxy.example.com/v1",
      apiKey: "token",
      model: "gpt-5.4",
    },
  });

  const html = renderThirdPartyConfigFields({
    editor,
    snapshot: createSnapshot({ profiles: [] }),
    busy: false,
    readOnly: false,
  });

  expect(html).toContain("共生配置");
  expect(html).toContain('data-role="symbiotic-enhanced-launch-hint"');
  expect(html).toContain('data-role="symbiotic-oauth-missing"');
  expect(html).toContain("experimental_bearer_token");
  expect(html).toContain('id="symbiotic-oauth-profile" disabled');
});

test("renders selected OAuth profile option for symbiotic config", async () => {
  expect(existsSync(join(root, "src/profile-editor-renderers.ts"))).toBe(true);
  const { renderThirdPartyConfigFields } = await import(renderersImportPath);
  const editor = createEditor({
    thirdParty: {
      template: "symbioticThirdParty",
      oauthProfileId: "official-b",
      provider: "openai",
      baseUrl: "https://proxy.example.com/v1",
      apiKey: "token",
      model: "gpt-5.4",
    },
  });

  const html = renderThirdPartyConfigFields({
    editor,
    snapshot: createSnapshot({
      activeProfileId: "official-a",
      profiles: [
        createProfile({ id: "official-a", name: "Official A" }),
        createProfile({ id: "official-b", name: "Official <B>" }),
      ],
    }),
    busy: false,
    readOnly: false,
  });

  expect(html).toContain('option value="official-b" selected');
  expect(html).toContain("Official &lt;B&gt;");
});

test("renders full config code panels from explicit editor input", async () => {
  expect(existsSync(join(root, "src/profile-editor-renderers.ts"))).toBe(true);
  const { renderEditorCodePanels } = await import(renderersImportPath);
  const editor = createEditor({
    authJson: '{ "token": "<secret>" }',
    configToml: 'model = "gpt-5.5"',
  });

  const html = renderEditorCodePanels({
    editor,
    busy: true,
    readOnly: false,
  });

  expect(html).toContain('class="editor-panels"');
  expect(html).toContain('id="editor-auth-json"');
  expect(html).toContain('{ &quot;token&quot;: &quot;&lt;secret&gt;&quot; }');
  expect(html).toContain('id="editor-config-toml"');
  expect(html).toContain('model = &quot;gpt-5.5&quot;');
  expect(html).toContain("disabled");
});

test("renders editor basic info card actions for editable and network read-only states", async () => {
  expect(existsSync(join(root, "src/profile-editor-renderers.ts"))).toBe(true);
  const { renderEditorBasicInfoCard } = await import(renderersImportPath);

  const editableHtml = renderEditorBasicInfoCard({
    editor: createEditor({
      mode: "existing",
      profileId: "profile-a",
      name: "Third <Party>",
      notes: "Primary",
    }),
    editorProfile: createProfile({ id: "profile-a", authTypeLabel: "第三方 API" }),
    busy: false,
    readOnly: false,
    existing: true,
    saveDisabled: true,
  });

  expect(editableHtml).toContain("基本信息");
  expect(editableHtml).toContain('id="editor-name"');
  expect(editableHtml).toContain("Third &lt;Party&gt;");
  expect(editableHtml).toContain('data-action="generate-symbiotic"');
  expect(editableHtml).toContain('data-action="save-and-switch"');
  expect(editableHtml).toContain('data-action="delete-profile"');
  expect(editableHtml).toContain("disabled");

  const readOnlyHtml = renderEditorBasicInfoCard({
    editor: createEditor({
      mode: "existing",
      source: "network",
      readOnly: true,
      name: "Network Profile",
    }),
    editorProfile: null,
    busy: false,
    readOnly: true,
    existing: true,
    saveDisabled: false,
  });

  expect(readOnlyHtml).toContain('data-action="import-current-network-profile"');
  expect(readOnlyHtml).not.toContain('data-action="save-editor"');
});

test("renders editor metadata card only when visible", async () => {
  expect(existsSync(join(root, "src/profile-editor-renderers.ts"))).toBe(true);
  const { renderEditorMetadataCard } = await import(renderersImportPath);

  expect(
    renderEditorMetadataCard({
      editor: createEditor(),
      visible: false,
    }),
  ).toBe("");

  const html = renderEditorMetadataCard({
    editor: createEditor({
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-05T00:00:00.000Z",
    }),
    visible: true,
  });

  expect(html).toContain("版本与时间");
  expect(html).toContain("创建时间");
  expect(html).toContain("最近更新");
  expect(html).toContain("2026");
});

test("renders editor runtime panel from explicit local profile input", async () => {
  expect(existsSync(join(root, "src/profile-editor-renderers.ts"))).toBe(true);
  const rendererModule = await import(renderersImportPath);

  expect(rendererModule).toHaveProperty("renderEditorRuntimePanel");
  const { renderEditorRuntimePanel } = rendererModule as typeof import("../src/profile-editor-renderers");

  expect(
    renderEditorRuntimePanel({
      snapshot: createSnapshot(),
      profile: null,
      editorSource: "local",
      busy: false,
      pendingActions: new Set(),
    }),
  ).toBe("");

  const localHtml = renderEditorRuntimePanel({
    snapshot: createSnapshot({ activeProfileId: "official-a" }),
    profile: createProfile({
      id: "third-party-a",
      name: "Third <Party>",
      authTypeLabel: "第三方 API",
      modelProviderKey: "yls<code>",
    }),
    editorSource: "local",
    busy: true,
    pendingActions: new Set(),
  });

  expect(localHtml).toContain('data-role="editor-runtime-panel"');
  expect(localHtml).toContain("yls&lt;code&gt;");
  expect(localHtml).toContain('data-action="switch"');
  expect(localHtml).toContain('data-name="Third &lt;Party&gt;"');
  expect(localHtml).toContain("disabled");
  expect(localHtml).toContain('data-role="third-party-usage-panel"');
  expect(localHtml).toContain('data-role="third-party-latency-panel"');
});

test("does not render editor runtime panel for network editor source", async () => {
  expect(existsSync(join(root, "src/profile-editor-renderers.ts"))).toBe(true);
  const rendererModule = await import(renderersImportPath);

  expect(rendererModule).toHaveProperty("renderEditorRuntimePanel");
  const { renderEditorRuntimePanel } = rendererModule as typeof import("../src/profile-editor-renderers");

  const html = renderEditorRuntimePanel({
    snapshot: createSnapshot(),
    profile: createProfile(),
    editorSource: "network",
    busy: false,
    pendingActions: new Set(),
  });

  expect(html).toBe("");
});

test("renders editor layout by composing config and sidebar panels", async () => {
  expect(existsSync(join(root, "src/profile-editor-renderers.ts"))).toBe(true);
  const rendererModule = await import(renderersImportPath);

  expect(rendererModule).toHaveProperty("renderEditorLayout");
  const { renderEditorLayout } = rendererModule as typeof import("../src/profile-editor-renderers");
  const editorProfile = createProfile({
    id: "third-party-a",
    name: "Third <Party>",
    authTypeLabel: "第三方 API",
    modelProviderKey: "ylscode",
  });

  const html = renderEditorLayout({
    snapshot: createSnapshot({ activeProfileId: "official-a" }),
    editor: createEditor({
      mode: "existing",
      profileId: "third-party-a",
      name: "Third <Party>",
      notes: "Primary",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-05T00:00:00.000Z",
    }),
    editorProfile,
    configFieldsHtml: "<section data-role=\"config-fields\">fields</section>",
    busy: true,
    readOnly: false,
    existing: true,
    saveDisabled: true,
    pendingActions: new Set(),
  });

  expect(html).toContain('class="editor-layout-grid"');
  expect(html).toContain('class="editor-main-column"');
  expect(html).toContain('data-role="config-fields"');
  expect(html).toContain('class="editor-sidebar-column"');
  expect(html).toContain("Third &lt;Party&gt;");
  expect(html).toContain('data-action="generate-symbiotic"');
  expect(html).toContain('data-role="editor-runtime-panel"');
  expect(html).toContain("版本与时间");
  expect(html).toContain("disabled");
});

test("disables profile deletion for the active editor profile", async () => {
  expect(existsSync(join(root, "src/profile-editor-renderers.ts"))).toBe(true);
  const rendererModule = await import(renderersImportPath);

  expect(rendererModule).toHaveProperty("renderEditorLayout");
  const { renderEditorLayout } = rendererModule as typeof import("../src/profile-editor-renderers");
  const editorProfile = createProfile({
    id: "third-party-a",
    name: "Third Party",
    authTypeLabel: "第三方 API",
  });

  const html = renderEditorLayout({
    snapshot: createSnapshot({ activeProfileId: "third-party-a", profiles: [editorProfile] }),
    editor: createEditor({
      mode: "existing",
      profileId: "third-party-a",
      name: "Third Party",
      notes: "Active runtime",
    }),
    editorProfile,
    configFieldsHtml: "<section data-role=\"config-fields\">fields</section>",
    busy: false,
    readOnly: false,
    existing: true,
    saveDisabled: false,
    pendingActions: new Set(),
  });

  expect(html).toContain('data-action="delete-profile"');
  expect(html).toContain("这是当前 Codex 正在使用的配置，不能直接删除");
  expect(html).toMatch(/data-action="delete-profile"[\s\S]*disabled/);
});

test("renders editor page shell around prebuilt editor content", async () => {
  expect(existsSync(join(root, "src/profile-editor-renderers.ts"))).toBe(true);
  const rendererModule = await import(renderersImportPath);

  expect(rendererModule).toHaveProperty("renderEditorPageShell");
  const { renderEditorPageShell } = rendererModule as typeof import("../src/profile-editor-renderers");

  const html = renderEditorPageShell({
    title: "查看网络共享配置",
    subtitle: "该配置来自网络共享库，仅供查看，不能直接编辑或保存。",
    busy: true,
    readOnly: true,
    hasTargetChanges: true,
    showTabs: true,
    currentTab: "manual-full",
    bodyContentHtml: "<div data-role=\"editor-body\">body</div>",
  });

  expect(html).toContain('data-page="editor"');
  expect(html).toContain("查看网络共享配置");
  expect(html).toContain("返回卡片网格");
  expect(html).toContain("disabled");
  expect(html).toContain('data-role="editor-readonly-notice"');
  expect(html).toContain('data-role="editor-live-change-notice"');
  expect(html).toContain('data-role="editor-template-tabs"');
  expect(html).toContain('button class="tab-btn active" data-action="editor-tab-full"');
  expect(html).toContain('data-role="editor-body"');
});

test("renders complete editor page from snapshot and editor state", async () => {
  expect(existsSync(join(root, "src/profile-editor-renderers.ts"))).toBe(true);
  const rendererModule = await import(renderersImportPath);

  expect(rendererModule).toHaveProperty("renderEditorPage");
  const { renderEditorPage } = rendererModule as typeof import("../src/profile-editor-renderers");
  const editor = createEditor({
    mode: "existing",
    profileId: "third-party-a",
    name: "Third <Party>",
    notes: "Primary",
    hasTargetChanges: true,
    thirdParty: {
      template: "standaloneThirdParty",
      oauthProfileId: "",
      provider: "ylscode",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "gpt-5.5",
    },
  });

  const html = renderEditorPage({
    snapshot: createSnapshot({
      activeProfileId: "official-a",
      profiles: [
        createProfile(),
        createProfile({
          id: "third-party-a",
          name: "Third <Party>",
          authTypeLabel: "第三方 API",
          modelProviderKey: "ylscode",
        }),
      ],
    }),
    editor,
    busy: true,
    pendingActions: new Set(),
  });

  expect(html).toContain('data-page="editor"');
  expect(html).toContain("Third &lt;Party&gt;");
  expect(html).toContain('data-role="editor-live-change-notice"');
  expect(html).toContain('class="editor-layout-grid"');
  expect(html).toContain('class="editor-panels"');
  expect(html).toContain('data-action="generate-symbiotic"');
  expect(html).toContain('data-role="editor-runtime-panel"');
  expect(html).toContain("disabled");
});
