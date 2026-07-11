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
