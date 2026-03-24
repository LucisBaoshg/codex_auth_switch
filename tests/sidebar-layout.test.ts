import { afterEach, beforeEach, expect, test, vi } from "vitest";

const invokeMock = vi.fn();
const checkForAppUpdateMock = vi.fn();
const getVersionMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: checkForAppUpdateMock,
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: getVersionMock,
}));

beforeEach(() => {
  vi.resetModules();
  invokeMock.mockReset();
  checkForAppUpdateMock.mockReset();
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
    throw new Error(`unexpected command: ${command}`);
  });

  checkForAppUpdateMock.mockResolvedValue({
    currentVersion: "1.3.1",
    version: "1.3.2",
    date: "2026-03-24T00:00:00Z",
    downloadAndInstall: vi.fn(),
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

  expect(document.querySelector('[data-role="update-entry"]')?.textContent).toContain("发现新版本");
  expect(document.querySelector('[data-role="update-entry"]')?.textContent).toContain("v1.3.2");
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

  expect(checkForAppUpdateMock).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("当前应用不在 Applications 文件夹中");
});
