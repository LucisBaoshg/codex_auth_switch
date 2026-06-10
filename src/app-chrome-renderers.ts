import { escapeHtml, getFlashIcon, type FlashKind } from "./html-utils";

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
