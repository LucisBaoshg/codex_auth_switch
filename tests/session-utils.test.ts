import { expect, test } from "vitest";

import type { CodexMessage, CodexSessionInfo } from "../src/session-utils";

const session: CodexSessionInfo = {
  id: "session-1",
  rolloutPath: "/tmp/session-1.jsonl",
  updatedAtMs: Date.UTC(2026, 5, 5, 8, 30),
  cwd: "/repo/app",
  title: "Work session",
  hasUserEvent: true,
  archived: false,
  modelProvider: "openai",
  fileSize: 2048,
};

test("builds codex session markdown without browser APIs", async () => {
  const { buildCodexSessionMarkdown } = await import("../src/session-utils");
  const messages: CodexMessage[] = [
    { role: "user", text: "hello" },
    { role: "assistant", text: "ready" },
  ];

  const markdown = buildCodexSessionMarkdown(session, messages);

  expect(markdown).toContain("# Codex Session: Work session");
  expect(markdown).toContain("- **Session ID**: `session-1`");
  expect(markdown).toContain("- **Directory**: `/repo/app`");
  expect(markdown).toContain(`- **Date**: ${new Date(session.updatedAtMs).toLocaleString()}`);
  expect(markdown).toContain("- **Model Provider**: `openai`");
  expect(markdown).toContain("### 👤 User\n\nhello");
  expect(markdown).toContain("### 👤 Codex\n\nready");
});

test("builds codex session markdown fallbacks for missing optional metadata", async () => {
  const { buildCodexSessionMarkdown } = await import("../src/session-utils");

  const markdown = buildCodexSessionMarkdown(
    {
      ...session,
      title: null,
      cwd: null,
      modelProvider: null,
    },
    [],
  );

  expect(markdown).toContain("# Codex Session: Untitled Session");
  expect(markdown).toContain("- **Directory**: `N/A`");
  expect(markdown).toContain("- **Model Provider**: `unknown`");
  expect(markdown).toContain("---");
});
