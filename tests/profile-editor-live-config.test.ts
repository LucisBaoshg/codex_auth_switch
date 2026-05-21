import { afterEach, beforeEach, expect, test, vi } from "vitest";

const invokeMock = vi.fn();
const getVersionMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: getVersionMock,
}));

beforeEach(() => {
  vi.resetModules();
  invokeMock.mockReset();
  getVersionMock.mockReset();
  getVersionMock.mockResolvedValue("1.4.11");
  document.body.innerHTML = '<div id="app"></div>';
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
});

afterEach(() => {
  vi.clearAllMocks();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test("shows a save prompt when the active profile has live target changes", async () => {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return {
        targetDir: "/Users/example/.codex",
        usingDefaultTargetDir: true,
        targetExists: true,
        targetAuthExists: true,
        targetConfigExists: true,
        targetUpdatedAt: "2026-04-13T00:00:00Z",
        targetAuthTypeLabel: "官方 OAuth",
        activeProfileId: "profile-live",
        lastSelectedProfileId: "profile-live",
        lastSwitchProfileId: "profile-live",
        lastSwitchedAt: "2026-04-13T00:00:00Z",
        codexUsageApiEnabled: true,
        profiles: [
          {
            id: "profile-live",
            name: "Live Account",
            notes: "当前正在运行",
            authTypeLabel: "官方 OAuth",
            createdAt: "2026-04-12T00:00:00Z",
            updatedAt: "2026-04-12T00:00:00Z",
            authHash: "hash-auth-saved",
            configHash: "hash-config-saved",
            codexUsage: null,
            thirdPartyLatency: null,
          },
        ],
      };
    }

    if (command === "get_profile_document") {
      return {
        id: "profile-live",
        name: "Live Account",
        notes: "当前正在运行",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-04-12T00:00:00Z",
        updatedAt: "2026-04-12T00:00:00Z",
        authJson: '{"auth_mode":"chatgpt"}',
        configToml: 'model = "gpt-5.4"\n',
        loadedFromTarget: true,
        hasTargetChanges: true,
      };
    }

    throw new Error(`unexpected command: ${command}`);
  });

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="view-profile-details"][data-id="profile-live"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();

  expect(document.querySelector('[data-role="editor-live-change-notice"]')).not.toBeNull();
  expect(document.body.textContent).toContain("当前运行中的配置有变动");
  expect(document.body.textContent).toContain("请保存");
});

test("creates new profiles from third-party api delta fields", async () => {
  const snapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-04-13T00:00:00Z",
    targetAuthTypeLabel: null,
    activeProfileId: null,
    lastSelectedProfileId: null,
    lastSwitchProfileId: null,
    lastSwitchedAt: null,
    codexUsageApiEnabled: true,
    profiles: [],
  };
  const createdSnapshot = {
    ...snapshot,
    activeProfileId: "profile-third",
    profiles: [
      {
        id: "profile-third",
        name: "YLS Code",
        notes: "third party",
        authTypeLabel: "第三方 API",
        modelProviderKey: "ylscode",
        createdAt: "2026-04-13T01:00:00Z",
        updatedAt: "2026-04-13T01:00:00Z",
        authHash: "auth-third",
        configHash: "config-third",
        codexUsage: null,
        thirdPartyLatency: null,
        thirdPartyUsage: null,
      },
    ],
  };

  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return snapshot;
    }
    if (command === "import_profile") {
      return createdSnapshot;
    }

    throw new Error(`unexpected command: ${command}`);
  });

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="new-profile"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  expect(document.querySelector("#editor-auth-json")).toBeNull();
  expect(document.querySelector("#editor-config-toml")).toBeNull();
  expect(document.body.textContent).toContain("只填写第三方 API 的差异量");

  const setInput = (selector: string, value: string) => {
    const input = document.querySelector<HTMLInputElement>(selector);
    expect(input).not.toBeNull();
    input!.value = value;
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  };

  setInput("#editor-name", "YLS Code");
  setInput("#third-party-base-url", "https://claudex.me/v1");
  setInput("#third-party-api-key", "sk-third-party");
  setInput("#third-party-model", "gpt-5.5");

  document
    .querySelector<HTMLButtonElement>('[data-action="save-editor"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("import_profile", {
    payload: expect.objectContaining({
      name: "YLS Code",
      authJson: JSON.stringify({ OPENAI_API_KEY: "sk-third-party" }, null, 2),
      configToml: expect.stringContaining('openai_base_url = "https://claudex.me/v1"'),
    }),
  });
  const payload = invokeMock.mock.calls.find(([command]) => command === "import_profile")?.[1]
    ?.payload;
  expect(payload.configToml).toContain('model_provider = "openai"');
  expect(payload.configToml).toContain('model = "gpt-5.5"');
  expect(payload.configToml).toContain('review_model = "gpt-5.5"');
  expect(payload.configToml).toContain('model_reasoning_effort = "high"');
  expect(payload.configToml).toContain('plan_mode_reasoning_effort = "xhigh"');
  expect(payload.configToml).toContain('approval_policy = "never"');
  expect(payload.configToml).toContain('sandbox_mode = "danger-full-access"');
  expect(payload.configToml).toContain("supports_websockets = false");
  expect(payload.configToml).toContain("[tui]");
  expect(payload.configToml).toContain("[sandbox_workspace_write]");
  expect(payload.configToml).not.toContain("[model_providers.");
});

