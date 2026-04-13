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
