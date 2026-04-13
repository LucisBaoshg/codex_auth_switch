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

test("switches to the Antigravity platform and imports the current account", async () => {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return {
        targetDir: "/Users/example/.codex",
        usingDefaultTargetDir: true,
        targetExists: true,
        targetAuthExists: true,
        targetConfigExists: true,
        targetUpdatedAt: "2026-04-10T00:00:00Z",
        targetAuthTypeLabel: "官方 OAuth",
        activeProfileId: null,
        lastSelectedProfileId: null,
        lastSwitchProfileId: null,
        lastSwitchedAt: null,
        codexUsageApiEnabled: true,
        profiles: [],
      };
    }

    if (command === "load_antigravity_snapshot") {
      return {
        sourceDbPath:
          "/Users/example/Library/Application Support/Antigravity/User/globalStorage/state.vscdb",
        sourceExists: true,
        activeProfileId: null,
        lastSelectedProfileId: null,
        lastSwitchProfileId: null,
        lastSwitchedAt: null,
        profiles: [],
      };
    }

    if (command === "import_current_antigravity_profile") {
      return {
        id: "ag-1",
        name: "Alice",
        notes: "Imported",
        email: "alice@example.com",
        displayName: "Alice",
        createdAt: "2026-04-10T00:00:00Z",
        updatedAt: "2026-04-10T00:00:00Z",
      };
    }

    throw new Error(`unexpected command: ${command}`);
  });

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>(
      '[data-action="switch-platform"][data-platform="antigravity"]',
    )
    ?.click();
  await flushUi();

  const importButton = document.querySelector<HTMLButtonElement>(
    '[data-action="import-current-antigravity"]',
  );
  expect(importButton).not.toBeNull();
  importButton?.click();
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("load_antigravity_snapshot", undefined);
  expect(invokeMock).toHaveBeenCalledWith("import_current_antigravity_profile", {
    name: "Current Antigravity Account",
    notes: "Imported from local state.vscdb",
  });
});

test("restores the latest Antigravity backup from the platform page", async () => {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") {
      return {
        targetDir: "/Users/example/.codex",
        usingDefaultTargetDir: true,
        targetExists: true,
        targetAuthExists: true,
        targetConfigExists: true,
        targetUpdatedAt: "2026-04-10T00:00:00Z",
        targetAuthTypeLabel: "官方 OAuth",
        activeProfileId: null,
        lastSelectedProfileId: null,
        lastSwitchProfileId: null,
        lastSwitchedAt: null,
        codexUsageApiEnabled: true,
        profiles: [],
      };
    }

    if (command === "load_antigravity_snapshot") {
      return {
        sourceDbPath:
          "/Users/example/Library/Application Support/Antigravity/User/globalStorage/state.vscdb",
        sourceExists: true,
        activeProfileId: "ag-1",
        lastSelectedProfileId: "ag-1",
        lastSwitchProfileId: "ag-1",
        lastSwitchedAt: "2026-04-10T00:00:00Z",
        profiles: [
          {
            id: "ag-1",
            name: "Alice",
            notes: "",
            email: "alice@example.com",
            displayName: "Alice",
            createdAt: "2026-04-10T00:00:00Z",
            updatedAt: "2026-04-10T00:00:00Z",
          },
        ],
      };
    }

    if (command === "restore_last_antigravity_backup") {
      return {
        profileId: "backup-restore",
        backupId: "backup-1",
        switchedAt: "2026-04-10T00:10:00Z",
      };
    }

    throw new Error(`unexpected command: ${command}`);
  });

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>(
      '[data-action="switch-platform"][data-platform="antigravity"]',
    )
    ?.click();
  await flushUi();

  const restoreButton = document.querySelector<HTMLButtonElement>(
    '[data-action="restore-antigravity-backup"]',
  );
  expect(restoreButton).not.toBeNull();
  restoreButton?.click();
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("restore_last_antigravity_backup", undefined);
});
