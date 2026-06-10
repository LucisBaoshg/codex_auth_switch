import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

import type { CodexSessionInfo } from "../src/session-utils";

const root = join(import.meta.dirname, "..");
const renderersImportPath = `../src/${"session-cleanup-renderers"}`;

function createSession(overrides: Partial<CodexSessionInfo> = {}): CodexSessionInfo {
  return {
    id: "session-1",
    rolloutPath: "/tmp/session-1.jsonl",
    updatedAtMs: Date.UTC(2026, 5, 5),
    cwd: "/repo/app",
    title: "Work session",
    hasUserEvent: true,
    archived: false,
    modelProvider: "openai",
    fileSize: 2048,
    ...overrides,
  };
}

test("renders inactive projects and old session cleanup rows", async () => {
  expect(existsSync(join(root, "src/session-cleanup-renderers.ts"))).toBe(true);
  const { renderSessionCleanupPage } = await import(renderersImportPath);
  const nowMs = Date.UTC(2026, 5, 5);
  const staleSession = createSession({
    id: "stale-1",
    cwd: "/repo/old <tag>",
    title: "Old <script>",
    archived: true,
    updatedAtMs: Date.UTC(2026, 3, 1),
    fileSize: 1024,
  });
  const recentSession = createSession({
    id: "recent-1",
    cwd: "/repo/new",
    updatedAtMs: Date.UTC(2026, 5, 1),
  });

  const html = renderSessionCleanupPage({
    sessions: [staleSession, recentSession],
    nowMs,
  });

  expect(html).toContain("会话清理");
  expect(html).toContain("超过 1 个月没有任何会话产生的工作空间项目 (1)");
  expect(html).toContain("/repo/old &lt;tag&gt;");
  expect(html).toContain("总计占用: 1.0 KB");
  expect(html).toContain("data-ids='[&quot;stale-1&quot;]'");
  expect(html).toContain("Old &lt;script&gt;");
  expect(html).toContain("已归档");
  expect(html).toContain("btn-clean-single-session");
});

test("renders empty cleanup states when no sessions are stale", async () => {
  expect(existsSync(join(root, "src/session-cleanup-renderers.ts"))).toBe(true);
  const { renderSessionCleanupPage } = await import(renderersImportPath);

  const html = renderSessionCleanupPage({
    sessions: [
      createSession({
        id: "recent-1",
        updatedAtMs: Date.UTC(2026, 5, 4),
      }),
    ],
    nowMs: Date.UTC(2026, 5, 5),
  });

  expect(html).toContain("没有超过 1 个月未活跃的项目");
  expect(html).toContain("没有超过 1 个月的旧会话");
});

test("renders inactive projects and old session cleanup rows with 7d filter", async () => {
  expect(existsSync(join(root, "src/session-cleanup-renderers.ts"))).toBe(true);
  const { renderSessionCleanupPage } = await import(renderersImportPath);
  const nowMs = Date.UTC(2026, 5, 10);
  
  // Stale session updated 8 days ago (should be cleaned up under 7d)
  const staleSession = createSession({
    id: "stale-7d",
    cwd: "/repo/old",
    updatedAtMs: Date.UTC(2026, 5, 2),
    fileSize: 1024,
  });
  
  // Recent session updated 3 days ago (should NOT be cleaned up under 7d)
  const recentSession = createSession({
    id: "recent-7d",
    cwd: "/repo/new",
    updatedAtMs: Date.UTC(2026, 5, 7),
  });

  const html = renderSessionCleanupPage({
    sessions: [staleSession, recentSession],
    nowMs,
    cleanupFilter: "7d",
  });

  expect(html).toContain("会话清理");
  expect(html).toContain("超过 7 天没有任何会话产生的工作空间项目 (1)");
  expect(html).toContain("所有项目中早于 7 天的旧会话 (1)");
  expect(html).toContain("/repo/old");
});

test("renders empty cleanup states under 7d filter", async () => {
  expect(existsSync(join(root, "src/session-cleanup-renderers.ts"))).toBe(true);
  const { renderSessionCleanupPage } = await import(renderersImportPath);

  const html = renderSessionCleanupPage({
    sessions: [
      createSession({
        id: "recent-1",
        updatedAtMs: Date.UTC(2026, 5, 4),
      }),
    ],
    nowMs: Date.UTC(2026, 5, 5),
    cleanupFilter: "7d",
  });

  expect(html).toContain("没有超过 7 天未活跃的项目");
  expect(html).toContain("没有超过 7 天的旧会话");
});
