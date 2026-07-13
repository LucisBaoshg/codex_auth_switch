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
import type { CleanupFilter } from "./session-cleanup-renderers";
import { selectSessionRenderState } from "./desktop-state";
import {
  createPreviewCodexSessionMessages,
  createPreviewCodexSessions,
} from "./session-preview-data";
import {
  renderSessionDetailHtml,
  renderSessionsListHtml,
} from "./session-renderers";
import type { CodexMessage, CodexSessionInfo } from "./session-utils";

export function refreshSessionsListView(): void {
  const listScroll = document.querySelector(".sessions-list-scroll");
  if (listScroll) {
    listScroll.innerHTML = renderSessionsListHtml(selectSessionRenderState(state));
  }
}

export function refreshSessionDetailPane(): void {
  const detailPane = document.querySelector(".sessions-detail-pane");
  if (detailPane) {
    detailPane.innerHTML = renderSessionDetailHtml(selectSessionRenderState(state));
  }
}

export async function fetchCodexSessions(): Promise<void> {
  if (!isTauriRuntime) {
    state.sessions = createPreviewCodexSessions(Date.now());
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
  try {
    const list = await desktopInvoke<CodexSessionInfo[]>("list_codex_sessions");
    state.sessions = list;

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
    state.sessionsLoading = false;
    refreshSessionsListView();
    refreshSessionDetailPane();
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
    state.sessions = state.sessions.filter(s => !sessionIds.includes(s.id));
    setFlash("success", "已成功清理该项目的所有会话");
    render();
    return;
  }

  setBusy(true);
  try {
    for (const id of sessionIds) {
      await desktopInvoke("delete_codex_session", { threadId: id });
    }
    state.sessions = state.sessions.filter(s => !sessionIds.includes(s.id));
    setFlash("success", "已成功物理清理该项目的所有会话文件");
  } catch (error) {
    setFlash("error", `清理项目会话失败: ${formatErrorMessage(error)}`);
  } finally {
    setBusy(false);
    render();
  }
}

export async function batchDeleteSessions(sessionIds: string[]): Promise<void> {
  const confirmed = await nativeConfirm(
    `您确定要批量物理删除选中的 ${sessionIds.length} 个会话及其文件吗？此操作无法撤销！`,
    "确认批量删除",
    true
  );
  if (!confirmed) return;

  if (!isTauriRuntime) {
    state.sessions = state.sessions.filter(s => !sessionIds.includes(s.id));
    setFlash("success", "已成功删除选中的会话");
    render();
    return;
  }

  setBusy(true);
  try {
    for (const id of sessionIds) {
      await desktopInvoke("delete_codex_session", { threadId: id });
    }
    state.sessions = state.sessions.filter(s => !sessionIds.includes(s.id));
    setFlash("success", "已成功批量物理删除选中的会话文件");
  } catch (error) {
    setFlash("error", `批量删除会话失败: ${formatErrorMessage(error)}`);
  } finally {
    setBusy(false);
    render();
  }
}

export function bindSessionPageEvents(): void {
  const sessionsContainer = document.querySelector<HTMLDivElement>(".sessions-page-container");
  if (sessionsContainer) {
    // 1. Session list and action delegation
    sessionsContainer.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement;

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
        if (filter === "all" || filter === "active" || filter === "archived") {
          state.sessionFilter = filter;
          sessionsContainer.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
          tab.classList.add("active");
          refreshSessionsListView();
        }
        return;
      }

      // Sort button
      const sortBtn = target.closest<HTMLButtonElement>(".sort-btn");
      if (sortBtn) {
        const sort = sortBtn.dataset.sort;
        if (sort === "time" || sort === "cwd") {
          state.sessionSortOrder = sort;
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
      const clearContainer = sessionsContainer.querySelector("#search-clear-container");
      if (clearContainer) {
        clearContainer.innerHTML = val ? `<button class="search-clear-btn" id="session-search-clear">×</button>` : "";
      }
      refreshSessionsListView();
    });
  }
}

export function bindSessionCleanupEvents(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-action="set-cleanup-filter"]').forEach(btn => {
    btn.addEventListener("click", () => {
      const filter = btn.dataset.filter as CleanupFilter;
      if (filter && state.cleanupFilter !== filter) {
        state.cleanupFilter = filter;
        render();
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-clean-project").forEach(btn => {
    btn.addEventListener("click", async () => {
      const cwd = btn.dataset.cwd;
      const idsJson = btn.dataset.ids;
      if (cwd && idsJson) {
        try {
          const ids = JSON.parse(idsJson) as string[];
          await deleteProjectSessions(cwd, ids);
        } catch (e) {
          console.error("Failed to parse session IDs for project cleanup", e);
        }
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-clean-single-session").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (id) {
        await batchDeleteSessions([id]);
      }
    });
  });

  const selectAllCheckbox = document.querySelector<HTMLInputElement>("#cleanup-select-all");
  const itemCheckboxes = document.querySelectorAll<HTMLInputElement>(".cleanup-item-checkbox");

  function updateBatchDeleteButtonState() {
    const checkedCheckboxes = document.querySelectorAll<HTMLInputElement>(".cleanup-item-checkbox:checked");
    const batchBtn = document.querySelector<HTMLButtonElement>("#cleanup-batch-delete-btn");
    const countSpan = document.querySelector<HTMLSpanElement>("#cleanup-selected-count");

    if (countSpan) {
      countSpan.textContent = checkedCheckboxes.length.toString();
    }
    if (batchBtn) {
      batchBtn.disabled = checkedCheckboxes.length === 0;
    }
  }

  selectAllCheckbox?.addEventListener("change", (event) => {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    itemCheckboxes.forEach(cb => {
      cb.checked = checked;
    });
    updateBatchDeleteButtonState();
  });

  itemCheckboxes.forEach(cb => {
    cb.addEventListener("change", () => {
      const allChecked = Array.from(itemCheckboxes).every(c => c.checked);
      const someChecked = Array.from(itemCheckboxes).some(c => c.checked);
      if (selectAllCheckbox) {
        selectAllCheckbox.checked = allChecked;
        selectAllCheckbox.indeterminate = someChecked && !allChecked;
      }
      updateBatchDeleteButtonState();
    });
  });

  const batchDeleteBtn = document.querySelector<HTMLButtonElement>("#cleanup-batch-delete-btn");
  batchDeleteBtn?.addEventListener("click", async () => {
    const checkedCheckboxes = document.querySelectorAll<HTMLInputElement>(".cleanup-item-checkbox:checked");
    const ids = Array.from(checkedCheckboxes).map(cb => cb.dataset.id).filter(Boolean) as string[];
    if (ids.length > 0) {
      await batchDeleteSessions(ids);
    }
  });
}
