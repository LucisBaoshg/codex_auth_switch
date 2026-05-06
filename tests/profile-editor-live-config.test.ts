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
  expect(payload.configToml).toContain("[tui]");
  expect(payload.configToml).toContain("[sandbox_workspace_write]");
  expect(payload.configToml).not.toContain("[model_providers.");
});
