import type { AppSnapshot, ProfileSummary } from "./desktop-types";
import { escapeHtml } from "./html-utils";
import { sharedProfileHasNewerRemote } from "./network-auth-sync";
import type { NetworkProfile } from "./network-profile-utils";
import type { EditorState } from "./profile-editor-state";
import {
  renderCodexUsagePanel,
  renderThirdPartyLatencyPanel,
  renderThirdPartyUsagePanel,
  type ProfileRuntimeRenderContext,
} from "./profile-runtime-renderers";
import {
  findProfileById,
  getOfficialOauthProfiles,
  isMissingOfficialOauthForNewSymbioticEditor,
  resolveOfficialOauthProfileId,
} from "./profile-selection";
import {
  formatDateTime,
  profileTypeLabel,
} from "./usage-formatters";

export type NewProfileEditorTab = "manual-delta" | "manual-full";

export type EditorDetailTab = "overview" | "config";

const activeProfileDeleteMessage =
  "这是当前 Codex 正在使用的配置，不能直接删除。请先切换到其他配置后再删除。";

export type NewProfileTabSelectorInput = {
  currentTab?: NewProfileEditorTab;
};

export type EditorPageShellInput = {
  title: string;
  subtitle: string;
  busy: boolean;
  readOnly: boolean;
  hasTargetChanges: boolean;
  showTabs: boolean;
  currentTab: NewProfileEditorTab;
  bodyContentHtml: string;
};

export type SharedUpdateCheckResult = {
  key: string;
  status: "checking" | "valid" | "invalid" | "skipped";
  message: string | null;
};

export function sharedUpdateCheckKey(remoteProfile: NetworkProfile): string {
  return [remoteProfile.id, remoteProfile.contentVersion ?? "", remoteProfile.contentHash ?? ""].join(":");
}

export type EditorPageInput = {
  snapshot: AppSnapshot | null;
  editor: EditorState;
  networkProfiles: readonly NetworkProfile[];
  hasNetworkAccessToken: boolean;
  remoteVersionCheckAttempted: boolean;
  busy: boolean;
  pendingActions: ReadonlySet<string>;
  sharedUpdateCheck?: SharedUpdateCheckResult | null;
};

export type ThirdPartyConfigFieldsInput = {
  editor: EditorState;
  snapshot: AppSnapshot | null;
  busy: boolean;
  readOnly: boolean;
};

export type EditorCodePanelsInput = {
  editor: EditorState;
  busy: boolean;
  readOnly: boolean;
};

export type EditorBasicInfoCardInput = {
  editor: EditorState;
  editorProfile: ProfileSummary | null;
  remoteProfile: NetworkProfile | null;
  replacementRemoteProfile?: NetworkProfile | null;
  hasNetworkAccessToken: boolean;
  remoteVersionCheckAttempted: boolean;
  busy: boolean;
  readOnly: boolean;
  existing: boolean;
  saveDisabled: boolean;
  deleteDisabled?: boolean;
  deleteDisabledReason?: string;
  metadataHtml?: string;
  sharedUpdateCheck?: SharedUpdateCheckResult | null;
};

export type EditorMetadataCardInput = {
  editor: EditorState;
  visible: boolean;
};

export type EditorRuntimePanelInput = {
  snapshot: AppSnapshot;
  profile: ProfileSummary | null;
  editorSource: EditorState["source"];
  busy: boolean;
  pendingActions: ReadonlySet<string>;
};

export type EditorLayoutInput = {
  snapshot: AppSnapshot;
  editor: EditorState;
  editorProfile: ProfileSummary | null;
  networkProfiles: readonly NetworkProfile[];
  hasNetworkAccessToken: boolean;
  remoteVersionCheckAttempted: boolean;
  configFieldsHtml: string;
  busy: boolean;
  readOnly: boolean;
  existing: boolean;
  saveDisabled: boolean;
  pendingActions: ReadonlySet<string>;
  showDetailTabs: boolean;
  detailTab: EditorDetailTab;
  sharedUpdateCheck?: SharedUpdateCheckResult | null;
};

