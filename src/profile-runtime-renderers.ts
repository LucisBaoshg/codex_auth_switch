import type { AppSnapshot, ProfileSummary } from "./desktop-types";
import { escapeHtml } from "./html-utils";
import {
  latencyProbeActionKey,
  refreshAllUsageActionKey,
  thirdPartyUsageActionKey,
  usageRefreshActionKey,
} from "./pending-action-keys";
import { hasPendingAction } from "./pending-actions";
import {
  formatDateTime,
  formatLatencyDuration,
  formatPlanTitle,
  formatQuotaCurrency,
  formatQuotaCurrencyCompact,
  formatQuotaPercent,
  formatUsageReset,
  isOfficialOauthProfile,
  isThirdPartyBackedProfile,
  quotaPercent,
  remainingPercent,
  selectUsageWindow,
  type CodexUsageWindow,
  type ThirdPartyUsageQuotaSnapshot,
} from "./usage-formatters";

export type ProfileRuntimeRenderContext = {
  busy: boolean;
  pendingActions: ReadonlySet<string>;
};

function renderUsageProgressRow(label: string, window: CodexUsageWindow | null): string {
  const remaining = window ? remainingPercent(window.usedPercent) : 0;

  return `
    <div class="usage-progress-row">
      <div class="usage-progress-head">
        <span class="usage-progress-label">${escapeHtml(label)}</span>
        <span class="usage-progress-reset">${escapeHtml(formatUsageReset(window))}</span>
      </div>
      <div class="usage-progress-line">
        <div class="usage-progress-track">
          <div class="usage-progress-fill" style="width:${remaining}%"></div>
        </div>
        <span class="usage-progress-value">${window ? `${remaining}%` : "--"}</span>
      </div>
    </div>
  `;
}

export function renderCodexUsagePanel(
  snapshot: AppSnapshot,
  profile: ProfileSummary,
  context: ProfileRuntimeRenderContext,
): string {
  if (!isOfficialOauthProfile(profile)) {
    return "";
  }

  const usage = profile.codexUsage;
  const primaryWindow = selectUsageWindow(usage, 300, true);
  const weeklyWindow = selectUsageWindow(usage, 10080, false);
  const usageError = usage?.error ?? null;
  const updated = usage ? formatDateTime(usage.updatedAt) : "还没有";
  const refreshingUsage = hasPendingAction(context.pendingActions, usageRefreshActionKey(profile.id));
  const refreshingAllUsage = hasPendingAction(context.pendingActions, refreshAllUsageActionKey);
  const usageButtonLabel = refreshingUsage ? "刷新中..." : "刷新额度";
  const usageUpdatedCopy = refreshingUsage
    ? "正在刷新额度…"
    : refreshingAllUsage
      ? "批量刷新中…"
      : `更新于：${updated}`;

  return `
    <section class="usage-panel">
      <div class="usage-panel-head">
        <div class="usage-panel-copy">
          <strong>${escapeHtml(formatPlanTitle(usage?.planType ?? null))}</strong>
          <span class="usage-panel-updated">${escapeHtml(usageUpdatedCopy)}</span>
        </div>
        ${
          snapshot.codexUsageApiEnabled
            ? `
              <button
                class="button button-ghost usage-refresh-button"
                data-action="refresh-codex-usage"
                data-id="${profile.id}"
                data-name="${escapeHtml(profile.name)}"
                ${context.busy || refreshingUsage || refreshingAllUsage ? "disabled" : ""}
              >
                ${escapeHtml(usageButtonLabel)}
              </button>
            `
            : `
              <button
                class="button button-ghost usage-refresh-button"
                data-action="enable-codex-usage"
                ${context.busy || refreshingAllUsage ? "disabled" : ""}
              >
                启用额度查询
              </button>
            `
        }
      </div>
      ${
        usageError
          ? `<p class="latency-panel-error">额度刷新失败：${escapeHtml(usageError)}</p>`
          : `
            <div class="usage-progress-list">
              ${renderUsageProgressRow("5H", primaryWindow)}
              ${renderUsageProgressRow("WEEKLY", weeklyWindow)}
            </div>
          `
      }
    </section>
  `;
}

