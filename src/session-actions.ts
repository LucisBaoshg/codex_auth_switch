import { nativeConfirm } from "./app-chrome-dialogs";
import {
  desktopInvoke,
  formatErrorMessage,
  isTauriRuntime,
  render,
  setBusy,
  setFlash,
  state,
} from "./app-runtime";
import { exportCodexSessionToMarkdown } from "./session-export";
import {
  renderSessionCleanupProjectsSection,
  renderSessionCleanupSessionsSection,
  type CleanupFilter,
} from "./session-cleanup-renderers";
import { selectSessionRenderState } from "./desktop-state";
import {
  createPreviewCodexSessionMessages,
  createPreviewCodexSessions,
} from "./session-preview-data";
import {
  renderSessionDetailHtml,
  renderSessionsListHtml,
  selectSessionListPage,
  type SessionListPageSelection,
} from "./session-renderers";
import {
  formatSessionFileSize,
  getOldSessions,
  type CodexMessage,
  type CodexSessionInfo,
} from "./session-utils";

const sessionListHtmlCache = new WeakMap<Element, string>();
const sessionDetailHtmlCache = new WeakMap<Element, string>();
let sessionsFetchGeneration = 0;

export function refreshSessionsListView(): void {
  const listScroll = document.querySelector(".sessions-list-scroll");
  if (listScroll) {
    const html = renderSessionsListHtml(selectSessionRenderState(state));
    if (sessionListHtmlCache.get(listScroll) !== html) {
      listScroll.innerHTML = html;
      sessionListHtmlCache.set(listScroll, html);
    }
  }
}

export function refreshSessionDetailPane(): void {
  const detailPane = document.querySelector(".sessions-detail-pane");
  if (detailPane) {
    const html = renderSessionDetailHtml(selectSessionRenderState(state));
    if (sessionDetailHtmlCache.get(detailPane) !== html) {
      detailPane.innerHTML = html;
      sessionDetailHtmlCache.set(detailPane, html);
    }
  }
}

function sessionCleanupRenderState() {
  return {
    sessions: state.sessions,
    nowMs: Date.now(),
    cleanupFilter: state.cleanupFilter,
    cleanupProjectPage: state.cleanupProjectPage,
    cleanupSessionPage: state.cleanupSessionPage,
  };
}

function replaceCleanupSection(role: string, html: string): void {
  const currentSection = document.querySelector<HTMLElement>(`[data-role="${role}"]`);
  if (currentSection) {
    currentSection.outerHTML = html;
  }
}

function refreshCleanupProjectsSection(): void {
  replaceCleanupSection(
    "cleanup-projects-section",
    renderSessionCleanupProjectsSection(sessionCleanupRenderState()),
  );
}

function refreshCleanupSessionsSection(): void {
  replaceCleanupSection(
    "cleanup-sessions-section",
    renderSessionCleanupSessionsSection(sessionCleanupRenderState()),
  );
}

function refreshSessionCleanupSections(): void {
  refreshCleanupProjectsSection();
  refreshCleanupSessionsSection();
}

function setSessionCleanupBusy(busy: boolean): void {
  const cleanupPage = document.querySelector<HTMLElement>(".cleanup-page-container");
  if (busy) {
    cleanupPage?.setAttribute("aria-busy", "true");
  } else {
    cleanupPage?.removeAttribute("aria-busy");
  }
}

function hasMountedSessionCleanupPage(): boolean {
  return state.view === "session-cleanup"
    && document.querySelector(".cleanup-page-container") !== null;
}

function refreshMountedSessionView(): void {
  if (hasMountedSessionCleanupPage()) {
    refreshSessionCleanupSections();
    return;
  }
  refreshSessionsListView();
  refreshSessionDetailPane();
}

function updateVisibleSessionFileSizes(): void {
  const sizes = new Map(
    state.sessions.map((session) => [session.id, formatSessionFileSize(session.fileSize)]),
  );
  document
    .querySelectorAll<HTMLElement>(
      ".session-card-file-size[data-session-id], .session-detail-file-size[data-session-id]",
    )
    .forEach((element) => {
      const sessionId = element.dataset.sessionId;
      if (sessionId && sizes.has(sessionId)) {
        element.textContent = sizes.get(sessionId) ?? "";
      }
    });
}

