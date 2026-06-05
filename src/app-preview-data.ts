import type { AppSnapshot } from "./desktop-types";

export function createPreviewAppSnapshot(nowIso = new Date().toISOString()): AppSnapshot {
  return {
    targetDir: "/Users/example/.codex",
    usingDefaultTargetDir: true,
    targetExists: true,
    targetAuthExists: true,
    targetConfigExists: true,
    targetUpdatedAt: nowIso,
    targetAuthTypeLabel: "第三方 API",
    activeProfileId: "profile-2",
    lastSelectedProfileId: "profile-2",
    lastSwitchProfileId: "profile-2",
    lastSwitchedAt: nowIso,
    codexUsageApiEnabled: true,
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
        codexUsage: {
          source: "api",
          planType: "team",
          primary: {
            usedPercent: 24,
            windowMinutes: 300,
            resetsAt: "2026-03-25T18:26:00Z",
          },
          secondary: {
            usedPercent: 7,
            windowMinutes: 10080,
            resetsAt: "2026-04-01T18:26:00Z",
          },
          credits: null,
          updatedAt: nowIso,
        },
        thirdPartyLatency: null,
        thirdPartyUsage: null,
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
        codexUsage: null,
        thirdPartyLatency: {
          wireApi: "responses",
          model: "gpt-5.4",
          ttftMs: 1820,
          totalMs: 4960,
          statusCode: 200,
          updatedAt: nowIso,
          error: null,
        },
        thirdPartyUsage: null,
      },
    ],
  };
}