export function renderThirdPartyConfigFields(input: ThirdPartyConfigFieldsInput): string {
  const disabled = input.busy || input.readOnly ? "disabled" : "";
  const officialProfiles = getOfficialOauthProfiles(input.snapshot);
  const selectedOauthProfileId = resolveOfficialOauthProfileId(
    input.snapshot,
    input.editor.thirdParty.oauthProfileId,
  );
  const isSymbiotic = input.editor.thirdParty.template === "symbioticThirdParty";
  const missingOauth = isSymbiotic && officialProfiles.length === 0;
  const tokenPlaceholder = isSymbiotic ? "第三方 API token" : "sk-...";

  let gridContentHtml = "";
  if (isSymbiotic) {
    gridContentHtml = `
      <label class="field full-width">
        <span>复用官方 OAuth 账号</span>
        <select id="symbiotic-oauth-profile" ${disabled || missingOauth ? "disabled" : ""}>
          ${officialProfiles
            .map(
              (profile) => `
                <option value="${escapeHtml(profile.id)}" ${profile.id === selectedOauthProfileId ? "selected" : ""}>
                  ${escapeHtml(profile.name)}
                </option>
              `,
            )
            .join("")}
        </select>
        <span class="field-hint">共生模式必须借用一个官方已登录账号的鉴权状态。</span>
      </label>

      <label class="field">
        <span>提供商代码 <code class="raw-key">model_provider</code></span>
        <input
          id="third-party-provider"
          type="text"
          value="${escapeHtml(input.editor.thirdParty.provider)}"
          placeholder="ylscode"
          ${disabled}
        />
        <span class="field-hint">提供商简码，建议小写拼音或英文。</span>
      </label>

      <label class="field">
        <span>默认模型 <code class="raw-key">model</code></span>
        <input
          id="third-party-model"
          type="text"
          value="${escapeHtml(input.editor.thirdParty.model)}"
          placeholder="gpt-5.4"
          ${disabled}
        />
        <span class="field-hint">默认请求的模型名称，例如 deepseek-chat。</span>
      </label>

      <label class="field full-width">
        <span>接口地址 <code class="raw-key">base_url</code></span>
        <input
          id="third-party-base-url"
          type="url"
          value="${escapeHtml(input.editor.thirdParty.baseUrl)}"
          placeholder="https://example.com/v1"
          ${disabled}
        />
        <span class="field-hint">第三方服务商的 API 基础端点地址。</span>
      </label>

      <label class="field full-width">
        <span>API 密钥 <code class="raw-key">experimental_bearer_token</code></span>
        <input
          id="third-party-api-key"
          type="password"
          value="${escapeHtml(input.editor.thirdParty.apiKey)}"
          placeholder="${escapeHtml(tokenPlaceholder)}"
          autocomplete="off"
          ${disabled}
        />
        <span class="field-hint">用于共生接口请求的 Bearer Token / 密钥。</span>
      </label>
    `;
  } else {
    gridContentHtml = `
      <label class="field full-width">
        <span>接口地址 <code class="raw-key">openai_base_url</code></span>
        <input
          id="third-party-base-url"
          type="url"
          value="${escapeHtml(input.editor.thirdParty.baseUrl)}"
          placeholder="https://example.com/v1"
          ${disabled}
        />
        <span class="field-hint">第三方 API 的基础路径，兼容 OpenAI 格式。</span>
      </label>

      <label class="field">
        <span>API 密钥 <code class="raw-key">OPENAI_API_KEY</code></span>
        <input
          id="third-party-api-key"
          type="password"
          value="${escapeHtml(input.editor.thirdParty.apiKey)}"
          placeholder="${escapeHtml(tokenPlaceholder)}"
          autocomplete="off"
          ${disabled}
        />
        <span class="field-hint">您的 API 密钥，仅保存在本地。</span>
      </label>

      <label class="field">
        <span>默认模型 <code class="raw-key">model</code></span>
        <input
          id="third-party-model"
          type="text"
          value="${escapeHtml(input.editor.thirdParty.model)}"
          placeholder="gpt-5.5"
          ${disabled}
        />
        <span class="field-hint">默认请求的模型名称，例如 deepseek-chat。</span>
      </label>
    `;
  }

  return `
    <section class="third-party-delta-card" data-role="third-party-delta-form">
      <div class="delta-card-header" style="display: none;">
        <p class="eyebrow">Third-party API</p>
        <h2 style="font-size: 1.25rem; font-weight: 750; color: var(--text-main); margin: 0 0 6px 0;">${isSymbiotic ? "共生配置" : "只填写第三方 API 的差异量"}</h2>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0 0 16px 0; line-height: 1.4;">
          ${isSymbiotic
            ? "复用已经登录的官方 OAuth 账号，同时把模型请求转到第三方 API。"
            : "保存时会自动生成 auth.json 和 config.toml，不会要求你手写完整配置。"}
        </p>
      </div>

      <div class="profile-template-options" data-role="profile-template-options">
        <label class="template-card-option">
          <input
            id="profile-template-standalone"
            name="profile-template"
            type="radio"
            value="standaloneThirdParty"
            ${input.editor.thirdParty.template === "standaloneThirdParty" ? "checked" : ""}
            ${disabled}
          />
          <div class="option-content">
            <span class="option-title">独立第三方 API</span>
            <span class="option-desc">仅配置第三方接口与模型参数，与官方登录账号互不干扰。</span>
          </div>
        </label>
        <label class="template-card-option">
          <input
            id="profile-template-symbiotic"
            name="profile-template"
            type="radio"
            value="symbioticThirdParty"
            ${isSymbiotic ? "checked" : ""}
            ${disabled}
          />
          <div class="option-content">
            <span class="option-title">共生配置</span>
            <span class="option-desc">复用已登录的官方 OAuth 账号授权，同时把模型调用转到第三方接口。</span>
          </div>
        </label>
      </div>

      ${
        isSymbiotic
          ? `
            <aside class="flash flash-info" data-role="symbiotic-enhanced-launch-hint" style="margin: 4px 0 12px 0; padding: 12px 14px;">
              <span style="font-size: 0.82rem; line-height: 1.4;">共生配置已经替代增强启动；插件入口会通过官方 OAuth 登录状态保持可用，不再需要单独执行增强启动。</span>
            </aside>
          `
          : ""
      }

      ${
        isSymbiotic && missingOauth
          ? `
            <aside class="flash flash-error" data-role="symbiotic-oauth-missing" style="margin: 4px 0 12px 0; padding: 12px 14px;">
              <span style="font-size: 0.82rem; line-height: 1.4;">错误：请先登录并保存一个官方 OAuth 账号，再创建共生配置。</span>
            </aside>
          `
          : ""
      }

      <div class="third-party-delta-grid">
        ${gridContentHtml}
      </div>
    </section>
  `;
}

