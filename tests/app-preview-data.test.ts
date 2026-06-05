import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const previewImportPath = `../src/${"app-preview-data"}`;

test("creates browser preview app snapshot from an explicit clock", async () => {
  expect(existsSync(join(root, "src/app-preview-data.ts"))).toBe(true);
  const { createPreviewAppSnapshot } = await import(previewImportPath);

  const nowIso = "2026-06-05T12:00:00.000Z";
  const snapshot = createPreviewAppSnapshot(nowIso);

  expect(snapshot).toMatchObject({
    targetDir: "/Users/example/.codex",
    targetAuthTypeLabel: "第三方 API",
    activeProfileId: "profile-2",
    lastSelectedProfileId: "profile-2",
    lastSwitchProfileId: "profile-2",
    targetUpdatedAt: nowIso,
    lastSwitchedAt: nowIso,
    codexUsageApiEnabled: true,
  });
  expect(snapshot.profiles).toHaveLength(2);
  expect(snapshot.profiles[0]).toMatchObject({
    id: "profile-1",
    name: "Work Team",
    authTypeLabel: "官方 OAuth",
    codexUsage: {
      source: "api",
      planType: "team",
      updatedAt: nowIso,
    },
  });
  expect(snapshot.profiles[1]).toMatchObject({
    id: "profile-2",
    name: "淘宝 1",
    authTypeLabel: "第三方 API",
    thirdPartyLatency: {
      wireApi: "responses",
      model: "gpt-5.4",
      updatedAt: nowIso,
      error: null,
    },
  });
  expect(createPreviewAppSnapshot(nowIso)).not.toBe(snapshot);
});
