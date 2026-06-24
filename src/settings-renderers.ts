import { escapeHtml } from "./html-utils";
import type { NetworkSharingSettings } from "./network-sharing";
import type { PacProxyStatus } from "./desktop-types";

export type SettingsPageInput = {
  networkSharing: NetworkSharingSettings;
  defaultNetworkProfilesApi: string;
  networkPortalUrl: string;
  accountSettingsHtml: string;
  busy: boolean;
  migratingLegacyThirdParty: boolean;
  writingThirdPartyWebsocketsDefaults: boolean;
  pacProxy?: PacProxyStatus;
  pacProxyLoading?: boolean;
};

function fallbackPacProxyStatus(): PacProxyStatus {
  return {
    supported: false,
    enabled: false,
    pacUrl: "http://10.12.0.24/proxy.pac",
    selectedPacKey: "jp",
    pacOptions: [
      { key: "jp", label: "日本（Japan）", url: "http://10.12.0.24/proxy.pac" },
      { key: "us", label: "美国（US）", url: "http://10.12.0.24/proxy-us.pac" },
      { key: "ca", label: "加拿大（Canada）", url: "http://10.12.0.24/proxy-ca.pac" },
    ],
    availableServices: [],
    selectedServices: [],
    services: [],
    message: "PAC 状态尚未加载。",
  };
}

function renderPacProxyServiceOptions(pacProxy: PacProxyStatus, disabled: boolean): string {
  if (!pacProxy.supported || pacProxy.availableServices.length === 0) {
    return "";
  }

  const selected = new Set(pacProxy.selectedServices);
  const options = pacProxy.availableServices
    .map((service) => `
              <label class="pac-service-option">
                <input
                  type="checkbox"
                  data-action="toggle-pac-proxy-service"
                  value="${escapeHtml(service)}"${selected.has(service) ? " checked" : ""}
                  ${disabled ? "disabled" : ""}
                />
                <span>${escapeHtml(service)}</span>
              </label>
    `)
    .join("");

  return `
          <div class="pac-service-options" data-role="pac-service-options">
            <span>生效网络服务</span>
            <div class="pac-service-option-grid">
              ${options}
            </div>
          </div>
  `;
}

function renderPacProxyOptionControls(pacProxy: PacProxyStatus, disabled: boolean): string {
  if (!pacProxy.pacOptions.length) {
    return "";
  }

  const options = pacProxy.pacOptions
    .map((option) => {
      const active = option.key === pacProxy.selectedPacKey;
      return `
              <button
                class="pac-option-button${active ? " is-active" : ""}"
                data-action="select-pac-proxy-option"
                data-pac-key="${escapeHtml(option.key)}"
                aria-pressed="${active ? "true" : "false"}"
                title="${escapeHtml(option.url)}"
                ${disabled ? "disabled" : ""}
              >
                <span>${escapeHtml(option.label)}</span>
                <small>${escapeHtml(option.url)}</small>
              </button>
      `;
    })
    .join("");

  return `
          <div class="pac-option-controls" data-role="pac-option-controls">
            <span>PAC 节点</span>
            <div class="pac-option-grid">
              ${options}
            </div>
          </div>
  `;
}

function renderPacProxySettings(input: SettingsPageInput): string {
  const pacProxy = input.pacProxy ?? fallbackPacProxyStatus();
  const loading = Boolean(input.pacProxyLoading);
  const disabled = input.busy || loading || !pacProxy.supported;
  const stateClass = pacProxy.enabled ? "is-on" : "is-off";
  const statusText = loading
    ? "切换中..."
    : pacProxy.supported
      ? pacProxy.enabled
        ? "已开启"
        : "未开启"
      : "未开启";
  const actionTitle = pacProxy.enabled ? "关闭 PAC 内网加速" : "开启 PAC 内网加速";
  const serviceText = pacProxy.enabled && pacProxy.services.length > 0
    ? `生效网络服务：${pacProxy.services.join("、")}`
    : "开启后会写入系统自动代理配置；关闭时只关闭匹配此地址的 PAC。";

  return `
        <div class="card" data-role="pac-proxy-settings">
          <div class="card-head pac-settings-head">
            <div class="pac-settings-copy">
              <h3>PAC 内网加速</h3>
              <p class="card-note">公司内网与国内网站直连，国外工作网站按 PAC 规则自动加速。</p>
            </div>
            <button
              class="pac-toggle-switch ${stateClass}"
              data-action="toggle-pac-proxy"
              aria-pressed="${pacProxy.enabled ? "true" : "false"}"
              title="${escapeHtml(actionTitle)}"
              ${disabled ? "disabled" : ""}
            >
              <span class="pac-toggle-track" aria-hidden="true">
                <span class="pac-toggle-thumb"></span>
              </span>
              <span>${escapeHtml(statusText)}</span>
            </button>
          </div>
          ${renderPacProxyOptionControls(pacProxy, disabled)}
          <div class="pac-url-box">
            <span>自动代理配置地址</span>
            <strong>${escapeHtml(pacProxy.pacUrl)}</strong>
          </div>
          ${renderPacProxyServiceOptions(pacProxy, disabled)}
          <p class="card-note pac-settings-message">${escapeHtml(pacProxy.message ?? serviceText)}</p>
        </div>
  `;
}

export function renderSettingsPage(input: SettingsPageInput): string {
  return `
    <section class="cards-page" data-page="settings">
      <header class="content-header" data-tauri-drag-region>
        <h2>全局设置</h2>
      </header>

      <div class="grid-container" style="max-width: 760px;">
        ${renderPacProxySettings(input)}
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
