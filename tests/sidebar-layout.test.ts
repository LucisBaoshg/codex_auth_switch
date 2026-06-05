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
  getVersionMock.mockResolvedValue("1.3.1");
  document.body.innerHTML = '<div id="app"></div>';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function switchToGridLayout(): Promise<void> {
  document
    .querySelector<HTMLButtonElement>('[data-action="profile-layout-grid"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
}

test("renders the default profile list without a left sidebar", async () => {
  await import("../src/main");
  await flushUi();

  expect(document.querySelector('[data-region="sidebar"]')).toBeNull();
  expect(document.querySelector('[data-page="cards"]')).not.toBeNull();
  expect(document.querySelector('[data-role="global-restart"]')).toBeNull();
  expect(document.querySelector('[data-action="launch-codex-enhanced"]')).toBeNull();
  expect(document.body.textContent).not.toContain("增强启动");
  expect(document.body.textContent).not.toContain("唤起宠物");
  expect(document.querySelector('[data-role="global-refresh"]')).not.toBeNull();
  expect(document.querySelector('[data-role="update-entry"]')).not.toBeNull();
  expect(document.querySelector('[data-role="update-entry"]')?.textContent).toContain("最新版");
  expect(document.querySelector('[data-role="add-card"]')).not.toBeNull();
  expect(document.querySelector(".page-header")).toBeNull();
  expect(document.querySelector('[data-role="current-config-card"]')).toBeNull();
  expect(document.querySelector('[data-role="current-status-band"]')).toBeNull();
  expect(document.querySelector('[data-role="profile-list"]')).not.toBeNull();
  expect(document.querySelector('[data-action="profile-layout-list"]')?.classList.contains("active")).toBe(true);
  expect(document.querySelector('[data-role="profile-grid"]')).toBeNull();
  expect(document.querySelector('[data-role="profile-row"][data-state="live"]')).not.toBeNull();
  expect(
    document.querySelector('[data-role="current-config-card"] [data-action="restart-codex"]'),
  ).toBeNull();
  expect(
    document.querySelector('[data-role="current-config-card"] [data-action="refresh"]'),
  ).toBeNull();
  expect(
    document.querySelector('[data-role="current-config-card"] [data-action="save-current-as-profile"]'),
  ).toBeNull();
  expect(document.querySelectorAll("[data-role='profile-row']").length).toBeGreaterThan(0);
  expect(document.querySelectorAll('[data-action="delete-profile"]')).toHaveLength(0);
});

test("does not expose enhanced launch from the toolbar", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return {
        targetDir: "/Users/example/.codex",
        usingDefaultTargetDir: true,
        targetExists: true,
        targetAuthExists: true,
        targetConfigExists: true,
        targetUpdatedAt: "2026-03-25T00:00:00Z",
        targetAuthTypeLabel: "官方 OAuth",
        activeProfileId: null,
        lastSelectedProfileId: null,
        lastSwitchProfileId: null,
        lastSwitchedAt: null,
        codexUsageApiEnabled: false,
        profiles: [],
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  await import("../src/main");
  await flushUi();

  expect(document.querySelector('[data-action="launch-codex-enhanced"]')).toBeNull();
  expect(invokeMock).not.toHaveBeenCalledWith("launch_codex_enhanced", undefined);
});

test("keeps the default profile list concise with metric chips and quick probe actions", async () => {
  await import("../src/main");
  await flushUi();

  const liveRow = document.querySelector('[data-role="profile-row"][data-state="live"]');

  expect(liveRow).not.toBeNull();
  expect(liveRow?.querySelectorAll('[data-role="profile-row-metric"]').length).toBeGreaterThanOrEqual(2);
  expect(liveRow?.querySelector('[data-role="profile-row-summary"]')).toBeNull();
  expect(liveRow?.querySelector('[data-role="profile-row-updated"]')).toBeNull();
  expect(liveRow?.textContent).not.toContain("更新");
  expect(liveRow?.querySelector('[data-action="refresh-third-party-usage"]')?.textContent).toContain("额度");
  expect(liveRow?.querySelector('[data-action="refresh-third-party-latency"]')?.textContent).toContain("测速");
  expect(liveRow?.querySelector('[data-action="view-profile-details"]')?.textContent?.trim()).toBe("");
  expect(liveRow?.querySelector('[data-action="view-profile-details"]')?.getAttribute("aria-label")).toContain("查看和编辑");
  expect(liveRow?.querySelector('[data-action="open-profile-drawer"]')).toBeNull();
  expect(liveRow?.querySelector('[data-action="delete-profile"]')).toBeNull();
});

test("shows only quota quick action for official profiles in the default list", async () => {
  await import("../src/main");
  await flushUi();

  const officialRow = Array.from(document.querySelectorAll('[data-role="profile-row"]')).find((row) =>
    row.textContent?.includes("官方 OAuth"),
  );

  expect(officialRow).not.toBeNull();
  expect(officialRow?.querySelector('[data-action="refresh-codex-usage"]')?.textContent).toContain("额度");
  expect(officialRow?.querySelector('[data-action="refresh-third-party-latency"]')).toBeNull();
  expect(officialRow?.querySelector('[data-role="profile-row-updated"]')).toBeNull();
});

test("shows the third-party provider key as the profile badge", async () => {
  const snapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-03-25T00:00:00Z",
    targetAuthTypeLabel: "第三方 API",
    activeProfileId: "profile-2",
    lastSelectedProfileId: "profile-2",
    lastSwitchProfileId: "profile-2",
    lastSwitchedAt: "2026-03-25T00:00:00Z",
    codexUsageApiEnabled: false,
    profiles: [
      {
        id: "profile-2",
        name: "Unified API",
        notes: "provider registry",
        authTypeLabel: "第三方 API",
        modelProviderKey: "ylscode",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T13:24:00Z",
        authHash: "auth-2",
        configHash: "config-2",
        codexUsage: null,
        thirdPartyLatency: {
          wireApi: "responses",
          model: "gpt-5.4",
          ttftMs: 1820,
          totalMs: 4960,
          statusCode: 200,
          updatedAt: "2026-03-26T10:12:00+08:00",
          error: null,
        },
        thirdPartyUsage: {
          provider: "ylscode",
          remaining: "12.34",
          unit: "USD",
          daily: null,
          weekly: null,
          updatedAt: "2026-03-26T10:20:00+08:00",
          error: null,
        },
      },
    ],
  };

  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return snapshot;
    }
    if (command === "get_profile_document") {
      return {
        id: "profile-2",
        name: "Unified API",
        notes: "provider registry",
        authTypeLabel: "第三方 API",
        modelProviderKey: "ylscode",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T13:24:00Z",
        authJson: '{"token":"test"}',
        configToml: 'model_provider = "ylscode"\n',
        loadedFromTarget: false,
        hasTargetChanges: false,
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();

  const row = document.querySelector('[data-role="profile-row"]');
  expect(row?.textContent).toContain("ylscode");
  expect(row?.textContent).not.toContain("第三方 API");
});

test("marks failed official usage refreshes in the list and detail page", async () => {
  const snapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-03-25T00:00:00Z",
    targetAuthTypeLabel: "官方 OAuth",
    activeProfileId: "profile-1",
    lastSelectedProfileId: "profile-1",
    lastSwitchProfileId: "profile-1",
    lastSwitchedAt: "2026-03-25T00:00:00Z",
    codexUsageApiEnabled: true,
    profiles: [
      {
        id: "profile-1",
        name: "Broken OAuth",
        notes: "missing token",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T14:19:00Z",
        authHash: "auth-1",
        configHash: "config-1",
        codexUsage: {
          source: "api",
          planType: null,
          primary: null,
          secondary: null,
          credits: null,
          updatedAt: "2026-03-25T21:56:00+08:00",
          error: "The selected profile does not contain a ChatGPT access token.",
        },
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
        id: "profile-1",
        name: "Broken OAuth",
        notes: "missing token",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T14:19:00Z",
        authJson: '{"auth_mode":"chatgpt"}',
        configToml: 'model_provider = "openai"\n',
        loadedFromTarget: false,
        hasTargetChanges: false,
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();

  const row = Array.from(document.querySelectorAll('[data-role="profile-row"]')).find((candidate) =>
    candidate.textContent?.includes("Broken OAuth"),
  );
  expect(row?.textContent).toContain("额度");
  expect(row?.textContent).toContain("失败");

  document
    .querySelector<HTMLButtonElement>('[data-action="view-profile-details"][data-id="profile-1"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();

  expect(document.body.textContent).toContain("额度刷新失败");
  expect(document.body.textContent).toContain("ChatGPT access token");
});

test("keeps list rows aligned with grouped metric and action slots", async () => {
  await import("../src/main");
  await flushUi();

  const rows = Array.from(document.querySelectorAll('[data-role="profile-row"]'));

  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.querySelectorAll('[data-role="profile-row-metric"]')).toHaveLength(3);
    expect(row.querySelector('[data-role="profile-row-actions"]')).not.toBeNull();
    expect(row.querySelector('[data-role="profile-row-primary-action"]')).not.toBeNull();
    expect(row.querySelector('[data-role="profile-row-secondary-actions"]')).not.toBeNull();
    expect(row.querySelector('[data-role="profile-row-quota-action"]')).not.toBeNull();
    expect(row.querySelector('[data-role="profile-row-latency-action"]')).not.toBeNull();
    expect(row.querySelector('[data-role="profile-row-detail-action"]')).not.toBeNull();
  }
});

test("switches between default list layout and grid card layout", async () => {
  await import("../src/main");
  await flushUi();

  expect(document.querySelector('[data-role="profile-list"]')).not.toBeNull();
  expect(document.querySelector('[data-role="profile-grid"]')).toBeNull();

  document
    .querySelector<HTMLButtonElement>('[data-action="profile-layout-grid"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  expect(document.querySelector('[data-role="profile-grid"]')).not.toBeNull();
  expect(document.querySelector('[data-role="profile-list"]')).toBeNull();
  expect(document.querySelector('[data-role="profile-card"][data-state="live"]')).not.toBeNull();

  document
    .querySelector<HTMLButtonElement>('[data-action="profile-layout-list"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  expect(document.querySelector('[data-role="profile-list"]')).not.toBeNull();
});

test("opens the single profile detail page with usage latency editor and delete action", async () => {
  const snapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-03-25T00:00:00Z",
    targetAuthTypeLabel: "第三方 API",
    activeProfileId: "profile-2",
    lastSelectedProfileId: "profile-2",
    lastSwitchProfileId: "profile-2",
    lastSwitchedAt: "2026-03-25T00:00:00Z",
    codexUsageApiEnabled: false,
    profiles: [
      {
        id: "profile-2",
        name: "ylscode",
        notes: "额度账号",
        authTypeLabel: "第三方 API",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T13:24:00Z",
        authHash: "auth-2",
        configHash: "config-2",
        codexUsage: null,
        thirdPartyLatency: {
          wireApi: "responses",
          model: "gpt-5.4",
          ttftMs: 1820,
          totalMs: 4960,
          statusCode: 200,
          updatedAt: "2026-03-26T10:12:00+08:00",
          error: null,
        },
        thirdPartyUsage: {
          provider: "ylscode",
          remaining: "12.34",
          unit: "USD",
          daily: {
            used: "87.66",
            total: "100",
            remaining: "12.34",
            usedPercent: 87.66,
          },
          weekly: {
            used: "300.49",
            total: "500",
            remaining: "199.51",
            usedPercent: 60,
          },
          updatedAt: "2026-03-26T10:20:00+08:00",
          error: null,
        },
      },
    ],
  };

  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return snapshot;
    }
    if (command === "get_profile_document") {
      return {
        id: "profile-2",
        name: "ylscode",
        notes: "额度账号",
        authTypeLabel: "第三方 API",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T13:24:00Z",
        authJson: '{"token":"test"}',
        configToml: 'model_provider = "ylscode"\n',
        loadedFromTarget: false,
        hasTargetChanges: false,
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="view-profile-details"][data-id="profile-2"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  const page = document.querySelector('[data-page="editor"]');
  expect(page).not.toBeNull();
  expect(document.querySelector('[data-role="profile-detail-drawer"]')).toBeNull();
  expect(page?.textContent).toContain("ylscode");
  expect(page?.querySelector('[data-role="third-party-usage-panel"]')).not.toBeNull();
  expect(page?.querySelector('[data-role="third-party-latency-panel"]')).not.toBeNull();
  expect(page?.textContent).toContain("$87.66 / $100.00");
  expect(page?.textContent).toContain("1.82s");
  expect(page?.querySelector('[data-action="delete-profile"][data-id="profile-2"]')).not.toBeNull();
});

test("shows current version in the update entry for desktop runtime", async () => {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return {
        targetDir: "/Users/example/.codex",
        usingDefaultTargetDir: true,
        targetExists: true,
        targetAuthExists: true,
        targetConfigExists: true,
        targetUpdatedAt: "2026-03-20T00:00:00Z",
        targetAuthTypeLabel: "第三方 API",
        activeProfileId: "profile-2",
        lastSelectedProfileId: "profile-2",
        lastSwitchProfileId: "profile-2",
        lastSwitchedAt: "2026-03-20T00:00:00Z",
        profiles: [
          {
            id: "profile-2",
            name: "淘宝 1",
            notes: "主工作账号，额度稳定。",
            authTypeLabel: "第三方 API",
            createdAt: "2026-03-17T01:00:00Z",
            updatedAt: "2026-03-19T04:12:00Z",
            authHash: "d18ff783cb10",
            configHash: "c450c91961af",
          },
        ],
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();

  expect(document.querySelector('[data-role="update-entry"]')?.textContent).toContain("v1.3.1");
});

test("shows the latest version in the update entry after update is detected", async () => {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return {
        targetDir: "/Users/example/.codex",
        usingDefaultTargetDir: true,
        targetExists: true,
        targetAuthExists: true,
        targetConfigExists: true,
        targetUpdatedAt: "2026-03-20T00:00:00Z",
        targetAuthTypeLabel: "第三方 API",
        activeProfileId: "profile-2",
        lastSelectedProfileId: "profile-2",
        lastSwitchProfileId: "profile-2",
        lastSwitchedAt: "2026-03-20T00:00:00Z",
        profiles: [
          {
            id: "profile-2",
            name: "淘宝 1",
            notes: "主工作账号，额度稳定。",
            authTypeLabel: "第三方 API",
            createdAt: "2026-03-17T01:00:00Z",
            updatedAt: "2026-03-19T04:12:00Z",
            authHash: "d18ff783cb10",
            configHash: "c450c91961af",
          },
        ],
      };
    }
    if (command === "check_install_location") {
      return {
        updateSafe: true,
        requiresApplicationsInstall: false,
        installPath: "/Applications/Codex 助手.app",
        message: null,
      };
    }
    if (command === "check_update") {
      return {
        hasUpdate: true,
        currentVersion: "1.3.1",
        latestVersion: "1.3.2",
        downloadUrl:
          "http://tc-github-mirror.ite.tool4seller.com/downloads/codex-auth-switch/macos/arm64/in_app_update/latest/Codex.Auth.Switch_aarch64.app.tar.gz",
        publishedAt: "2026-03-24T00:00:00Z",
        releaseName: null,
        notes: "- Fix mirror updater flow",
        kind: "in_app_update",
        filename: "Codex.Auth.Switch_aarch64.app.tar.gz",
        sha256: "abc123",
        size: 6406006,
        canInstall: true,
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="check-update"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await flushUi();
  await flushUi();
  await flushUi();

  const cancelBtn = document.querySelector<HTMLButtonElement>("#btn-cancel");
  expect(cancelBtn).not.toBeNull();
  cancelBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await flushUi();
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("check_update", undefined);
  expect(document.querySelector('[data-role="update-entry"]')?.textContent).toContain("有新版本");
  expect(document.querySelector('[data-role="update-entry"]')?.textContent).toContain("v1.3.2");
});

test("opens the mirror download link when only an installer package is available", async () => {
  const initialSnapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-03-20T00:00:00Z",
    targetAuthTypeLabel: "第三方 API",
    activeProfileId: "profile-2",
    lastSelectedProfileId: "profile-2",
    lastSwitchProfileId: "profile-2",
    lastSwitchedAt: "2026-03-20T00:00:00Z",
    profiles: [
      {
        id: "profile-2",
        name: "淘宝 1",
        notes: "主工作账号，额度稳定。",
        authTypeLabel: "第三方 API",
        createdAt: "2026-03-17T01:00:00Z",
        updatedAt: "2026-03-19T04:12:00Z",
        authHash: "d18ff783cb10",
        configHash: "c450c91961af",
      },
    ],
  };

  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "load_snapshot") {
      return initialSnapshot;
    }
    if (command === "check_install_location") {
      return {
        updateSafe: true,
        requiresApplicationsInstall: false,
        installPath: "C:/Program Files/Codex 助手",
        message: null,
      };
    }
    if (command === "check_update") {
      return {
        hasUpdate: true,
        currentVersion: "1.3.1",
        latestVersion: "1.3.2",
        downloadUrl:
          "http://tc-github-mirror.ite.tool4seller.com/downloads/codex-auth-switch/windows/x64/latest/Codex.Auth.Switch_1.3.2_x64-setup.exe",
        publishedAt: "2026-03-24T00:00:00Z",
        releaseName: null,
        notes: "- Fix mirror updater flow",
        kind: "installer",
        filename: "Codex.Auth.Switch_1.3.2_x64-setup.exe",
        sha256: "def456",
        size: 4063777,
        canInstall: false,
      };
    }
    if (command === "install_update") {
      return {
        ok: true,
        args,
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="check-update"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await flushUi();
  await flushUi();

  const okBtn = document.querySelector<HTMLButtonElement>("#btn-ok");
  expect(okBtn).not.toBeNull();
  okBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await flushUi();
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith(
    "install_update",
    expect.objectContaining({
      payload: expect.objectContaining({
        kind: "installer",
        downloadUrl:
          "http://tc-github-mirror.ite.tool4seller.com/downloads/codex-auth-switch/windows/x64/latest/Codex.Auth.Switch_1.3.2_x64-setup.exe",
      }),
    }),
  );
});

test("opens the editor flow when clicking the add-profile card", async () => {
  await import("../src/main");

  document
    .querySelector<HTMLButtonElement>('[data-action="new-profile"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  expect(document.querySelector('[data-page="editor"]')).not.toBeNull();
  expect(document.querySelector("#editor-name")).not.toBeNull();
  expect(document.querySelector('[data-role="third-party-delta-form"]')).not.toBeNull();
  expect(document.querySelector("#third-party-base-url")).not.toBeNull();
  expect(document.querySelector("#third-party-api-key")).not.toBeNull();
  expect(document.querySelector("#editor-auth-json")).toBeNull();
  expect(document.querySelector("#editor-config-toml")).toBeNull();
});

test("keeps codex usage query controls in profile management instead of settings", async () => {
  const snapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-03-25T00:00:00Z",
    targetAuthTypeLabel: "官方 OAuth",
    activeProfileId: "profile-official",
    lastSelectedProfileId: "profile-official",
    lastSwitchProfileId: "profile-official",
    lastSwitchedAt: "2026-03-25T00:00:00Z",
    codexUsageApiEnabled: true,
    profiles: [
      {
        id: "profile-official",
        name: "Official",
        notes: "official account",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T13:24:00Z",
        authHash: "auth-official",
        configHash: "config-official",
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

  expect(document.querySelector('[data-action="refresh-all-codex-usage"]')).not.toBeNull();

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-settings"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  expect(document.querySelector('[data-action="refresh-all-codex-usage"]')).toBeNull();
});

test("migrates legacy third-party profiles from the local profile toolbar", async () => {
  const snapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-03-25T00:00:00Z",
    targetAuthTypeLabel: "第三方 API",
    activeProfileId: "profile-legacy",
    lastSelectedProfileId: "profile-legacy",
    lastSwitchProfileId: "profile-legacy",
    lastSwitchedAt: "2026-03-25T00:00:00Z",
    codexUsageApiEnabled: false,
    profiles: [
      {
        id: "profile-legacy",
        name: "Legacy API",
        notes: "old provider table",
        authTypeLabel: "第三方 API",
        modelProviderKey: "ylscode",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T13:24:00Z",
        authHash: "auth-legacy",
        configHash: "config-legacy",
        codexUsage: null,
        thirdPartyLatency: null,
        thirdPartyUsage: null,
      },
    ],
  };
  const migratedSnapshot = {
    ...snapshot,
    profiles: [
      {
        ...snapshot.profiles[0],
        modelProviderKey: "openai",
        updatedAt: "2026-03-25T01:00:00Z",
        configHash: "config-migrated",
      },
    ],
  };

  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return migratedSnapshot;
    }
    if (command === "migrate_legacy_third_party_profiles") {
      return {
        migratedProfileIds: ["profile-legacy"],
        skippedProfileIds: [],
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();

  // Switch to settings page where migrate button is rendered
  document
    .querySelector<HTMLButtonElement>('[data-action="nav-settings"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="migrate-legacy-third-party"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("migrate_legacy_third_party_profiles", undefined);
  expect(document.body.textContent).toContain("已迁移 1 个旧第三方 API 配置");

  // Switch back to profile page to see updated profiles list
  document
    .querySelector<HTMLButtonElement>('[data-action="nav-profiles"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  expect(document.body.textContent).toContain("openai");
});

test("writes websocket defaults to third-party profiles from settings", async () => {
  const snapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-03-25T00:00:00Z",
    targetAuthTypeLabel: "第三方 API",
    activeProfileId: "profile-third",
    lastSelectedProfileId: "profile-third",
    lastSwitchProfileId: "profile-third",
    lastSwitchedAt: "2026-03-25T00:00:00Z",
    codexUsageApiEnabled: false,
    profiles: [
      {
        id: "profile-third",
        name: "Third API",
        notes: "third-party profile",
        authTypeLabel: "第三方 API",
        modelProviderKey: "openai",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T13:24:00Z",
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
    if (command === "write_third_party_websockets_defaults") {
      return {
        updatedProfileIds: ["profile-third"],
        skippedProfileIds: [],
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-settings"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="write-third-party-websockets-defaults"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("write_third_party_websockets_defaults", undefined);
  expect(document.body.textContent).toContain(
    "已为 1 个第三方 API 配置写入 supports_websockets = false",
  );
});

test("renders codex usage as a plan header with two progress rows", async () => {
  const usageUpdatedAt = "2026-03-25T21:56:00+08:00";
  const fiveHourReset = "2026-03-26T01:45:00+08:00";
  const weeklyReset = "2026-03-30T20:14:00+08:00";

  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return {
        targetDir: "/Users/example/.codex",
        usingDefaultTargetDir: true,
        targetExists: true,
        targetAuthExists: true,
        targetConfigExists: true,
        targetUpdatedAt: "2026-03-25T00:00:00Z",
        targetAuthTypeLabel: "官方 OAuth",
        activeProfileId: "profile-1",
        lastSelectedProfileId: "profile-1",
        lastSwitchProfileId: "profile-1",
        lastSwitchedAt: "2026-03-25T00:00:00Z",
        codexUsageApiEnabled: true,
        profiles: [
          {
            id: "profile-1",
            name: "淘宝team",
            notes: "自动从当前 Codex 配置生成",
            authTypeLabel: "官方 OAuth",
            createdAt: "2026-03-24T00:00:00Z",
            updatedAt: "2026-03-24T14:19:00Z",
            authHash: "auth-1",
            configHash: "config-1",
            codexUsage: {
              source: "api",
              planType: "team",
              primary: {
                usedPercent: 35,
                windowMinutes: 300,
                resetsAt: fiveHourReset,
              },
              secondary: {
                usedPercent: 84,
                windowMinutes: 10080,
                resetsAt: weeklyReset,
              },
              credits: null,
              updatedAt: usageUpdatedAt,
            },
          },
        ],
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();
  await switchToGridLayout();

  const expectedUpdatedAt = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(usageUpdatedAt));
  const expectedFiveHourReset = `${new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(fiveHourReset))} on ${new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(fiveHourReset))}`;
  const expectedWeeklyReset = `${new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(weeklyReset))} on ${new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(weeklyReset))}`;

  expect(document.body.textContent).toContain("Codex Team Plan");
  expect(document.body.textContent).toContain(`更新于：${expectedUpdatedAt}`);
  expect(document.body.textContent).toContain(expectedFiveHourReset);
  expect(document.body.textContent).toContain(expectedWeeklyReset);
  expect(document.body.textContent).toContain("65%");
  expect(document.body.textContent).toContain("16%");
  expect(document.body.textContent).not.toContain("私有 API");
  expect(document.querySelectorAll(".usage-progress-row")).toHaveLength(2);
  expect(document.querySelector(".usage-stat")).toBeNull();
  expect(
    document.querySelector('[data-action="refresh-codex-usage"][data-id="profile-1"]'),
  ).not.toBeNull();
});

test("keeps the rest of the UI interactive while codex usage is refreshing", async () => {
  let resolveRefresh: ((value: unknown) => void) | null = null;
  const refreshedSnapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-03-25T00:00:00Z",
    targetAuthTypeLabel: "官方 OAuth",
    activeProfileId: "profile-1",
    lastSelectedProfileId: "profile-1",
    lastSwitchProfileId: "profile-1",
    lastSwitchedAt: "2026-03-25T00:00:00Z",
    codexUsageApiEnabled: true,
    profiles: [
      {
        id: "profile-1",
        name: "淘宝team",
        notes: "自动从当前 Codex 配置生成",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T14:19:00Z",
        authHash: "auth-1",
        configHash: "config-1",
        codexUsage: {
          source: "api",
          planType: "team",
          primary: {
            usedPercent: 35,
            windowMinutes: 300,
            resetsAt: "2026-03-26T01:45:00+08:00",
          },
          secondary: null,
          credits: null,
          updatedAt: "2026-03-25T21:56:00+08:00",
        },
      },
    ],
  };

  invokeMock.mockImplementation((command: string) => {
    if (command === "load_snapshot") {
      return Promise.resolve({
        ...refreshedSnapshot,
        profiles: refreshedSnapshot.profiles.map((profile) => ({
          ...profile,
          codexUsage: null,
        })),
      });
    }
    if (command === "get_profile_document") {
      return Promise.resolve({
        id: "profile-1",
        name: "淘宝team",
        notes: "自动从当前 Codex 配置生成",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T14:19:00Z",
        authJson: '{"token":"test"}',
        configToml: 'model_provider = "openai"\n',
        loadedFromTarget: false,
        hasTargetChanges: false,
      });
    }
    if (command === "refresh_profile_codex_usage") {
      return new Promise((resolve) => {
        resolveRefresh = resolve;
      });
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="view-profile-details"][data-id="profile-1"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="refresh-codex-usage"][data-id="profile-1"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await flushUi();
  await flushUi();

  const pendingRefreshButton = document.querySelector<HTMLButtonElement>(
    '[data-action="refresh-codex-usage"][data-id="profile-1"]',
  );
  expect(invokeMock).toHaveBeenCalledWith("refresh_profile_codex_usage", { profileId: "profile-1" });
  expect(pendingRefreshButton?.textContent).toContain("刷新中");
  expect(pendingRefreshButton?.hasAttribute("disabled")).toBe(true);
  expect(
    document.querySelector<HTMLButtonElement>('[data-action="back-to-cards"]')?.hasAttribute("disabled"),
  ).toBe(false);

  resolveRefresh?.(refreshedSnapshot);
  await flushUi();
  await flushUi();
});

test("renders a third-party latency panel inside the profile card", async () => {
  const probeUpdatedAt = "2026-03-26T10:12:00+08:00";

  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return {
        targetDir: "/Users/example/.codex",
        usingDefaultTargetDir: true,
        targetExists: true,
        targetAuthExists: true,
        targetConfigExists: true,
        targetUpdatedAt: "2026-03-25T00:00:00Z",
        targetAuthTypeLabel: "第三方 API",
        activeProfileId: "profile-2",
        lastSelectedProfileId: "profile-2",
        lastSwitchProfileId: "profile-2",
        lastSwitchedAt: "2026-03-25T00:00:00Z",
        codexUsageApiEnabled: false,
        profiles: [
          {
            id: "profile-2",
            name: "aixj",
            notes: "栋哥分享",
            authTypeLabel: "第三方 API",
            createdAt: "2026-03-24T00:00:00Z",
            updatedAt: "2026-03-24T13:24:00Z",
            authHash: "auth-2",
            configHash: "config-2",
            codexUsage: null,
            thirdPartyLatency: {
              wireApi: "responses",
              model: "gpt-5.4",
              ttftMs: 1820,
              totalMs: 4960,
              statusCode: 200,
              updatedAt: probeUpdatedAt,
              error: null,
            },
          },
        ],
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();
  await switchToGridLayout();

  expect(document.querySelector('[data-role="third-party-runtime-panel"]')).not.toBeNull();
  expect(document.body.textContent).not.toContain("第三方 API 测速");
  expect(document.body.textContent).toContain("首 Token");
  expect(document.body.textContent).toContain("1.82s");
  expect(document.body.textContent).toContain("总耗时");
  expect(document.body.textContent).toContain("4.96s");
  expect(document.body.textContent).toContain("ylscode");
  expect(
    document.querySelector('[data-action="refresh-third-party-latency"][data-id="profile-2"]'),
  ).not.toBeNull();
});

test("renders a ylscode third-party usage panel inside the profile card", async () => {
  const usageUpdatedAt = "2026-03-26T10:20:00+08:00";

  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return {
        targetDir: "/Users/example/.codex",
        usingDefaultTargetDir: true,
        targetExists: true,
        targetAuthExists: true,
        targetConfigExists: true,
        targetUpdatedAt: "2026-03-25T00:00:00Z",
        targetAuthTypeLabel: "第三方 API",
        activeProfileId: "profile-2",
        lastSelectedProfileId: "profile-2",
        lastSwitchProfileId: "profile-2",
        lastSwitchedAt: "2026-03-25T00:00:00Z",
        codexUsageApiEnabled: false,
        profiles: [
          {
            id: "profile-2",
            name: "ylscode",
            notes: "额度账号",
            authTypeLabel: "第三方 API",
            createdAt: "2026-03-24T00:00:00Z",
            updatedAt: "2026-03-24T13:24:00Z",
            authHash: "auth-2",
            configHash: "config-2",
            codexUsage: null,
            thirdPartyLatency: null,
            thirdPartyUsage: {
              provider: "ylscode",
              remaining: "-0.03",
              unit: "USD",
              daily: {
                used: "100.03",
                total: "100",
                remaining: "-0.03",
                usedPercent: 100,
              },
              weekly: {
                used: "300.49",
                total: "500",
                remaining: "199.51",
                usedPercent: 60,
              },
              updatedAt: usageUpdatedAt,
              error: null,
            },
          },
        ],
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();
  await switchToGridLayout();

  expect(document.querySelector('[data-role="third-party-runtime-panel"]')).not.toBeNull();
  expect(document.body.textContent).not.toContain("第三方 API 用量");
  expect(document.body.textContent).toContain("今日");
  expect(document.body.textContent).toContain("$100.03 / $100.00");
  expect(document.body.textContent).toContain("本周");
  expect(document.body.textContent).toContain("$300.49 / $500.00");
  expect(document.body.textContent).toContain("60%");
  expect(document.body.textContent).toContain("ylscode");
  expect(
    document.querySelector('[data-action="refresh-third-party-usage"][data-id="profile-2"]'),
  ).not.toBeNull();
});

test("combines third-party usage and latency into one compact card status block", async () => {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return {
        targetDir: "/Users/example/.codex",
        usingDefaultTargetDir: true,
        targetExists: true,
        targetAuthExists: true,
        targetConfigExists: true,
        targetUpdatedAt: "2026-03-25T00:00:00Z",
        targetAuthTypeLabel: "第三方 API",
        activeProfileId: "profile-2",
        lastSelectedProfileId: "profile-2",
        lastSwitchProfileId: "profile-2",
        lastSwitchedAt: "2026-03-25T00:00:00Z",
        codexUsageApiEnabled: false,
        profiles: [
          {
            id: "profile-2",
            name: "ylscode",
            notes: "额度账号",
            authTypeLabel: "第三方 API",
            createdAt: "2026-03-24T00:00:00Z",
            updatedAt: "2026-03-24T13:24:00Z",
            authHash: "auth-2",
            configHash: "config-2",
            codexUsage: null,
            thirdPartyLatency: {
              wireApi: "responses",
              model: "gpt-5.4",
              ttftMs: 1820,
              totalMs: 4960,
              statusCode: 200,
              updatedAt: "2026-03-26T10:12:00+08:00",
              error: null,
            },
            thirdPartyUsage: {
              provider: "ylscode",
              remaining: "12.34",
              unit: "USD",
              daily: {
                used: "87.66",
                total: "100",
                remaining: "12.34",
                usedPercent: 87.66,
              },
              weekly: {
                used: "300.49",
                total: "500",
                remaining: "199.51",
                usedPercent: 60,
              },
              updatedAt: "2026-03-26T10:20:00+08:00",
              error: null,
            },
          },
        ],
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();
  await switchToGridLayout();

  const profileCard = document.querySelector('[data-role="profile-card"]');
  expect(profileCard?.querySelector('[data-role="third-party-runtime-panel"]')).not.toBeNull();
  expect(profileCard?.querySelector('[data-role="third-party-usage-panel"]')).toBeNull();
  expect(profileCard?.querySelector('[data-role="third-party-latency-panel"]')).toBeNull();
  expect(document.body.textContent).toContain("今日");
  expect(document.body.textContent).toContain("$87.66 / $100.00");
  expect(document.body.textContent).toContain("本周");
  expect(document.body.textContent).toContain("$300.49 / $500.00");
  expect(document.body.textContent).toContain("首 Token");
  expect(document.body.textContent).toContain("1.82s");
  expect(document.body.textContent).not.toContain("第三方 API 用量");
  expect(document.body.textContent).not.toContain("第三方 API 测速");
});

test("refreshes ylscode third-party usage for the selected profile card", async () => {
  const refreshedSnapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-03-25T00:00:00Z",
    targetAuthTypeLabel: "第三方 API",
    activeProfileId: "profile-2",
    lastSelectedProfileId: "profile-2",
    lastSwitchProfileId: "profile-2",
    lastSwitchedAt: "2026-03-25T00:00:00Z",
    codexUsageApiEnabled: false,
    profiles: [
      {
        id: "profile-2",
        name: "ylscode",
        notes: "额度账号",
        authTypeLabel: "第三方 API",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T13:24:00Z",
        authHash: "auth-2",
        configHash: "config-2",
        codexUsage: null,
        thirdPartyLatency: null,
        thirdPartyUsage: {
          provider: "ylscode",
          remaining: "12.34",
          unit: "USD",
          daily: {
            used: "87.66",
            total: "100",
            remaining: "12.34",
            usedPercent: 87.66,
          },
          weekly: {
            used: "300.49",
            total: "500",
            remaining: "199.51",
            usedPercent: 60.098,
          },
          updatedAt: "2026-03-26T10:25:00+08:00",
          error: null,
        },
      },
    ],
  };

  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return {
        ...refreshedSnapshot,
        profiles: refreshedSnapshot.profiles.map((profile) => ({
          ...profile,
          thirdPartyUsage: null,
        })),
      };
    }
    if (command === "refresh_profile_third_party_usage") {
      return refreshedSnapshot;
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();
  await switchToGridLayout();

  document
    .querySelector<HTMLButtonElement>('[data-action="refresh-third-party-usage"][data-id="profile-2"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await flushUi();
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("refresh_profile_third_party_usage", {
    profileId: "profile-2",
  });
  expect(document.body.textContent).toContain("$87.66 / $100.00");
  expect(document.body.textContent).toContain("$300.49 / $500.00");
  expect(document.body.textContent).toContain("已刷新「ylscode」第三方 API 用量。");
});

test("refreshes third-party usage for symbiotic profiles", async () => {
  const refreshedSnapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-03-25T00:00:00Z",
    targetAuthTypeLabel: "共生配置",
    activeProfileId: "profile-symbiotic",
    lastSelectedProfileId: "profile-symbiotic",
    lastSwitchProfileId: "profile-symbiotic",
    lastSwitchedAt: "2026-03-25T00:00:00Z",
    codexUsageApiEnabled: true,
    profiles: [
      {
        id: "profile-symbiotic",
        name: "YLS OAuth",
        notes: "第三方额度，共用 OAuth 登录",
        authTypeLabel: "共生配置",
        modelProviderKey: "ylscode",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T13:24:00Z",
        authHash: "auth-symbiotic",
        configHash: "config-symbiotic",
        codexUsage: null,
        thirdPartyLatency: null,
        thirdPartyUsage: {
          provider: "ylscode",
          remaining: "87.66",
          unit: "USD",
          daily: {
            used: "12.34",
            total: "100",
            remaining: "87.66",
            usedPercent: 12.34,
          },
          weekly: {
            used: "45.67",
            total: "500",
            remaining: "454.33",
            usedPercent: 9.134,
          },
          updatedAt: "2026-03-26T10:25:00+08:00",
          error: null,
        },
      },
    ],
  };

  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return {
        ...refreshedSnapshot,
        profiles: refreshedSnapshot.profiles.map((profile) => ({
          ...profile,
          thirdPartyUsage: null,
        })),
      };
    }
    if (command === "refresh_profile_third_party_usage") {
      return refreshedSnapshot;
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();

  expect(document.body.textContent).toContain("共生配置");
  expect(document.body.textContent).toContain("ylscode");

  document
    .querySelector<HTMLButtonElement>(
      '[data-action="refresh-third-party-usage"][data-id="profile-symbiotic"]',
    )
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await flushUi();
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("refresh_profile_third_party_usage", {
    profileId: "profile-symbiotic",
  });
  expect(invokeMock).not.toHaveBeenCalledWith("refresh_profile_codex_usage", {
    profileId: "profile-symbiotic",
  });
  expect(document.body.textContent).toContain("$12.34 / $100");
  expect(document.body.textContent).toContain("已刷新「YLS OAuth」第三方 API 用量。");
});

test("refreshes third-party latency for the selected profile card", async () => {
  const refreshedSnapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-03-25T00:00:00Z",
    targetAuthTypeLabel: "第三方 API",
    activeProfileId: "profile-2",
    lastSelectedProfileId: "profile-2",
    lastSwitchProfileId: "profile-2",
    lastSwitchedAt: "2026-03-25T00:00:00Z",
    codexUsageApiEnabled: false,
    profiles: [
      {
        id: "profile-2",
        name: "aixj",
        notes: "栋哥分享",
        authTypeLabel: "第三方 API",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T13:24:00Z",
        authHash: "auth-2",
        configHash: "config-2",
        codexUsage: null,
        thirdPartyLatency: {
          wireApi: "chat_completions",
          model: "gpt-4.1",
          ttftMs: 960,
          totalMs: 2410,
          statusCode: 200,
          updatedAt: "2026-03-26T10:15:00+08:00",
          error: null,
        },
      },
    ],
  };

  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return {
        ...refreshedSnapshot,
        profiles: refreshedSnapshot.profiles.map((profile) => ({
          ...profile,
          thirdPartyLatency: null,
        })),
      };
    }
    if (command === "refresh_profile_latency_probe") {
      return refreshedSnapshot;
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();
  await switchToGridLayout();

  document
    .querySelector<HTMLButtonElement>('[data-action="refresh-third-party-latency"][data-id="profile-2"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await flushUi();
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("refresh_profile_latency_probe", { profileId: "profile-2" });
  expect(document.body.textContent).toContain("0.96s");
  expect(document.body.textContent).toContain("2.41s");
  expect(document.body.textContent).toContain("已完成「aixj」第三方 API 测速。");
});

test("restarts Codex after switching profiles and session repair finishes", async () => {
  const initialSnapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-03-20T00:00:00Z",
    targetAuthTypeLabel: "第三方 API",
    activeProfileId: "profile-2",
    lastSelectedProfileId: "profile-2",
    lastSwitchProfileId: "profile-2",
    lastSwitchedAt: "2026-03-20T00:00:00Z",
    profiles: [
      {
        id: "profile-1",
        name: "Work Team",
        notes: "工作主账号，常驻使用。",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-03-16T01:00:00Z",
        updatedAt: "2026-03-18T12:20:00Z",
        authHash: "7da2e87f1bc3",
        configHash: "92ca2d10aa51",
      },
      {
        id: "profile-2",
        name: "淘宝 1",
        notes: "主工作账号，额度稳定。",
        authTypeLabel: "第三方 API",
        createdAt: "2026-03-17T01:00:00Z",
        updatedAt: "2026-03-19T04:12:00Z",
        authHash: "d18ff783cb10",
        configHash: "c450c91961af",
      },
    ],
  };

  const switchedSnapshot = {
    ...initialSnapshot,
    activeProfileId: "profile-1",
    lastSelectedProfileId: "profile-1",
    lastSwitchProfileId: "profile-1",
  };

  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return initialSnapshot;
    }
    if (command === "switch_profile") {
      return switchedSnapshot;
    }
    if (command === "restart_codex") {
      return undefined;
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="switch"][data-id="profile-1"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await flushUi();
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("switch_profile", { profileId: "profile-1" });
  expect(invokeMock).toHaveBeenCalledWith("restart_codex", undefined);
  expect(document.body.textContent).toContain("profile 切换成功，Codex 已重启。");
});

test("shows an indeterminate provider sync dialog while switching profiles", async () => {
  const initialSnapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-03-20T00:00:00Z",
    targetAuthTypeLabel: "第三方 API",
    activeProfileId: "profile-2",
    lastSelectedProfileId: "profile-2",
    lastSwitchProfileId: "profile-2",
    lastSwitchedAt: "2026-03-20T00:00:00Z",
    profiles: [
      {
        id: "profile-1",
        name: "Work Team",
        notes: "工作主账号，常驻使用。",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-03-16T01:00:00Z",
        updatedAt: "2026-03-18T12:20:00Z",
        authHash: "7da2e87f1bc3",
        configHash: "92ca2d10aa51",
      },
      {
        id: "profile-2",
        name: "淘宝 1",
        notes: "主工作账号，额度稳定。",
        authTypeLabel: "第三方 API",
        createdAt: "2026-03-17T01:00:00Z",
        updatedAt: "2026-03-19T04:12:00Z",
        authHash: "d18ff783cb10",
        configHash: "c450c91961af",
      },
    ],
  };

  const switchedSnapshot = {
    ...initialSnapshot,
    activeProfileId: "profile-1",
    lastSelectedProfileId: "profile-1",
    lastSwitchProfileId: "profile-1",
  };

  let resolveSwitch: ((snapshot: typeof switchedSnapshot) => void) | null = null;
  const switchPromise = new Promise<typeof switchedSnapshot>((resolve) => {
    resolveSwitch = resolve;
  });
  let resolveRestart: (() => void) | null = null;
  const restartPromise = new Promise<void>((resolve) => {
    resolveRestart = resolve;
  });

  invokeMock.mockImplementation((command: string) => {
    if (command === "load_snapshot") {
      return Promise.resolve(initialSnapshot);
    }
    if (command === "switch_profile") {
      return switchPromise;
    }
    if (command === "restart_codex") {
      return restartPromise;
    }
    return Promise.reject(new Error(`unexpected command: ${command}`));
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="switch"][data-id="profile-1"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await flushUi();

  const dialog = document.querySelector('[data-role="profile-switch-busy-dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog?.getAttribute("aria-busy")).toBe("true");
  expect(dialog?.textContent).toContain("切换中");
  expect(dialog?.textContent).toContain("正在同步会话并修复 Codex 会话");

  resolveSwitch?.(switchedSnapshot);
  await flushUi();
  await flushUi();

  const restartDialog = document.querySelector('[data-role="profile-switch-busy-dialog"]');
  expect(restartDialog).not.toBeNull();
  expect(restartDialog?.getAttribute("aria-busy")).toBe("true");
  expect(restartDialog?.textContent).toContain("重启 Codex");
  expect(restartDialog?.textContent).toContain("会话修复已完成，正在重启 Codex");

  resolveRestart?.();
  await flushUi();
  await flushUi();

  expect(document.querySelector('[data-role="profile-switch-busy-dialog"]')).toBeNull();
});

test("opens the detail editor when clicking view-details on a profile card", async () => {
  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="view-profile-details"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await flushUi();

  expect(document.querySelector('[data-page="editor"]')).not.toBeNull();
  expect(document.querySelector("#editor-auth-json")).not.toBeNull();
  expect(document.querySelector("#editor-config-toml")).not.toBeNull();
});

test("moves cloud sharing out of the new profile editor into a dedicated sharing center", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => [],
  })));

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="new-profile"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  expect(document.querySelector('[data-action="editor-tab-network"]')).toBeNull();

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-sharing"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();

  expect(document.querySelector('[data-page="sharing-center"]')).not.toBeNull();
  expect(document.querySelector('[data-role="sharing-center-tabs"]')).not.toBeNull();
  expect(document.querySelector('[data-role="local-share-form"]')).not.toBeNull();
  expect(document.querySelector('[data-role="local-profile-tabs"]')).not.toBeNull();

  document
    .querySelector<HTMLButtonElement>('[data-action="sharing-tab-library"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  expect(document.querySelector('[data-role="network-profile-library"]')).not.toBeNull();
});

test("shares a selected local profile to the enterprise sharing center for everyone", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  localStorage.setItem("codex-auth-switch.networkProfileToken", "cas_test_token");

  const snapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-03-25T00:00:00Z",
    targetAuthTypeLabel: "第三方 API",
    activeProfileId: "profile-2",
    lastSelectedProfileId: "profile-2",
    lastSwitchProfileId: "profile-2",
    lastSwitchedAt: "2026-03-25T00:00:00Z",
    codexUsageApiEnabled: false,
    profiles: [
      {
        id: "profile-2",
        name: "Unified API",
        notes: "provider registry",
        authTypeLabel: "第三方 API",
        modelProviderKey: "ylscode",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T13:24:00Z",
        authHash: "auth-2",
        configHash: "config-2",
        codexUsage: null,
        thirdPartyLatency: null,
        thirdPartyUsage: null,
      },
    ],
  };

  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") return snapshot;
    if (command === "get_profile_document") {
      return {
        id: "profile-2",
        name: "Unified API",
        notes: "provider registry",
        authTypeLabel: "第三方 API",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T13:24:00Z",
        authJson: '{"OPENAI_API_KEY":"sk-test"}',
        configToml: 'model = "gpt-5.4"\n',
        loadedFromTarget: false,
        hasTargetChanges: false,
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  const profilePostBodies: FormData[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/users") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          users: [
            { dingUserId: "Ding-A", label: "Alice", mobile: "13900000001" },
            { dingUserId: "Ding-B", label: "Bob", mobile: "13900000002" },
          ],
        }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles" && init?.method === "POST") {
      profilePostBodies.push(init.body as FormData);
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: "remote-1" }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles") {
      return {
        ok: true,
        status: 200,
        json: async () => [],
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../src/main");
  await flushUi();
  await flushUi();
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-sharing"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();

  document.querySelector<HTMLInputElement>("#share-visibility-public")!.checked = true;
  document
    .querySelector<HTMLInputElement>("#share-visibility-public")
    ?.dispatchEvent(new Event("change", { bubbles: true }));

  document
    .querySelector<HTMLButtonElement>('[data-action="share-local-profile"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  expect(fetchMock).toHaveBeenCalledWith(
    "https://codex-helper.ite.tool4seller.com/codex/api/users",
    { cache: "no-store", headers: { Authorization: "Bearer cas_test_token" } },
  );
  expect(profilePostBodies).toHaveLength(1);
  expect(profilePostBodies[0].get("name")).toBe("Unified API");
  expect(profilePostBodies[0].get("description")).toBe("provider registry");
  expect(profilePostBodies[0].get("visibility")).toBe("public");
  expect(profilePostBodies[0].get("sharedWith")).toBe("[]");
  expect(await (profilePostBodies[0].get("file1") as File).text()).toContain("sk-test");
});

test("shares a local profile to selected known SSO users from the sharing center", async () => {
  localStorage.setItem("codex-auth-switch.networkProfileToken", "cas_test_token");

  const profilePostBodies: FormData[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/users") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          users: [
            { dingUserId: "Ding-A", label: "Alice", mobile: "13900000001" },
            { dingUserId: "Ding-B", label: "Bob", mobile: "13900000002" },
          ],
        }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles" && init?.method === "POST") {
      profilePostBodies.push(init.body as FormData);
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: "remote-2" }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles") {
      return {
        ok: true,
        status: 200,
        json: async () => [],
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-sharing"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  const initialChecked = document.querySelectorAll<HTMLInputElement>(".share-user-checkbox:checked");
  expect(initialChecked).toHaveLength(0);

  const bobCheckbox = document.querySelector<HTMLInputElement>('.share-user-checkbox[value="Ding-B"]');
  expect(bobCheckbox).not.toBeNull();
  expect(bobCheckbox!.type).toBe("checkbox");
  bobCheckbox!.checked = true;
  bobCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="share-local-profile"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();

  expect(profilePostBodies).toHaveLength(1);
  expect(profilePostBodies[0].get("visibility")).toBe("selected");
  expect(profilePostBodies[0].get("sharedWith")).toBe(JSON.stringify(["Ding-B"]));
});

test("edits recipients for an owned shared profile and shows its share count in the library tab", async () => {
  localStorage.setItem("codex-auth-switch.networkProfileToken", "cas_test_token");

  let remoteProfiles = [
    {
      id: "remote-owned",
      name: "ChatGPT Pro",
      description: "自动从当前 Codex 配置生成",
      createdAt: "2026-06-04T10:00:00Z",
      updatedAt: "2026-06-04T10:00:00Z",
      files: ["auth.json", "config.toml"],
      ownerDingUserId: "Ding-A",
      ownerName: "Alice",
      visibility: "selected",
      sharedWith: ["Ding-A", "Ding-B"],
    },
    {
      id: "remote-other",
      name: "Team API",
      description: "other shared profile",
      createdAt: "2026-06-04T11:00:00Z",
      files: ["auth.json", "config.toml"],
      ownerDingUserId: "Ding-C",
      ownerName: "Carol",
      visibility: "public",
      sharedWith: [],
    },
  ];
  const updateBodies: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/auth/me") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: { dingUserId: "Ding-A", name: "Alice", mobile: "13900000001" } }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/users") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          users: [
            { dingUserId: "Ding-A", label: "Alice", mobile: "13900000001" },
            { dingUserId: "Ding-B", label: "Bob", mobile: "13900000002" },
          ],
        }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-owned" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      updateBodies.push(body);
      remoteProfiles = remoteProfiles.map((profile) =>
        profile.id === "remote-owned"
          ? {
              ...profile,
              visibility: body.visibility as "selected",
              sharedWith: body.sharedWith as string[],
              updatedAt: "2026-06-04T12:00:00Z",
            }
          : profile,
      );
      return {
        ok: true,
        status: 200,
        json: async () => remoteProfiles[0],
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles") {
      return {
        ok: true,
        status: 200,
        json: async () => remoteProfiles,
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../src/main");
  await flushUi();
  await flushUi();
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-sharing"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  expect(document.querySelector('[data-role="sharing-center-tabs"]')).not.toBeNull();
  expect(document.querySelector('[data-role="local-share-form"]')?.textContent).toContain("ChatGPT Pro");
  expect(document.querySelector('[data-role="local-share-form"]')?.textContent).toContain("指定 1 人");

  document
    .querySelector<HTMLButtonElement>('[data-action="select-share-profile-tab"][data-owned-id="remote-owned"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  const initialEditChecked = document.querySelectorAll<HTMLInputElement>(".shared-profile-edit-user-checkbox:checked");
  expect(initialEditChecked).toHaveLength(1);
  expect(initialEditChecked[0].value).toBe("Ding-B");
  expect(document.querySelector<HTMLInputElement>('.shared-profile-edit-user-checkbox[value="Ding-A"]')).toBeNull();

  const bobCheckbox = document.querySelector<HTMLInputElement>('.shared-profile-edit-user-checkbox[value="Ding-B"]');
  expect(bobCheckbox).not.toBeNull();
  expect(bobCheckbox!.type).toBe("checkbox");
  bobCheckbox!.checked = true;
  bobCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="save-shared-profile-users"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  expect(updateBodies).toEqual([
    {
      name: "ChatGPT Pro",
      description: "自动从当前 Codex 配置生成",
      visibility: "selected",
      sharedWith: ["Ding-B"],
    },
  ]);
  expect(fetchMock).toHaveBeenCalledWith(
    "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-owned",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer cas_test_token",
        "Content-Type": "application/json",
      }),
    }),
  );

  document
    .querySelector<HTMLButtonElement>('[data-action="sharing-tab-library"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  expect(document.querySelector('[data-role="network-profile-library"]')?.textContent).toContain("我共享的配置");
  expect(document.querySelector('[data-role="network-profile-library"]')?.textContent).toContain("指定 1 人");
});

test("keeps SSO signed in when editing shared recipients receives an unauthorized response", async () => {
  localStorage.setItem("codex-auth-switch.networkProfileToken", "cas_test_token");

  const remoteProfiles = [
    {
      id: "remote-owned",
      name: "ChatGPT Pro",
      description: "自动从当前 Codex 配置生成",
      createdAt: "2026-06-04T10:00:00Z",
      updatedAt: "2026-06-04T10:00:00Z",
      files: ["auth.json", "config.toml"],
      ownerDingUserId: "Ding-A",
      ownerName: "Alice",
      visibility: "selected",
      sharedWith: ["Ding-A"],
    },
  ];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/auth/me") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: { dingUserId: "Ding-A", name: "Alice", mobile: "13900000001" } }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/users") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          users: [
            { dingUserId: "Ding-A", label: "Alice", mobile: "13900000001" },
            { dingUserId: "Ding-B", label: "Bob", mobile: "13900000002" },
          ],
        }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-owned" && init?.method === "POST") {
      return {
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles") {
      return {
        ok: true,
        status: 200,
        json: async () => remoteProfiles,
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../src/main");
  await flushUi();
  await flushUi();
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-sharing"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="select-share-profile-tab"][data-owned-id="remote-owned"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  const bobCheckbox = document.querySelector<HTMLInputElement>('.shared-profile-edit-user-checkbox[value="Ding-B"]');
  expect(bobCheckbox).not.toBeNull();
  bobCheckbox!.checked = true;
  bobCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="save-shared-profile-users"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  const sidebarStatus = document.querySelector('[data-role="sidebar-login-status"]');
  expect(sidebarStatus?.textContent).toContain("Alice");
  expect(sidebarStatus?.textContent).not.toContain("未登录");
  expect(sidebarStatus?.querySelector('[data-action="open-network-sso-login"]')).toBeNull();
  expect(document.body.textContent).toContain("已保留当前登录状态");
  expect(localStorage.getItem("codex-auth-switch.networkProfileToken")).toBe("cas_test_token");
});

test("deletes an owned shared profile from the sharing center management list", async () => {
  localStorage.setItem("codex-auth-switch.networkProfileToken", "cas_test_token");
  const confirmMock = vi.fn(() => true);
  vi.stubGlobal("confirm", confirmMock);

  let remoteProfiles = [
    {
      id: "remote-owned",
      name: "ChatGPT Pro",
      description: "自动从当前 Codex 配置生成",
      createdAt: "2026-06-04T10:00:00Z",
      updatedAt: "2026-06-04T10:00:00Z",
      files: ["auth.json", "config.toml"],
      ownerDingUserId: "Ding-A",
      ownerName: "Alice",
      visibility: "public",
      sharedWith: [],
    },
  ];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/auth/me") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: { dingUserId: "Ding-A", name: "Alice", mobile: "13900000001" } }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/users") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ users: [] }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-owned" && init?.method === "DELETE") {
      remoteProfiles = [];
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles") {
      return {
        ok: true,
        status: 200,
        json: async () => remoteProfiles,
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../src/main");
  await flushUi();
  await flushUi();
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-sharing"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  expect(document.querySelector('[data-role="local-share-form"]')?.textContent).toContain("ChatGPT Pro");

  document
    .querySelector<HTMLButtonElement>('[data-action="select-share-profile-tab"][data-owned-id="remote-owned"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="delete-shared-profile"][data-id="remote-owned"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  expect(confirmMock).toHaveBeenCalledWith("确定删除「ChatGPT Pro」吗？删除后其他人将无法再导入这套共享配置。");
  expect(fetchMock).toHaveBeenCalledWith(
    "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-owned",
    expect.objectContaining({
      method: "DELETE",
      headers: {
        Authorization: "Bearer cas_test_token",
      },
    }),
  );
  expect(document.querySelector('[data-role="local-share-form"]')?.textContent).toContain("未共享");
  expect(document.body.textContent).toContain("已删除共享配置");
});

test("preserves sharing center scroll position for in-page recipient changes", async () => {
  localStorage.setItem("codex-auth-switch.networkProfileToken", "cas_test_token");

  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = input.toString();
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/auth/me") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: { dingUserId: "Ding-A", name: "Alice", mobile: "13900000001" } }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/users") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          users: [
            { dingUserId: "Ding-A", label: "Alice", mobile: "13900000001" },
            { dingUserId: "Ding-B", label: "Bob", mobile: "13900000002" },
          ],
        }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles") {
      return {
        ok: true,
        status: 200,
        json: async () => [],
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../src/main");
  await flushUi();
  await flushUi();
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-sharing"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  const scroller = document.querySelector<HTMLElement>(".app-main-content");
  expect(scroller).not.toBeNull();
  scroller!.scrollTop = 360;

  const bobCheckbox = document.querySelector<HTMLInputElement>('.share-user-checkbox[value="Ding-B"]');
  expect(bobCheckbox).not.toBeNull();
  bobCheckbox!.checked = true;
  bobCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
  await flushUi();

  expect(document.querySelector<HTMLElement>(".app-main-content")?.scrollTop).toBe(360);
});

test("opens network shared profile details in readonly mode without browser cache", async () => {
  localStorage.setItem("codex-auth-switch.networkProfileToken", "cas_test_token");
  const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = input.toString();

    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles") {
      return {
        ok: true,
        json: async () => [
          {
            id: "remote-1",
            name: "Team Shared",
            description: "团队共享配置",
            createdAt: "2026-04-16T00:00:00Z",
            files: ["auth.json", "config.toml"],
          },
        ],
      };
    }

    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-1") {
      return {
        ok: true,
        json: async () => ({
          id: "remote-1",
          name: "Team Shared",
          description: "团队共享配置",
          createdAt: "2026-04-16T00:00:00Z",
          files: ["auth.json", "config.toml"],
        }),
      };
    }

    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-1/auth.json") {
      return {
        ok: true,
        text: async () => '{"token":"remote-token"}',
      };
    }

    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-1/config.toml") {
      return {
        ok: true,
        text: async () => 'model = "gpt-5.4"\n',
      };
    }

    throw new Error(`unexpected fetch: ${input}`);
  });

  vi.stubGlobal("fetch", fetchMock);

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-sharing"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await flushUi();
  await flushUi();
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="sharing-tab-library"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  const detailButton = document.querySelector<HTMLButtonElement>(
    '[data-action="view-network-profile-details"][data-id="remote-1"]',
  );
  expect(detailButton).not.toBeNull();
  detailButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await flushUi();
  await flushUi();
  await flushUi();
  await flushUi();
  await flushUi();

  expect(document.querySelector('[data-page="editor"]')).not.toBeNull();
  expect(document.querySelector<HTMLInputElement>("#editor-name")?.disabled).toBe(true);
  expect(document.querySelector<HTMLTextAreaElement>("#editor-auth-json")?.disabled).toBe(true);
  expect(document.querySelector<HTMLTextAreaElement>("#editor-config-toml")?.disabled).toBe(true);
  expect(document.querySelector('[data-role="editor-readonly-notice"]')).not.toBeNull();
  expect(document.querySelector('[data-action="save-editor"]')).toBeNull();
  expect(document.querySelector('[data-action="save-and-switch"]')).toBeNull();
  expect(fetchMock).toHaveBeenCalledWith(
    "https://codex-helper.ite.tool4seller.com/codex/api/profiles",
    { cache: "no-store", headers: { Authorization: "Bearer cas_test_token" } },
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-1",
    { cache: "no-store", headers: { Authorization: "Bearer cas_test_token" } },
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-1/auth.json",
    { cache: "no-store", headers: { Authorization: "Bearer cas_test_token" } },
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-1/config.toml",
    { cache: "no-store", headers: { Authorization: "Bearer cas_test_token" } },
  );
});

test("imports a network shared profile detail as an editable local profile", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  localStorage.setItem("codex-auth-switch.networkProfileToken", "cas_test_token");

  const emptySnapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-04-16T00:00:00Z",
    targetAuthTypeLabel: null,
    activeProfileId: null,
    lastSelectedProfileId: null,
    lastSwitchProfileId: null,
    lastSwitchedAt: null,
    codexUsageApiEnabled: false,
    profiles: [],
  };
  const importedSnapshot = {
    ...emptySnapshot,
    profiles: [
      {
        id: "local-imported-1",
        name: "Team Shared",
        notes: "团队共享配置",
        authTypeLabel: "第三方 API",
        createdAt: "2026-04-16T00:00:00Z",
        updatedAt: "2026-04-16T00:10:00Z",
        authHash: "auth-imported",
        configHash: "config-imported",
        codexUsage: null,
        thirdPartyLatency: null,
        thirdPartyUsage: null,
      },
    ],
  };

  invokeMock.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "load_snapshot") return emptySnapshot;
    if (command === "import_profile") {
      expect(args).toEqual({
        payload: {
          name: "Team Shared",
          notes: "团队共享配置",
          authJson: '{"token":"remote-token"}',
          configToml: 'model = "gpt-5.4"\n',
        },
      });
      return importedSnapshot;
    }
    throw new Error(`unexpected command: ${command}`);
  });

  const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = input.toString();
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/auth/me") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: { dingUserId: "Ding-A", name: "Alice" } }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/users") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ users: [] }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles") {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "remote-1",
            name: "Team Shared",
            description: "团队共享配置",
            createdAt: "2026-04-16T00:00:00Z",
            files: ["auth.json", "config.toml"],
          },
        ],
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-1") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "remote-1",
          name: "Team Shared",
          description: "团队共享配置",
          createdAt: "2026-04-16T00:00:00Z",
          files: ["auth.json", "config.toml"],
        }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-1/auth.json") {
      return {
        ok: true,
        status: 200,
        text: async () => '{"token":"remote-token"}',
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-1/config.toml") {
      return {
        ok: true,
        status: 200,
        text: async () => 'model = "gpt-5.4"\n',
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../src/main");
  await flushUi();
  await flushUi();
  await flushUi();

  expect(document.querySelector<HTMLButtonElement>('[data-action="nav-sharing"]')).not.toBeNull();
  document
    .querySelector<HTMLButtonElement>('[data-action="nav-sharing"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  expect(document.querySelector('[data-page="sharing-center"]')).not.toBeNull();
  document
    .querySelector<HTMLButtonElement>('[data-action="sharing-tab-library"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  expect(
    document.querySelector<HTMLButtonElement>('[data-action="view-network-profile-details"][data-id="remote-1"]'),
  ).not.toBeNull();
  document
    .querySelector<HTMLButtonElement>('[data-action="view-network-profile-details"][data-id="remote-1"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  expect(document.querySelector('[data-page="editor"]')).not.toBeNull();
  expect(document.querySelector<HTMLButtonElement>('[data-action="import-current-network-profile"]')).not.toBeNull();
  document
    .querySelector<HTMLButtonElement>('[data-action="import-current-network-profile"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("import_profile", {
    payload: {
      name: "Team Shared",
      notes: "团队共享配置",
      authJson: '{"token":"remote-token"}',
      configToml: 'model = "gpt-5.4"\n',
    },
  });

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-profiles"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  expect(document.querySelector('[data-role="profile-row"]')?.textContent).toContain("Team Shared");
});

test("deletes a saved profile after confirmation", async () => {
  const initialSnapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-03-20T00:00:00Z",
    targetAuthTypeLabel: "第三方 API",
    activeProfileId: "profile-2",
    lastSelectedProfileId: "profile-2",
    lastSwitchProfileId: "profile-2",
    lastSwitchedAt: "2026-03-20T00:00:00Z",
    profiles: [
      {
        id: "profile-1",
        name: "Work Team",
        notes: "工作主账号，常驻使用。",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-03-16T01:00:00Z",
        updatedAt: "2026-03-18T12:20:00Z",
        authHash: "7da2e87f1bc3",
        configHash: "92ca2d10aa51",
      },
      {
        id: "profile-2",
        name: "淘宝 1",
        notes: "主工作账号，额度稳定。",
        authTypeLabel: "第三方 API",
        createdAt: "2026-03-17T01:00:00Z",
        updatedAt: "2026-03-19T04:12:00Z",
        authHash: "d18ff783cb10",
        configHash: "c450c91961af",
      },
    ],
  };

  const deletedSnapshot = {
    ...initialSnapshot,
    profiles: initialSnapshot.profiles.filter((profile) => profile.id !== "profile-1"),
  };

  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return initialSnapshot;
    }
    if (command === "get_profile_document") {
      return {
        id: "profile-1",
        name: "Work Team",
        notes: "工作主账号，常驻使用。",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-03-16T01:00:00Z",
        updatedAt: "2026-03-18T12:20:00Z",
        authJson: '{"token":"test"}',
        configToml: 'model_provider = "openai"\n',
        loadedFromTarget: false,
        hasTargetChanges: false,
      };
    }
    if (command === "delete_profile") {
      return deletedSnapshot;
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="view-profile-details"][data-id="profile-1"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  // Click the delete button in the detail page — this opens the custom DOM confirm dialog (nativeConfirm)
  document
    .querySelector<HTMLButtonElement>('[data-action="delete-profile"][data-id="profile-1"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await flushUi();

  // Click the "确定" / OK button inside the nativeConfirm overlay
  const okBtn = document.querySelector<HTMLButtonElement>("#btn-ok");
  expect(okBtn).not.toBeNull();
  okBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await flushUi();
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("delete_profile", { profileId: "profile-1" });
  expect(document.querySelectorAll("[data-role='profile-row']")).toHaveLength(1);
});

test("shows Applications install guidance before checking for update on macOS", async () => {
  const initialSnapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-03-20T00:00:00Z",
    targetAuthTypeLabel: "第三方 API",
    activeProfileId: "profile-2",
    lastSelectedProfileId: "profile-2",
    lastSwitchProfileId: "profile-2",
    lastSwitchedAt: "2026-03-20T00:00:00Z",
    profiles: [
      {
        id: "profile-2",
        name: "淘宝 1",
        notes: "主工作账号，额度稳定。",
        authTypeLabel: "第三方 API",
        createdAt: "2026-03-17T01:00:00Z",
        updatedAt: "2026-03-19T04:12:00Z",
        authHash: "d18ff783cb10",
        configHash: "c450c91961af",
      },
    ],
  };

  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return initialSnapshot;
    }
    if (command === "check_install_location") {
      return {
        updateSafe: false,
        requiresApplicationsInstall: true,
        installPath: "/Users/example/Downloads/Codex 助手.app",
        message:
          "当前应用不在 Applications 文件夹中。请先将 Codex 助手拖到 Applications 后再重新打开，然后再执行更新。",
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="check-update"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await flushUi();

  expect(document.body.textContent).toContain("当前应用不在 Applications 文件夹中");
});

test("refreshes all profiles (official and third-party) when clicking global refresh all button", async () => {
  const snapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-03-25T00:00:00Z",
    targetAuthTypeLabel: "官方 OAuth",
    activeProfileId: "profile-1",
    lastSelectedProfileId: "profile-1",
    lastSwitchProfileId: "profile-1",
    lastSwitchedAt: "2026-03-25T00:00:00Z",
    codexUsageApiEnabled: true,
    profiles: [
      {
        id: "profile-1",
        name: "Official",
        notes: "official account",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T13:24:00Z",
        authHash: "auth-official",
        configHash: "config-official",
        codexUsage: null,
        thirdPartyLatency: null,
        thirdPartyUsage: null,
      },
      {
        id: "profile-2",
        name: "ThirdParty",
        notes: "third party account",
        authTypeLabel: "第三方 API",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T13:24:00Z",
        authHash: "auth-thirdparty",
        configHash: "config-thirdparty",
        codexUsage: null,
        thirdPartyLatency: null,
        thirdPartyUsage: null,
      },
    ],
  };

  const commandsCalled: { command: string; args?: any }[] = [];

  invokeMock.mockImplementation(async (command: string, args?: any) => {
    commandsCalled.push({ command, args });
    if (command === "load_snapshot") {
      return snapshot;
    }
    if (command === "refresh_all_codex_usage") {
      return snapshot;
    }
    if (command === "refresh_profile_third_party_usage") {
      return snapshot;
    }
    throw new Error(`unexpected command: ${command}`);
  });

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  await import("../src/main");
  await flushUi();

  const refreshAllButton = document.querySelector<HTMLButtonElement>(
    '[data-action="refresh-all-codex-usage"]'
  );
  expect(refreshAllButton).not.toBeNull();

  refreshAllButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  // Verify that both Tauri commands were called
  expect(commandsCalled.some((c) => c.command === "refresh_all_codex_usage")).toBe(true);
  expect(commandsCalled.some(
    (c) => c.command === "refresh_profile_third_party_usage" && c.args?.profileId === "profile-2"
  )).toBe(true);
});
