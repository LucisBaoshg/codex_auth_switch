import type {
  CodexUsageStatsBreakdown,
  CodexUsageStatsFilter,
  CodexUsageStatsSnapshot,
  CodexUsageStatsTrend,
} from "./desktop-types";
import { escapeHtml } from "./html-utils";

export type CodexUsageStatsPageInput = {
  loading: boolean;
  error: string | null;
  stats: CodexUsageStatsSnapshot | null;
  filter: CodexUsageStatsFilter;
  activeTab: "logs" | "trends" | "breakdowns";
};

type UsageRangePreset = "today" | "7d" | "30d" | "all" | "custom";

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatCost(value: string): string {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "$0";
  }
  return `$${numeric.toFixed(4)}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatProviderName(provider: string | null | undefined): string {
  if (!provider) {
    return "unknown";
  }
  const p = provider.trim().toLowerCase();
  if (p === "openai") return "OpenAI";
  if (p === "anthropic") return "Anthropic";
  if (p === "google") return "Google";
  if (p === "deepseek") return "DeepSeek";
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function currentDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function inferRangePreset(filter: CodexUsageStatsFilter): UsageRangePreset {
  if (!filter.startDate && !filter.endDate) {
    return "all";
  }
  if (filter.startDate === currentDate() && filter.endDate === currentDate()) {
    return "today";
  }
  if (filter.endDate === currentDate() && filter.startDate === dateDaysAgo(6)) {
    return "7d";
  }
  if (filter.endDate === currentDate() && filter.startDate === dateDaysAgo(29)) {
    return "30d";
  }
  return "custom";
}

function renderRangeButton(label: string, preset: UsageRangePreset, activePreset: UsageRangePreset): string {
  return `
    <button
      class="usage-range-button ${activePreset === preset ? "usage-range-button-active" : ""}"
      data-action="set-usage-range"
      data-range="${escapeHtml(preset)}"
      type="button"
    >${escapeHtml(label)}</button>
  `;
}

function renderSelectOptions(values: string[], selected: string | null | undefined): string {
  return [
    `<option value="all"${selected ? "" : " selected"}>全部</option>`,
    ...values.map((value) => {
      const safeValue = escapeHtml(value);
      return `<option value="${safeValue}"${selected === value ? " selected" : ""}>${safeValue}</option>`;
    }),
  ].join("");
}

function renderFilterBar(input: CodexUsageStatsPageInput): string {
  const filter = input.filter;
  const stats = input.stats;
  const activePreset = inferRangePreset(filter);
  const disabled = input.loading ? "disabled" : "";
  return `
    <section class="usage-filter-bar" aria-label="使用统计筛选">
      <!-- Presets Segmented Control -->
      <div class="usage-range-group" role="group" aria-label="时间范围">
        ${renderRangeButton("今日", "today", activePreset)}
        ${renderRangeButton("7 天", "7d", activePreset)}
        ${renderRangeButton("30 天", "30d", activePreset)}
        ${renderRangeButton("全部", "all", activePreset)}
        ${renderRangeButton("自定义", "custom", activePreset)}
      </div>

      <!-- Dynamic Date Range / Inputs -->
      ${activePreset === "custom" ? `
        <div class="usage-filter-pill usage-date-pill">
          <span class="usage-filter-pill-label">开始</span>
          <input type="date" data-action="set-usage-start-date" value="${escapeHtml(filter.startDate ?? "")}" ${disabled}>
        </div>
        <div class="usage-filter-pill usage-date-pill">
          <span class="usage-filter-pill-label">结束</span>
          <input type="date" data-action="set-usage-end-date" value="${escapeHtml(filter.endDate ?? "")}" ${disabled}>
        </div>
      ` : `
        <div class="usage-filter-date-range" title="当前数据时间范围">
          ${filter.startDate && filter.endDate ? `${escapeHtml(filter.startDate)} 至 ${escapeHtml(filter.endDate)}` : "全部时间"}
        </div>
      `}

      <div class="usage-filter-divider" aria-hidden="true"></div>

      <!-- Model Selector Pill -->
      <div class="usage-filter-pill">
        <span class="usage-filter-pill-label">模型</span>
        <select data-action="set-usage-model" ${disabled}>
          ${renderSelectOptions(stats?.availableModels ?? [], filter.model)}
        </select>
      </div>

      <!-- Effort Selector Pill -->
      <div class="usage-filter-pill">
        <span class="usage-filter-pill-label">努力级别</span>
        <select data-action="set-usage-effort" ${disabled}>
          ${renderSelectOptions(stats?.availableEfforts ?? [], filter.effort)}
        </select>
      </div>
    </section>
  `;
}

function renderMetric(label: string, value: string, note: string, iconHtml: string, cardClass: string): string {
  return `
    <article class="usage-stat-card ${cardClass}">
      <div class="usage-stat-card-header">
        <span>${escapeHtml(label)}</span>
        <div class="usage-stat-card-icon" aria-hidden="true">${iconHtml}</div>
      </div>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
    </article>
  `;
}

function renderEmptyState(copy: string): string {
  return `
    <div class="usage-stats-empty">
      <svg viewBox="0 0 24 24" width="36" height="36" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 19V5"></path>
        <path d="M4 19h16"></path>
        <path d="M8 15v-4"></path>
        <path d="M12 15V8"></path>
        <path d="M16 15v-2"></path>
      </svg>
      <p>${escapeHtml(copy)}</p>
    </div>
  `;
}

function trendPoint(
  trend: CodexUsageStatsTrend,
  index: number,
  trends: CodexUsageStatsTrend[],
  maxCost: number,
): { x: number; y: number } {
  const width = 620;
  const height = 220;
  const padX = 36;
  const padTop = 22;
  const padBottom = 34;
  const usableWidth = width - padX * 2;
  const usableHeight = height - padTop - padBottom;
  const x = trends.length === 1 ? width / 2 : padX + (index / (trends.length - 1)) * usableWidth;
  const cost = Number.parseFloat(trend.totalCostUsd);
  const y = padTop + usableHeight - ((Number.isFinite(cost) ? cost : 0) / maxCost) * usableHeight;
  return { x, y };
}

function formatCompactNumber(num: number): string {
  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1)}B`;
  }
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}k`;
  }
  return num.toString();
}

function renderTrendChart(stats: CodexUsageStatsSnapshot): string {
  if (stats.trends.length === 0) {
    return renderEmptyState("筛选范围内没有可展示的趋势。");
  }

  const trends = stats.trends;
  const maxCost = Math.max(...trends.map((t) => Number.parseFloat(t.totalCostUsd) || 0), 0.000001);
  const maxTokens = Math.max(...trends.map((t) => t.realTotalTokens || 0), 1);

  const width = 1000;
  const height = 280;
  const padLeft = 60;
  const padRight = 70;
  const padTop = 35;
  const padBottom = 45;
  const usableWidth = width - padLeft - padRight;
  const usableHeight = height - padTop - padBottom;

  const points = trends.map((trend, index) => {
    const x = trends.length === 1 ? padLeft + usableWidth / 2 : padLeft + (index / (trends.length - 1)) * usableWidth;
    const cost = Number.parseFloat(trend.totalCostUsd) || 0;
    const tokens = trend.realTotalTokens || 0;
    const yCost = padTop + usableHeight - (cost / maxCost) * usableHeight;
    const yTokens = padTop + usableHeight - (tokens / maxTokens) * usableHeight;
    return { x, yCost, yTokens };
  });

  const costLine = points.map((p) => `${p.x.toFixed(1)},${p.yCost.toFixed(1)}`).join(" ");
  const costArea = `${padLeft},${padTop + usableHeight} ${costLine} ${padLeft + usableWidth},${padTop + usableHeight}`;
  const tokensLine = points.map((p) => `${p.x.toFixed(1)},${p.yTokens.toFixed(1)}`).join(" ");

  const firstDate = trends[0]?.date ?? "";
  const lastDate = trends[trends.length - 1]?.date ?? "";

  return `
    <div class="usage-chart-wrap" data-role="usage-trend-chart">
      <div class="usage-chart-legend">
        <span class="legend-item">
          <span class="legend-color-pills legend-cost-pill" style="background: var(--accent); opacity: 0.85;"></span>
          <strong>成本</strong>
        </span>
        <span class="legend-item">
          <span class="legend-color-pills legend-tokens-pill" style="border-top: 2px dashed #f43f5e;"></span>
          <strong>真实消耗 Tokens</strong>
        </span>
      </div>
      <svg class="usage-trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="用量趋势">
        <defs>
          <linearGradient id="chartAreaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.25" />
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.0" />
          </linearGradient>
          <linearGradient id="chartLineGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="var(--accent)" />
            <stop offset="100%" stop-color="#8b5cf6" />
          </linearGradient>
        </defs>

        <!-- Horizontal Grid Lines -->
        ${[0.25, 0.5, 0.75, 1.0].map((div) => {
          const y = padTop + usableHeight - div * usableHeight;
          return `<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${padLeft + usableWidth}" y2="${y.toFixed(1)}" class="usage-chart-grid-line" stroke-dasharray="4 4"></line>`;
        }).join("")}

        <!-- Axes -->
        <line x1="${padLeft}" y1="${padTop + usableHeight}" x2="${padLeft + usableWidth}" y2="${padTop + usableHeight}" class="usage-chart-axis"></line>
        <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + usableHeight}" class="usage-chart-axis"></line>
        <line x1="${padLeft + usableWidth}" y1="${padTop}" x2="${padLeft + usableWidth}" y2="${padTop + usableHeight}" class="usage-chart-axis"></line>

        <!-- Paths -->
        <polyline points="${escapeHtml(costArea)}" class="usage-chart-area" fill="url(#chartAreaGradient)"></polyline>
        <polyline points="${escapeHtml(costLine)}" class="usage-chart-line" stroke="url(#chartLineGradient)"></polyline>
        <polyline points="${escapeHtml(tokensLine)}" class="usage-chart-tokens-line" stroke="#f43f5e" stroke-width="2" stroke-dasharray="4 4" fill="none"></polyline>

        <!-- Tooltip Interactive Circles for Cost -->
        ${points.map((point, index) => {
          const trend = trends[index];
          return `
            <g class="usage-chart-point">
              <circle cx="${point.x.toFixed(1)}" cy="${point.yCost.toFixed(1)}" r="4.5" fill="var(--accent)"></circle>
              <circle cx="${point.x.toFixed(1)}" cy="${point.yTokens.toFixed(1)}" r="4.0" fill="#f43f5e"></circle>
              <title>${escapeHtml(trend.date)}
成本: ${escapeHtml(formatCost(trend.totalCostUsd))}
总量: ${formatInteger(trend.realTotalTokens)} tokens
输入: ${formatInteger(trend.totalInputTokens)}
缓存读取: ${formatInteger(trend.totalCacheReadTokens)}
输出: ${formatInteger(trend.totalOutputTokens)}
请求次数: ${formatInteger(trend.requestCount)} 次</title>
            </g>
          `;
        }).join("")}

        <!-- X Axis Labels -->
        <text x="${padLeft}" y="${height - 15}" class="usage-chart-label">${escapeHtml(firstDate)}</text>
        <text x="${padLeft + usableWidth}" y="${height - 15}" text-anchor="end" class="usage-chart-label">${escapeHtml(lastDate)}</text>

        <!-- Left Y Axis Labels (Tokens) -->
        ${[0.0, 0.25, 0.5, 0.75, 1.0].map((div) => {
          const y = padTop + usableHeight - div * usableHeight;
          const val = maxTokens * div;
          return `<text x="${padLeft - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="usage-chart-label">${escapeHtml(formatCompactNumber(val))}</text>`;
        }).join("")}

        <!-- Right Y Axis Labels (Cost) -->
        ${[0.0, 0.25, 0.5, 0.75, 1.0].map((div) => {
          const y = padTop + usableHeight - div * usableHeight;
          const val = maxCost * div;
          return `<text x="${padLeft + usableWidth + 8}" y="${(y + 4).toFixed(1)}" text-anchor="start" class="usage-chart-label">${escapeHtml(formatCost(val.toFixed(6)))}</text>`;
        }).join("")}
      </svg>
    </div>
  `;
}

function renderBreakdownRows(rows: CodexUsageStatsBreakdown[], listClass = ""): string {
  if (rows.length === 0) {
    return renderEmptyState("当前筛选没有分布数据。");
  }
  const maxCost = Math.max(...rows.map((row) => Number.parseFloat(row.totalCostUsd) || 0), 0.000001);
  return `
    <div class="usage-breakdown-list ${listClass}">
      ${rows.map((row) => {
        const cost = Number.parseFloat(row.totalCostUsd) || 0;
        const width = Math.max(4, Math.round((cost / maxCost) * 100));
        return `
          <article class="usage-breakdown-row">
            <div class="usage-breakdown-head">
              <strong>${escapeHtml(row.name)}</strong>
              <span>${escapeHtml(formatCost(row.totalCostUsd))}</span>
            </div>
            <div class="usage-breakdown-track" aria-hidden="true">
              <span style="width: ${width}%"></span>
            </div>
            <div class="usage-breakdown-meta">
              <span>${formatInteger(row.requestCount)} 次</span>
              <span>&middot;</span>
              <span>${formatInteger(row.realTotalTokens)} tokens</span>
              <span>&middot;</span>
              <span>推理输出 ${formatInteger(row.totalReasoningOutputTokens)}</span>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderTrendTable(stats: CodexUsageStatsSnapshot): string {
  if (stats.trends.length === 0) {
    return renderEmptyState("还没有可展示的按日统计。");
  }

  return `
    <div class="usage-table-wrapper">
      <table class="usage-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>请求</th>
            <th>真实消耗 Tokens</th>
            <th>新输入</th>
            <th>缓存读取</th>
            <th>输出</th>
            <th>推理输出</th>
            <th>估算金额</th>
          </tr>
        </thead>
        <tbody>
          ${stats.trends.map((trend) => `
            <tr>
              <td><strong>${escapeHtml(trend.date)}</strong></td>
              <td>${formatInteger(trend.requestCount)}</td>
              <td>${formatInteger(trend.realTotalTokens)}</td>
              <td>${formatInteger(trend.totalInputTokens)}</td>
              <td>${formatInteger(trend.totalCacheReadTokens)}</td>
              <td>${formatInteger(trend.totalOutputTokens)}</td>
              <td>${formatInteger(trend.totalReasoningOutputTokens)}</td>
              <td>${formatCost(trend.totalCostUsd)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderLogTable(stats: CodexUsageStatsSnapshot): string {
  if (stats.logs.length === 0) {
    return renderEmptyState("当前筛选范围内没有请求明细。");
  }

  return `
    <div class="usage-table-wrapper">
      <table class="usage-table usage-log-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>供应商</th>
            <th>计费模型</th>
            <th>输入</th>
            <th>输出</th>
            <th class="cell-cost">生成成本</th>
            <th>状态</th>
            <th>来源</th>
          </tr>
        </thead>
        <tbody>
          ${stats.logs.map((log) => {
            const statusClass = "status-green"; // Codex sessions are successful runs
            return `
              <tr data-request-id="${escapeHtml(log.requestId)}">
                <td class="cell-time">${escapeHtml(formatDateTime(log.createdAt))}</td>
                <td class="cell-provider">${escapeHtml(formatProviderName(log.provider))}</td>
                <td><span class="usage-model-pill">${escapeHtml(log.model)}</span></td>
                <td>
                  <div class="stacked-cell">
                    <span class="main-val">${formatInteger(log.inputTokens)}</span>
                    <span class="cell-subtext">${formatInteger(log.cacheReadTokens)}</span>
                  </div>
                </td>
                <td>
                  <div class="stacked-cell">
                    <span class="main-val">${formatInteger(log.outputTokens)}</span>
                    ${log.reasoningOutputTokens > 0 ? `<span class="cell-subtext">${formatInteger(log.reasoningOutputTokens)}</span>` : ""}
                  </div>
                </td>
                <td class="cell-cost"><strong>${formatCost(log.totalCostUsd)}</strong></td>
                <td><span class="status-badge ${statusClass}">200</span></td>
                <td class="cell-source">codex_session</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

export function renderCodexUsageStatsPage(input: CodexUsageStatsPageInput): string {
  const stats = input.stats;
  const summary = stats?.summary;
  const updatedAt = stats ? formatDateTime(stats.updatedAt) : "尚未刷新";
  const syncText = stats
    ? `扫描 ${formatInteger(stats.sync.filesScanned)} 个文件，新增 ${formatInteger(stats.sync.imported)} 条，跳过 ${formatInteger(stats.sync.skipped)} 条`
    : "读取 ~/.codex/sessions 与 archived_sessions 中的 token_count 事件";

  return `
    <section class="usage-stats-page" data-role="usage-stats-page">
      <header class="top-nav usage-stats-top">
        <div class="top-nav-copy">
          <h1>使用统计</h1>
          <p>按 Codex 会话日志汇总 token、努力级别、缓存命中和估算金额。</p>
          <div class="top-nav-meta">
            <span class="meta-chip">更新时间：${escapeHtml(updatedAt)}</span>
            <span class="meta-chip">${escapeHtml(syncText)}</span>
            <span class="meta-chip">金额为估算</span>
          </div>
        </div>
        <div class="top-nav-actions">
          <button class="button button-primary" data-action="refresh-usage-stats" ${input.loading ? "disabled" : ""}>
            <svg class="${input.loading ? "usage-loading-spin" : ""}" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M3 21v-5h5"></path><path d="M3 12a9 9 0 0 1 15.74-6.26L21 8"></path><path d="M16 8h5V3"></path></svg>
            ${input.loading ? "刷新中" : "刷新统计"}
          </button>
        </div>
      </header>

      ${renderFilterBar(input)}
      ${input.error ? `<div class="inline-alert inline-alert-error">${escapeHtml(input.error)}</div>` : ""}

      <div class="usage-stats-grid">
        ${renderMetric(
          "估算金额",
          summary ? formatCost(summary.totalCostUsd) : "--",
          "按内置 OpenAI API 价格表估算",
          `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>`,
          "card-cost"
        )}
        ${renderMetric(
          "真实消耗 Tokens",
          summary ? formatInteger(summary.realTotalTokens) : "--",
          "新输入 + 缓存读取 + 缓存写入 + 输出",
          `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>`,
          "card-tokens"
        )}
        ${renderMetric(
          "推理输出",
          summary ? formatInteger(summary.totalReasoningOutputTokens) : "--",
          "reasoning output tokens",
          `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-3.12 3 3 0 0 1 0-4.88 2.5 2.5 0 0 1 0-3.12A2.5 2.5 0 0 1 9.5 2z"></path><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-3.12 3 3 0 0 0 0-4.88 2.5 2.5 0 0 0 0-3.12A2.5 2.5 0 0 0 14.5 2z"></path></svg>`,
          "card-reasoning"
        )}
        ${renderMetric(
          "缓存命中率",
          summary ? formatPercent(summary.cacheHitRate) : "--",
          "缓存读取 / 输入总量",
          `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
          "card-cache"
        )}
      </div>

      <section class="usage-panel usage-chart-panel-full">
        <div class="usage-panel-header">
          <h2>使用趋势</h2>
          <span>${stats ? `${formatInteger(stats.trends.length)} 天` : "未加载"}</span>
        </div>
        ${input.loading && !stats ? renderEmptyState("正在读取 Codex 会话日志...") : stats ? renderTrendChart(stats) : renderEmptyState("点击刷新统计开始导入会话用量。")}
      </section>

      <div class="usage-tab-bar">
        <button class="usage-tab-btn ${input.activeTab === "logs" ? "active" : ""}" data-action="set-usage-tab" data-tab="logs">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
          请求日志
        </button>
        <button class="usage-tab-btn ${input.activeTab === "trends" ? "active" : ""}" data-action="set-usage-tab" data-tab="trends">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
          按日明细
        </button>
        <button class="usage-tab-btn ${input.activeTab === "breakdowns" ? "active" : ""}" data-action="set-usage-tab" data-tab="breakdowns">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path></svg>
          模型统计
        </button>
      </div>

      <div class="usage-tab-content">
        ${input.activeTab === "logs" ? `
          <section class="usage-panel usage-tab-panel">
            <div class="usage-panel-header">
              <h2>请求明细</h2>
              <span>${stats ? `最近 ${formatInteger(stats.logs.length)} 条` : "未加载"}</span>
            </div>
            ${input.loading && !stats ? renderEmptyState("正在准备请求明细...") : stats ? renderLogTable(stats) : renderEmptyState("暂无请求明细。")}
          </section>
        ` : input.activeTab === "trends" ? `
          <section class="usage-panel usage-tab-panel">
            <div class="usage-panel-header">
              <h2>按日明细</h2>
              <span>${stats ? `${formatInteger(stats.trends.length)} 天` : "未加载"}</span>
            </div>
            ${input.loading && !stats ? renderEmptyState("正在准备按日统计...") : stats ? renderTrendTable(stats) : renderEmptyState("暂无按日明细。")}
          </section>
        ` : `
          <div class="usage-breakdowns-grid">
            <section class="usage-panel">
              <div class="usage-panel-header">
                <h2>模型分布</h2>
                <span>${stats ? `${formatInteger(stats.modelBreakdown.length)} 个模型` : "未加载"}</span>
              </div>
              ${stats ? renderBreakdownRows(stats.modelBreakdown, "usage-model-breakdown") : renderEmptyState("暂无模型分布。")}
            </section>

            <section class="usage-panel">
              <div class="usage-panel-header">
                <h2>努力级别</h2>
                <span>${stats ? `${formatInteger(stats.effortBreakdown.length)} 类` : "未加载"}</span>
              </div>
              ${stats ? renderBreakdownRows(stats.effortBreakdown, "usage-effort-breakdown") : renderEmptyState("暂无努力级别分布。")}
            </section>
          </div>
        `}
      </div>

      ${stats?.sync.errors.length ? `
        <section class="usage-panel usage-error-panel">
          <div class="usage-panel-header">
            <h2>导入异常</h2>
            <span>${formatInteger(stats.sync.errors.length)} 条</span>
          </div>
          <ul>
            ${stats.sync.errors.slice(0, 8).map((error) => `<li>${escapeHtml(error)}</li>`).join("")}
          </ul>
        </section>
      ` : ""}
    </section>
  `;
}
