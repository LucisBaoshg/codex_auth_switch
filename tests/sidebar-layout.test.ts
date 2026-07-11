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

function configRecoverySnapshot() {
  return {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-07-10T00:00:00Z",
    targetAuthTypeLabel: null,
    activeProfileId: null,
    lastSelectedProfileId: null,
    lastSwitchProfileId: null,
    lastSwitchedAt: null,
    codexUsageApiEnabled: false,
    profiles: [],
    configRecoveryNotices: [{
      id: "notice-1",
      kind: "profileMetadata",
      sourcePath: "/profiles/one/meta.json",
      recoveryPath: "/recovery/profiles/one/meta.json",
      profileId: "one",
      summary: "档案 one 的 meta.json 无法解析",
      action: "重新导入这个档案。",
      occurredAt: "2026-07-10T00:00:00Z",
    }],
  };
}

test("acknowledges config recovery notice and does not show it twice", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") return configRecoverySnapshot();
    if (command === "acknowledge_config_recovery") return null;
    throw new Error(`unexpected command: ${command}`);
  });

  await import("../src/main");
  await flushUi();

  expect(document.querySelector('[data-role="config-recovery-dialog"]')).not.toBeNull();
  document
    .querySelector<HTMLButtonElement>('[data-action="acknowledge-config-recovery"]')
    ?.click();
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("acknowledge_config_recovery", {
    noticeIds: ["notice-1"],
  });
  expect(document.querySelector('[data-role="config-recovery-dialog"]')).toBeNull();

  document
    .querySelector<HTMLButtonElement>('[data-action="refresh"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  expect(document.querySelector('[data-role="config-recovery-dialog"]')).toBeNull();
});

