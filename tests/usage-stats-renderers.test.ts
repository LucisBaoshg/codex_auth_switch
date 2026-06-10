import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const renderersImportPath = `../src/${"usage-stats-renderers"}`;

test("renders codex usage stats summary, trend and request logs", async () => {
  expect(existsSync(join(root, "src/usage-stats-renderers.ts"))).toBe(true);
  const { renderCodexUsageStatsPage } = await import(renderersImportPath);

  const baseInput = {
    loading: false,
    error: null,
    stats: {
      updatedAt: "2026-06-08T10:03:00Z",
      sync: {
        imported: 3,
        skipped: 0,
        filesScanned: 1,
        errors: [],
      },
      summary: {
        totalRequests: 3,
        totalCostUsd: "0.012345",
        totalInputTokens: 850,
        totalOutputTokens: 325,
        totalCacheReadTokens: 1050,
        totalCacheCreationTokens: 0,
        totalReasoningOutputTokens: 115,
        realTotalTokens: 2225,
        cacheHitRate: 1050 / 1900,
      },
      trends: [
        {
          date: "2026-06-08",
          requestCount: 3,
          totalCostUsd: "0.012345",
          totalInputTokens: 850,
          totalOutputTokens: 325,
          totalCacheReadTokens: 1050,
          totalCacheCreationTokens: 0,
          totalReasoningOutputTokens: 115,
          realTotalTokens: 2225,
        },
      ],
      filter: {
        startDate: "2026-06-08",
        endDate: "2026-06-08",
        model: null,
        effort: null,
      },
      modelBreakdown: [
        {
          name: "gpt-5.4",
          requestCount: 3,
          totalCostUsd: "0.007263",
          totalInputTokens: 850,
          totalOutputTokens: 325,
          totalCacheReadTokens: 1050,
          totalCacheCreationTokens: 0,
          totalReasoningOutputTokens: 115,
          realTotalTokens: 2225,
        },
      ],
      effortBreakdown: [
        {
          name: "high",
          requestCount: 3,
          totalCostUsd: "0.007263",
          totalInputTokens: 850,
          totalOutputTokens: 325,
          totalCacheReadTokens: 1050,
          totalCacheCreationTokens: 0,
          totalReasoningOutputTokens: 115,
          realTotalTokens: 2225,
        },
      ],
      availableModels: ["gpt-5.4"],
      availableEfforts: ["high"],
      logs: [
        {
          requestId: "codex_session:session-a:3",
          sessionId: "session-a",
          model: "gpt-5.4",
          effort: "high",
          createdAt: "2026-06-08T10:02:05Z",
          inputTokens: 250,
          outputTokens: 75,
          cacheReadTokens: 50,
          cacheCreationTokens: 0,
          reasoningOutputTokens: 25,
          totalCostUsd: "0.007263",
          sourcePath: "/tmp/session.jsonl",
        },
      ],
    },
    filter: {
      startDate: "2026-06-08",
      endDate: "2026-06-08",
      model: null,
      effort: null,
    },
  };

  // 1. Render logs tab
  const htmlLogs = renderCodexUsageStatsPage({
    ...baseInput,
    activeTab: "logs",
  });

  expect(htmlLogs).toContain('data-role="usage-stats-page"');
  expect(htmlLogs).toContain("真实消耗 Tokens");
  expect(htmlLogs).toContain("2,225");
  expect(htmlLogs).toContain("缓存命中率");
  expect(htmlLogs).toContain("55.3%");
  expect(htmlLogs).toContain("$0.0073");
  expect(htmlLogs).toContain("推理输出");
  expect(htmlLogs).toContain("115");
  expect(htmlLogs).toContain("codex_session:session-a:3");
  expect(htmlLogs).toContain('data-action="refresh-usage-stats"');
  expect(htmlLogs).toContain('data-action="set-usage-range"');
  expect(htmlLogs).toContain('data-action="set-usage-model"');
  expect(htmlLogs).toContain('data-action="set-usage-effort"');
  expect(htmlLogs).toContain('data-role="usage-trend-chart"');

  // 2. Render breakdowns tab
  const htmlBreakdowns = renderCodexUsageStatsPage({
    ...baseInput,
    activeTab: "breakdowns",
  });

  expect(htmlBreakdowns).toContain("模型分布");
  expect(htmlBreakdowns).toContain("努力级别");
  expect(htmlBreakdowns).toContain("gpt-5.4");
  expect(htmlBreakdowns).toContain("high");
  expect(htmlBreakdowns).not.toContain("codex_session:session-a:3");

  // 3. Render trends tab
  const htmlTrends = renderCodexUsageStatsPage({
    ...baseInput,
    activeTab: "trends",
  });

  expect(htmlTrends).toContain("按日明细");
  expect(htmlTrends).toContain("2026-06-08");
  expect(htmlTrends).not.toContain("codex_session:session-a:3");
});
