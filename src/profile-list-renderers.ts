import type { AppSnapshot, ProfileSummary } from "./desktop-types";
import { escapeHtml } from "./html-utils";
import {
  codexUsageActionPrefix,
  latencyProbeActionKey,
  refreshAllUsageActionKey,
  thirdPartyUsageActionKey,
  usageRefreshActionKey,
} from "./pending-action-keys";
import {
  hasPendingAction,
  hasPendingActionPrefix,
} from "./pending-actions";
import {
  renderCodexUsagePanel,
  renderProfileRowMetrics,
  renderThirdPartyRuntimePanel,
  type ProfileRuntimeRenderContext,
} from "./profile-runtime-renderers";
import {
  formatDateTime,
  isOfficialOauthProfile,
  isThirdPartyBackedProfile,
  profileTypeLabel,
} from "./usage-formatters";

export type ProfileLayoutMode = "list" | "grid";

export type ProfileLayoutToggleInput = {
  layout: ProfileLayoutMode;
  busy: boolean;
};

export type ProfileCollectionRenderInput = {
  snapshot: AppSnapshot;
  profiles: ProfileSummary[];
  busy: boolean;
  pendingActions: ReadonlySet<string>;
};

export type CardsPageInput = ProfileCollectionRenderInput & {
  layout: ProfileLayoutMode;
};

export function renderProfileLayoutToggle(input: ProfileLayoutToggleInput): string {
  return `
    <div class="profile-layout-toggle" role="group" aria-label="Profile layout">
      <button
        class="profile-layout-button ${input.layout === "list" ? "active" : ""}"
        data-action="profile-layout-list"
        ${input.busy ? "disabled" : ""}
      >
        列表
      </button>
      <button
        class="profile-layout-button ${input.layout === "grid" ? "active" : ""}"
        data-action="profile-layout-grid"
        ${input.busy ? "disabled" : ""}
      >
        卡片
      </button>
    </div>
  `;
}

function profileRuntimeRenderContext(input: ProfileCollectionRenderInput): ProfileRuntimeRenderContext {
  return {
    busy: input.busy,
    pendingActions: input.pendingActions,
  };
}

function renderProfileDetailButton(profile: ProfileSummary, busy: boolean): string {
  return `
    <button
      class="button button-ghost profile-row-detail"
      title="查看和编辑完整信息"
      aria-label="查看和编辑 ${escapeHtml(profile.name)}"
      data-action="view-profile-details"
      data-id="${profile.id}"
      ${busy ? "disabled" : ""}
    >
      <svg class="profile-row-detail-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    </button>
  `;
}

export function renderCardsPage(input: CardsPageInput): string {
  return `
    <section class="cards-page" data-page="cards">
      <header class="content-header" data-tauri-drag-region>
        <div class="header-title">
          <h2>配置管理</h2>
          <span class="header-subtitle">共 ${input.snapshot.profiles.length} 个本地配置文件</span>
        </div>
        <div class="content-actions">
          <button class="button button-secondary" title="重新从本地目录读取配置文件" data-role="global-refresh" data-action="refresh" ${input.busy ? "disabled" : ""}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
            <span>同步本地配置</span>
          </button>
          <button class="button button-primary" data-role="add-card" data-action="new-profile" ${input.busy ? "disabled" : ""}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            新建配置
          </button>
        </div>
      </header>

      <section class="grid-container">
        <div class="section-header">
          <h3 class="section-title">已保存的配置文件</h3>
          <div class="section-actions">
            <button
              class="button button-secondary"
              data-action="refresh-all-codex-usage"
              title="连接 API 接口以获取并更新所有配置的最新额度使用情况"
              ${input.busy || hasPendingActionPrefix(input.pendingActions, codexUsageActionPrefix) ? "disabled" : ""}
              style="padding: 6px 12px; font-size: 0.82rem; height: 32px; display: inline-flex; align-items: center; gap: 4px;"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
              <span>${hasPendingAction(input.pendingActions, refreshAllUsageActionKey) ? "更新中..." : "更新全部额度用量"}</span>
            </button>
            ${renderProfileLayoutToggle({
              layout: input.layout,
              busy: input.busy,
            })}
          </div>
        </div>
        ${
          input.layout === "list"
            ? renderProfileList(input)
            : renderProfileGrid(input)
        }
      </section>
    </section>
  `;
}