export function renderThirdPartyLatencyPanel(
  profile: ProfileSummary,
  context: ProfileRuntimeRenderContext,
): string {
  if (!isThirdPartyBackedProfile(profile)) {
    return "";
  }

  const probe = profile.thirdPartyLatency;
  const updated = probe ? formatDateTime(probe.updatedAt) : "还没有";
  const refreshingLatency = hasPendingAction(context.pendingActions, latencyProbeActionKey(profile.id));
  const actionLabel = refreshingLatency ? "测速中..." : probe ? "重新测速" : "开始测速";
  const probeMeta = [probe?.wireApi, probe?.model].filter(Boolean).join(" · ");
  const probeUpdatedCopy = refreshingLatency ? "正在执行测速…" : `更新于：${updated}`;

  return `
    <section class="latency-panel" data-role="third-party-latency-panel">
      <div class="latency-panel-head">
        <div class="latency-panel-copy">
          <strong>第三方 API 测速</strong>
          <span class="latency-panel-updated">${escapeHtml(probeUpdatedCopy)}</span>
        </div>
        <button
          class="button button-ghost latency-refresh-button"
          data-action="refresh-third-party-latency"
          data-id="${profile.id}"
          data-name="${escapeHtml(profile.name)}"
          ${context.busy || refreshingLatency ? "disabled" : ""}
        >
          ${escapeHtml(actionLabel)}
        </button>
      </div>
      ${
        probe?.error
          ? `<p class="latency-panel-error">测速失败：${escapeHtml(probe.error)}</p>`
          : `
            <div class="latency-panel-stats">
              <div class="latency-stat">
                <span class="latency-stat-label">首 Token</span>
                <strong>${escapeHtml(formatLatencyDuration(probe?.ttftMs ?? null))}</strong>
              </div>
              <div class="latency-stat">
                <span class="latency-stat-label">总耗时</span>
                <strong>${escapeHtml(formatLatencyDuration(probe?.totalMs ?? null))}</strong>
              </div>
            </div>
          `
      }
      <div class="latency-panel-meta">
        ${
          probeMeta
            ? `<span>${escapeHtml(probeMeta)}</span>`
            : `<span>点击按钮后会发送一次极小的流式请求用于测速</span>`
        }
        ${
          probe?.statusCode != null
            ? `<span>HTTP ${escapeHtml(String(probe.statusCode))}</span>`
            : ""
        }
      </div>
    </section>
  `;
}

function renderThirdPartyQuotaCard(label: string, quota: ThirdPartyUsageQuotaSnapshot | null | undefined): string {
  const percent = quotaPercent(quota) ?? 0;
  return `
    <div class="third-party-quota-card">
      <div class="third-party-quota-head">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(formatQuotaPercent(quota))}</span>
      </div>
      <div class="third-party-quota-amount">
        ${escapeHtml(formatQuotaCurrency(quota?.used))} / ${escapeHtml(formatQuotaCurrency(quota?.total))}
      </div>
      <div class="usage-progress-track">
        <div class="usage-progress-fill" style="width:${percent}%"></div>
      </div>
    </div>
  `;
}