export function renderNewProfileTabSelector(input: NewProfileTabSelectorInput): string {
  const currentTab = input.currentTab || "manual-delta";
  return `
    <div class="editor-template-tabs" data-role="editor-template-tabs">
      <button class="tab-btn ${currentTab === "manual-delta" ? "active" : ""}" data-action="editor-tab-delta">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        极简第三方 API
      </button>
      <button class="tab-btn ${currentTab === "manual-full" ? "active" : ""}" data-action="editor-tab-full">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
        空白完整配置
      </button>
    </div>
  `;
}

export function renderEditorDetailTabs(currentTab: EditorDetailTab, busy: boolean): string {
  const disabled = busy ? "disabled" : "";
  return `
    <div class="editor-template-tabs editor-detail-tabs" data-role="editor-detail-tabs">
      <button class="tab-btn ${currentTab === "overview" ? "active" : ""}" data-action="editor-detail-overview" ${disabled}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect></svg>
        概览
      </button>
      <button class="tab-btn ${currentTab === "config" ? "active" : ""}" data-action="editor-detail-config" ${disabled}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
        配置文件
      </button>
    </div>
  `;
}

export function renderEditorPageShell(input: EditorPageShellInput): string {
  return `
    <section class="editor-page" data-page="editor">
      <header class="editor-header">
        <div class="editor-header-left">
          <button class="button button-ghost" data-action="back-to-cards" ${input.busy ? "disabled" : ""}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            返回卡片网格
          </button>
          <div>
            <p class="eyebrow" style="display: none;">Profile Detail</p>
            <h1 style="margin-top: 4px;">${escapeHtml(input.title)}</h1>
            <p class="page-copy" style="display: none;">${escapeHtml(input.subtitle)}</p>
          </div>
        </div>
      </header>

      ${input.readOnly
        ? `
          <aside class="flash flash-info" data-role="editor-readonly-notice">
            <span>网络共享配置仅支持查看详情，不能直接编辑或保存。</span>
          </aside>
        `
        : ""}

      ${input.hasTargetChanges
        ? `
          <aside class="flash flash-info" data-role="editor-live-change-notice">
            <span>当前运行中的配置有变动，请保存以同步回这套 Profile。</span>
          </aside>
        `
        : ""}

      ${input.showTabs ? renderNewProfileTabSelector({ currentTab: input.currentTab }) : ""}

      ${input.bodyContentHtml}
    </section>
  `;
}