async function hydrateSessionFileSizes(fetchGeneration: number): Promise<void> {
  try {
    const hydrated = await desktopInvoke<CodexSessionInfo[]>("list_codex_sessions", {
      includeFileSizes: true,
    });
    if (fetchGeneration !== sessionsFetchGeneration) {
      return;
    }

    const fileSizes = new Map(hydrated.map((session) => [session.id, session.fileSize]));
    let didChange = false;
    state.sessions = state.sessions.map((session) => {
      if (!fileSizes.has(session.id)) {
        return session;
      }
      const fileSize = fileSizes.get(session.id);
      if (session.fileSize === fileSize) {
        return session;
      }
      didChange = true;
      return { ...session, fileSize };
    });

    if (!didChange) {
      return;
    }
    if (hasMountedSessionCleanupPage()) {
      refreshSessionCleanupSections();
    } else {
      updateVisibleSessionFileSizes();
    }
  } catch {
    // 文件大小只用于辅助显示；后台补齐失败不阻塞会话列表操作。
  }
}

export async function fetchCodexSessions(): Promise<void> {
  const fetchGeneration = ++sessionsFetchGeneration;
  if (!isTauriRuntime) {
    state.sessions = createPreviewCodexSessions(Date.now());
    state.sessionsFetchedAtMs = Date.now();
    state.selectedSessionId = null;
    state.sessionMessages = [];
    render();
    return;
  }

  // Only show the list-wide loading spinner on initial load (when list is empty)
  // to prevent UI layout flash when navigating between active views
  const isFirstLoad = state.sessions.length === 0;
  if (isFirstLoad) {
    state.sessionsLoading = true;
    refreshSessionsListView();
  }
  let shouldHydrateFileSizes = false;
  try {
    const list = await desktopInvoke<CodexSessionInfo[]>("list_codex_sessions", {
      includeFileSizes: false,
    });
    if (fetchGeneration !== sessionsFetchGeneration) {
      return;
    }
    state.sessions = list;
    state.sessionsFetchedAtMs = Date.now();
    state.sessionPage = 0;
    shouldHydrateFileSizes = true;

    // Preserve the active session selection if it remains in the new list
    if (state.selectedSessionId) {
      const exists = list.some(s => s.id === state.selectedSessionId);
      if (!exists) {
        state.selectedSessionId = null;
        state.sessionMessages = [];
      }
    }
  } catch (error) {
    setFlash("error", `获取会话失败: ${formatErrorMessage(error)}`);
  } finally {
    if (fetchGeneration !== sessionsFetchGeneration) {
      return;
    }
    state.sessionsLoading = false;
    refreshMountedSessionView();
    if (shouldHydrateFileSizes) {
      void hydrateSessionFileSizes(fetchGeneration);
    }
  }
}

export async function fetchCodexSessionMessages(threadId: string): Promise<void> {
  if (!isTauriRuntime) {
    state.selectedSessionId = threadId;
    state.sessionMessages = createPreviewCodexSessionMessages();
    state.showAllMessages = false;
    refreshSessionDetailPane();
    return;
  }

  state.messagesLoading = true;
  state.showAllMessages = false;
  refreshSessionDetailPane();
  try {
    const messages = await desktopInvoke<CodexMessage[]>("get_codex_session_messages", { threadId });
    state.selectedSessionId = threadId;
    state.sessionMessages = messages;
  } catch (error) {
    setFlash("error", `获取会话消息失败: ${formatErrorMessage(error)}`);
  } finally {
    state.messagesLoading = false;
    refreshSessionDetailPane();
  }
}