export function renderThirdPartyUsagePanel(
  profile: ProfileSummary,
  context: ProfileRuntimeRenderContext,
): string {
  if (!isThirdPartyBackedProfile(profile)) {
    return "";
  }

  const usage = profile.thirdPartyUsage ?? null;
  const updated = usage ? formatDateTime(usage.updatedAt) : "还没有";
  const refreshingUsage = hasPendingAction(context.pendingActions, thirdPartyUsageActionKey(profile.id));
  const refreshingAllCodexUsage = hasPendingAction(context.pendingActions, refreshAllUsageActionKey);
  const actionLabel = refreshingUsage
    ? "刷新中..."
    : refreshingAllCodexUsage
    ? "等待中..."
    : usage
    ? "重新刷新"
    : "刷新用量";
  const provider = usage?.provider ?? "ylscode";
  const usageUpdatedCopy = refreshingUsage ? "正在刷新用量…" : `更新于：${updated}`;

  return `
    <section class="latency-panel" data-role="third-party-usage-panel">
      <div class="latency-panel-head">
        <div class="latency-panel-copy">
          <strong>第三方 API 用量</strong>
          <span class="latency-panel-updated">${escapeHtml(usageUpdatedCopy)}</span>
        </div>
        <button
          class="button button-ghost latency-refresh-button"
          data-action="refresh-third-party-usage"
          data-id="${profile.id}"
          data-name="${escapeHtml(profile.name)}"
          ${context.busy || refreshingUsage || refreshingAllCodexUsage ? "disabled" : ""}
        >
          ${escapeHtml(actionLabel)}
        </button>
      </div>
      ${
        usage?.error
          ? `<p class="latency-panel-error">用量刷新失败：${escapeHtml(usage.error)}</p>`
          : `
            <div class="third-party-quota-grid">
              ${renderThirdPartyQuotaCard("今日配额", usage?.daily ?? null)}
              ${renderThirdPartyQuotaCard("本周配额", usage?.weekly ?? null)}
            </div>
          `
      }
      <div class="latency-panel-meta">
        <span>${escapeHtml(provider)}</span>
      </div>
    </section>
  `;
}

export function renderThirdPartyRuntimePanel(
  profile: ProfileSummary,
  context: ProfileRuntimeRenderContext,
): string {
  if (!isThirdPartyBackedProfile(profile)) {
    return "";
  }

  const usage = profile.thirdPartyUsage ?? null;
  const probe = profile.thirdPartyLatency;
  const refreshingUsage = hasPendingAction(context.pendingActions, thirdPartyUsageActionKey(profile.id));
  const refreshingLatency = hasPendingAction(context.pendingActions, latencyProbeActionKey(profile.id));
  const refreshingAllCodexUsage = hasPendingAction(context.pendingActions, refreshAllUsageActionKey);
  const provider = usage?.provider ?? "ylscode";

  return `
    <section class="runtime-panel" data-role="third-party-runtime-panel">
      <div class="runtime-panel-head">
        <div class="runtime-provider">${escapeHtml(provider)}</div>
        <div class="runtime-actions">
          <button
            class="button button-ghost runtime-action-button"
            data-action="refresh-third-party-usage"
            data-id="${profile.id}"
            data-name="${escapeHtml(profile.name)}"
            ${context.busy || refreshingUsage || refreshingAllCodexUsage ? "disabled" : ""}
          >
            ${refreshingUsage ? "用量中..." : refreshingAllCodexUsage ? "等待中..." : "刷新用量"}
          </button>
          <button
            class="button button-ghost runtime-action-button"
            data-action="refresh-third-party-latency"
            data-id="${profile.id}"
            data-name="${escapeHtml(profile.name)}"
            ${context.busy || refreshingLatency ? "disabled" : ""}
          >
            ${refreshingLatency ? "测速中..." : "测速"}
          </button>
        </div>
      </div>
      ${
        usage?.error || probe?.error
          ? `
            <div class="runtime-errors">
              ${usage?.error ? `<p>用量：${escapeHtml(usage.error)}</p>` : ""}
              ${probe?.error ? `<p>测速：${escapeHtml(probe.error)}</p>` : ""}
            </div>
          `
          : ""
      }
      <div class="runtime-metrics">
        <div class="runtime-metric runtime-metric-wide">
          <div class="runtime-metric-head">
            <span>今日</span>
            <em>${escapeHtml(formatQuotaPercent(usage?.daily))}</em>
          </div>
          <strong>${escapeHtml(formatQuotaCurrency(usage?.daily?.used))} / ${escapeHtml(formatQuotaCurrency(usage?.daily?.total))}</strong>
          <div class="usage-progress-track">
            <div class="usage-progress-fill" style="width:${quotaPercent(usage?.daily) ?? 0}%"></div>
          </div>
        </div>
        <div class="runtime-metric runtime-metric-wide">
          <div class="runtime-metric-head">
            <span>本周</span>
            <em>${escapeHtml(formatQuotaPercent(usage?.weekly))}</em>
          </div>
          <strong>${escapeHtml(formatQuotaCurrency(usage?.weekly?.used))} / ${escapeHtml(formatQuotaCurrency(usage?.weekly?.total))}</strong>
          <div class="usage-progress-track">
            <div class="usage-progress-fill" style="width:${quotaPercent(usage?.weekly) ?? 0}%"></div>
          </div>
        </div>
        <div class="runtime-metric">
          <span>首 Token</span>
          <strong>${escapeHtml(formatLatencyDuration(probe?.ttftMs ?? null))}</strong>
        </div>
        <div class="runtime-metric">
          <span>总耗时</span>
          <strong>${escapeHtml(formatLatencyDuration(probe?.totalMs ?? null))}</strong>
        </div>
      </div>
    </section>
  `;
}

