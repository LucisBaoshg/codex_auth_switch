import { escapeHtml } from "./html-utils";
import {
  networkUserDisplayName,
  networkUserMeta,
  type NetworkUserPrincipal,
} from "./network-profile-utils";

export type SidebarLoginStatusInput = {
  hasToken: boolean;
  authRequired: boolean;
  userLoading: boolean;
  user: NetworkUserPrincipal | null;
};

export type NetworkAccountSettingsInput = {
  hasToken: boolean;
  authRequired: boolean;
  user: NetworkUserPrincipal | null;
};

export function renderSidebarLoginStatus(input: SidebarLoginStatusInput): string {
  if (!input.hasToken || input.authRequired) {
    return `
      <section class="sidebar-login-card sidebar-login-card-guest" data-role="sidebar-login-status">
        <div class="sidebar-login-main">
          <span class="sidebar-login-dot sidebar-login-dot-muted"></span>
          <div class="sidebar-login-copy">
            <strong>未登录</strong>
            <span>登录后同步企业共享库</span>
          </div>
        </div>
        <button class="sidebar-login-button" data-action="open-network-sso-login">钉钉 SSO 登录</button>
      </section>
    `;
  }

  if (input.userLoading && !input.user) {
    return `
      <section class="sidebar-login-card" data-role="sidebar-login-status">
        <div class="sidebar-login-main">
          <span class="sidebar-login-dot sidebar-login-dot-loading"></span>
          <div class="sidebar-login-copy">
            <strong>检查登录中</strong>
            <span>正在连接企业共享库</span>
          </div>
        </div>
      </section>
    `;
  }

  const userName = networkUserDisplayName(input.user);
  const userMeta = networkUserMeta(input.user);
  return `
    <section class="sidebar-login-card sidebar-login-card-signed-in" data-role="sidebar-login-status">
      <div class="sidebar-login-main">
        <span class="sidebar-login-avatar">${escapeHtml(userName.slice(0, 1).toUpperCase())}</span>
        <div class="sidebar-login-copy">
          <strong>${escapeHtml(userName)}</strong>
          <span>${escapeHtml(userMeta || "已登录企业共享库")}</span>
        </div>
      </div>
    </section>
  `;
}

export function renderNetworkAccountSettings(input: NetworkAccountSettingsInput): string {
  const userName = networkUserDisplayName(input.user);
  const userMeta = networkUserMeta(input.user);
  const signedIn = input.hasToken && !input.authRequired;

  return `
    <div class="network-account-settings" data-role="network-account-settings">
      <div>
        <span class="field-hint">当前登录</span>
        <strong>${signedIn ? escapeHtml(userName) : "未登录"}</strong>
        <p class="card-note" style="margin-top: 4px;">${
          signedIn
            ? escapeHtml(userMeta || "已连接企业共享库")
            : "请先使用钉钉 SSO 登录企业共享库。"
        }</p>
      </div>
      <button
        class="button button-secondary"
        data-action="logout-network-user"
        ${input.hasToken ? "" : "disabled"}
      >
        退出登录
      </button>
    </div>
  `;
}
