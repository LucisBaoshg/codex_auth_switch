import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

import type { CodexMessage, CodexSessionInfo } from "../src/session-utils";

const root = join(import.meta.dirname, "..");
const renderersImportPath = `../src/${"session-renderers"}`;

function createSession(overrides: Partial<CodexSessionInfo> = {}): CodexSessionInfo {
  return {
    id: "session-1",
    rolloutPath: "/tmp/session-1.jsonl",
    updatedAtMs: Date.UTC(2026, 5, 5, 8, 30),
    cwd: "/repo/app",
    title: "Work session",
    hasUserEvent: true,
    archived: false,
    modelProvider: "openai",
    fileSize: 2048,
    ...overrides,
  };
}

function createRenderState(overrides = {}) {
  return {
    sessions: [],
    selectedSessionId: null,
    sessionMessages: [],
    sessionSearchQuery: "",
    sessionFilter: "all",
    sessionSortOrder: "time",
    sessionPage: 0,
    sessionsLoading: false,
    messagesLoading: false,
    ...overrides,
  };
}

test("renders filtered and grouped session lists", async () => {
  expect(existsSync(join(root, "src/session-renderers.ts"))).toBe(true);
  const { renderSessionsListHtml } = await import(renderersImportPath);
  const activeSession = createSession({
    id: "active-1",
    cwd: "/repo/app",
    title: "Active Work",
    updatedAtMs: Date.UTC(2026, 5, 5, 9, 0),
  });
  const archivedSession = createSession({
    id: "archived-1",
    cwd: "/repo/old",
    title: "Archived Work",
    archived: true,
    updatedAtMs: Date.UTC(2026, 5, 4, 9, 0),
  });

  const html = renderSessionsListHtml(
    createRenderState({
      sessions: [archivedSession, activeSession],
      selectedSessionId: "active-1",
      sessionSearchQuery: "active",
      sessionSortOrder: "cwd",
    }),
  );

  expect(html).toContain("workspace-group");
  expect(html).toContain("Active Work");
  expect(html).toContain("selected");
  expect(html).toContain("2.0 KB");
  expect(html).not.toContain("Archived Work");
});

test("renders session detail and messages without app state", async () => {
  expect(existsSync(join(root, "src/session-renderers.ts"))).toBe(true);
  const { renderSessionDetailHtml } = await import(renderersImportPath);
  const messages: CodexMessage[] = [
    { role: "user", text: "hello <b>world</b>" },
    { role: "assistant", text: "Use `code`" },
  ];

  const html = renderSessionDetailHtml(
    createRenderState({
      sessions: [
        createSession({
          id: "session-1",
          title: "Review <script>",
          archived: true,
        }),
      ],
      selectedSessionId: "session-1",
      sessionMessages: messages,
    }),
  );

  expect(html).toContain("Review &lt;script&gt;");
  expect(html).toContain("已归档");
  expect(html).toContain("openai");
  expect(html).toContain("hello &lt;b&gt;world&lt;/b&gt;");
  expect(html).toContain("Use <code>code</code>");
});

test("paginates large session lists before rendering DOM nodes", async () => {
  const { renderSessionsListHtml, SESSION_LIST_PAGE_SIZE } = await import(renderersImportPath);
  const sessions = Array.from({ length: SESSION_LIST_PAGE_SIZE + 5 }, (_, index) =>
    createSession({
      id: `session-${index}`,
      title: `Session ${index}`,
      updatedAtMs: index,
    }),
  );

  const firstPageHtml = renderSessionsListHtml(createRenderState({ sessions }));
  const secondPageHtml = renderSessionsListHtml(
    createRenderState({ sessions, sessionPage: 1 }),
  );

  expect(firstPageHtml.match(/class="session-item-card/g)).toHaveLength(SESSION_LIST_PAGE_SIZE);
  expect(firstPageHtml).toContain(`第 1 / 2 页 · 共 ${sessions.length} 个`);
  expect(firstPageHtml).toContain('data-action="session-page-next"');
  expect(secondPageHtml.match(/class="session-item-card/g)).toHaveLength(5);
  expect(secondPageHtml).toContain(`第 2 / 2 页 · 共 ${sessions.length} 个`);
});

test("keeps workspace grouping while paginating grouped sessions", async () => {
  const { renderSessionsListHtml, SESSION_LIST_PAGE_SIZE } = await import(renderersImportPath);
  const sessions = Array.from({ length: SESSION_LIST_PAGE_SIZE + 1 }, (_, index) =>
    createSession({
      id: `grouped-${index}`,
      cwd: index < SESSION_LIST_PAGE_SIZE ? "/repo/current" : "/repo/old",
      title: `Grouped ${index}`,
      updatedAtMs: SESSION_LIST_PAGE_SIZE - index,
    }),
  );

  const html = renderSessionsListHtml(
    createRenderState({
      sessions,
      sessionPage: 1,
      sessionSortOrder: "cwd",
    }),
  );

  expect(html.match(/class="session-item-card/g)).toHaveLength(1);
  expect(html).toContain("workspace-group");
  expect(html).toContain("Grouped 80");
});

test("selects the same first page for all and active when archived sessions are later", async () => {
  const { selectSessionListPage, SESSION_LIST_PAGE_SIZE } = await import(renderersImportPath);
  const activeSessions = Array.from({ length: SESSION_LIST_PAGE_SIZE + 2 }, (_, index) =>
    createSession({
      id: `active-${index}`,
      updatedAtMs: SESSION_LIST_PAGE_SIZE - index,
    }),
  );
  const archivedSession = createSession({
    id: "archived-old",
    archived: true,
    updatedAtMs: -1,
  });
  const allPage = selectSessionListPage(
    createRenderState({ sessions: [...activeSessions, archivedSession] }),
  );
  const activePage = selectSessionListPage(
    createRenderState({
      sessions: [...activeSessions, archivedSession],
      sessionFilter: "active",
    }),
  );

  expect(activePage.sessions.map((session: CodexSessionInfo) => session.id))
    .toEqual(allPage.sessions.map((session: CodexSessionInfo) => session.id));
  expect(activePage.totalItems).toBe(activeSessions.length);
  expect(allPage.totalItems).toBe(activeSessions.length + 1);
});

test("renders the full sessions page shell from renderer state", async () => {
  expect(existsSync(join(root, "src/session-renderers.ts"))).toBe(true);
  const { renderSessionsPage } = await import(renderersImportPath);

  const html = renderSessionsPage(
    createRenderState({
      sessions: [createSession()],
      selectedSessionId: "session-1",
      sessionSearchQuery: "Work",
      sessionFilter: "active",
      sessionSortOrder: "time",
      sessionMessages: [{ role: "assistant", text: "ready" }],
    }),
  );

  expect(html).toContain("Codex 会话管理");
  expect(html).toContain('value="Work"');
  expect(html).toContain("filter-tab active");
  expect(html).toContain("sessions-list-scroll");
  expect(html).toContain("session-detail-active");
});
