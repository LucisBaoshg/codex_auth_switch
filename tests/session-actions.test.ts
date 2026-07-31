import { beforeEach, expect, test } from "vitest";

import { state } from "../src/app-runtime";
import {
  bindSessionCleanupEvents,
  bindSessionPageEvents,
} from "../src/session-actions";
import { renderSessionCleanupPage } from "../src/session-cleanup-renderers";
import { selectSessionRenderState } from "../src/desktop-state";
import {
  renderSessionsPage,
  SESSION_LIST_PAGE_SIZE,
} from "../src/session-renderers";

const nowMs = Date.UTC(2026, 6, 31);
const dayMs = 24 * 60 * 60 * 1000;

function createStaleSessions(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `session-${index}`,
    rolloutPath: `/tmp/session-${index}.jsonl`,
    updatedAtMs: nowMs - 8 * dayMs,
    cwd: `/repo/${index}`,
    title: `Session ${index}`,
    hasUserEvent: true,
    archived: false,
    fileSize: 1024,
  }));
}

beforeEach(() => {
  state.view = "session-cleanup";
  state.sessions = createStaleSessions(55);
  state.cleanupFilter = "30d";
  state.cleanupProjectPage = 0;
  state.cleanupSessionPage = 0;
  document.body.innerHTML = `
    <div class="app-layout">
      ${renderSessionCleanupPage({
        sessions: state.sessions,
        nowMs,
        cleanupFilter: state.cleanupFilter,
      })}
    </div>
  `;
});

test("updates cleanup sections without replacing the page container", () => {
  bindSessionCleanupEvents();
  const cleanupPage = document.querySelector<HTMLElement>(".cleanup-page-container")!;
  const initialProjectsSection = cleanupPage.querySelector(
    '[data-role="cleanup-projects-section"]',
  );

  cleanupPage
    .querySelector<HTMLButtonElement>('[data-action="set-cleanup-filter"][data-filter="7d"]')!
    .click();

  expect(document.querySelector(".cleanup-page-container")).toBe(cleanupPage);
  expect(state.cleanupFilter).toBe("7d");
  expect(
    cleanupPage.querySelector('[data-role="cleanup-projects-section"]'),
  ).not.toBe(initialProjectsSection);
  expect(cleanupPage.querySelectorAll(".cleanup-project-card")).toHaveLength(20);
  expect(cleanupPage.querySelectorAll(".cleanup-row")).toHaveLength(50);

  cleanupPage
    .querySelector<HTMLButtonElement>('[data-action="cleanup-project-page-next"]')!
    .click();
  cleanupPage
    .querySelector<HTMLButtonElement>('[data-action="cleanup-session-page-next"]')!
    .click();

  expect(state.cleanupProjectPage).toBe(1);
  expect(state.cleanupSessionPage).toBe(1);
  expect(document.querySelector(".cleanup-page-container")).toBe(cleanupPage);
});

test("uses delegated checkbox handling after section updates", () => {
  bindSessionCleanupEvents();
  const cleanupPage = document.querySelector<HTMLElement>(".cleanup-page-container")!;
  cleanupPage
    .querySelector<HTMLButtonElement>('[data-action="set-cleanup-filter"][data-filter="7d"]')!
    .click();

  const selectAll = cleanupPage.querySelector<HTMLInputElement>("#cleanup-select-all")!;
  selectAll.checked = true;
  selectAll.dispatchEvent(new Event("change", { bubbles: true }));

  expect(
    cleanupPage.querySelectorAll<HTMLInputElement>(".cleanup-item-checkbox:checked"),
  ).toHaveLength(50);
  expect(
    cleanupPage.querySelector<HTMLButtonElement>("#cleanup-batch-delete-btn")!.disabled,
  ).toBe(false);
  expect(cleanupPage.querySelector("#cleanup-selected-count")?.textContent).toBe("50");
});

test("keeps the current session card DOM when a filter has the same visible page", () => {
  const activeSessions = Array.from(
    { length: SESSION_LIST_PAGE_SIZE + 5 },
    (_, index) => ({
      ...createStaleSessions(1)[0],
      id: `active-${index}`,
      title: `Active ${index}`,
      updatedAtMs: nowMs - index,
    }),
  );
  const archivedSession = {
    ...createStaleSessions(1)[0],
    id: "archived-old",
    title: "Archived old",
    archived: true,
    updatedAtMs: nowMs - 10_000,
  };
  state.view = "sessions";
  state.sessions = [...activeSessions, archivedSession];
  state.sessionFilter = "all";
  state.sessionSortOrder = "time";
  state.sessionPage = 0;
  state.sessionsLoading = false;
  state.selectedSessionId = null;
  state.sessionMessages = [];
  state.messagesLoading = false;
  state.showAllMessages = false;
  document.body.innerHTML = renderSessionsPage(selectSessionRenderState(state));

  bindSessionPageEvents();
  const firstCard = document.querySelector<HTMLElement>(".session-item-card");
  document
    .querySelector<HTMLButtonElement>('.filter-tab[data-filter="active"]')!
    .click();

  expect(state.sessionFilter).toBe("active");
  expect(document.querySelector(".session-item-card")).toBe(firstCard);
  expect(document.querySelector(".session-page-status")?.textContent)
    .toContain(`共 ${activeSessions.length} 个`);
});