export function renderEditorPage(input: EditorPageInput): string {
  const snapshot = input.snapshot;
  if (!snapshot) {
    return "";
  }

  const existing = input.editor.mode === "existing";
  const readOnly = input.editor.readOnly;
  const saveDisabled =
    input.busy || isMissingOfficialOauthForNewSymbioticEditor(input.editor, snapshot);
  const editorProfile = findProfileById(snapshot, input.editor.profileId);

  const showTabs = input.editor.mode === "new";
  const currentTab: NewProfileEditorTab = input.editor.newTab || "manual-delta";

  const showDetailTabs = input.editor.mode !== "new";
  const detailTab: EditorDetailTab = input.editor.detailTab || "overview";

  const title =
    readOnly
      ? (input.editor.name || "查看网络共享配置")
      : input.editor.mode === "fromCurrent"
      ? "保存当前 Codex 配置为新 Profile"
      : existing
        ? (input.editor.name || "查看和编辑 Profile")
        : "手动创建新 Profile";

  const subtitle =
    readOnly
      ? "该配置来自网络共享库，仅供查看，不能直接编辑或保存。"
      : input.editor.mode === "fromCurrent"
      ? "把当前 `.codex` 里的内容复制成一套新的 profile。"
      : existing
        ? "查看和编辑此 Profile 的配置文本。"
        : "直接手工填写名称、备注以及配置内容。";

  const configFields = (showTabs && currentTab === "manual-delta")
    ? renderThirdPartyConfigFields({
      editor: input.editor,
      snapshot,
      busy: input.busy,
      readOnly,
    })
    : renderEditorCodePanels({
      editor: input.editor,
      busy: input.busy,
      readOnly,
    });

  const bodyContent = renderEditorLayout({
    snapshot,
    editor: input.editor,
    editorProfile,
    networkProfiles: input.networkProfiles,
    hasNetworkAccessToken: input.hasNetworkAccessToken,
    remoteVersionCheckAttempted: input.remoteVersionCheckAttempted,
    configFieldsHtml: configFields,
    busy: input.busy,
    readOnly,
    existing,
    saveDisabled,
    pendingActions: input.pendingActions,
    showDetailTabs,
    detailTab,
    sharedUpdateCheck: input.sharedUpdateCheck ?? null,
  });

  return renderEditorPageShell({
    title,
    subtitle,
    busy: input.busy,
    readOnly,
    hasTargetChanges: input.editor.mode === "existing" && input.editor.hasTargetChanges,
    showTabs,
    currentTab,
    bodyContentHtml: bodyContent,
  });
}