test("opens recovery directory before acknowledging config recovery", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") return configRecoverySnapshot();
    if (command === "open_config_recovery_dir") return null;
    if (command === "acknowledge_config_recovery") return null;
    throw new Error(`unexpected command: ${command}`);
  });

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="open-config-recovery-dir"]')
    ?.click();
  await flushUi();
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("open_config_recovery_dir", undefined);
  expect(invokeMock).toHaveBeenCalledWith("acknowledge_config_recovery", {
    noticeIds: ["notice-1"],
  });
  const openOrder = invokeMock.mock.invocationCallOrder.find((_, index) =>
    invokeMock.mock.calls[index]?.[0] === "open_config_recovery_dir"
  );
  const acknowledgeOrder = invokeMock.mock.invocationCallOrder.find((_, index) =>
    invokeMock.mock.calls[index]?.[0] === "acknowledge_config_recovery"
  );
  expect(openOrder).toBeLessThan(acknowledgeOrder!);
});

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
  expect(liveRow?.querySelector('[data-action="refresh-third-party-usage"]')?.textContent).toContain("用量");
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
  expect(officialRow?.querySelector('[data-action="refresh-codex-usage"]')?.textContent).toContain("用量");
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
  expect(row?.textContent).toContain("用量");
  expect(row?.textContent).toContain("失败");

  document
    .querySelector<HTMLButtonElement>('[data-action="view-profile-details"][data-id="profile-1"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();

  expect(document.body.textContent).toContain("用量刷新失败");
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

  // Config files now live on the dedicated 配置文件 tab.
  document
    .querySelector<HTMLButtonElement>('[data-action="editor-detail-config"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

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

test("re-sharing an owned local profile updates the existing enterprise shared profile files", async () => {
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
    targetUpdatedAt: "2026-06-05T00:00:00Z",
    targetAuthTypeLabel: "官方 OAuth",
    activeProfileId: "local-chatgpt-pro",
    lastSelectedProfileId: "local-chatgpt-pro",
    lastSwitchProfileId: "local-chatgpt-pro",
    lastSwitchedAt: "2026-06-05T00:00:00Z",
    codexUsageApiEnabled: false,
    profiles: [
      {
        id: "local-chatgpt-pro",
        name: "ChatGPT Pro",
        notes: "自动从当前 Codex 配置生成",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-06-04T10:00:00Z",
        updatedAt: "2026-06-05T08:00:00Z",
        authHash: "auth-new",
        configHash: "config-new",
        codexUsage: null,
        thirdPartyLatency: null,
        thirdPartyUsage: null,
      },
    ],
  };
  const remoteProfiles = [
    {
      id: "remote-owned",
      name: "ChatGPT Pro",
      description: "自动从当前 Codex 配置生成",
      authTypeLabel: "官方 OAuth",
      createdAt: "2026-06-04T10:00:00Z",
      updatedAt: "2026-06-04T10:00:00Z",
      files: ["auth.json", "config.toml"],
      ownerDingUserId: "Ding-A",
      ownerName: "Alice",
      visibility: "selected",
      sharedWith: ["Ding-B"],
      sourceProfileId: "local-chatgpt-pro",
    },
  ];
  const updateBodies: Record<string, unknown>[] = [];

  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") return snapshot;
    if (command === "get_profile_document") {
      return {
        id: "local-chatgpt-pro",
        name: "ChatGPT Pro",
        notes: "自动从当前 Codex 配置生成",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-06-04T10:00:00Z",
        updatedAt: "2026-06-05T08:00:00Z",
        authJson: '{"auth_mode":"chatgpt","tokens":{"access_token":"new-token"}}',
        configToml: 'model = "gpt-5.5"\n',
        loadedFromTarget: true,
        hasTargetChanges: true,
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

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
        json: async () => ({ users: [{ dingUserId: "Ding-B", label: "Bob", mobile: "13900000002" }] }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-owned" && init?.method === "POST") {
      updateBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ...remoteProfiles[0],
          updatedAt: "2026-06-05T08:00:00Z",
          contentVersion: 2,
          contentHash: "new-content-hash",
        }),
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

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-sharing"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="share-local-profile"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  expect(fetchMock).not.toHaveBeenCalledWith(
    "https://codex-helper.ite.tool4seller.com/codex/api/profiles",
    expect.objectContaining({ method: "POST" }),
  );
  expect(updateBodies).toHaveLength(1);
  expect(updateBodies[0]).toEqual(expect.objectContaining({
    name: "ChatGPT Pro",
    description: "自动从当前 Codex 配置生成",
    visibility: "selected",
    sharedWith: ["Ding-B"],
    sourceProfileId: "local-chatgpt-pro",
    authContent: '{"auth_mode":"chatgpt","tokens":{"access_token":"new-token"}}',
    configContent: 'model = "gpt-5.5"\n',
  }));
});

test("re-sharing warns when the enterprise backend does not return content version metadata", async () => {
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
    targetUpdatedAt: "2026-06-05T00:00:00Z",
    targetAuthTypeLabel: "官方 OAuth",
    activeProfileId: "local-chatgpt-pro",
    lastSelectedProfileId: "local-chatgpt-pro",
    lastSwitchProfileId: "local-chatgpt-pro",
    lastSwitchedAt: "2026-06-05T00:00:00Z",
    codexUsageApiEnabled: false,
    profiles: [
      {
        id: "local-chatgpt-pro",
        name: "ChatGPT Pro",
        notes: "自动从当前 Codex 配置生成",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-06-04T10:00:00Z",
        updatedAt: "2026-06-05T08:00:00Z",
        authHash: "auth-new",
        configHash: "config-new",
        codexUsage: null,
        thirdPartyLatency: null,
        thirdPartyUsage: null,
      },
    ],
  };
  const remoteProfiles = [
    {
      id: "remote-owned",
      name: "ChatGPT Pro",
      description: "自动从当前 Codex 配置生成",
      authTypeLabel: "官方 OAuth",
      createdAt: "2026-06-04T10:00:00Z",
      updatedAt: "2026-06-04T10:00:00Z",
      files: ["auth.json", "config.toml"],
      ownerDingUserId: "Ding-A",
      ownerName: "Alice",
      visibility: "selected",
      sharedWith: ["Ding-B"],
    },
  ];

  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") return snapshot;
    if (command === "get_profile_document") {
      return {
        id: "local-chatgpt-pro",
        name: "ChatGPT Pro",
        notes: "自动从当前 Codex 配置生成",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-06-04T10:00:00Z",
        updatedAt: "2026-06-05T08:00:00Z",
        authJson: '{"auth_mode":"chatgpt","tokens":{"access_token":"new-token"}}',
        configToml: 'model = "gpt-5.5"\n',
        loadedFromTarget: true,
        hasTargetChanges: true,
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
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
        json: async () => ({ users: [{ dingUserId: "Ding-B", label: "Bob" }] }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-owned" && init?.method === "POST") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ...remoteProfiles[0], updatedAt: "2026-06-17T02:55:02Z" }),
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

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-sharing"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="share-local-profile"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  expect(document.body.textContent).toContain("企业共享库服务端尚未升级");
});

test("edits recipients for an owned shared profile and shows its share count in the library tab", async () => {
  localStorage.setItem("codex-auth-switch.networkProfileToken", "cas_test_token");

  let remoteProfiles = [
    {
      id: "remote-owned",
      name: "ChatGPT Pro",
      description: "自动从当前 Codex 配置生成",
      authTypeLabel: "官方 OAuth",
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
  const editUserList = document.querySelector<HTMLElement>('[data-role="share-user-list"]');
  expect(editUserList).not.toBeNull();
  editUserList!.scrollTop = 96;
  bobCheckbox!.checked = true;
  bobCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
  await flushUi();
  expect(document.querySelector<HTMLElement>('[data-role="share-user-list"]')?.scrollTop).toBe(96);

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

  expect(document.body.textContent).toContain("确定删除「ChatGPT Pro」吗？删除后其他人将无法再导入这套共享配置。");
  document.querySelector<HTMLButtonElement>("#btn-ok")?.click();
  await flushUi();
  await flushUi();
  await flushUi();

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

test("deletes an owned shared profile through native desktop networking", async () => {
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
    targetUpdatedAt: "2026-06-04T10:00:00Z",
    targetAuthTypeLabel: "官方 OAuth",
    activeProfileId: null,
    lastSelectedProfileId: null,
    lastSwitchProfileId: null,
    lastSwitchedAt: null,
    codexUsageApiEnabled: false,
    profiles: [
      {
        id: "local-owned",
        name: "ChatGPT Pro",
        notes: "自动从当前 Codex 配置生成",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-06-04T10:00:00Z",
        updatedAt: "2026-06-04T10:00:00Z",
        authHash: "auth",
        configHash: "config",
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
    if (command === "delete_network_profile") {
      return { status: 200, body: "" };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  let remoteProfiles = [
    {
      id: "remote-owned",
      name: "ChatGPT Pro",
      description: "自动从当前 Codex 配置生成",
      createdAt: "2026-06-04T10:00:00Z",
      updatedAt: "2026-06-04T10:00:00Z",
      files: ["auth.json", "config.toml"],
      sourceProfileId: "local-owned",
      ownerDingUserId: "Ding-A",
      ownerName: "Alice",
      visibility: "public",
      sharedWith: [],
    },
  ];
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
        json: async () => ({ users: [] }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles") {
      const profiles = remoteProfiles;
      remoteProfiles = [];
      return {
        ok: true,
        status: 200,
        json: async () => profiles,
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../src/main");
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

  document
    .querySelector<HTMLButtonElement>('[data-action="delete-shared-profile"][data-id="remote-owned"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  document.querySelector<HTMLButtonElement>("#btn-ok")?.click();
  await flushUi();
  await flushUi();
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("delete_network_profile", {
    url: "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-owned",
    token: "cas_test_token",
  });
  expect(fetchMock).not.toHaveBeenCalledWith(
    "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-owned",
    expect.anything(),
  );
  expect(document.querySelector('[data-role="local-share-form"]')?.textContent).toContain("未共享");
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
            authTypeLabel: "官方 OAuth",
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
          authTypeLabel: "官方 OAuth",
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
  await flushUi();
  await flushUi();
  await flushUi();
  await flushUi();
  await flushUi();
  await flushUi();

  expect(document.querySelector('[data-page="editor"]')).not.toBeNull();
  expect(document.querySelector<HTMLInputElement>("#editor-name")?.disabled).toBe(true);
  expect(document.querySelector('[data-role="editor-readonly-notice"]')).not.toBeNull();

  // Config files now live on the dedicated 配置文件 tab.
  document
    .querySelector<HTMLButtonElement>('[data-action="editor-detail-config"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  expect(document.querySelector<HTMLTextAreaElement>("#editor-auth-json")?.disabled).toBe(true);
  expect(document.querySelector<HTMLTextAreaElement>("#editor-config-toml")?.disabled).toBe(true);
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
    if (command === "set_profile_remote_metadata") {
      expect(args).toEqual({
        profileId: "local-imported-1",
        remoteProfileId: "remote-1",
        remoteContentVersion: null,
        remoteContentHash: null,
        remoteUpdatedAt: "2026-04-16T00:00:00Z",
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
            authTypeLabel: "官方 OAuth",
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
          authTypeLabel: "官方 OAuth",
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
  expect(invokeMock).toHaveBeenCalledWith("set_profile_remote_metadata", {
    profileId: "local-imported-1",
    remoteProfileId: "remote-1",
    remoteContentVersion: null,
    remoteContentHash: null,
    remoteUpdatedAt: "2026-04-16T00:00:00Z",
  });

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-profiles"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  expect(document.querySelector('[data-role="profile-row"]')?.textContent).toContain("Team Shared");
});

test("prompts to update and restarts Codex when the active shared profile has a newer cloud version", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  localStorage.setItem("codex-auth-switch.networkProfileToken", "cas_test_token");

  const initialSnapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-06-04T10:00:00Z",
    targetAuthTypeLabel: "第三方 API",
    activeProfileId: "local-shared-1",
    lastSelectedProfileId: "local-shared-1",
    lastSwitchProfileId: "local-shared-1",
    lastSwitchedAt: "2026-06-04T10:00:00Z",
    codexUsageApiEnabled: false,
    profiles: [
      {
        id: "local-shared-1",
        name: "Team Shared",
        notes: "团队共享配置",
        authTypeLabel: "第三方 API",
        createdAt: "2026-06-04T09:00:00Z",
        updatedAt: "2026-06-04T10:00:00Z",
        authHash: "auth-old",
        configHash: "config-old",
        remoteProfileId: "remote-1",
        remoteContentVersion: 1,
        remoteContentHash: "old-content",
        remoteUpdatedAt: "2026-06-04T10:00:00Z",
        codexUsage: null,
        thirdPartyLatency: null,
        thirdPartyUsage: null,
      },
    ],
  };
  const updatedSnapshot = {
    ...initialSnapshot,
    profiles: [
      {
        ...initialSnapshot.profiles[0],
        updatedAt: "2026-06-05T08:00:00Z",
        authHash: "auth-new",
        configHash: "config-new",
        remoteContentVersion: 2,
        remoteContentHash: "new-content",
        remoteUpdatedAt: "2026-06-05T08:00:00Z",
      },
    ],
  };

  invokeMock.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "load_snapshot") return initialSnapshot;
    if (command === "update_profile") {
      expect(args).toEqual({
        profileId: "local-shared-1",
        payload: {
          name: "Team Shared",
          notes: "团队共享配置",
          authJson: '{"token":"new-cloud-token"}',
          configToml: 'model = "gpt-5.5"\n',
        },
      });
      return updatedSnapshot;
    }
    if (command === "set_profile_remote_metadata") {
      expect(args).toEqual({
        profileId: "local-shared-1",
        remoteProfileId: "remote-1",
        remoteContentVersion: 2,
        remoteContentHash: "new-content",
        remoteUpdatedAt: "2026-06-05T08:00:00Z",
      });
      return updatedSnapshot;
    }
    if (command === "switch_profile") {
      expect(args).toEqual({ profileId: "local-shared-1" });
      return updatedSnapshot;
    }
    if (command === "restart_codex") return undefined;
    throw new Error(`unexpected command: ${command}`);
  });

  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = input.toString();
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/auth/me") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: { dingUserId: "Ding-B", name: "Bob" } }),
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
            createdAt: "2026-06-04T09:00:00Z",
            updatedAt: "2026-06-05T08:00:00Z",
            contentVersion: 2,
            contentHash: "new-content",
            contentUpdatedAt: "2026-06-05T08:00:00Z",
            files: ["auth.json", "config.toml"],
            ownerDingUserId: "Ding-A",
            visibility: "public",
            sharedWith: [],
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
          createdAt: "2026-06-04T09:00:00Z",
          updatedAt: "2026-06-05T08:00:00Z",
          contentVersion: 2,
          contentHash: "new-content",
          contentUpdatedAt: "2026-06-05T08:00:00Z",
          files: ["auth.json", "config.toml"],
        }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-1/auth.json") {
      return {
        ok: true,
        status: 200,
        text: async () => '{"token":"new-cloud-token"}',
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-1/config.toml") {
      return {
        ok: true,
        status: 200,
        text: async () => 'model = "gpt-5.5"\n',
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../src/main");
  await flushUi();
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-sharing"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  expect(document.body.textContent).toContain("Team Shared");
  expect(document.body.textContent).toContain("v2");
  document.querySelector<HTMLButtonElement>("#btn-ok")?.click();
  await flushUi();
  await flushUi();
  await flushUi();
  await flushUi();
  await flushUi();
  await flushUi();
  await flushUi();
  await flushUi();
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("update_profile", expect.objectContaining({ profileId: "local-shared-1" }));
  expect(invokeMock).toHaveBeenCalledWith("set_profile_remote_metadata", expect.objectContaining({ profileId: "local-shared-1" }));
  expect(invokeMock).toHaveBeenCalledWith("switch_profile", { profileId: "local-shared-1" });
  expect(invokeMock).toHaveBeenCalledWith("restart_codex", undefined);
  expect(document.body.textContent).toContain("已更新并重启 Codex");
});

test("shows a stale shared profile version notice in local profile details and updates from cloud", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  localStorage.setItem("codex-auth-switch.networkProfileToken", "cas_test_token");

  const initialSnapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-06-24T10:00:00Z",
    targetAuthTypeLabel: "官方 OAuth",
    activeProfileId: "other-profile",
    lastSelectedProfileId: "other-profile",
    lastSwitchProfileId: "other-profile",
    lastSwitchedAt: "2026-06-24T10:00:00Z",
    codexUsageApiEnabled: false,
    profiles: [
      {
        id: "local-shared-oauth",
        name: "ChatGPT Pro",
        notes: "共享官方 OAuth",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-06-24T09:00:00Z",
        updatedAt: "2026-06-24T10:00:00Z",
        authHash: "auth-old",
        configHash: "config-old",
        remoteProfileId: "remote-oauth",
        remoteContentVersion: 1,
        remoteContentHash: "hash-v1",
        remoteUpdatedAt: "2026-06-24T09:30:00Z",
        codexUsage: null,
        thirdPartyLatency: null,
        thirdPartyUsage: null,
      },
      {
        id: "other-profile",
        name: "Other",
        notes: "",
        authTypeLabel: "第三方 API",
        createdAt: "2026-06-24T09:00:00Z",
        updatedAt: "2026-06-24T09:00:00Z",
        authHash: "auth-other",
        configHash: "config-other",
        remoteProfileId: null,
        remoteContentVersion: null,
        remoteContentHash: null,
        remoteUpdatedAt: null,
        codexUsage: null,
        thirdPartyLatency: null,
        thirdPartyUsage: null,
      },
    ],
  };
  const updatedSnapshot = {
    ...initialSnapshot,
    profiles: [
      {
        ...initialSnapshot.profiles[0],
        updatedAt: "2026-06-24T11:00:00Z",
        authHash: "auth-new",
        configHash: "config-new",
        remoteContentVersion: 2,
        remoteContentHash: "hash-v2",
        remoteUpdatedAt: "2026-06-24T11:00:00Z",
      },
      initialSnapshot.profiles[1],
    ],
  };

  invokeMock.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "load_snapshot") return initialSnapshot;
    if (command === "get_pac_proxy_status") {
      return {
        supported: false,
        enabled: false,
        pacUrl: "http://10.12.0.24/proxy.pac",
        selectedPacKey: "jp",
        pacOptions: [],
        availableServices: [],
        selectedServices: [],
        services: [],
        message: "PAC 状态尚未加载。",
      };
    }
    if (command === "get_profile_document") {
      expect(args).toEqual({ profileId: "local-shared-oauth" });
      return {
        id: "local-shared-oauth",
        name: "ChatGPT Pro",
        notes: "共享官方 OAuth",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-06-24T09:00:00Z",
        updatedAt: "2026-06-24T10:00:00Z",
        remoteProfileId: "remote-oauth",
        remoteContentVersion: 1,
        remoteContentHash: "hash-v1",
        remoteUpdatedAt: "2026-06-24T09:30:00Z",
        authJson: '{"auth_mode":"chatgpt","tokens":{"refresh_token":"old-refresh"}}',
        configToml: 'model = "gpt-5"\n',
        loadedFromTarget: false,
        hasTargetChanges: false,
        readOnly: false,
      };
    }
    if (command === "update_profile") {
      expect(args).toEqual({
        profileId: "local-shared-oauth",
        payload: {
          name: "ChatGPT Pro",
          notes: "共享官方 OAuth",
          authJson: '{"auth_mode":"chatgpt","tokens":{"refresh_token":"new-refresh"}}',
          configToml: 'model = "gpt-5.5"\n',
        },
      });
      return updatedSnapshot;
    }
    if (command === "set_profile_remote_metadata") {
      expect(args).toEqual({
        profileId: "local-shared-oauth",
        remoteProfileId: "remote-oauth",
        remoteContentVersion: 2,
        remoteContentHash: "hash-v2",
        remoteUpdatedAt: "2026-06-24T11:00:00Z",
      });
      return updatedSnapshot;
    }
    throw new Error(`unexpected command: ${command}`);
  });

  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = input.toString();
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/auth/me") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: { dingUserId: "Ding-B", name: "Bob" } }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles") {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "remote-oauth",
            name: "ChatGPT Pro",
            description: "共享官方 OAuth",
            createdAt: "2026-06-24T09:00:00Z",
            updatedAt: "2026-06-24T11:00:00Z",
            contentVersion: 2,
            contentHash: "hash-v2",
            contentUpdatedAt: "2026-06-24T11:00:00Z",
            files: ["auth.json", "config.toml"],
            ownerDingUserId: "Ding-A",
            visibility: "selected",
            sharedWith: ["Ding-B"],
          },
        ],
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-oauth") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "remote-oauth",
          name: "ChatGPT Pro",
          description: "共享官方 OAuth",
          createdAt: "2026-06-24T09:00:00Z",
          updatedAt: "2026-06-24T11:00:00Z",
          contentVersion: 2,
          contentHash: "hash-v2",
          contentUpdatedAt: "2026-06-24T11:00:00Z",
          files: ["auth.json", "config.toml"],
        }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-oauth/auth.json") {
      return {
        ok: true,
        status: 200,
        text: async () => '{"auth_mode":"chatgpt","tokens":{"refresh_token":"new-refresh"}}',
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-oauth/config.toml") {
      return {
        ok: true,
        status: 200,
        text: async () => 'model = "gpt-5.5"\n',
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../src/main");
  await flushUi();
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="view-profile-details"][data-id="local-shared-oauth"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  expect(document.querySelector('[data-role="shared-version-status"]')?.textContent).toContain("共享中心有新版本");
  expect(document.querySelector('[data-role="shared-version-status"]')?.textContent).toContain("本地 v1");
  expect(document.querySelector('[data-role="shared-version-status"]')?.textContent).toContain("共享中心 v2");

  document
    .querySelector<HTMLButtonElement>('[data-action="update-shared-profile-from-cloud"][data-id="local-shared-oauth"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();
  await flushUi();
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("update_profile", expect.objectContaining({
    profileId: "local-shared-oauth",
  }));
  expect(invokeMock).toHaveBeenCalledWith("set_profile_remote_metadata", expect.objectContaining({
    profileId: "local-shared-oauth",
  }));
  expect(invokeMock).not.toHaveBeenCalledWith("restart_codex", undefined);
  expect(document.body.textContent).toContain("已更新共享配置");
});

test("shows a not found result after checking a missing shared center profile version", async () => {
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
    targetUpdatedAt: "2026-06-24T10:00:00Z",
    targetAuthTypeLabel: "官方 OAuth",
    activeProfileId: null,
    lastSelectedProfileId: null,
    lastSwitchProfileId: null,
    lastSwitchedAt: null,
    codexUsageApiEnabled: false,
    profiles: [
      {
        id: "local-shared-oauth",
        name: "ChatGPT Pro",
        notes: "共享官方 OAuth",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-06-24T09:00:00Z",
        updatedAt: "2026-06-24T10:00:00Z",
        authHash: "auth-old",
        configHash: "config-old",
        remoteProfileId: "remote-missing",
        remoteContentVersion: 1,
        remoteContentHash: "hash-v1",
        remoteUpdatedAt: "2026-06-24T09:30:00Z",
        codexUsage: null,
        thirdPartyLatency: null,
        thirdPartyUsage: null,
      },
    ],
  };

  invokeMock.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "load_snapshot") return snapshot;
    if (command === "get_pac_proxy_status") {
      return {
        supported: false,
        enabled: false,
        pacUrl: "http://10.12.0.24/proxy.pac",
        selectedPacKey: "jp",
        pacOptions: [],
        availableServices: [],
        selectedServices: [],
        services: [],
        message: "PAC 状态尚未加载。",
      };
    }
    if (command === "get_profile_document") {
      expect(args).toEqual({ profileId: "local-shared-oauth" });
      return {
        id: "local-shared-oauth",
        name: "ChatGPT Pro",
        notes: "共享官方 OAuth",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-06-24T09:00:00Z",
        updatedAt: "2026-06-24T10:00:00Z",
        remoteProfileId: "remote-missing",
        remoteContentVersion: 1,
        remoteContentHash: "hash-v1",
        remoteUpdatedAt: "2026-06-24T09:30:00Z",
        authJson: '{"auth_mode":"chatgpt"}',
        configToml: 'model = "gpt-5"\n',
        loadedFromTarget: false,
        hasTargetChanges: false,
        readOnly: false,
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = input.toString();
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/auth/me") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: { dingUserId: "Ding-B", name: "Bob" } }),
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

  document
    .querySelector<HTMLButtonElement>('[data-action="view-profile-details"][data-id="local-shared-oauth"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  expect(document.querySelector('[data-role="shared-version-status"]')?.textContent).toContain("共享中心未找到对应配置");
});

test("relinks a missing shared profile to the unique same-name cloud profile when updating", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  localStorage.setItem("codex-auth-switch.networkProfileToken", "cas_test_token");

  const initialProfile = {
    id: "local-shared-oauth",
    name: "ChatGPT Pro",
    notes: "共享官方 OAuth",
    authTypeLabel: "官方 OAuth",
    createdAt: "2026-06-24T09:00:00Z",
    updatedAt: "2026-06-24T10:00:00Z",
    authHash: "auth-old",
    configHash: "config-old",
    remoteProfileId: "remote-old",
    remoteContentVersion: 1,
    remoteContentHash: "hash-old",
    remoteUpdatedAt: "2026-06-24T09:30:00Z",
    codexUsage: null,
    thirdPartyLatency: null,
    thirdPartyUsage: null,
  };
  const initialSnapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-06-24T10:00:00Z",
    targetAuthTypeLabel: "官方 OAuth",
    activeProfileId: null,
    lastSelectedProfileId: null,
    lastSwitchProfileId: null,
    lastSwitchedAt: null,
    codexUsageApiEnabled: false,
    profiles: [initialProfile],
  };
  const updatedSnapshot = {
    ...initialSnapshot,
    profiles: [
      {
        ...initialProfile,
        authHash: "auth-new",
        configHash: "config-new",
        updatedAt: "2026-06-24T11:00:00Z",
      },
    ],
  };
  const metadataSnapshot = {
    ...updatedSnapshot,
    profiles: [
      {
        ...updatedSnapshot.profiles[0],
        remoteProfileId: "remote-new",
        remoteContentVersion: 1,
        remoteContentHash: "hash-new",
        remoteUpdatedAt: "2026-06-24T11:00:00Z",
      },
    ],
  };

  invokeMock.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "load_snapshot") return initialSnapshot;
    if (command === "get_pac_proxy_status") {
      return {
        supported: false,
        enabled: false,
        pacUrl: "http://10.12.0.24/proxy.pac",
        selectedPacKey: "jp",
        pacOptions: [],
        availableServices: [],
        selectedServices: [],
        services: [],
        message: "PAC 状态尚未加载。",
      };
    }
    if (command === "get_profile_document") {
      expect(args).toEqual({ profileId: "local-shared-oauth" });
      return {
        id: "local-shared-oauth",
        name: "ChatGPT Pro",
        notes: "共享官方 OAuth",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-06-24T09:00:00Z",
        updatedAt: "2026-06-24T10:00:00Z",
        remoteProfileId: "remote-old",
        remoteContentVersion: 1,
        remoteContentHash: "hash-old",
        remoteUpdatedAt: "2026-06-24T09:30:00Z",
        authJson: '{"auth_mode":"chatgpt","tokens":{"refresh_token":"old-refresh"}}',
        configToml: 'model = "gpt-5"\n',
        loadedFromTarget: false,
        hasTargetChanges: false,
        readOnly: false,
      };
    }
    if (command === "update_profile") {
      expect(args).toEqual({
        profileId: "local-shared-oauth",
        payload: {
          name: "ChatGPT Pro",
          notes: "共享官方 OAuth",
          authJson: '{"auth_mode":"chatgpt","tokens":{"refresh_token":"new-refresh"}}',
          configToml: 'model = "gpt-5.5"\n',
        },
      });
      return updatedSnapshot;
    }
    if (command === "set_profile_remote_metadata") {
      expect(args).toEqual({
        profileId: "local-shared-oauth",
        remoteProfileId: "remote-new",
        remoteContentVersion: 1,
        remoteContentHash: "hash-new",
        remoteUpdatedAt: "2026-06-24T11:00:00Z",
      });
      return metadataSnapshot;
    }
    throw new Error(`unexpected command: ${command}`);
  });

  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = input.toString();
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/auth/me") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: { dingUserId: "Ding-B", name: "Bob" } }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles") {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "remote-new",
            name: "ChatGPT Pro",
            description: "共享官方 OAuth",
            createdAt: "2026-06-24T09:00:00Z",
            updatedAt: "2026-06-24T11:00:00Z",
            contentVersion: 1,
            contentHash: "hash-new",
            contentUpdatedAt: "2026-06-24T11:00:00Z",
            files: ["auth.json", "config.toml"],
          },
        ],
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-new") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "remote-new",
          name: "ChatGPT Pro",
          description: "共享官方 OAuth",
          createdAt: "2026-06-24T09:00:00Z",
          updatedAt: "2026-06-24T11:00:00Z",
          contentVersion: 1,
          contentHash: "hash-new",
          contentUpdatedAt: "2026-06-24T11:00:00Z",
          files: ["auth.json", "config.toml"],
        }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-new/auth.json") {
      return {
        ok: true,
        status: 200,
        text: async () => '{"auth_mode":"chatgpt","tokens":{"refresh_token":"new-refresh"}}',
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-new/config.toml") {
      return {
        ok: true,
        status: 200,
        text: async () => 'model = "gpt-5.5"\n',
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../src/main");
  await flushUi();
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="view-profile-details"][data-id="local-shared-oauth"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  expect(document.querySelector('[data-role="shared-version-status"]')?.textContent).toContain("关联同名配置并更新");

  document
    .querySelector<HTMLButtonElement>('[data-action="update-shared-profile-from-cloud"][data-id="local-shared-oauth"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  for (let i = 0; i < 12; i += 1) {
    await flushUi();
  }

  expect(invokeMock).toHaveBeenCalledWith("set_profile_remote_metadata", {
    profileId: "local-shared-oauth",
    remoteProfileId: "remote-new",
    remoteContentVersion: 1,
    remoteContentHash: "hash-new",
    remoteUpdatedAt: "2026-06-24T11:00:00Z",
  });
  expect(invokeMock).not.toHaveBeenCalledWith("restart_codex", undefined);
  expect(document.body.textContent).toContain("已更新共享配置");
});

test("lays out local profile details in a tabbed overview / config view", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });

  const snapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-06-24T10:00:00Z",
    targetAuthTypeLabel: "官方 OAuth",
    activeProfileId: null,
    lastSelectedProfileId: null,
    lastSwitchProfileId: null,
    lastSwitchedAt: null,
    codexUsageApiEnabled: false,
    profiles: [
      {
        id: "local-oauth",
        name: "ChatGPT Pro",
        notes: "自动从当前 Codex 配置生成",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-06-24T09:00:00Z",
        updatedAt: "2026-06-24T10:00:00Z",
        authHash: "auth-hash",
        configHash: "config-hash",
        remoteProfileId: null,
        remoteContentVersion: null,
        remoteContentHash: null,
        remoteUpdatedAt: null,
        codexUsage: null,
        thirdPartyLatency: null,
        thirdPartyUsage: null,
      },
    ],
  };

  invokeMock.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "load_snapshot") return snapshot;
    if (command === "get_pac_proxy_status") {
      return {
        supported: false,
        enabled: false,
        pacUrl: "http://10.12.0.24/proxy.pac",
        selectedPacKey: "jp",
        pacOptions: [],
        availableServices: [],
        selectedServices: [],
        services: [],
        message: "PAC 状态尚未加载。",
      };
    }
    if (command === "get_profile_document") {
      expect(args).toEqual({ profileId: "local-oauth" });
      return {
        id: "local-oauth",
        name: "ChatGPT Pro",
        notes: "自动从当前 Codex 配置生成",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-06-24T09:00:00Z",
        updatedAt: "2026-06-24T10:00:00Z",
        remoteProfileId: null,
        remoteContentVersion: null,
        remoteContentHash: null,
        remoteUpdatedAt: null,
        authJson: '{"auth_mode":"chatgpt"}',
        configToml: 'model = "gpt-5.5"\n',
        loadedFromTarget: false,
        hasTargetChanges: false,
        readOnly: false,
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  await import("../src/main");
  await vi.waitFor(() => {
    expect(
      document.querySelector('[data-action="view-profile-details"][data-id="local-oauth"]'),
    ).not.toBeNull();
  }, { timeout: 3000 });

  document
    .querySelector<HTMLButtonElement>('[data-action="view-profile-details"][data-id="local-oauth"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  const layout = await vi.waitFor(() => {
    const element = document.querySelector('[data-role="editor-detail-layout"]');
    expect(element).not.toBeNull();
    return element;
  }, { timeout: 3000 });
  // Tabbed detail view: tab bar first, then the active tab panel.
  expect(layout?.children.item(0)?.getAttribute("data-role")).toBe("editor-detail-tabs");
  expect(layout?.children.item(1)?.getAttribute("data-role")).toBe("editor-tab-panel");
  expect(document.querySelector(".editor-sidebar-column")).toBeNull();

  // 概览 tab is active by default: summary present, config panels hidden.
  expect(document.querySelector('[data-role="editor-summary-grid"]')).not.toBeNull();
  expect(document.querySelector('[data-role="editor-summary-section"] #editor-name')).not.toBeNull();
  expect(document.querySelector('[data-role="editor-config-section"]')).toBeNull();

  // Switching to 配置文件 reveals the auth/config editors.
  document
    .querySelector<HTMLButtonElement>('[data-action="editor-detail-config"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => {
    expect(document.querySelector('[data-role="editor-config-section"] #editor-auth-json')).not.toBeNull();
  }, { timeout: 3000 });

  expect(document.querySelector('[data-role="editor-summary-section"]')).toBeNull();
});