export async function renameCodexSession(threadId: string, title: string): Promise<void> {
  if (!isTauriRuntime) {
    const session = state.sessions.find(s => s.id === threadId);
    if (session) session.title = title;
    setFlash("success", "会话重命名成功");
    refreshSessionsListView();
    refreshSessionDetailPane();
    return;
  }

  setBusy(true);
  try {
    await desktopInvoke("rename_codex_session", { threadId, newTitle: title });
    const session = state.sessions.find(s => s.id === threadId);
    if (session) session.title = title;
    setFlash("success", "会话重命名成功");
  } catch (error) {
    setFlash("error", `重命名失败: ${formatErrorMessage(error)}`);
  } finally {
    setBusy(false);
    refreshSessionsListView();
    refreshSessionDetailPane();
  }
}

export async function archiveCodexSession(threadId: string, archive: boolean): Promise<void> {
  if (!isTauriRuntime) {
    const session = state.sessions.find(s => s.id === threadId);
    if (session) {
      session.archived = archive;
      session.rolloutPath = archive
        ? "/Users/example/.codex/archived_sessions/rollout-mock.jsonl"
        : "/Users/example/.codex/sessions/2026/05/21/rollout-mock.jsonl";
    }
    setFlash("success", archive ? "会话归档成功" : "会话已取消归档");
    refreshSessionsListView();
    refreshSessionDetailPane();
    return;
  }

  setBusy(true);
  try {
    await desktopInvoke("archive_codex_session", { threadId, archive });
    const list = await desktopInvoke<CodexSessionInfo[]>("list_codex_sessions");
    state.sessions = list;
    const session = list.find(s => s.id === threadId);
    if (session) {
      const messages = await desktopInvoke<CodexMessage[]>("get_codex_session_messages", { threadId });
      state.sessionMessages = messages;
    } else {
      state.selectedSessionId = null;
      state.sessionMessages = [];
    }
    setFlash("success", archive ? "会话归档成功" : "会话已取消归档");
  } catch (error) {
    setFlash("error", `归档操作失败: ${formatErrorMessage(error)}`);
  } finally {
    setBusy(false);
    refreshSessionsListView();
    refreshSessionDetailPane();
  }
}

export async function deleteCodexSession(threadId: string): Promise<void> {
  const confirmed = await nativeConfirm("您确定要物理删除该会话及其对话文件吗？此操作无法撤销，物理文件将被彻底删除以释放磁盘空间！", "确认物理删除", true);
  if (!confirmed) return;

  if (!isTauriRuntime) {
    state.sessions = state.sessions.filter(s => s.id !== threadId);
    if (state.selectedSessionId === threadId) {
      state.selectedSessionId = null;
      state.sessionMessages = [];
    }
    setFlash("success", "会话已物理删除");
    refreshSessionsListView();
    refreshSessionDetailPane();
    return;
  }

  setBusy(true);
  try {
    await desktopInvoke("delete_codex_session", { threadId });
    state.sessions = state.sessions.filter(s => s.id !== threadId);
    if (state.selectedSessionId === threadId) {
      state.selectedSessionId = null;
      state.sessionMessages = [];
    }
    setFlash("success", "会话及文件已物理删除");
  } catch (error) {
    setFlash("error", `删除会话失败: ${formatErrorMessage(error)}`);
  } finally {
    setBusy(false);
    refreshSessionsListView();
    refreshSessionDetailPane();
  }
}