export function renderProfileRowMetrics(profile: ProfileSummary): string {
  if (isOfficialOauthProfile(profile)) {
    const usage = profile.codexUsage;
    if (usage?.error) {
      return `
        <span class="profile-row-metric profile-row-metric-error" data-role="profile-row-metric">
          <span>额度</span>
          <strong>失败</strong>
        </span>
        <span class="profile-row-metric profile-row-metric-muted" data-role="profile-row-metric">
          <span>5H</span>
          <strong>--</strong>
        </span>
        <span class="profile-row-metric profile-row-metric-muted" data-role="profile-row-metric">
          <span>本周</span>
          <strong>--</strong>
        </span>
      `;
    }

    const primaryWindow = selectUsageWindow(usage, 300, true);
    const weeklyWindow = selectUsageWindow(usage, 10080, false);
    return `
      <span class="profile-row-metric" data-role="profile-row-metric">
        <span>5H</span>
        <strong>${primaryWindow ? `${remainingPercent(primaryWindow.usedPercent)}%` : "--"}</strong>
      </span>
      <span class="profile-row-metric" data-role="profile-row-metric">
        <span>本周</span>
        <strong>${weeklyWindow ? `${remainingPercent(weeklyWindow.usedPercent)}%` : "--"}</strong>
      </span>
      <span class="profile-row-metric profile-row-metric-muted" data-role="profile-row-metric">
        <span>首响</span>
        <strong>--</strong>
      </span>
    `;
  }

  if (isThirdPartyBackedProfile(profile)) {
    const usage = profile.thirdPartyUsage;
    const probe = profile.thirdPartyLatency;
    return `
      <span class="profile-row-metric" data-role="profile-row-metric">
        <span>今日</span>
        <strong>${escapeHtml(formatQuotaCurrencyCompact(usage?.daily?.used))} / ${escapeHtml(formatQuotaCurrencyCompact(usage?.daily?.total))}</strong>
      </span>
      <span class="profile-row-metric" data-role="profile-row-metric">
        <span>本周</span>
        <strong>${escapeHtml(formatQuotaCurrencyCompact(usage?.weekly?.used))} / ${escapeHtml(formatQuotaCurrencyCompact(usage?.weekly?.total))}</strong>
      </span>
      <span class="profile-row-metric" data-role="profile-row-metric">
        <span>首响</span>
        <strong>${escapeHtml(formatLatencyDuration(probe?.ttftMs ?? null))}</strong>
      </span>
    `;
  }

  return `
    <span class="profile-row-metric" data-role="profile-row-metric">
      <span>状态</span>
      <strong>--</strong>
    </span>
  `;
}
