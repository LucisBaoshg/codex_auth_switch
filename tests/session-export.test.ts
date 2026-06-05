import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";

import type { CodexMessage, CodexSessionInfo } from "../src/session-utils";

const root = join(import.meta.dirname, "..");
const exportImportPath = `../src/${"session-export"}`;

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

const originalCreateObjectURL = URL.createObjectURL;
const originalAnchorClick = HTMLAnchorElement.prototype.click;

afterEach(() => {
  document.body.innerHTML = "";
  URL.createObjectURL = originalCreateObjectURL;
  HTMLAnchorElement.prototype.click = originalAnchorClick;
  vi.restoreAllMocks();
});

test("exports codex session markdown through a temporary download link", async () => {
  expect(existsSync(join(root, "src/session-export.ts"))).toBe(true);
  const { exportCodexSessionToMarkdown } = await import(exportImportPath);

  const createObjectUrl = vi.fn(() => "blob:codex-session");
  URL.createObjectURL = createObjectUrl;
  const click = vi.fn();
  HTMLAnchorElement.prototype.click = click;

  const messages: CodexMessage[] = [
    { role: "user", text: "hello" },
    { role: "assistant", text: "ready" },
  ];

  exportCodexSessionToMarkdown(session, messages);

  expect(createObjectUrl).toHaveBeenCalledTimes(1);
  const blob = createObjectUrl.mock.calls[0]?.[0] as Blob;
  await expect(blob.text()).resolves.toContain("# Codex Session: Work session");
  await expect(blob.text()).resolves.toContain("### 👤 User\n\nhello");
  expect(blob.type).toBe("text/markdown;charset=utf-8;");
  expect(click).toHaveBeenCalledTimes(1);
  expect(document.querySelector("a")).toBeNull();
});

test("exports codex session markdown using a stable session filename", async () => {
  expect(existsSync(join(root, "src/session-export.ts"))).toBe(true);
  const { exportCodexSessionToMarkdown } = await import(exportImportPath);

  URL.createObjectURL = vi.fn(() => "blob:codex-session");
  HTMLAnchorElement.prototype.click = vi.fn(function click(this: HTMLAnchorElement) {
    expect(this.getAttribute("href")).toBe("blob:codex-session");
    expect(this.getAttribute("download")).toBe("codex-session-session-1.md");
    expect(this.style.visibility).toBe("hidden");
    expect(document.body.contains(this)).toBe(true);
  });

  exportCodexSessionToMarkdown(session, []);
});
