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

test("renders a card-only profile gallery without a left sidebar", async () => {
  await import("../src/main");
  await flushUi();

  expect(document.querySelector('[data-region="sidebar"]')).toBeNull();
  expect(document.querySelector('[data-page="cards"]')).not.toBeNull();
  expect(document.querySelector('[data-role="global-restart"]')).toBeNull();
  expect(document.querySelector('[data-role="global-refresh"]')).not.toBeNull();
  expect(document.querySelector('[data-role="update-entry"]')).not.toBeNull();
  expect(document.querySelector('[data-role="update-entry"]')?.textContent).toContain("检查更新");
  expect(document.querySelector('[data-role="add-card"]')).not.toBeNull();
  expect(document.querySelector(".page-header")).toBeNull();
  expect(document.querySelector('[data-role="current-config-card"]')).toBeNull();
  expect(document.querySelector('[data-role="current-status-band"]')).toBeNull();
  const gridChildren = Array.from(document.querySelectorAll(".card-grid > *"));
  expect(gridChildren[0]?.getAttribute("data-role")).toBe("add-card");
  expect(gridChildren[1]?.getAttribute("data-role")).toBe("profile-card");
  expect(
    document.querySelector('[data-role="current-config-card"] [data-action="restart-codex"]'),
  ).toBeNull();
  expect(
    document.querySelector('[data-role="current-config-card"] [data-action="refresh"]'),
  ).toBeNull();
  expect(
    document.querySelector('[data-role="current-config-card"] [data-action="save-current-as-profile"]'),
  ).toBeNull();
  expect(document.querySelector('[data-role="profile-card"][data-state="live"]')).not.toBeNull();
  expect(document.querySelectorAll("[data-role='profile-card']").length).toBeGreaterThan(0);
  expect(document.querySelectorAll('[data-action="delete-profile"]').length).toBeGreaterThan(0);
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
        installPath: "/Applications/Codex Auth Switch.app",
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
  expect(document.querySelector('[data-role="update-entry"]')?.textContent).toContain("发现新版本");
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
        installPath: "C:/Program Files/Codex Auth Switch",
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
  expect(document.querySelector("#editor-auth-json")).not.toBeNull();
  expect(document.querySelector("#editor-config-toml")).not.toBeNull();
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
    document.querySelector<HTMLButtonElement>('[data-action="new-profile"]')?.hasAttribute("disabled"),
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

  const expectedUpdatedAt = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(probeUpdatedAt));

  expect(document.body.textContent).toContain("第三方 API 测速");
  expect(document.body.textContent).toContain(`更新于：${expectedUpdatedAt}`);
  expect(document.body.textContent).toContain("首 Token");
  expect(document.body.textContent).toContain("1.82s");
  expect(document.body.textContent).toContain("总耗时");
  expect(document.body.textContent).toContain("4.96s");
  expect(document.body.textContent).toContain("responses · gpt-5.4");
  expect(
    document.querySelector('[data-action="refresh-third-party-latency"][data-id="profile-2"]'),
  ).not.toBeNull();
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

test("shows a manual-restart success message after switching profiles", async () => {
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

  expect(document.body.textContent).toContain("profile 切换成功，请重启 Codex 使用");
  expect(invokeMock).toHaveBeenCalledWith("switch_profile", { profileId: "profile-1" });
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

  // Click the delete button — this opens the custom DOM confirm dialog (nativeConfirm)
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
  expect(document.querySelectorAll("[data-role='profile-card']")).toHaveLength(1);
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
        installPath: "/Users/example/Downloads/Codex Auth Switch.app",
        message:
          "当前应用不在 Applications 文件夹中。请先将 Codex Auth Switch 拖到 Applications 后再重新打开，然后再执行更新。",
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
