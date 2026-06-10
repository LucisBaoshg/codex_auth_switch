import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const stateImportPath = `../src/${"desktop-state"}`;

test("creates desktop state from explicit network sharing settings", async () => {
  expect(existsSync(join(root, "src/desktop-state.ts"))).toBe(true);
  const { createDesktopState } = await import(stateImportPath);

  const state = createDesktopState({
    profilesApi: "https://example.com/codex/api/profiles",
    token: "",
  });

  expect(state).toMatchObject({
    platform: "codex",
    snapshot: null,
    view: "cards",
    selectedProfileId: null,
    busy: false,
    busyDialog: null,
    flash: null,
    activeTab: "local",
    sharingCenterTab: "own",
    profileLayout: "list",
    networkAuthRequired: true,
    networkSharing: {
      profilesApi: "https://example.com/codex/api/profiles",
      token: "",
    },
    appVersion: null,
    update: {
      checking: false,
      lastResult: null,
    },
    sessionSearchQuery: "",
    sessionFilter: "all",
    sessionSortOrder: "time",
    sessionsLoading: false,
    messagesLoading: false,
  });
  expect(state.pendingActions).toBeInstanceOf(Set);
  expect(state.pendingActions.size).toBe(0);
  expect(state.editor.mode).toBe("new");
  expect(state.shareDraft).toEqual({
    profileId: null,
    visibility: "selected",
    selectedUserIds: [],
  });
});

test("detects existing network auth token during state creation", async () => {
  expect(existsSync(join(root, "src/desktop-state.ts"))).toBe(true);
  const { createDesktopState } = await import(stateImportPath);

  const state = createDesktopState({
    profilesApi: "https://example.com/codex/api/profiles",
    token: "desktop-token",
  });

  expect(state.networkAuthRequired).toBe(false);
  expect(state.networkSharing.token).toBe("desktop-token");
});

test("selects session render state from desktop state", async () => {
  expect(existsSync(join(root, "src/desktop-state.ts"))).toBe(true);
  const { createDesktopState, selectSessionRenderState } = await import(stateImportPath);

  const state = createDesktopState({
    profilesApi: "https://example.com/codex/api/profiles",
    token: "",
  });
  state.sessions = [
    {
      id: "session-1",
      updatedAtMs: Date.UTC(2026, 5, 5, 8, 30),
      hasUserEvent: true,
      archived: false,
      title: "Work session",
    },
  ];
  state.selectedSessionId = "session-1";
  state.sessionMessages = [{ role: "user", text: "hello" }];
  state.sessionSearchQuery = "work";
  state.sessionFilter = "active";
  state.sessionSortOrder = "cwd";
  state.sessionsLoading = true;
  state.messagesLoading = true;

  expect(selectSessionRenderState(state)).toEqual({
    sessions: state.sessions,
    selectedSessionId: "session-1",
    sessionMessages: state.sessionMessages,
    sessionSearchQuery: "work",
    sessionFilter: "active",
    sessionSortOrder: "cwd",
    sessionsLoading: true,
    messagesLoading: true,
    showAllMessages: false,
  });
});

test("applies snapshot and keeps selected profile ids valid", async () => {
  expect(existsSync(join(root, "src/desktop-state.ts"))).toBe(true);
  const { applySnapshotToDesktopState, createDesktopState } = await import(stateImportPath);

  const state = createDesktopState({
    profilesApi: "https://example.com/codex/api/profiles",
    token: "",
  });
  state.selectedProfileId = "missing-profile";
  state.shareDraft.profileId = "missing-share";

  const snapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: "2026-06-05T08:00:00Z",
    targetAuthTypeLabel: "官方 OAuth",
    activeProfileId: "profile-2",
    lastSelectedProfileId: "profile-1",
    lastSwitchProfileId: "profile-2",
    lastSwitchedAt: "2026-06-05T08:00:00Z",
    codexUsageApiEnabled: true,
    profiles: [
      {
        id: "profile-1",
        name: "Work",
        notes: "",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-06-01T00:00:00Z",
        updatedAt: "2026-06-01T00:00:00Z",
        authHash: "auth-1",
        configHash: "config-1",
        codexUsage: null,
        thirdPartyLatency: null,
      },
      {
        id: "profile-2",
        name: "API",
        notes: "",
        authTypeLabel: "第三方 API",
        createdAt: "2026-06-02T00:00:00Z",
        updatedAt: "2026-06-02T00:00:00Z",
        authHash: "auth-2",
        configHash: "config-2",
        codexUsage: null,
        thirdPartyLatency: null,
      },
    ],
  };

  applySnapshotToDesktopState(state, snapshot);

  expect(state.snapshot).toBe(snapshot);
  expect(state.selectedProfileId).toBe("profile-2");
  expect(state.shareDraft.profileId).toBe("profile-2");
});