export async function deleteProjectSessions(cwd: string, sessionIds: string[]): Promise<void> {
  const confirmed = await nativeConfirm(
    `您确定要物理清空项目 "${cwd}" 的所有会话文件吗？共包含 ${sessionIds.length} 个会话。此操作无法撤销！`,
    "确认清空项目会话",
    true
  );
  if (!confirmed) return;

  if (!isTauriRuntime) {
    const deletedIds = new Set(sessionIds);
    state.sessions = state.sessions.filter((session) => !deletedIds.has(session.id));
    state.sessionsFetchedAtMs = Date.now();
    state.cleanupProjectPage = 0;
    state.cleanupSessionPage = 0;
    refreshSessionCleanupSections();
    setFlash("success", "已成功清理该项目的所有会话", { render: false });
    return;
  }

  const useLocalCleanupUpdates = hasMountedSessionCleanupPage();
  setBusy(true, { render: !useLocalCleanupUpdates });
  setSessionCleanupBusy(true);
  let flash: { kind: "success" | "error"; text: string };
  try {
    await desktopInvoke<number>("delete_codex_sessions", { threadIds: sessionIds });
    const deletedIds = new Set(sessionIds);
    state.sessions = state.sessions.filter((session) => !deletedIds.has(session.id));
    state.sessionsFetchedAtMs = Date.now();
    state.cleanupProjectPage = 0;
    state.cleanupSessionPage = 0;
    flash = { kind: "success", text: "已成功物理清理该项目的所有会话文件" };
  } catch (error) {
    flash = { kind: "error", text: `清理项目会话失败: ${formatErrorMessage(error)}` };
  } finally {
    setBusy(false, { render: false });
    setSessionCleanupBusy(false);
  }
  if (useLocalCleanupUpdates) {
    refreshSessionCleanupSections();
  }
  setFlash(flash.kind, flash.text, { render: !useLocalCleanupUpdates });
}

type BatchDeleteOptions = {
  targetLabel?: string;
  successMessage?: string;
};

export async function batchDeleteSessions(
  sessionIds: string[],
  options: BatchDeleteOptions = {},
): Promise<void> {
  const targetLabel = options.targetLabel || `选中的 ${sessionIds.length} 个会话`;
  const confirmed = await nativeConfirm(
    `您确定要批量物理删除${targetLabel}及其文件吗？此操作无法撤销！`,
    "确认批量删除",
    true
  );
  if (!confirmed) return;

  if (!isTauriRuntime) {
    const deletedIds = new Set(sessionIds);
    state.sessions = state.sessions.filter((session) => !deletedIds.has(session.id));
    state.sessionsFetchedAtMs = Date.now();
    state.cleanupProjectPage = 0;
    state.cleanupSessionPage = 0;
    refreshSessionCleanupSections();
    setFlash("success", "已成功删除选中的会话", { render: false });
    return;
  }

  const useLocalCleanupUpdates = hasMountedSessionCleanupPage();
  setBusy(true, { render: !useLocalCleanupUpdates });
  setSessionCleanupBusy(true);
  let flash: { kind: "success" | "error"; text: string };
  try {
    await desktopInvoke<number>("delete_codex_sessions", { threadIds: sessionIds });
    const deletedIds = new Set(sessionIds);
    state.sessions = state.sessions.filter((session) => !deletedIds.has(session.id));
    state.sessionsFetchedAtMs = Date.now();
    state.cleanupProjectPage = 0;
    state.cleanupSessionPage = 0;
    flash = {
      kind: "success",
      text: options.successMessage || "已成功批量物理删除选中的会话文件",
    };
  } catch (error) {
    flash = { kind: "error", text: `批量删除会话失败: ${formatErrorMessage(error)}` };
  } finally {
    setBusy(false, { render: false });
    setSessionCleanupBusy(false);
  }
  if (useLocalCleanupUpdates) {
    refreshSessionCleanupSections();
  }
  setFlash(flash.kind, flash.text, { render: !useLocalCleanupUpdates });
}

function hasSameVisibleSessions(
  left: SessionListPageSelection,
  right: SessionListPageSelection,
): boolean {
  return left.sessions.length === right.sessions.length
    && left.sessions.every((session, index) => session.id === right.sessions[index]?.id);
}

function updateSessionPagination(
  sessionsContainer: HTMLElement,
  selection: SessionListPageSelection,
): void {
  if (selection.totalPages === 0) {
    return;
  }
  const status = sessionsContainer.querySelector<HTMLElement>(".session-page-status");
  if (status) {
    status.textContent =
      `第 ${selection.currentPage + 1} / ${selection.totalPages} 页 · 共 ${selection.totalItems} 个`;
  }
  const previousButton = sessionsContainer.querySelector<HTMLButtonElement>(
    '[data-action="session-page-prev"]',
  );
  const nextButton = sessionsContainer.querySelector<HTMLButtonElement>(
    '[data-action="session-page-next"]',
  );
  if (previousButton) {
    previousButton.disabled = selection.currentPage === 0;
  }
  if (nextButton) {
    nextButton.disabled = selection.currentPage + 1 >= selection.totalPages;
  }
}