export function renderProfileList(input: ProfileCollectionRenderInput): string {
  return `
    <div class="profile-list" data-role="profile-list">
      ${input.profiles
        .map((profile) => {
          const live = input.snapshot.activeProfileId === profile.id;
          const refreshingCodexUsage = hasPendingAction(input.pendingActions, usageRefreshActionKey(profile.id));
          const refreshingAllCodexUsage = hasPendingAction(input.pendingActions, refreshAllUsageActionKey);
          const refreshingThirdPartyUsage = hasPendingAction(input.pendingActions, thirdPartyUsageActionKey(profile.id));
          const refreshingLatency = hasPendingAction(input.pendingActions, latencyProbeActionKey(profile.id));
          return `
            <article class="profile-row ${live ? "profile-row-live" : ""}" data-role="profile-row" data-state="${live ? "live" : "idle"}">
              <div class="profile-row-main">
                <span class="profile-row-copy">
                  <span class="profile-row-title">
                    <strong>${escapeHtml(profile.name)}</strong>
                    <span class="pill pill-type">${escapeHtml(profileTypeLabel(profile))}</span>
                  </span>
                  <span>${escapeHtml(profile.notes || "暂无备注")}</span>
                </span>
              </div>
              <div class="profile-row-metrics">
                ${renderProfileRowMetrics(profile)}
              </div>
              <div class="profile-row-actions" data-role="profile-row-actions">
                <span class="profile-row-primary-action" data-role="profile-row-primary-action">
                ${
                  live
                    ? `<span class="profile-row-status profile-row-status-live">生效中</span>`
                    : `<button class="button button-secondary profile-row-switch" data-action="switch" data-id="${profile.id}" data-name="${escapeHtml(profile.name)}" ${input.busy ? "disabled" : ""}>应用</button>`
                }
                </span>
                <span class="profile-row-utility-actions" data-role="profile-row-secondary-actions">
                  <span class="profile-row-action-slot" data-role="profile-row-quota-action">
                  ${
                    isOfficialOauthProfile(profile)
                      ? input.snapshot.codexUsageApiEnabled
                        ? `
                          <button
                            class="button button-ghost profile-row-utility"
                            data-action="refresh-codex-usage"
                            data-id="${profile.id}"
                            data-name="${escapeHtml(profile.name)}"
                            ${input.busy || refreshingCodexUsage || refreshingAllCodexUsage ? "disabled" : ""}
                          >
                            ${refreshingCodexUsage ? "刷新中..." : "额度"}
                          </button>
                        `
                        : `
                          <button
                            class="button button-ghost profile-row-utility"
                            data-action="enable-codex-usage"
                            ${input.busy || refreshingAllCodexUsage ? "disabled" : ""}
                          >
                            启用额度
                          </button>
                        `
                      : `
                        <button
                          class="button button-ghost profile-row-utility"
                          data-action="refresh-third-party-usage"
                          data-id="${profile.id}"
                          data-name="${escapeHtml(profile.name)}"
                          ${input.busy || refreshingThirdPartyUsage || refreshingAllCodexUsage ? "disabled" : ""}
                        >
                          ${refreshingThirdPartyUsage ? "刷新中..." : refreshingAllCodexUsage ? "等待中..." : "额度"}
                        </button>
                      `
                  }
                  </span>
                  <span class="profile-row-action-slot" data-role="profile-row-latency-action">
                  ${
                    isThirdPartyBackedProfile(profile)
                      ? `
                        <button
                          class="button button-ghost profile-row-utility"
                          data-action="refresh-third-party-latency"
                          data-id="${profile.id}"
                          data-name="${escapeHtml(profile.name)}"
                          ${input.busy || refreshingLatency ? "disabled" : ""}
                        >
                          ${refreshingLatency ? "测速中..." : "测速"}
                        </button>
                      `
                      : `<span class="profile-row-action-placeholder">--</span>`
                  }
                  </span>
                </span>
                <span class="profile-row-detail-actions" data-role="profile-row-detail-action">
                  ${renderProfileDetailButton(profile, input.busy)}
                </span>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

export function renderProfileGrid(input: ProfileCollectionRenderInput): string {
  const runtimeContext = profileRuntimeRenderContext(input);

  return `
    <div class="card-grid" data-role="profile-grid">
      ${input.profiles.length === 0 ? `
        <div class="empty-state">
          <h3>暂无存档记录</h3>
          <p>点击右上角 "+ 新建配置" 按钮录入您的第一套 Profile 集合吧！</p>
        </div>
      ` : ""}
      ${input.profiles
        .map(
          (profile) => `
            <article
              class="card profile-card ${input.snapshot.activeProfileId === profile.id ? "profile-card-live" : ""}"
              data-role="profile-card"
              data-state="${input.snapshot.activeProfileId === profile.id ? "live" : "idle"}"
            >
              <div class="card-head">
                <h2 title="${escapeHtml(profile.name)}">${escapeHtml(profile.name)}</h2>
                <div style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
                  ${input.snapshot.activeProfileId === profile.id ? `
                    <div class="status-badge">
                      <div class="status-dot status-dot-pulse"></div>
                      <span>Active</span>
                    </div>
                  ` : ""}
                  <span class="pill pill-type">${escapeHtml(profileTypeLabel(profile))}</span>
                </div>
              </div>
              <p class="card-note" style="${!profile.notes ? 'opacity:0.5;font-style:italic;' : ''}">${escapeHtml(profile.notes || "暂无备注")}</p>
              ${renderCodexUsagePanel(input.snapshot, profile, runtimeContext)}
              ${renderThirdPartyRuntimePanel(profile, runtimeContext)}

              <div class="card-actions-overlay">
                <div style="display: flex; flex-direction: column; gap: 4px; flex-grow: 1;">
                  <p class="card-date">更新于：${formatDateTime(profile.updatedAt)}</p>
                  ${input.snapshot.activeProfileId === profile.id
                    ? `<div class="env-active-label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> 环境生效中</div>`
                    : `<button class="button button-secondary" style="width:100%" data-action="switch" data-id="${profile.id}" data-name="${escapeHtml(profile.name)}" ${input.busy ? "disabled" : ""}>应用此配置</button>`}
                </div>

                <div class="card-secondary-actions" style="align-self: flex-end; padding-bottom: 2px; display: flex; gap: 4px;">
                  ${renderProfileDetailButton(profile, input.busy)}
                </div>
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}