test("applies snapshot without replacing valid selected profile ids", async () => {
  expect(existsSync(join(root, "src/desktop-state.ts"))).toBe(true);
  const { applySnapshotToDesktopState, createDesktopState } = await import(stateImportPath);

  const state = createDesktopState({
    profilesApi: "https://example.com/codex/api/profiles",
    token: "",
  });
  state.selectedProfileId = "profile-1";
  state.shareDraft.profileId = "profile-1";

  const snapshot = {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: null,
    targetAuthTypeLabel: "官方 OAuth",
    activeProfileId: "profile-2",
    lastSelectedProfileId: "profile-2",
    lastSwitchProfileId: "profile-2",
    lastSwitchedAt: null,
    codexUsageApiEnabled: false,
    profiles: [
      {
        id: "profile-1",
        name: "Work",
        notes: "",
        authTypeLabel: "官方 OAuth",
        createdAt: "2026-06-01T00:00:00Z",
        updatedAt: "2026-06-01T00:00:00Z",
        authHash: "auth-1",
        configHash: "config-1",
        codexUsage: null,
        thirdPartyLatency: null,
      },
    ],
  };

  applySnapshotToDesktopState(state, snapshot);

  expect(state.selectedProfileId).toBe("profile-1");
  expect(state.shareDraft.profileId).toBe("profile-1");
});

test("selects network profiles owned by the current user", async () => {
  expect(existsSync(join(root, "src/desktop-state.ts"))).toBe(true);
  const { createDesktopState, selectOwnNetworkProfiles } = await import(stateImportPath);

  const state = createDesktopState({
    profilesApi: "https://example.com/codex/api/profiles",
    token: "",
  });
  state.networkUser = {
    dingUserId: " Ding-A ",
    name: "Alice",
  };
  state.networkProfiles = [
    {
      id: "owned",
      name: "Owned profile",
      description: "",
      createdAt: "2026-06-05T00:00:00Z",
      files: [],
      ownerDingUserId: "ding-a",
    },
    {
      id: "other",
      name: "Other profile",
      description: "",
      createdAt: "2026-06-05T00:00:00Z",
      files: [],
      ownerDingUserId: "ding-b",
    },
    {
      id: "unowned",
      name: "Unowned profile",
      description: "",
      createdAt: "2026-06-05T00:00:00Z",
      files: [],
    },
  ];

  expect(selectOwnNetworkProfiles(state).map((profile) => profile.id)).toEqual(["owned"]);
});

test("selects no owned network profiles without a current user", async () => {
  expect(existsSync(join(root, "src/desktop-state.ts"))).toBe(true);
  const { createDesktopState, selectOwnNetworkProfiles } = await import(stateImportPath);

  const state = createDesktopState({
    profilesApi: "https://example.com/codex/api/profiles",
    token: "",
  });
  state.networkProfiles = [
    {
      id: "owned",
      name: "Owned profile",
      description: "",
      createdAt: "2026-06-05T00:00:00Z",
      files: [],
      ownerDingUserId: "ding-a",
    },
  ];

  expect(selectOwnNetworkProfiles(state)).toEqual([]);
});