export function bindSessionPageEvents(): void {
  const sessionsContainer = document.querySelector<HTMLDivElement>(".sessions-page-container");
  if (sessionsContainer) {
    // 1. Session list and action delegation
    sessionsContainer.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement;

      const previousPageBtn = target.closest<HTMLButtonElement>(
        '[data-action="session-page-prev"]',
      );
      const nextPageBtn = target.closest<HTMLButtonElement>(
        '[data-action="session-page-next"]',
      );
      if (previousPageBtn || nextPageBtn) {
        const pageDelta = previousPageBtn ? -1 : 1;
        state.sessionPage = Math.max(0, state.sessionPage + pageDelta);
        refreshSessionsListView();
        const listScroll = sessionsContainer.querySelector<HTMLElement>(".sessions-list-scroll");
        listScroll?.scrollTo({ top: 0 });
        return;
      }

      // Load all messages
      const loadAllBtn = target.closest<HTMLButtonElement>("[data-action=\"load-all-messages\"]");
      if (loadAllBtn) {
        state.showAllMessages = true;
        refreshSessionDetailPane();
        return;
      }

      // Toggle message collapse
      const toggleCollapseBtn = target.closest<HTMLButtonElement>("[data-action=\"toggle-message-collapse\"]");
      if (toggleCollapseBtn) {
        const collapsible = toggleCollapseBtn.closest(".collapsible-message") as HTMLDivElement;
        if (collapsible) {
          const preview = collapsible.querySelector(".collapsible-preview") as HTMLDivElement;
          const full = collapsible.querySelector(".collapsible-full") as HTMLDivElement;
          const isCollapsed = collapsible.dataset.collapsed === "true";
          if (isCollapsed) {
            collapsible.dataset.collapsed = "false";
            preview.style.display = "none";
            full.style.display = "block";
            toggleCollapseBtn.innerHTML = "收起 ▴";
          } else {
            collapsible.dataset.collapsed = "true";
            preview.style.display = "block";
            full.style.display = "none";
            const length = collapsible.dataset.length || "";
            toggleCollapseBtn.innerHTML = `展开全部 (${length} 字) ▾`;
          }
        }
        return;
      }

      // Card selection
      const card = target.closest<HTMLDivElement>(".session-item-card");
      if (card) {
        const id = card.dataset.id;
        if (id) {
          sessionsContainer.querySelectorAll(".session-item-card").forEach(c => c.classList.remove("selected"));
          card.classList.add("selected");
          await fetchCodexSessionMessages(id);
        }
        return;
      }

      // Filter tabs
      const tab = target.closest<HTMLButtonElement>(".filter-tab");
      if (tab) {
        const filter = tab.dataset.filter;
        if (
          (filter === "all" || filter === "active" || filter === "archived")
          && filter !== state.sessionFilter
        ) {
          const previousSelection = selectSessionListPage(selectSessionRenderState(state));
          state.sessionFilter = filter;
          state.sessionPage = 0;
          const nextSelection = selectSessionListPage(selectSessionRenderState(state));
          sessionsContainer.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
          tab.classList.add("active");
          if (hasSameVisibleSessions(previousSelection, nextSelection)) {
            updateSessionPagination(sessionsContainer, nextSelection);
          } else {
            refreshSessionsListView();
          }
        }
        return;
      }

      // Sort button
      const sortBtn = target.closest<HTMLButtonElement>(".sort-btn");
      if (sortBtn) {
        const sort = sortBtn.dataset.sort;
        if (
          (sort === "time" || sort === "cwd")
          && sort !== state.sessionSortOrder
        ) {
          state.sessionSortOrder = sort;
          state.sessionPage = 0;
          sessionsContainer.querySelectorAll(".sort-btn").forEach(b => b.classList.remove("active"));
          sortBtn.classList.add("active");
          refreshSessionsListView();
        }
        return;
      }

      // Search clear button
      const clearBtn = target.closest<HTMLButtonElement>("#session-search-clear");
      if (clearBtn) {
        state.sessionSearchQuery = "";
        state.sessionPage = 0;
        const searchInput = sessionsContainer.querySelector<HTMLInputElement>("#session-search");
        if (searchInput) {
          searchInput.value = "";
          searchInput.focus();
        }
        const clearContainer = sessionsContainer.querySelector("#search-clear-container");
        if (clearContainer) {
          clearContainer.innerHTML = "";
        }
        refreshSessionsListView();
        return;
      }

      // Rename session button
      const renameBtn = target.closest<HTMLButtonElement>('[data-action="rename-session"]');
      if (renameBtn) {
        const threadId = renameBtn.dataset.id;
        if (threadId) {
          const currentSession = state.sessions.find(s => s.id === threadId);
          const oldTitle = currentSession?.title || "";
          const newTitle = prompt("请输入会话的新标题:", oldTitle);
          if (newTitle !== null) {
            const trimmed = newTitle.trim();
            if (trimmed) {
              await renameCodexSession(threadId, trimmed);
            }
          }
        }
        return;
      }

      // Archive session button
      const archiveBtn = target.closest<HTMLButtonElement>('[data-action="toggle-archive-session"]');
      if (archiveBtn) {
        const threadId = archiveBtn.dataset.id;
        const isArchived = archiveBtn.dataset.archived === "true";
        if (threadId) {
          await archiveCodexSession(threadId, !isArchived);
        }
        return;
      }

      // Export session button
      const exportBtn = target.closest<HTMLButtonElement>('[data-action="export-session"]');
      if (exportBtn) {
        const threadId = exportBtn.dataset.id;
        if (threadId) {
          const session = state.sessions.find(s => s.id === threadId);
          if (session) {
            exportCodexSessionToMarkdown(session, state.sessionMessages);
          }
        }
        return;
      }

      // Delete session button
      const deleteBtn = target.closest<HTMLButtonElement>('[data-action="delete-session"]');
      if (deleteBtn) {
        const threadId = deleteBtn.dataset.id;
        if (threadId) {
          await deleteCodexSession(threadId);
        }
        return;
      }
    });

    // 2. Search Input events
    const searchInput = sessionsContainer.querySelector<HTMLInputElement>("#session-search");
    searchInput?.addEventListener("input", (event) => {
      const val = (event.currentTarget as HTMLInputElement).value;
      state.sessionSearchQuery = val;
      state.sessionPage = 0;
      const clearContainer = sessionsContainer.querySelector("#search-clear-container");
      if (clearContainer) {
        clearContainer.innerHTML = val ? `<button class="search-clear-btn" id="session-search-clear">×</button>` : "";
      }
      refreshSessionsListView();
    });
  }
}

