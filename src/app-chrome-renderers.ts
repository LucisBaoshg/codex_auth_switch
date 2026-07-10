import { escapeHtml, getFlashIcon, type FlashKind } from "./html-utils";
import type { ConfigRecoveryNotice } from "./desktop-types";

export type BusyDialogState = {
  title: string;
  message: string;
} | null;

export type FlashState = {
  kind: FlashKind;
  text: string;
} | null;

export type AppShellView =
  | "cards"
  | "editor"
  | "sharing"
  | "settings"
  | "sessions"
  | "session-cleanup"
  | "usage-stats";

export type AppShellInput = {
  view: AppShellView;
  contentHtml: string;
  sidebarLoginStatusHtml: string;
  flash: FlashState;
  busyDialog: BusyDialogState;
  update: {
    checking: boolean;
    hasPendingUpdate: boolean;
    currentVersionText: string;
    updateVersionText: string;
  };
};

export type NativeConfirmDialogInput = {
  message: string;
  okText: string;
  isDanger: boolean;
};

function sidebarNavItemClass(active: boolean): string {
  return active ? "nav-item active" : "nav-item";
}

export function renderFlash(flash: FlashState): string {
  if (!flash) {
    return "";
  }

  return `
    <div class="toast-notification toast-${flash.kind}">
      <span class="toast-icon">${getFlashIcon(flash.kind)}</span>
      <span class="toast-text">${escapeHtml(flash.text)}</span>
      <button class="toast-close" data-action="clear-flash" aria-label="关闭">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
  `;
}

export function renderNativeConfirmDialog(input: NativeConfirmDialogInput): string {
  const okColor = input.isDanger ? "var(--danger)" : "var(--accent)";
  const okShadow = input.isDanger ? "rgba(239,68,68,0.2)" : "rgba(99,102,241,0.2)";

  return `<style>@keyframes zoomIn { to { transform: scale(1); } }</style>
      <h3 style="margin:0 0 12px;font-size:1.2rem;">提示</h3>
      <p style="margin:0 0 24px;color:var(--text-muted);font-size:0.95rem;line-height:1.5;">${escapeHtml(input.message)}</p>
      <div style="display:flex;gap:12px;justify-content:center;">
        <button id="btn-cancel" style="flex:1;padding:10px;border:none;border-radius:12px;background:var(--bg-page);color:var(--text-main);cursor:pointer;font-weight:600;border:1px solid var(--border);">取消</button>
        <button id="btn-ok" style="flex:1;padding:10px;border:none;border-radius:12px;background:${okColor};color:white;cursor:pointer;font-weight:600;box-shadow:0 4px 12px ${okShadow};">${escapeHtml(input.okText)}</button>
      </div>`;
}

function recoveryKindLabel(notice: ConfigRecoveryNotice): string {
  switch (notice.kind) {
    case "state":
      return "应用状态";
    case "profileMetadata":
      return "档案元数据";
    case "targetMarker":
      return "活动档案标记";
    case "targetAuth":
      return "活动认证配置";
    case "targetConfig":
      return "活动模型配置";
  }
}

export function renderConfigRecoveryDialog(notices: ConfigRecoveryNotice[]): string {
  const noticeItems = notices.map((notice) => `
    <article style="padding:14px;border:1px solid var(--border);border-radius:14px;background:var(--bg-page);">
      <div style="font-weight:700;color:var(--text-main);margin-bottom:6px;">
        ${escapeHtml(recoveryKindLabel(notice))}
      </div>
      <p style="margin:0 0 8px;color:var(--text-main);line-height:1.5;">
        ${escapeHtml(notice.summary)}
      </p>
      <dl style="margin:0;display:grid;gap:6px;font-size:0.82rem;color:var(--text-muted);">
        <div><dt style="display:inline;font-weight:600;">损坏文件：</dt><dd style="display:inline;margin:0;overflow-wrap:anywhere;">${escapeHtml(notice.sourcePath)}</dd></div>
        ${notice.recoveryPath
          ? `<div><dt style="display:inline;font-weight:600;">恢复文件：</dt><dd style="display:inline;margin:0;overflow-wrap:anywhere;">${escapeHtml(notice.recoveryPath)}</dd></div>`
          : ""}
      </dl>
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:0.88rem;line-height:1.5;color:var(--text-main);">
        <strong>你需要做什么：</strong>${escapeHtml(notice.action)}
      </div>
    </article>
  `).join("");

  return `
    <section
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="config-recovery-title"
      data-role="config-recovery-dialog"
      style="width:min(620px,calc(100vw - 40px));max-height:calc(100vh - 56px);display:flex;flex-direction:column;background:var(--bg-panel);border:1px solid var(--border);border-radius:22px;box-shadow:var(--shadow-lg);color:var(--text-main);overflow:hidden;"
    >
      <header style="padding:24px 26px 16px;">
        <h2 id="config-recovery-title" style="margin:0 0 8px;font-size:1.25rem;">检测到配置文件损坏</h2>
        <p style="margin:0;color:var(--text-muted);line-height:1.55;">
          应用已跳过损坏内容并继续启动。有效配置仍可正常使用，请按下方说明处理受影响文件。
        </p>
      </header>
      <div style="padding:0 26px 18px;overflow:auto;display:grid;gap:10px;">
        <h3 style="margin:0;font-size:0.92rem;">发现的问题与已自动处理</h3>
        ${noticeItems}
      </div>
      <footer style="padding:16px 26px 22px;border-top:1px solid var(--border);display:flex;gap:12px;justify-content:flex-end;">
        <button class="button button-secondary" data-action="open-config-recovery-dir">打开恢复目录</button>
        <button class="button button-primary" data-action="acknowledge-config-recovery">我知道了</button>
      </footer>
    </section>
  `;
}