export function renderEditorCodePanels(input: EditorCodePanelsInput): string {
  const disabled = input.busy || input.readOnly ? "disabled" : "";

  return `
    <div class="editor-panels">
      <div class="code-editor-card">
        <div class="code-editor-header">
          <span class="code-editor-title">auth.json</span>
          <span class="code-editor-format">JSON</span>
        </div>
        <textarea
          id="editor-auth-json"
          class="code-textarea"
          spellcheck="false"
          ${disabled}
        >${escapeHtml(input.editor.authJson)}</textarea>
      </div>

      <div class="code-editor-card">
        <div class="code-editor-header">
          <span class="code-editor-title">config.toml</span>
          <span class="code-editor-format">TOML</span>
        </div>
        <textarea
          id="editor-config-toml"
          class="code-textarea"
          spellcheck="false"
          ${disabled}
        >${escapeHtml(input.editor.configToml)}</textarea>
      </div>
    </div>
  `;
}

export function renderEditorLayout(input: EditorLayoutInput): string {
  const deleteDisabled = input.snapshot.activeProfileId === input.editor.profileId;
  const remoteProfile = input.editor.remoteProfileId
    ? input.networkProfiles.find((profile) => profile.id === input.editor.remoteProfileId) ?? null
    : null;
  const replacementRemoteProfile =
    input.editor.remoteProfileId && !remoteProfile
      ? findUniqueRemoteProfileByName(input.networkProfiles, input.editor.name)
      : null;
  const metadataCardHtml = renderEditorMetadataCard({
    editor: input.editor,
    visible: input.existing || input.readOnly,
  });
  const basicInfoHtml = renderEditorBasicInfoCard({
    editor: input.editor,
    editorProfile: input.editorProfile,
    remoteProfile,
    replacementRemoteProfile,
    hasNetworkAccessToken: input.hasNetworkAccessToken,
    remoteVersionCheckAttempted: input.remoteVersionCheckAttempted,
    busy: input.busy,
    readOnly: input.readOnly,
    existing: input.existing,
    saveDisabled: input.saveDisabled,
    deleteDisabled,
    deleteDisabledReason: deleteDisabled ? activeProfileDeleteMessage : "",
    metadataHtml: metadataCardHtml,
    sharedUpdateCheck: input.sharedUpdateCheck ?? null,
  });
  const runtimePanelHtml = renderEditorRuntimePanel({
    snapshot: input.snapshot,
    profile: input.editorProfile,
    editorSource: input.editor.source,
    busy: input.busy,
    pendingActions: input.pendingActions,
  });
  // Runtime usage now spans the full width below the basic-info card; the
  // 版本与时间 metadata moved into the basic-info right rail to remove the
  // large empty column that used to sit beside it.
  const statusSectionHtml = runtimePanelHtml
    ? `
        <section class="editor-status-section" data-role="editor-status-section">
          ${runtimePanelHtml}
        </section>
      `
    : "";

  const summarySectionHtml = `
    <section class="editor-summary-section" data-role="editor-summary-section">
      ${basicInfoHtml}
    </section>
  `;
  const configSectionHtml = `
    <section class="editor-config-section" data-role="editor-config-section">
      ${input.configFieldsHtml}
    </section>
  `;

  if (input.showDetailTabs) {
    const activePanelHtml =
      input.detailTab === "config"
        ? configSectionHtml
        : `${summarySectionHtml}${statusSectionHtml}`;

    return `
      <div class="editor-detail-layout editor-detail-layout-tabbed" data-role="editor-detail-layout">
        ${renderEditorDetailTabs(input.detailTab, input.busy)}
        <div class="editor-tab-panel" data-role="editor-tab-panel" data-active-tab="${input.detailTab}">
          ${activePanelHtml}
        </div>
      </div>
    `;
  }

  return `
      <div class="editor-detail-layout" data-role="editor-detail-layout">
        ${summarySectionHtml}

        ${configSectionHtml}

        ${statusSectionHtml}
      </div>
    `;
}

