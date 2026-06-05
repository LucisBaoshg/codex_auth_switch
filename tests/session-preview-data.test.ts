import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const previewImportPath = `../src/${"session-preview-data"}`;

test("creates browser preview sessions from an explicit clock", async () => {
  expect(existsSync(join(root, "src/session-preview-data.ts"))).toBe(true);
  const { createPreviewCodexSessions } = await import(previewImportPath);

  const nowMs = Date.UTC(2026, 5, 5, 12, 0, 0);
  const sessions = createPreviewCodexSessions(nowMs);

  expect(sessions).toHaveLength(3);
  expect(sessions[0]).toMatchObject({
    id: "session-1",
    title: "新增会话管理功能讨论",
    cwd: "/Volumes/Acer/Dev/codex_auth_switch",
    archived: false,
    modelProvider: "openai",
  });
  expect(sessions[0].updatedAtMs).toBe(nowMs - 1000 * 60 * 10);
  expect(sessions[2]).toMatchObject({
    id: "session-3",
    archived: true,
  });
});

test("creates browser preview session messages without app state", async () => {
  expect(existsSync(join(root, "src/session-preview-data.ts"))).toBe(true);
  const { createPreviewCodexSessionMessages } = await import(previewImportPath);

  const messages = createPreviewCodexSessionMessages();

  expect(messages).toHaveLength(2);
  expect(messages[0]).toMatchObject({
    role: "user",
    text: "我想给 app新增一个功能，就是 codex 会话管理，有什么建议没有",
  });
  expect(messages[1].role).toBe("assistant");
  expect(messages[1].text).toContain("双栏布局");
});