test("writes back refreshed shared auth on startup when the active target changed", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  localStorage.setItem("codex-auth-switch.networkProfileToken", "cas_test_token");

  const initialSnapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-06-24T10:00:00Z",
    targetAuthTypeLabel: "官方 OAuth",
    activeProfileId: "local-shared-oauth",
    lastSelectedProfileId: "local-shared-oauth",
    lastSwitchProfileId: "local-shared-oauth",
    lastSwitchedAt: "2026-06-24T10:00:00Z",
    codexUsageApiEnabled: false,
    profiles: [
      {
        id: "local-shared-oauth",
        name: "ChatGPT Pro",
        notes: "共享官方 OAuth",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-06-24T09:00:00Z",
        updatedAt: "2026-06-24T10:00:00Z",
        authHash: "auth-old",
        configHash: "config-old",
        remoteProfileId: "remote-oauth",
        remoteContentVersion: 3,
        remoteContentHash: "hash-v3",
        remoteUpdatedAt: "2026-06-24T09:30:00Z",
        codexUsage: null,
        thirdPartyLatency: null,
        thirdPartyUsage: null,
      },
    ],
  };
  const updatedNetworkProfile = {
    id: "remote-oauth",
    name: "ChatGPT Pro",
    description: "共享官方 OAuth",
    createdAt: "2026-06-24T09:00:00Z",
    updatedAt: "2026-06-24T10:05:00Z",
    contentVersion: 4,
    contentHash: "hash-v4",
    contentUpdatedAt: "2026-06-24T10:05:00Z",
    files: ["auth.json", "config.toml"],
    ownerDingUserId: "Ding-A",
    visibility: "selected",
    sharedWith: ["Ding-B"],
  };
  const updatedSnapshot = {
    ...initialSnapshot,
    profiles: [
      {
        ...initialSnapshot.profiles[0],
        updatedAt: "2026-06-24T10:05:00Z",
        authHash: "auth-new",
        remoteContentVersion: 4,
        remoteContentHash: "hash-v4",
        remoteUpdatedAt: "2026-06-24T10:05:00Z",
      },
    ],
  };

  invokeMock.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "load_snapshot") return initialSnapshot;
    if (command === "get_pac_proxy_status") {
      return {
        supported: false,
        enabled: false,
        pacUrl: "http://10.12.0.24/proxy.pac",
        selectedPacKey: "jp",
        pacOptions: [],
        availableServices: [],
        selectedServices: [],
        services: [],
        message: "PAC 状态尚未加载。",
      };
    }
    if (command === "get_profile_document") {
      expect(args).toEqual({ profileId: "local-shared-oauth" });
      return {
        id: "local-shared-oauth",
        name: "ChatGPT Pro",
        notes: "共享官方 OAuth",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-06-24T09:00:00Z",
        updatedAt: "2026-06-24T10:05:00Z",
        remoteProfileId: "remote-oauth",
        remoteContentVersion: 3,
        remoteContentHash: "hash-v3",
        remoteUpdatedAt: "2026-06-24T09:30:00Z",
        authJson: '{"auth_mode":"chatgpt","tokens":{"refresh_token":"new-refresh"}}',
        configToml: 'model = "gpt-5"\n',
        loadedFromTarget: true,
        hasTargetChanges: true,
        readOnly: false,
      };
    }
    if (command === "network_request") {
      expect(args).toEqual({
        method: "POST",
        url: "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-oauth",
        token: "cas_test_token",
        body: JSON.stringify({
          baseContentVersion: 3,
          baseContentHash: "hash-v3",
          authContent: '{"auth_mode":"chatgpt","tokens":{"refresh_token":"new-refresh"}}',
        }),
      });
      return {
        status: 200,
        body: JSON.stringify(updatedNetworkProfile),
      };
    }
    if (command === "update_profile") {
      expect(args).toEqual({
        profileId: "local-shared-oauth",
        payload: {
          name: "ChatGPT Pro",
          notes: "共享官方 OAuth",
          authJson: '{"auth_mode":"chatgpt","tokens":{"refresh_token":"new-refresh"}}',
          configToml: 'model = "gpt-5"\n',
        },
      });
      return updatedSnapshot;
    }
    if (command === "set_profile_remote_metadata") {
      expect(args).toEqual({
        profileId: "local-shared-oauth",
        remoteProfileId: "remote-oauth",
        remoteContentVersion: 4,
        remoteContentHash: "hash-v4",
        remoteUpdatedAt: "2026-06-24T10:05:00Z",
      });
      return updatedSnapshot;
    }
    throw new Error(`unexpected command: ${command}`);
  });

  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = input.toString();
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/auth/me") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: { dingUserId: "Ding-B", name: "Bob" } }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles") {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            ...updatedNetworkProfile,
            contentVersion: 3,
            contentHash: "hash-v3",
            contentUpdatedAt: "2026-06-24T09:30:00Z",
          },
        ],
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../src/main");
  await flushUi();
  await flushUi();
  await flushUi();
  await flushUi();
  await flushUi();

  expect(fetchMock).toHaveBeenCalledWith(
    "https://codex-helper.ite.tool4seller.com/codex/api/profiles",
    expect.any(Object),
  );
  expect(invokeMock).toHaveBeenCalledWith("network_request", expect.objectContaining({
    method: "POST",
    url: "https://codex-helper.ite.tool4seller.com/codex/api/profiles/remote-oauth",
  }));
  expect(document.body.textContent).not.toContain("请先更新到最新版");
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