function normalizedProfileName(value: string): string {
  return value.trim().toLowerCase();
}

function findUniqueRemoteProfileByName(
  networkProfiles: readonly NetworkProfile[],
  name: string,
): NetworkProfile | null {
  const normalizedName = normalizedProfileName(name);
  if (!normalizedName) {
    return null;
  }

  const matches = networkProfiles.filter((profile) => normalizedProfileName(profile.name) === normalizedName);
  return matches.length === 1 ? matches[0] : null;
}

function sharedVersionLabel(version: number | null | undefined): string {
  return typeof version === "number" ? `v${version}` : "未知版本";
}

function renderSharedVersionStatus(input: EditorBasicInfoCardInput): string {
  if (input.editor.source !== "local" || !input.editor.remoteProfileId || !input.editor.profileId) {
    return "";
  }

  if (!input.hasNetworkAccessToken) {
    return `
      <div class="shared-version-status" data-role="shared-version-status" data-state="offline">
        <div class="shared-version-main">
          <span class="shared-version-title">共享中心版本</span>
          <span class="shared-version-pill">未连接</span>
        </div>
        <p>登录企业共享中心后可检查这套配置是否有新版本。</p>
      </div>
    `;
  }

  if (!input.remoteProfile) {
    if (input.remoteVersionCheckAttempted) {
      const replacementProfile = input.replacementRemoteProfile;
      return `
        <div class="shared-version-status" data-role="shared-version-status" data-state="missing">
          <div class="shared-version-main">
            <span class="shared-version-title">共享中心未找到对应配置</span>
            <span class="shared-version-pill">未匹配</span>
          </div>
          ${
            replacementProfile
              ? `<p>旧关联 ID ${escapeHtml(input.editor.remoteProfileId)} 未返回；已找到同名共享配置「${escapeHtml(replacementProfile.name)}」，可重新关联并拉取。</p>
                <button
                  class="button button-primary button-full"
                  data-action="update-shared-profile-from-cloud"
                  data-id="${escapeHtml(input.editor.profileId)}"
                  ${input.busy ? "disabled" : ""}
                >
                  关联同名配置并更新
                </button>`
              : `<p>旧关联 ID ${escapeHtml(input.editor.remoteProfileId)} 不在当前共享中心列表里。通常是共享配置被删除/重建，或当前账号没有访问权限。</p>
                <button class="button button-secondary button-full" data-action="refresh-network-in-editor" ${input.busy ? "disabled" : ""}>
                  重新检查
                </button>`
          }
        </div>
      `;
    }

    return `
      <div class="shared-version-status" data-role="shared-version-status" data-state="unknown">
        <div class="shared-version-main">
          <span class="shared-version-title">共享中心版本</span>
          <span class="shared-version-pill">待检查</span>
        </div>
        <p>还没有加载到共享中心的版本信息。</p>
        <button class="button button-secondary button-full" data-action="refresh-network-in-editor" ${input.busy ? "disabled" : ""}>
          检查共享中心版本
        </button>
      </div>
    `;
  }

  const stale = sharedProfileHasNewerRemote(input.editor, input.remoteProfile);
  const localVersion = sharedVersionLabel(input.editor.remoteContentVersion);
  const remoteVersion = sharedVersionLabel(input.remoteProfile.contentVersion);
  const remoteUpdatedAt = input.remoteProfile.contentUpdatedAt ?? input.remoteProfile.updatedAt ?? input.remoteProfile.createdAt;

  if (!stale) {
    return `
      <div class="shared-version-status" data-role="shared-version-status" data-state="current">
        <div class="shared-version-main">
          <span class="shared-version-title">共享中心版本</span>
          <span class="shared-version-pill shared-version-pill-current">已同步</span>
        </div>
        <p>本地 ${escapeHtml(localVersion)} · 共享中心 ${escapeHtml(remoteVersion)}</p>
      </div>
    `;
  }

  const check =
    input.sharedUpdateCheck && input.sharedUpdateCheck.key === sharedUpdateCheckKey(input.remoteProfile)
      ? input.sharedUpdateCheck
      : null;
  const checking = check?.status === "checking";
  const checkDetail = check?.message?.trim();
  const checkResultHtml = check
    ? {
        checking: `<p class="shared-version-verify-result" data-role="shared-version-verify-result" data-state="checking">正在通过 usage 接口验证新版本配置…</p>`,
        valid: `<p class="shared-version-verify-result" data-role="shared-version-verify-result" data-state="valid">✓ 新版本配置有效（usage 接口验证通过），可以放心更新。</p>`,
        skipped: `<p class="shared-version-verify-result" data-role="shared-version-verify-result" data-state="skipped">该配置类型暂不支持 usage 验证${checkDetail ? `：${escapeHtml(checkDetail)}` : "。"}</p>`,
        invalid: `<p class="shared-version-verify-result" data-role="shared-version-verify-result" data-state="invalid">✗ 新版本配置无效，请勿更新${checkDetail ? `：${escapeHtml(checkDetail)}` : "。"}</p>`,
      }[check.status]
    : "";

  return `
    <div class="shared-version-status" data-role="shared-version-status" data-state="stale">
      <div class="shared-version-main">
        <span class="shared-version-title">共享中心有新版本</span>
        <span class="shared-version-pill shared-version-pill-stale">${escapeHtml(remoteVersion)}</span>
      </div>
      <p>本地 ${escapeHtml(localVersion)} · 共享中心 ${escapeHtml(remoteVersion)}${remoteUpdatedAt ? ` · ${escapeHtml(formatDateTime(remoteUpdatedAt))}` : ""}</p>
      ${checkResultHtml}
      <div class="shared-version-actions">
        <button
          class="button button-secondary button-full"
          data-action="verify-shared-profile-update"
          data-id="${escapeHtml(input.editor.profileId)}"
          ${input.busy || checking ? "disabled" : ""}
        >
          ${checking ? "验证中…" : "先验证有效性"}
        </button>
        <button
          class="button button-primary button-full"
          data-action="update-shared-profile-from-cloud"
          data-id="${escapeHtml(input.editor.profileId)}"
          ${input.busy || checking ? "disabled" : ""}
        >
          更新到最新版
        </button>
      </div>
    </div>
  `;
}

