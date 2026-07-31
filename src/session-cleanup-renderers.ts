import { escapeHtml } from "./html-utils";
import {
  SESSION_CLEANUP_WINDOW_MS,
  formatSessionFileSize,
  getInactiveSessionProjects,
  getOldSessions,
  type CodexSessionInfo,
} from "./session-utils";

export type CleanupFilter = "7d" | "30d";
export const CLEANUP_PROJECTS_PAGE_SIZE = 20;
export const CLEANUP_SESSIONS_PAGE_SIZE = 50;

export type SessionCleanupRenderState = {
  sessions: CodexSessionInfo[];
  nowMs: number;
  cleanupFilter?: CleanupFilter;
  cleanupProjectPage?: number;
  cleanupSessionPage?: number;
};

export function renderSessionCleanupPage(state: SessionCleanupRenderState): string {
  const filter = state.cleanupFilter || "30d";

  return `
    <div class="cleanup-page-container">
      <div class="cleanup-operation-status" role="status" aria-live="polite">
        <span class="busy-dialog-spinner" aria-hidden="true"></span>
        <span>正在处理会话文件...</span>
      </div>
      <header class="cleanup-header">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <button class="icon-button" data-action="back-to-sessions" title="返回会话管理">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            </button>
            <h2>会话清理</h2>
          </div>
          <div class="editor-template-tabs" style="margin-bottom: 0;">
            <button class="tab-btn ${filter === "7d" ? "active" : ""}" data-action="set-cleanup-filter" data-filter="7d">
              近 7 天
            </button>
            <button class="tab-btn ${filter === "30d" ? "active" : ""}" data-action="set-cleanup-filter" data-filter="30d">
              超过 1 个月
            </button>
          </div>
        </div>
        <p class="cleanup-subtitle">清理长期未使用的会话，物理删除对话 rollout 文件，释放磁盘空间。</p>
      </header>

      <div class="cleanup-sections-wrapper">
        ${renderSessionCleanupProjectsSection(state)}
        ${renderSessionCleanupSessionsSection(state)}
      </div>
    </div>
  `;
}

export function renderSessionCleanupProjectsSection(
  state: SessionCleanupRenderState,
): string {
  const filter = state.cleanupFilter || "30d";
  const cleanupCutoffMs = cleanupCutoffForFilter(state.nowMs, filter);
  const inactiveProjects = getInactiveSessionProjects(state.sessions, cleanupCutoffMs);
  const timeLabel = cleanupTimeLabel(filter);
  return `
    <div class="cleanup-section" data-role="cleanup-projects-section">
      <div class="cleanup-section-header">
        <h3>超过 ${timeLabel}没有任何会话产生的工作空间项目 (${inactiveProjects.length})</h3>
        <span class="section-desc">这些项目的开发工作可能已经结束，可以安全清理。</span>
      </div>
      ${renderInactiveProjects(inactiveProjects, filter, state.cleanupProjectPage ?? 0)}
    </div>
  `;
}

export function renderSessionCleanupSessionsSection(
  state: SessionCleanupRenderState,
): string {
  const filter = state.cleanupFilter || "30d";
  const cleanupCutoffMs = cleanupCutoffForFilter(state.nowMs, filter);
  const oldSessions = getOldSessions(state.sessions, cleanupCutoffMs);
  const timeLabel = cleanupTimeLabel(filter);
  return `
    <div class="cleanup-section" data-role="cleanup-sessions-section">
      <div class="cleanup-section-header">
        <h3>所有项目中早于 ${timeLabel}的旧会话 (${oldSessions.length})</h3>
        <span class="section-desc">清理时间久远的聊天记录，保留近期活动。</span>
      </div>
      ${renderOldSessions(oldSessions, filter, state.cleanupSessionPage ?? 0)}
    </div>
  `;
}

function cleanupCutoffForFilter(nowMs: number, filter: CleanupFilter): number {
  const windowMs = filter === "7d"
    ? 7 * 24 * 60 * 60 * 1000
    : SESSION_CLEANUP_WINDOW_MS;
  return nowMs - windowMs;
}

function cleanupTimeLabel(filter: CleanupFilter): string {
  return filter === "7d" ? "7 天" : "1 个月";
}