test("creates symbiotic third-party api profiles from an existing official oauth profile", async () => {
  const snapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-04-13T00:00:00Z",
    targetAuthTypeLabel: "官方 OAuth",
    activeProfileId: "profile-oauth",
    lastSelectedProfileId: "profile-oauth",
    lastSwitchProfileId: "profile-oauth",
    lastSwitchedAt: "2026-04-13T00:00:00Z",
    codexUsageApiEnabled: true,
    profiles: [
      {
        id: "profile-oauth",
        name: "Official Team",
        notes: "official login",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-04-12T00:00:00Z",
        updatedAt: "2026-04-12T00:00:00Z",
        authHash: "hash-auth-oauth",
        configHash: "hash-config-oauth",
        codexUsage: null,
        thirdPartyLatency: null,
        thirdPartyUsage: null,
      },
    ],
  };
  const createdSnapshot = {
    ...snapshot,
    activeProfileId: "profile-symbiotic",
    profiles: [
      {
        ...snapshot.profiles[0],
      },
      {
        id: "profile-symbiotic",
        name: "YLS OAuth",
        notes: "symbiotic",
        authTypeLabel: "共生配置",
        modelProviderKey: "ylscode",
        createdAt: "2026-04-13T01:00:00Z",
        updatedAt: "2026-04-13T01:00:00Z",
        authHash: "auth-symbiotic",
        configHash: "config-symbiotic",
        codexUsage: null,
        thirdPartyLatency: null,
        thirdPartyUsage: null,
      },
    ],
  };

  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return snapshot;
    }
    if (command === "get_profile_document") {
      return {
        id: "profile-oauth",
        name: "Official Team",
        notes: "official login",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-04-12T00:00:00Z",
        updatedAt: "2026-04-12T00:00:00Z",
        authJson:
          '{"auth_mode":"chatgpt","OPENAI_API_KEY":"sk-old","tokens":{"id_token":"id-token","access_token":"access-token"}}',
        configToml: 'model = "gpt-5.4"\nmodel_reasoning_effort = "medium"\n',
        loadedFromTarget: false,
        hasTargetChanges: false,
      };
    }
    if (command === "import_profile") {
      return createdSnapshot;
    }

    throw new Error(`unexpected command: ${command}`);
  });

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="new-profile"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  document
    .querySelector<HTMLInputElement>('#profile-template-symbiotic')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  expect(document.body.textContent).toContain("共生配置已经替代增强启动");
  expect(document.body.textContent).toContain("插件入口会通过官方 OAuth 登录状态保持可用");

  const setInput = (selector: string, value: string) => {
    const input = document.querySelector<HTMLInputElement>(selector);
    expect(input).not.toBeNull();
    input!.value = value;
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  };

  setInput("#editor-name", "YLS OAuth");
  setInput("#third-party-provider", "ylscode");
  setInput("#third-party-base-url", "https://code.ylsagi.com/v1");
  setInput("#third-party-api-key", "oauth-provider-token");
  setInput("#third-party-model", "gpt-5.5");

  document
    .querySelector<HTMLButtonElement>('[data-action="save-editor"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("get_profile_document", {
    profileId: "profile-oauth",
  });
  const payload = invokeMock.mock.calls.find(([command]) => command === "import_profile")?.[1]
    ?.payload;
  expect(payload.authJson).toBe(
    JSON.stringify(
      {
        auth_mode: "chatgpt",
        OPENAI_API_KEY: null,
        tokens: {
          id_token: "id-token",
          access_token: "access-token",
        },
      },
      null,
      2,
    ),
  );
  expect(payload.configToml).toContain('model_provider = "ylscode"');
  expect(payload.configToml).toContain('model = "gpt-5.5"');
  expect(payload.configToml).toContain("[model_providers.ylscode]");
  expect(payload.configToml).toContain('name = "ylscode"');
  expect(payload.configToml).toContain('base_url = "https://code.ylsagi.com/v1"');
  expect(payload.configToml).toContain('experimental_bearer_token = "oauth-provider-token"');
  expect(payload.configToml).toContain("requires_openai_auth = true");
  expect(payload.configToml).toContain("supports_websockets = false");
  expect(payload.configToml.indexOf("supports_websockets = false")).toBeGreaterThan(
    payload.configToml.indexOf("[model_providers.ylscode]"),
  );
  expect(payload.configToml.indexOf("supports_websockets = false")).toBeLessThan(
    payload.configToml.indexOf("[features]"),
  );
  expect(payload.configToml).toContain("[features]");
  expect(payload.configToml).toContain("remote_connections = true");
  expect(payload.configToml).toContain("remote_control = true");
});

test("prompts official oauth login before creating a symbiotic profile when no official profile exists", async () => {
  const snapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-04-13T00:00:00Z",
    targetAuthTypeLabel: "第三方 API",
    activeProfileId: "profile-third",
    lastSelectedProfileId: "profile-third",
    lastSwitchProfileId: "profile-third",
    lastSwitchedAt: "2026-04-13T00:00:00Z",
    codexUsageApiEnabled: true,
    profiles: [
      {
        id: "profile-third",
        name: "Third",
        notes: "third party",
        authTypeLabel: "第三方 API",
        createdAt: "2026-04-12T00:00:00Z",
        updatedAt: "2026-04-12T00:00:00Z",
        authHash: "hash-auth-third",
        configHash: "hash-config-third",
        codexUsage: null,
        thirdPartyLatency: null,
        thirdPartyUsage: null,
      },
    ],
  };

  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return snapshot;
    }

    throw new Error(`unexpected command: ${command}`);
  });

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="new-profile"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  document
    .querySelector<HTMLInputElement>('#profile-template-symbiotic')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  expect(document.body.textContent).toContain("请先登录并保存一个官方 OAuth 账号");
  expect(document.querySelector<HTMLButtonElement>('[data-action="save-editor"]')?.disabled).toBe(
    true,
  );
});