export function bindSessionCleanupEvents(): void {
  const cleanupPage = document.querySelector<HTMLElement>(".cleanup-page-container");
  if (!cleanupPage || cleanupPage.dataset.eventsBound === "true") {
    return;
  }
  cleanupPage.dataset.eventsBound = "true";

  cleanupPage.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    const actionButton = target.closest<HTMLButtonElement>("[data-action]");
    const action = actionButton?.dataset.action;

    if (action === "set-cleanup-filter" && actionButton) {
      const filter = actionButton.dataset.filter as CleanupFilter;
      if (filter && state.cleanupFilter !== filter) {
        state.cleanupFilter = filter;
        state.cleanupProjectPage = 0;
        state.cleanupSessionPage = 0;
        cleanupPage
          .querySelectorAll<HTMLButtonElement>('[data-action="set-cleanup-filter"]')
          .forEach((button) => {
            button.classList.toggle("active", button.dataset.filter === filter);
          });
        refreshSessionCleanupSections();
        cleanupPage.scrollTop = 0;
      }
      return;
    }

    const pageActions: Record<string, { kind: "project" | "session"; delta: number }> = {
      "cleanup-project-page-prev": { kind: "project", delta: -1 },
      "cleanup-project-page-next": { kind: "project", delta: 1 },
      "cleanup-session-page-prev": { kind: "session", delta: -1 },
      "cleanup-session-page-next": { kind: "session", delta: 1 },
    };
    const pageAction = action ? pageActions[action] : undefined;
    if (pageAction) {
      if (pageAction.kind === "project") {
        state.cleanupProjectPage = Math.max(
          0,
          state.cleanupProjectPage + pageAction.delta,
        );
        refreshCleanupProjectsSection();
      } else {
        state.cleanupSessionPage = Math.max(
          0,
          state.cleanupSessionPage + pageAction.delta,
        );
        refreshCleanupSessionsSection();
      }
      return;
    }

    const projectButton = target.closest<HTMLButtonElement>(".btn-clean-project");
    if (projectButton) {
      const cwd = projectButton.dataset.cwd;
      const idsJson = projectButton.dataset.ids;
      if (cwd && idsJson) {
        try {
          const ids = JSON.parse(idsJson) as string[];
          await deleteProjectSessions(cwd, ids);
        } catch (e) {
          console.error("Failed to parse session IDs for project cleanup", e);
        }
      }
      return;
    }

    const singleDeleteButton = target.closest<HTMLButtonElement>(".btn-clean-single-session");
    if (singleDeleteButton) {
      const id = singleDeleteButton.dataset.id;
      if (id) {
        await batchDeleteSessions([id]);
      }
      return;
    }

    if (target.closest("#cleanup-batch-delete-btn")) {
      const ids = Array.from(
        cleanupPage.querySelectorAll<HTMLInputElement>(".cleanup-item-checkbox:checked"),
      ).map((checkbox) => checkbox.dataset.id).filter(Boolean) as string[];
      if (ids.length > 0) {
        await batchDeleteSessions(ids);
      }
      return;
    }

    if (action === "cleanup-delete-all-old-sessions") {
      const cleanupWindowMs = state.cleanupFilter === "7d"
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
      const oldSessionIds = getOldSessions(
        state.sessions,
        Date.now() - cleanupWindowMs,
      ).map((session) => session.id);
      if (oldSessionIds.length === 0) {
        setFlash("success", "当前范围内没有需要清理的历史会话", { render: false });
        return;
      }
      await batchDeleteSessions(oldSessionIds, {
        targetLabel: `当前范围内全部 ${oldSessionIds.length} 个历史会话`,
        successMessage: `已一键清理 ${oldSessionIds.length} 个历史会话及其文件`,
      });
      return;
    }
  });

  cleanupPage.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    if (!target.matches("#cleanup-select-all, .cleanup-item-checkbox")) {
      return;
    }

    const itemCheckboxes = Array.from(
      cleanupPage.querySelectorAll<HTMLInputElement>(".cleanup-item-checkbox"),
    );
    const selectAllCheckbox =
      cleanupPage.querySelector<HTMLInputElement>("#cleanup-select-all");
    if (target.id === "cleanup-select-all") {
      itemCheckboxes.forEach((checkbox) => {
        checkbox.checked = target.checked;
      });
    } else if (selectAllCheckbox) {
      const checkedCount = itemCheckboxes.filter((checkbox) => checkbox.checked).length;
      selectAllCheckbox.checked = checkedCount === itemCheckboxes.length;
      selectAllCheckbox.indeterminate =
        checkedCount > 0 && checkedCount < itemCheckboxes.length;
    }

    const checkedCount = itemCheckboxes.filter((checkbox) => checkbox.checked).length;
    const batchButton =
      cleanupPage.querySelector<HTMLButtonElement>("#cleanup-batch-delete-btn");
    const countSpan =
      cleanupPage.querySelector<HTMLSpanElement>("#cleanup-selected-count");
    if (batchButton) {
      batchButton.disabled = checkedCount === 0;
    }
    if (countSpan) {
      countSpan.textContent = checkedCount.toString();
    }
  });
}
