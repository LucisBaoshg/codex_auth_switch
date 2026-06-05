import { escapeHtml, formatMessageText } from "./html-utils";
import {
  formatSessionFileSize,
  groupSessionsByCwd,
  type CodexMessage,
  type CodexSessionInfo,
} from "./session-utils";

export type SessionFilter = "all" | "active" | "archived";
export type SessionSortOrder = "time" | "cwd";

export type SessionRenderState = {
  sessions: CodexSessionInfo[];
  selectedSessionId: string | null;
  sessionMessages: CodexMessage[];
  sessionSearchQuery: string;
  sessionFilter: SessionFilter;
  sessionSortOrder: SessionSortOrder;
  sessionsLoading: boolean;
  messagesLoading: boolean;
};

export function renderSessionsListHtml(state: SessionRenderState): string {
  let filtered = state.sessions;
  if (state.sessionFilter === "active") {
    filtered = filtered.filter((session) => !session.archived);
  } else if (state.sessionFilter === "archived") {
    filtered = filtered.filter((session) => session.archived);
  }

  const query = state.sessionSearchQuery.toLowerCase().trim();
  if (query) {
    filtered = filtered.filter(
      (session) =>
        (session.title && session.title.toLowerCase().includes(query)) ||
        session.id.toLowerCase().includes(query) ||
        (session.cwd && session.cwd.toLowerCase().includes(query)),
    );
  }

  const selectedSession = state.sessions.find((session) => session.id === state.selectedSessionId);

  if (state.sessionsLoading) {
    return `
      <div class="sessions-empty-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 40px 20px;">
        <div class="busy-dialog-spinner" style="margin: 0 auto; width: 24px; height: 24px; border-width: 2px;"></div>
        <span style="color: var(--text-muted); font-size: 0.85rem;">正在加载会话列表...</span>
      </div>
    `;
  }

  if (filtered.length === 0) {
    return `<div class="sessions-empty-state">没有找到符合条件的会话</div>`;
  }

  if (state.sessionSortOrder === "cwd") {
    const groups = groupSessionsByCwd(filtered);
    const cwdMaxTimes: Record<string, number> = {};
    for (const cwd of Object.keys(groups)) {
      cwdMaxTimes[cwd] = Math.max(...groups[cwd].map((session) => session.updatedAtMs));
    }

    return Object.keys(groups)
      .sort((left, right) => cwdMaxTimes[right] - cwdMaxTimes[left])
      .map((cwd) => {
        const folderSessions = groups[cwd].sort((left, right) => right.updatedAtMs - left.updatedAtMs);
        return `
          <details class="workspace-group" open>
            <summary class="workspace-header">
              <svg class="icon-folder" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
              <span class="workspace-title" title="${escapeHtml(cwd)}">${escapeHtml(cwd.split(/[/\\]/).pop() || cwd)}</span>
              <span class="workspace-count">${folderSessions.length}</span>
              <svg class="icon-chevron" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </summary>
            <div class="workspace-sessions">
              ${folderSessions.map((session) => renderSessionItemHtml(session, selectedSession)).join("")}
            </div>
          </details>
        `;
      })
      .join("");
  }

  const sorted = [...filtered].sort((left, right) => right.updatedAtMs - left.updatedAtMs);
  return `<div class="sessions-linear-list">${sorted
    .map((session) => renderSessionItemHtml(session, selectedSession))
    .join("")}</div>`;
}

export function renderSessionDetailHtml(state: SessionRenderState): string {
  const selectedSession = state.sessions.find((session) => session.id === state.selectedSessionId);

  if (!selectedSession) {
    return `
      <div class="session-detail-empty">
        <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        <p>选择左侧的 Codex 会话以预览历史消息</p>
      </div>
    `;
  }

  return `
    <div class="session-detail-active">
      <header class="session-detail-header">
        <div class="session-detail-title-row">
          <h3 class="session-detail-title" title="${escapeHtml(selectedSession.title || selectedSession.id)}">
            ${escapeHtml(selectedSession.title || "未命名会话")}
          </h3>
          <span class="session-detail-badge ${selectedSession.archived ? "badge-archived" : "badge-active"}">
            ${selectedSession.archived ? "已归档" : "活跃"}
          </span>
        </div>
        <div class="session-detail-meta-row">
          <span class="meta-item">
            <strong>路径:</strong> <code title="${escapeHtml(selectedSession.rolloutPath || "")}">${escapeHtml(selectedSession.rolloutPath || "无")}</code>
          </span>
          <span class="meta-item">
            <strong>工作目录:</strong> <code title="${escapeHtml(selectedSession.cwd || "")}">${escapeHtml(selectedSession.cwd || "无")}</code>
          </span>
          <span class="meta-item">
            <strong>大小:</strong> ${formatSessionFileSize(selectedSession.fileSize)}
          </span>
          ${selectedSession.modelProvider ? `
            <span class="meta-item">
              <strong>提供商:</strong> <span class="pill pill-provider">${escapeHtml(selectedSession.modelProvider)}</span>
            </span>
          ` : ""}
        </div>
        <div class="session-detail-actions">
          <button class="button button-secondary" data-action="rename-session" data-id="${selectedSession.id}">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            重命名
          </button>
          <button class="button button-secondary" data-action="toggle-archive-session" data-id="${selectedSession.id}" data-archived="${selectedSession.archived}">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="9"></line><line x1="9" y1="13" x2="15" y2="13"></line><line x1="9" y1="17" x2="15" y2="17"></line></svg>
            ${selectedSession.archived ? "取消归档" : "归档会话"}
          </button>
          <button class="button button-secondary" data-action="export-session" data-id="${selectedSession.id}">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"></path></svg>
            导出
          </button>
          <button class="button button-danger" data-action="delete-session" data-id="${selectedSession.id}">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            彻底删除
          </button>
        </div>
      </header>
      <div class="session-messages-container">
        ${renderSessionMessages(state)}
      </div>
    </div>
  `;
}