export function renderAppShell(input: AppShellInput): string {
  const updateStatusClass = input.update.checking
    ? "version-status-checking"
    : input.update.hasPendingUpdate
      ? "version-status-update"
      : "version-status-latest";
  const updateTitle = input.update.hasPendingUpdate
    ? "有新版本，点击下载并安装"
    : "最新版本，点击重新检查";
  const updateText = input.update.checking
    ? "检测版本中..."
    : input.update.hasPendingUpdate
      ? `有新版本 ${input.update.updateVersionText}`
      : `最新版 v${input.update.currentVersionText}`;

  return `
    <div class="app-layout">
      <aside class="app-sidebar">
        <div class="sidebar-header">
          <div class="app-logo">
            <svg class="app-logo-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="logo-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#22D3EE"/>
                  <stop offset="100%" stop-color="#4F46E5"/>
                </linearGradient>
              </defs>
              <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#logo-grad)"/>
              <rect x="6" y="9" width="12" height="6" rx="3" fill="rgba(255,255,255,0.2)" stroke="#FFFFFF" stroke-width="1.2"/>
              <circle cx="13.5" cy="12" r="2.2" fill="#FFFFFF"/>
            </svg>
            <span>Codex 助手</span>
          </div>
        </div>
        <nav class="sidebar-nav">
          <button class="${sidebarNavItemClass(input.view === "cards" || input.view === "editor")}" data-action="nav-profiles">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            配置管理
          </button>
          <button class="${sidebarNavItemClass(input.view === "sharing")}" data-action="nav-sharing">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><path d="M8.59 13.51 15.42 17.49"></path><path d="M15.41 6.51 8.59 10.49"></path></svg>
            配置共享
          </button>
          <button class="${sidebarNavItemClass(input.view === "sessions")}" data-action="nav-sessions">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            会话管理
          </button>
          <button class="${sidebarNavItemClass(input.view === "usage-stats")}" data-action="nav-usage-stats">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5"></path><path d="M4 19h16"></path><path d="M8 15v-4"></path><path d="M12 15V8"></path><path d="M16 15v-2"></path></svg>
            使用统计
          </button>
          <button class="${sidebarNavItemClass(input.view === "settings")}" data-action="nav-settings">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            全局设置
          </button>
        </nav>
        <div class="sidebar-footer">
          ${input.sidebarLoginStatusHtml}
          <div class="version-status ${updateStatusClass}" data-role="update-entry" data-action="check-update" style="display: flex; align-items: center; gap: 8px; cursor: pointer;" title="${escapeHtml(updateTitle)}">
            <span class="version-status-dot"></span>
            <span>${escapeHtml(updateText)}</span>
          </div>
        </div>
      </aside>
      <main class="app-main-content">
        ${input.contentHtml}
      </main>
      ${renderFlash(input.flash)}
    </div>
    ${renderBusyDialog(input.busyDialog)}
  `;
}

export function renderBusyDialog(busyDialog: BusyDialogState): string {
  if (!busyDialog) {
    return "";
  }

  return `
    <aside
      class="busy-dialog-backdrop"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-role="profile-switch-busy-dialog"
    >
      <div class="busy-dialog">
        <div class="busy-dialog-spinner" aria-hidden="true"></div>
        <div class="busy-dialog-copy">
          <h2>${escapeHtml(busyDialog.title)}</h2>
          <p>${escapeHtml(busyDialog.message)}</p>
          <div class="busy-dialog-progress" aria-hidden="true">
            <span></span>
          </div>
        </div>
      </div>
    </aside>
  `;
}