function renderInactiveProjects(
  inactiveProjects: ReturnType<typeof getInactiveSessionProjects<CodexSessionInfo>>,
  filter: CleanupFilter,
  requestedPage: number,
): string {
  const timeLabel = filter === "7d" ? "7 天" : "1 个月";
  if (inactiveProjects.length === 0) {
    return `<div class="cleanup-empty-state">没有超过 ${timeLabel}未活跃的项目</div>`;
  }

  const totalPages = Math.ceil(inactiveProjects.length / CLEANUP_PROJECTS_PAGE_SIZE);
  const currentPage = clampCleanupPage(requestedPage, totalPages);
  const startIndex = currentPage * CLEANUP_PROJECTS_PAGE_SIZE;
  const pageProjects = inactiveProjects.slice(
    startIndex,
    startIndex + CLEANUP_PROJECTS_PAGE_SIZE,
  );

  return `
    <div class="cleanup-list">
      ${pageProjects
        .map((project) => {
          const date = new Date(project.lastActiveTime);
          const timeStr = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
          const totalSize = project.sessions.reduce((acc, session) => acc + (session.fileSize || 0), 0);
          const idsJson = JSON.stringify(project.sessions.map((session) => session.id));
          return `
            <div class="cleanup-project-card">
              <div class="project-info">
                <svg class="icon-folder" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                <div class="project-details">
                  <span class="project-path" title="${escapeHtml(project.cwd)}">${escapeHtml(project.cwd)}</span>
                  <div class="project-meta">
                    <span>最后活跃: ${timeStr}</span>
                    <span class="dot-separator">•</span>
                    <span>会话总数: ${project.sessions.length} 个</span>
                    <span class="dot-separator">•</span>
                    <span>总计占用: ${formatSessionFileSize(totalSize)}</span>
                  </div>
                </div>
              </div>
              <button class="button button-danger btn-clean-project" data-cwd="${escapeHtml(project.cwd)}" data-ids='${escapeHtml(idsJson)}'>
                清空项目会话
              </button>
            </div>
          `;
        })
        .join("")}
    </div>
    ${renderCleanupPaginationHtml("project", currentPage, totalPages, inactiveProjects.length)}
  `;
}

function renderOldSessions(
  oldSessions: CodexSessionInfo[],
  filter: CleanupFilter,
  requestedPage: number,
): string {
  const timeLabel = filter === "7d" ? "7 天" : "1 个月";
  if (oldSessions.length === 0) {
    return `<div class="cleanup-empty-state">没有超过 ${timeLabel}的旧会话</div>`;
  }

  const totalPages = Math.ceil(oldSessions.length / CLEANUP_SESSIONS_PAGE_SIZE);
  const currentPage = clampCleanupPage(requestedPage, totalPages);
  const startIndex = currentPage * CLEANUP_SESSIONS_PAGE_SIZE;
  const pageSessions = oldSessions.slice(startIndex, startIndex + CLEANUP_SESSIONS_PAGE_SIZE);

  return `
    <div class="batch-action-bar">
      <label class="checkbox-wrapper select-all-wrapper">
        <input type="checkbox" id="cleanup-select-all">
        <span>全选本页旧会话 (${pageSessions.length})</span>
      </label>
      <div class="cleanup-batch-buttons">
        <button class="button button-danger" id="cleanup-batch-delete-btn" disabled>
          批量物理删除 (已选 <span id="cleanup-selected-count">0</span>)
        </button>
        <button
          class="button button-danger cleanup-delete-all-button"
          data-action="cleanup-delete-all-old-sessions"
        >
          一键清理全部历史会话 (${oldSessions.length})
        </button>
      </div>
    </div>
    <div class="cleanup-table-wrapper">
      <table class="cleanup-table">
        <thead>
          <tr>
            <th width="40"></th>
            <th>会话标题</th>
            <th>工作空间 (CWD)</th>
            <th width="120">最后活跃</th>
            <th width="100">大小</th>
            <th width="80">操作</th>
          </tr>
        </thead>
        <tbody>
          ${pageSessions
            .map((session) => {
              const date = new Date(session.updatedAtMs);
              const timeStr = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
              return `
                <tr class="cleanup-row" data-id="${session.id}">
                  <td>
                    <input type="checkbox" class="cleanup-item-checkbox" data-id="${session.id}">
                  </td>
                  <td class="cell-title" title="${escapeHtml(session.title || session.id)}">
                    <strong>${escapeHtml(session.title || "未命名会话")}</strong>
                    ${session.archived ? `<span class="session-card-archive-badge">已归档</span>` : ""}
                  </td>
                  <td class="cell-cwd" title="${escapeHtml(session.cwd || "")}">
                    <code>${escapeHtml(session.cwd || "无")}</code>
                  </td>
                  <td>${timeStr}</td>
                  <td>${formatSessionFileSize(session.fileSize)}</td>
                  <td>
                    <button class="button button-danger btn-clean-single-session" data-id="${session.id}">删除</button>
                  </td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
    ${renderCleanupPaginationHtml("session", currentPage, totalPages, oldSessions.length)}
  `;
}

function clampCleanupPage(requestedPage: number, totalPages: number): number {
  return Math.min(Math.max(0, requestedPage), totalPages - 1);
}

function renderCleanupPaginationHtml(
  kind: "project" | "session",
  currentPage: number,
  totalPages: number,
  totalItems: number,
): string {
  const label = kind === "project" ? "项目" : "会话";
  return `
    <nav class="cleanup-pagination" aria-label="${label}分页">
      <button
        class="cleanup-page-button"
        data-action="cleanup-${kind}-page-prev"
        ${currentPage === 0 ? "disabled" : ""}
      >
        上一页
      </button>
      <span>第 ${currentPage + 1} / ${totalPages} 页 · 共 ${totalItems} 个${label}</span>
      <button
        class="cleanup-page-button"
        data-action="cleanup-${kind}-page-next"
        ${currentPage + 1 >= totalPages ? "disabled" : ""}
      >
        下一页
      </button>
    </nav>
  `;
}