export function renderEditorBasicInfoCard(input: EditorBasicInfoCardInput): string {
  const inputDisabled = input.busy || input.readOnly ? "disabled" : "";
  const showNetworkImport = input.readOnly && input.editor.source === "network";
  const sharedVersionStatusHtml = renderSharedVersionStatus(input);
  const showSymbioticAction =
    input.existing &&
    input.editorProfile?.authTypeLabel === "第三方 API" &&
    Boolean(input.editor.profileId);
  const deleteDisabled = input.busy || input.deleteDisabled;
  const deleteTitle = input.deleteDisabledReason
    ? `title="${escapeHtml(input.deleteDisabledReason)}"`
    : "";

  const actionsHtml = input.readOnly
    ? (showNetworkImport
      ? `
        <div class="sidebar-actions">
          <button class="button button-primary button-full" data-action="import-current-network-profile" ${input.busy ? "disabled" : ""}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><polyline points="4 17 10 11 16 17"></polyline><polyline points="4 6 10 12 16 6"></polyline></svg>
            导入并编辑配置
          </button>
        </div>
      `
      : "")
    : `
        <div class="sidebar-actions">
          <button class="button button-primary button-full" data-action="save-and-switch" ${input.saveDisabled ? "disabled" : ""}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            ${input.existing ? "保存并立即启动" : "创建并立即启动"}
          </button>
          <div class="sidebar-actions-row">
            <button class="button button-secondary" data-action="save-editor" ${input.saveDisabled ? "disabled" : ""}>
              ${input.existing
                ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>保存修改`
                : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>创建配置`
              }
            </button>
            ${input.existing && input.editor.profileId
              ? `
                <button
                  class="button button-danger"
                  data-action="delete-profile"
                  data-id="${escapeHtml(input.editor.profileId)}"
                  data-name="${escapeHtml(input.editor.name)}"
                  ${deleteTitle}
                  ${deleteDisabled ? "disabled" : ""}
                >
                  删除
                </button>
              `
              : ""
            }
          </div>
          ${showSymbioticAction
            ? `
              <button class="button button-ghost editor-secondary-link" data-action="generate-symbiotic" data-id="${escapeHtml(input.editor.profileId ?? "")}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                生成共生配置
              </button>
            `
            : ""
          }
        </div>
      `;

  return `
    <div class="sidebar-card editor-summary-card">
      <div class="sidebar-card-title">基本信息</div>
      ${sharedVersionStatusHtml}
      <div class="editor-summary-grid" data-role="editor-summary-grid">
        <div class="editor-summary-fields">
          <label class="field profile-name-field">
            <span>Profile 名称</span>
            <input
              id="editor-name"
              type="text"
              value="${escapeHtml(input.editor.name)}"
              placeholder="例如：淘宝 1 / Work / Backup"
              ${inputDisabled}
            />
          </label>

          <label class="field profile-notes-field">
            <span>备注</span>
            <textarea
              id="editor-notes"
              rows="3"
              placeholder="写一点识别信息，比如账号用途、邮箱、额度状态"
              ${inputDisabled}
            >${escapeHtml(input.editor.notes)}</textarea>
          </label>
        </div>

        ${actionsHtml || input.metadataHtml
          ? `<div class="editor-summary-actions">${actionsHtml}${input.metadataHtml ?? ""}</div>`
          : ""}
      </div>
    </div>
  `;
}

