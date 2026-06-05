import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

import {
  latencyProbeActionKey,
  refreshAllUsageActionKey,
  usageRefreshActionKey,
} from "../src/pending-action-keys";
import type { AppSnapshot, ProfileSummary } from "../src/desktop-types";

const root = join(import.meta.dirname, "..");
const renderersImportPath = `../src/${"profile-list-renderers"}`;

function createProfile(overrides: Partial<ProfileSummary> = {}): ProfileSummary {
  return {
    id: "profile-1",
    name: "Profile One",
    notes: "Daily profile",
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
    activeProfileId: "profile-1",
    lastSelectedProfileId: "profile-1",
    lastSwitchProfileId: "profile-1",
    lastSwitchedAt: null,
    codexUsageApiEnabled: true,
    profiles: [],
    ...overrides,
  };
}

test("renders profile layout toggle without app state", async () => {
  expect(existsSync(join(root, "src/profile-list-renderers.ts"))).toBe(true);
  const { renderProfileLayoutToggle } = await import(renderersImportPath);

  const html = renderProfileLayoutToggle({ layout: "grid", busy: true });

  expect(html).toContain('data-action="profile-layout-list"');
  expect(html).toContain('data-action="profile-layout-grid"');
  expect(html).toContain('profile-layout-button active"');
  expect(html).toContain("disabled");
});

test("renders cards page shell with selected profile layout", async () => {
  expect(existsSync(join(root, "src/profile-list-renderers.ts"))).toBe(true);
  const rendererModule = await import(renderersImportPath);

  expect(rendererModule).toHaveProperty("renderCardsPage");
  const { renderCardsPage } = rendererModule as Record<string, (...args: any[]) => string>;
  const snapshot = createSnapshot({
    profiles: [
      createProfile({ id: "profile-a", name: "Profile <A>" }),
      createProfile({ id: "profile-b", name: "Profile B" }),
    ],
  });

  const listHtml = renderCardsPage({
    snapshot,
    profiles: snapshot.profiles,
    layout: "list",
    busy: true,
    pendingActions: new Set([refreshAllUsageActionKey]),
  });

  expect(listHtml).toContain('data-page="cards"');
  expect(listHtml).toContain("配置管理");
  expect(listHtml).toContain("共 2 个本地配置文件");
  expect(listHtml).toContain('data-role="global-refresh"');
  expect(listHtml).toContain('data-action="new-profile"');
  expect(listHtml).toContain("更新中...");
  expect(listHtml).toContain('data-role="profile-list"');
  expect(listHtml).toContain("Profile &lt;A&gt;");
  expect(listHtml).toContain("disabled");

  const gridHtml = renderCardsPage({
    snapshot,
    profiles: snapshot.profiles,
    layout: "grid",
    busy: false,
    pendingActions: new Set(),
  });

  expect(gridHtml).toContain('data-role="profile-grid"');
  expect(gridHtml).toContain("更新全部额度用量");
});

test("renders profile list rows with live and pending actions", async () => {
  expect(existsSync(join(root, "src/profile-list-renderers.ts"))).toBe(true);
  const { renderProfileList } = await import(renderersImportPath);
  const official = createProfile({
    id: "official",
    name: "Official <One>",
    notes: "",
    authTypeLabel: "官方 OAuth",
  });
  const thirdParty = createProfile({
    id: "third-party",
    name: "Third Party",
    authTypeLabel: "第三方 API",
    modelProviderKey: "ylscode",
    thirdPartyUsage: {
      provider: "ylscode",
      remaining: null,
      unit: null,
      daily: null,
      weekly: null,
      updatedAt: "2026-06-05T08:00:00.000Z",
      error: null,
    },
    thirdPartyLatency: {
      wireApi: "responses",
      model: "gpt-5.5",
      ttftMs: 900,
      totalMs: 1800,
      statusCode: 200,
      updatedAt: "2026-06-05T08:00:00.000Z",
      error: null,
    },
  });

  const html = renderProfileList({
    snapshot: createSnapshot({ activeProfileId: "official" }),
    profiles: [official, thirdParty],
    busy: false,
    pendingActions: new Set([
      usageRefreshActionKey("official"),
      latencyProbeActionKey("third-party"),
      refreshAllUsageActionKey,
    ]),
  });

  expect(html).toContain('data-role="profile-list"');
  expect(html).toContain('data-state="live"');
  expect(html).toContain("Official &lt;One&gt;");
  expect(html).toContain("暂无备注");
  expect(html).toContain("刷新中...");
  expect(html).toContain("等待中...");
  expect(html).toContain("测速中...");
  expect(html).toContain('data-role="profile-row-secondary-actions"');
  expect(html).not.toContain('data-action="generate-symbiotic"');
  expect(html).toContain('data-action="view-profile-details"');
  expect(html).toContain('class="profile-row-detail-icon"');
});

test("renders profile grid empty state and profile cards", async () => {
  expect(existsSync(join(root, "src/profile-list-renderers.ts"))).toBe(true);
  const { renderProfileGrid } = await import(renderersImportPath);

  const emptyHtml = renderProfileGrid({
    snapshot: createSnapshot({ activeProfileId: null }),
    profiles: [],
    busy: false,
    pendingActions: new Set(),
  });
  expect(emptyHtml).toContain("暂无存档记录");

  const cardHtml = renderProfileGrid({
    snapshot: createSnapshot({ activeProfileId: "profile-1" }),
    profiles: [createProfile({ name: "Profile <One>" })],
    busy: true,
    pendingActions: new Set(),
  });

  expect(cardHtml).toContain('data-role="profile-grid"');
  expect(cardHtml).toContain("Profile &lt;One&gt;");
  expect(cardHtml).toContain("环境生效中");
  expect(cardHtml).toContain('data-action="view-profile-details"');
  expect(cardHtml).toContain('aria-label="查看和编辑 Profile &lt;One&gt;"');
});
