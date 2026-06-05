import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

import {
  refreshAllUsageActionKey,
  thirdPartyUsageActionKey,
  usageRefreshActionKey,
} from "../src/pending-action-keys";
import type { AppSnapshot, ProfileSummary } from "../src/desktop-types";

const root = join(import.meta.dirname, "..");
const renderersImportPath = `../src/${"profile-runtime-renderers"}`;

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

test("renders Codex usage panel from profile runtime data", async () => {
  expect(existsSync(join(root, "src/profile-runtime-renderers.ts"))).toBe(true);
  const { renderCodexUsagePanel } = await import(renderersImportPath);
  const profile = createProfile({
    codexUsage: {
      source: "api",
      planType: "pro",
      primary: {
        usedPercent: 25,
        windowMinutes: 300,
        resetsAt: "2026-06-05T10:30:00.000Z",
      },
      secondary: {
        usedPercent: 90,
        windowMinutes: 10080,
        resetsAt: null,
      },
      credits: null,
      updatedAt: "2026-06-05T08:00:00.000Z",
    },
  });

  const html = renderCodexUsagePanel(createSnapshot(), profile, {
    busy: false,
    pendingActions: new Set([usageRefreshActionKey(profile.id)]),
  });

  expect(html).toContain("Codex Pro Plan");
  expect(html).toContain("刷新中...");
  expect(html).toContain("disabled");
  expect(html).toContain("75%");
  expect(html).toContain("10%");
});

test("renders third-party runtime panel with usage, latency, and pending states", async () => {
  expect(existsSync(join(root, "src/profile-runtime-renderers.ts"))).toBe(true);
  const { renderThirdPartyRuntimePanel } = await import(renderersImportPath);
  const profile = createProfile({
    id: "third-party",
    authTypeLabel: "第三方 API",
    modelProviderKey: "ylscode",
    thirdPartyUsage: {
      provider: "ylscode",
      remaining: null,
      unit: null,
      daily: { used: "2", total: "10", remaining: "8", usedPercent: 20 },
      weekly: { used: "7", total: "20", remaining: "13", usedPercent: 35 },
      updatedAt: "2026-06-05T08:00:00.000Z",
      error: null,
    },
    thirdPartyLatency: {
      wireApi: "responses",
      model: "gpt-5.5",
      ttftMs: 1234,
      totalMs: 4567,
      statusCode: 200,
      updatedAt: "2026-06-05T08:00:00.000Z",
      error: null,
    },
  });

  const html = renderThirdPartyRuntimePanel(profile, {
    busy: false,
    pendingActions: new Set([thirdPartyUsageActionKey(profile.id), refreshAllUsageActionKey]),
  });

  expect(html).toContain('data-role="third-party-runtime-panel"');
  expect(html).toContain("ylscode");
  expect(html).toContain("用量中...");
  expect(html).toContain("$2.00 / $10.00");
  expect(html).toContain("20%");
  expect(html).toContain("1.23s");
  expect(html).toContain("4.57s");
});

test("renders compact profile row metrics for official and third-party profiles", async () => {
  expect(existsSync(join(root, "src/profile-runtime-renderers.ts"))).toBe(true);
  const { renderProfileRowMetrics } = await import(renderersImportPath);

  expect(
    renderProfileRowMetrics(
      createProfile({
        codexUsage: {
          source: "api",
          planType: "team",
          primary: { usedPercent: 60, windowMinutes: 300, resetsAt: null },
          secondary: { usedPercent: 10, windowMinutes: 10080, resetsAt: null },
          credits: null,
          updatedAt: "2026-06-05T08:00:00.000Z",
        },
      }),
    ),
  ).toContain("<strong>40%</strong>");

  expect(
    renderProfileRowMetrics(
      createProfile({
        authTypeLabel: "第三方 API",
        thirdPartyUsage: {
          provider: "ylscode",
          remaining: null,
          unit: null,
          daily: { used: "12.00", total: "20.00", remaining: "8", usedPercent: 60 },
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
      }),
    ),
  ).toContain("$12 / $20");
});