export function renderSessionsPage(state: SessionRenderState): string {
  const listHtml = renderSessionsListHtml(state);
  const rightPaneHtml = renderSessionDetailHtml(state);

  return `
    <div class="sessions-page-container">
      <div class="sessions-sidebar-pane">
        <div class="sessions-pane-header" data-tauri-drag-region style="display: flex; justify-content: space-between; align-items: center;">
          <h2>Codex 会话管理</h2>
          <button class="icon-button" data-action="nav-session-cleanup" title="清理旧会话" style="width: 28px; height: 28px; border-radius: 6px;">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
        </div>
        <div class="sessions-pane-filters">
          <div class="search-input-wrapper">
            <svg class="search-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" id="session-search" placeholder="搜索标题、工作空间..." value="${escapeHtml(state.sessionSearchQuery)}">
            <span id="search-clear-container">
              ${state.sessionSearchQuery ? `<button class="search-clear-btn" id="session-search-clear">×</button>` : ""}
            </span>
          </div>
          <div class="filter-controls-row">
            <div class="filter-group">
              <button class="filter-tab ${state.sessionFilter === "all" ? "active" : ""}" data-filter="all">全部</button>
              <button class="filter-tab ${state.sessionFilter === "active" ? "active" : ""}" data-filter="active">活跃</button>
              <button class="filter-tab ${state.sessionFilter === "archived" ? "active" : ""}" data-filter="archived">已归档</button>
            </div>
            <div class="sort-group">
              <button class="sort-btn ${state.sessionSortOrder === "time" ? "active" : ""}" data-sort="time" title="按时间排序">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              </button>
              <button class="sort-btn ${state.sessionSortOrder === "cwd" ? "active" : ""}" data-sort="cwd" title="按工作空间分组">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
              </button>
            </div>
          </div>
        </div>
        <div class="sessions-list-scroll">
          ${listHtml}
        </div>
      </div>
      <div class="sessions-detail-pane">
        ${rightPaneHtml}
      </div>
    </div>
  `;
}

function renderSessionItemHtml(
  session: CodexSessionInfo,
  selectedSession: CodexSessionInfo | undefined,
): string {
  const isSelected = selectedSession && selectedSession.id === session.id;
  const date = new Date(session.updatedAtMs);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const timeStr = `${month}月${day}日 ${hours}:${minutes}`;

  return `
    <div class="session-item-card ${isSelected ? "selected" : ""}" data-action="select-session" data-id="${session.id}">
      <div class="session-card-header">
        <span class="session-card-title" title="${escapeHtml(session.title || session.id)}">${escapeHtml(session.title || "未命名会话")}</span>
        ${session.archived ? `<span class="session-card-archive-badge">已归档</span>` : ""}
      </div>
      <div class="session-card-details">
        <span class="session-card-cwd" title="${escapeHtml(session.cwd || "")}">${escapeHtml(session.cwd ? (session.cwd.split(/[/\\]/).pop() || "") : "无目录")}</span>
        <div class="session-card-meta">
          <span>${timeStr}</span>
          <span class="dot-separator">•</span>
          <span>${formatSessionFileSize(session.fileSize)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderSessionMessages(state: SessionRenderState): string {
  if (state.messagesLoading) {
    return `
      <div class="messages-loading-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 100%; min-height: 200px; padding: 40px 20px;">
        <div class="busy-dialog-spinner" style="margin: 0 auto; width: 24px; height: 24px; border-width: 2px;"></div>
        <span style="color: var(--text-muted); font-size: 0.85rem;">正在加载会话消息...</span>
      </div>
    `;
  }

  if (state.sessionMessages.length === 0) {
    return `<div class="messages-empty">该会话暂无消息，或对话文件为空。</div>`;
  }

  return state.sessionMessages
    .map((message) => {
      const isUser = message.role === "user";
      const bubbleClass = isUser ? "msg-user" : "msg-assistant";
      const avatarChar = isUser ? "👤" : "🤖";
      const displayName = isUser ? "User" : "Codex";

      return `
        <div class="message-bubble-wrapper ${bubbleClass}">
          <div class="message-avatar">${avatarChar}</div>
          <div class="message-content-box">
            <div class="message-sender">${displayName}</div>
            <div class="message-text">${formatMessageText(message.text)}</div>
          </div>
        </div>
      `;
    })
    .join("");
}
