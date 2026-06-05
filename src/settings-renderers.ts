import { escapeHtml } from "./html-utils";
import type { NetworkSharingSettings } from "./network-sharing";

export type SettingsPageInput = {
  networkSharing: NetworkSharingSettings;
  defaultNetworkProfilesApi: string;
  networkPortalUrl: string;
  accountSettingsHtml: string;
  busy: boolean;
  migratingLegacyThirdParty: boolean;
  writingThirdPartyWebsocketsDefaults: boolean;
};

export function renderSettingsPage(input: SettingsPageInput): string {
  return `
    <section class="cards-page" data-page="settings">
      <header class="content-header" data-tauri-drag-region>
        <h2>全局设置</h2>
      </header>

      <div class="grid-container" style="max-width: 760px;">
        <div class="card">
          <div class="card-head">
            <h3>企业共享库</h3>
          </div>
          <p class="card-note">从这里打开钉钉 SSO 登录页，登录完成后客户端会自动连接企业共享库。客户端只会拉取您有权限访问的配置。</p>
          <div style="display:grid; gap: 14px; margin-top: 16px;">
            <label class="field">
              <span>共享库 API 地址</span>
              <input
                id="network-profiles-api"
                type="url"
                value="${escapeHtml(input.networkSharing.profilesApi)}"
                placeholder="${escapeHtml(input.defaultNetworkProfilesApi)}"
              />
            </label>
            <label class="field">
              <span>桌面访问令牌</span>
              <input
                id="network-profile-token"
                type="password"
                value="${escapeHtml(input.networkSharing.token)}"
                placeholder="cas_..."
                autocomplete="off"
              />
            </label>
            ${input.accountSettingsHtml}
            <div class="content-actions">
              <button class="button button-primary" data-action="open-network-sso-login">
                钉钉 SSO 登录
              </button>
              <a class="button button-secondary" href="${escapeHtml(input.networkPortalUrl)}/profiles" target="_blank" rel="noreferrer">
                打开共享库网页
              </a>
            </div>
            <div class="content-actions">
              <button class="button button-primary" data-action="save-network-sharing-settings">
                保存共享库设置
              </button>
              <button class="button button-secondary" data-action="refresh-network-after-settings">
                保存并刷新共享库
              </button>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-head">
            <h3>数据迁移</h3>
          </div>
          <p class="card-note">将旧版本的第三方 API 配置迁移到新的配置格式。如果您之前有使用旧版配置，建议执行此操作。</p>
          <div class="content-actions" style="margin-top: 16px;">
            <button
              class="button button-secondary"
              data-action="migrate-legacy-third-party"
              ${input.busy || input.migratingLegacyThirdParty ? "disabled" : ""}
            >
              ${input.migratingLegacyThirdParty ? "迁移中..." : "迁移旧第三方配置"}
            </button>
            <button
              class="button button-secondary"
              data-action="write-third-party-websockets-defaults"
              ${input.busy || input.writingThirdPartyWebsocketsDefaults ? "disabled" : ""}
            >
              ${input.writingThirdPartyWebsocketsDefaults ? "写入中..." : "写入第三方 WebSocket 默认值"}
            </button>
          </div>
        </div>
      </div>
    </section>
  `;
}