export function renderEditorMetadataCard(input: EditorMetadataCardInput): string {
  if (!input.visible) {
    return "";
  }

  return `
    <div class="sidebar-card metadata-card">
      <div class="sidebar-card-title">版本与时间</div>
      <div class="meta-row">
        <span class="meta-label">创建时间</span>
        <span class="meta-value">${formatDateTime(input.editor.createdAt)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">最近更新</span>
        <span class="meta-value">${formatDateTime(input.editor.updatedAt)}</span>
      </div>
    </div>
  `;
}

export function renderEditorRuntimePanel(input: EditorRuntimePanelInput): string {
  if (!input.profile || input.editorSource !== "local") {
    return "";
  }

  const live = input.snapshot.activeProfileId === input.profile.id;
  const runtimeContext: ProfileRuntimeRenderContext = {
    busy: input.busy,
    pendingActions: input.pendingActions,
  };

  return `
    <section class="editor-runtime" data-role="editor-runtime-panel">
      <div class="editor-runtime-head">
        <div>
          <span class="pill pill-type">${escapeHtml(profileTypeLabel(input.profile))}</span>
          ${live ? `<span class="profile-row-status profile-row-status-live">生效中</span>` : ""}
        </div>
        ${
          live
            ? ""
            : `<button class="button button-secondary" data-action="switch" data-id="${input.profile.id}" data-name="${escapeHtml(input.profile.name)}" ${input.busy ? "disabled" : ""}>启用此配置</button>`
        }
      </div>
      ${renderCodexUsagePanel(input.snapshot, input.profile, runtimeContext)}
      ${renderThirdPartyUsagePanel(input.profile, runtimeContext)}
      ${renderThirdPartyLatencyPanel(input.profile, runtimeContext)}
    </section>
  `;
}
