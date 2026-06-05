import type { ProfileSummary } from "./desktop-types";
import { escapeHtml } from "./html-utils";
import {
  isOwnNetworkProfile,
  networkProfileVisibility,
  shareUserInitial,
  sharingScopeLabel,
  type NetworkProfile,
  type NetworkUserPrincipal,
  type ShareUserOption,
} from "./network-profile-utils";
import type {
  LocalShareDraft,
  SharedProfileEditDraft,
} from "./profile-editor-state";
import type { LocalShareFormState } from "./sharing-center-state";
import { formatDateTime } from "./usage-formatters";

export type SharingCenterTab = "own" | "library";

export type ShareUserCheckboxListInput = {
  users: ShareUserOption[];
  loading: boolean;
  selectedUserIds: string[];
  checkboxClass: string;
};

export type ShareUserPickerInput = {
  users: ShareUserOption[];
  loading: boolean;
  shareDraft: LocalShareDraft;
};

export type SharedProfileEditUserPickerInput = {
  users: ShareUserOption[];
  loading: boolean;
  editDraft: SharedProfileEditDraft | null;
};

export type SharingCenterPageInput = {
  activeTab: SharingCenterTab;
  busy: boolean;
  tabContentHtml: string;
};

export type LocalShareFormInput = {
  profiles: ProfileSummary[];
  authRequired: boolean;
  busy: boolean;
  currentUser: NetworkUserPrincipal | null;
  shareDraft: LocalShareDraft;
  localShareForm: LocalShareFormState;
  shareUserPickerHtml: string;
  ownedProfilesLoading: boolean;
  ownedProfiles: NetworkProfile[];
  editDraft: SharedProfileEditDraft | null;
  editUserPickerHtml: string;
};

export type OwnedSharedProfilesInput = {
  authRequired: boolean;
  loading: boolean;
  profiles: NetworkProfile[];
  busy: boolean;
  editDraft: SharedProfileEditDraft | null;
  editUserPickerHtml: string;
};

export type OwnSharingTabInput = {
  profiles: ProfileSummary[];
  authRequired: boolean;
  busy: boolean;
  currentUser: NetworkUserPrincipal | null;
  shareDraft: LocalShareDraft;
  localShareForm: LocalShareFormState;
  shareUserPickerHtml: string;
  ownedProfilesLoading: boolean;
  ownedProfiles: NetworkProfile[];
  editDraft: SharedProfileEditDraft | null;
  editUserPickerHtml: string;
};

export type EnterpriseLibraryTabInput = {
  authRequired: boolean;
  loading: boolean;
  profiles: NetworkProfile[];
  currentUser: NetworkUserPrincipal | null;
};

export function renderShareUserCheckboxList(input: ShareUserCheckboxListInput): string {
  if (input.loading) {
    return `
      <div class="empty-state" style="padding: 18px;">
        <div class="busy-dialog-spinner" style="margin: 0 auto 10px auto; width: 22px; height: 22px;"></div>
        <p>正在加载可分享用户...</p>
      </div>
    `;
  }

  if (input.users.length === 0) {
    return `
      <div class="empty-state" style="padding: 18px;">
        <h3>暂无可选用户</h3>
        <p>只有登录过企业共享中心的用户会出现在这里。</p>
      </div>
    `;
  }

  return `
    <div class="sharing-user-list" data-role="share-user-list">
      ${input.users
        .map(
          (user) => `
            <label class="share-user-row">
              <input
                class="${escapeHtml(input.checkboxClass)}"
                type="checkbox"
                value="${escapeHtml(user.dingUserId)}"
                ${input.selectedUserIds.includes(user.dingUserId) ? "checked" : ""}
              />
              <span class="share-user-avatar">${escapeHtml(shareUserInitial(user))}</span>
              <span class="share-user-copy">
                <strong>${escapeHtml(user.label)}</strong>
                <span>${escapeHtml(user.mobile || user.jobNumber || user.dingUserId)}</span>
              </span>
            </label>
          `,
        )
        .join("")}
    </div>
  `;
}

export function renderShareUserPicker(input: ShareUserPickerInput): string {
  if (input.shareDraft.visibility !== "selected") {
    return "";
  }

  return renderShareUserCheckboxList({
    users: input.users,
    loading: input.loading,
    selectedUserIds: input.shareDraft.selectedUserIds,
    checkboxClass: "share-user-checkbox",
  });
}

export function renderSharedProfileEditUserPicker(input: SharedProfileEditUserPickerInput): string {
  const draft = input.editDraft;
  if (!draft || draft.visibility !== "selected") {
    return "";
  }

  return renderShareUserCheckboxList({
    users: input.users,
    loading: input.loading,
    selectedUserIds: draft.selectedUserIds,
    checkboxClass: "shared-profile-edit-user-checkbox",
  });
}

export function renderSharingCenterTabs(activeTab: SharingCenterTab): string {
  return `
    <div class="editor-template-tabs sharing-tabs" data-role="sharing-center-tabs">
      <button class="tab-btn ${activeTab === "own" ? "active" : ""}" data-action="sharing-tab-own">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><path d="M20 21a8 8 0 0 0-16 0"></path><circle cx="12" cy="7" r="4"></circle></svg>
        共享自己的配置
      </button>
      <button class="tab-btn ${activeTab === "library" ? "active" : ""}" data-action="sharing-tab-library">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><path d="M3.3 7 12 12l8.7-5"></path><path d="M12 22V12"></path></svg>
        企业共享库
      </button>
    </div>
  `;
}

export function renderSharingCenterPage(input: SharingCenterPageInput): string {
  return `
    <section class="cards-page" data-page="sharing-center">
      <header class="content-header" data-tauri-drag-region>
        <div class="header-title">
          <h2>配置共享中心</h2>
          <span class="header-subtitle">共享本地配置，也从企业共享库导入可用配置</span>
        </div>
        <div class="content-actions">
          <button class="button button-secondary" data-action="refresh-sharing-center" ${input.busy ? "disabled" : ""}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
            刷新共享中心
          </button>
        </div>
      </header>

      ${renderSharingCenterTabs(input.activeTab)}
      ${input.tabContentHtml}
    </section>
  `;
}

export function renderLocalShareForm(input: LocalShareFormInput): string {
  const selectedProfile = input.localShareForm.selectedProfile;
  const ownedProfilesByName = new Map(input.ownedProfiles.map((profile) => [profile.name, profile]));
  const matchedOwnedProfile = selectedProfile ? ownedProfilesByName.get(selectedProfile.name) ?? null : null;
  const activeOwnedProfile =
    input.ownedProfiles.find((profile) => profile.id === input.editDraft?.profileId) ?? null;
  const showSharedEditor = Boolean(activeOwnedProfile);

  return `
    <section class="card sharing-share-form sharing-config-workspace" data-role="local-share-form">
      <div class="sharing-section-head">
        <div>
          <h3>共享我的本地配置</h3>
          <p>选择一张配置卡片，直接发布或修改它在企业共享库中的可见范围。</p>
        </div>
        <span class="sharing-section-badge">${input.ownedProfiles.length} 个已共享</span>
      </div>

      <div class="local-profile-tab-grid" data-role="local-profile-tabs">
        ${input.profiles.map((profile) => {
            const ownedProfile = ownedProfilesByName.get(profile.name) ?? null;
            const selected = !showSharedEditor && profile.id === selectedProfile?.id;
            const editing = Boolean(ownedProfile && input.editDraft?.profileId === ownedProfile.id);
            return renderLocalProfileTabCard({
              profile,
              ownedProfile,
              currentUser: input.currentUser,
              selected: selected || editing,
              busy: input.busy,
            });
        }).join("")}
        ${input.ownedProfiles
          .filter((ownedProfile) => !input.profiles.some((profile) => profile.name === ownedProfile.name))
          .map((ownedProfile) => renderRemoteOnlyProfileTabCard({
            profile: ownedProfile,
            currentUser: input.currentUser,
            selected: ownedProfile.id === input.editDraft?.profileId,
            busy: input.busy,
          }))
          .join("")}
      </div>

      ${input.ownedProfilesLoading && !input.authRequired ? `
        <div class="sharing-inline-note">正在加载我已共享的配置...</div>
      ` : ""}

      <div class="sharing-config-editor-panel">
        ${input.authRequired
          ? `
            <div class="empty-state" data-role="network-auth-prompt" style="padding:20px;">
              <h3>需要登录企业共享中心</h3>
              <p>完成钉钉 SSO 登录后，客户端会自动连接企业共享库，并允许共享配置和选择共享对象。</p>
              <button class="button button-primary" data-action="open-network-sso-login" style="margin-top:12px;">钉钉 SSO 登录</button>
            </div>
          `
          : activeOwnedProfile
            ? renderInlineSharedProfileEditor(activeOwnedProfile, input)
            : matchedOwnedProfile
              ? renderSharedProfileSummary(matchedOwnedProfile, input)
              : renderLocalProfilePublishEditor(input)}
      </div>
    </section>
  `;
}

export function renderOwnSharingTab(input: OwnSharingTabInput): string {
  return `
    <div class="sharing-own-stack">
      ${renderLocalShareForm({
        profiles: input.profiles,
        authRequired: input.authRequired,
        busy: input.busy,
        currentUser: input.currentUser,
        shareDraft: input.shareDraft,
        localShareForm: input.localShareForm,
        shareUserPickerHtml: input.shareUserPickerHtml,
        ownedProfilesLoading: input.ownedProfilesLoading,
        ownedProfiles: input.ownedProfiles,
        editDraft: input.editDraft,
        editUserPickerHtml: input.editUserPickerHtml,
      })}
    </div>
  `;
}

function renderLocalProfileTabCard(input: {
  profile: ProfileSummary;
  ownedProfile: NetworkProfile | null;
  currentUser: NetworkUserPrincipal | null;
  selected: boolean;
  busy: boolean;
}): string {
  const scopeLabel = input.ownedProfile ? sharingScopeLabelForCurrentUser(input.ownedProfile, input.currentUser) : "";

  return `
    <button
      class="local-profile-tab-card ${input.selected ? "active" : ""}"
      type="button"
      data-action="select-share-profile-tab"
      data-profile-id="${escapeHtml(input.profile.id)}"
      ${input.ownedProfile ? `data-owned-id="${escapeHtml(input.ownedProfile.id)}"` : ""}
      ${input.busy ? "disabled" : ""}
    >
      <span class="local-profile-tab-main">
        <strong>${escapeHtml(input.profile.name)}</strong>
        <small>${escapeHtml(input.profile.notes || input.profile.authTypeLabel || "本地配置")}</small>
        <em>更新: ${formatDateTime(input.profile.updatedAt)}</em>
      </span>
      <span class="local-profile-tab-status ${input.ownedProfile ? "shared" : ""}">
        ${input.ownedProfile ? `已共享 · ${escapeHtml(scopeLabel)}` : "未共享"}
      </span>
    </button>
  `;
}

function renderRemoteOnlyProfileTabCard(input: {
  profile: NetworkProfile;
  currentUser: NetworkUserPrincipal | null;
  selected: boolean;
  busy: boolean;
}): string {
  return `
    <button
      class="local-profile-tab-card ${input.selected ? "active" : ""}"
      type="button"
      data-action="select-share-profile-tab"
      data-owned-id="${escapeHtml(input.profile.id)}"
      ${input.busy ? "disabled" : ""}
    >
      <span class="local-profile-tab-main">
        <strong>${escapeHtml(input.profile.name)}</strong>
        <small>${escapeHtml(input.profile.description || "云端共享配置")}</small>
        <em>更新: ${formatDateTime(input.profile.updatedAt || input.profile.createdAt)}</em>
      </span>
      <span class="local-profile-tab-status shared">
        已共享 · ${escapeHtml(sharingScopeLabelForCurrentUser(input.profile, input.currentUser))}
      </span>
    </button>
  `;
}

function renderLocalProfilePublishEditor(input: LocalShareFormInput): string {
  const selectedProfile = input.localShareForm.selectedProfile;

  if (!selectedProfile) {
    return `
      <div class="empty-state" style="padding:24px;margin-top:16px;">
        <h3>没有可共享的本地配置</h3>
        <p>先保存一个本地 profile 后，再发布到企业共享库。</p>
      </div>
    `;
  }

  return `
    <div class="sharing-publish-layout compact">
      <fieldset class="sharing-scope-block">
        <div class="sharing-block-label">
          <span>1</span>
          <strong>设置共享范围</strong>
        </div>
        <div class="share-scope-options segmented">
          <label class="share-scope-option">
            <input
              id="share-visibility-selected"
              name="share-visibility"
              type="radio"
              value="selected"
              ${input.shareDraft.visibility === "selected" ? "checked" : ""}
            />
            <div>
              <strong>指定用户</strong>
              <span>只共享给选中的员工。</span>
            </div>
          </label>
          <label class="share-scope-option">
            <input
              id="share-visibility-public"
              name="share-visibility"
              type="radio"
              value="public"
              ${input.shareDraft.visibility === "public" ? "checked" : ""}
            />
            <div>
              <strong>全部员工</strong>
              <span>所有已登录员工可见。</span>
            </div>
          </label>
        </div>
      </fieldset>

      <div class="sharing-recipient-block" data-state="${input.shareDraft.visibility}">
        <div class="sharing-block-label">
          <span>2</span>
          <strong>选择共享对象</strong>
        </div>
        ${input.shareDraft.visibility === "selected" ? input.shareUserPickerHtml : `
          <div class="sharing-recipient-note">
            <strong>无需逐个选择人员</strong>
            <span>发布后，所有已登录企业共享库的员工都可以看到这套配置。</span>
          </div>
        `}
      </div>
    </div>

    <div class="sharing-form-footer">
      <div class="sharing-submit-summary">
        <strong>${escapeHtml(selectedProfile.name)}</strong>
        <span>${escapeHtml(input.localShareForm.shareSummary)}</span>
      </div>
      <button
        class="button button-primary"
        data-action="share-local-profile"
        ${input.busy || input.profiles.length === 0 || input.localShareForm.selectedShareDisabled ? "disabled" : ""}
      >
        共享到企业共享库
      </button>
    </div>
  `;
}

function renderSharedProfileSummary(profile: NetworkProfile, input: LocalShareFormInput): string {
  return `
    <div class="sharing-shared-summary">
      <div>
        <strong>${escapeHtml(profile.name)}</strong>
        <span>${escapeHtml(sharingScopeLabelForCurrentUser(profile, input.currentUser))} · 点击配置卡片可直接修改共享情况。</span>
      </div>
      <button
        class="button button-secondary"
        data-action="edit-shared-profile-users"
        data-id="${escapeHtml(profile.id)}"
        ${input.busy ? "disabled" : ""}
      >
        修改共享情况
      </button>
    </div>
  `;
}

function renderInlineSharedProfileEditor(profile: NetworkProfile, input: LocalShareFormInput): string {
  const draft = input.editDraft;
  if (!draft) {
    return renderSharedProfileSummary(profile, input);
  }

  const selectedDisabled = draft.visibility === "selected" && draft.selectedUserIds.length === 0;

  return `
    <div class="shared-profile-editor inline">
      <div class="sharing-inline-editor-head">
        <div>
          <strong>${escapeHtml(profile.name)}</strong>
          <span>已共享 · ${escapeHtml(sharingScopeLabelForCurrentUser(profile, input.currentUser))}</span>
        </div>
        <button class="button button-danger" data-action="delete-shared-profile" data-id="${escapeHtml(profile.id)}" ${input.busy ? "disabled" : ""}>
          删除
        </button>
      </div>
      <fieldset class="field" style="border:0;padding:0;margin:0;">
        <span>共享范围</span>
        <div class="share-scope-options segmented three">
          ${([
            ["selected", "指定用户", "只共享给选中的员工。"],
            ["public", "全部员工", "企业共享库内全部可见。"],
            ["private", "仅自己", "停止对其他人共享。"],
          ] as const).map(([value, title, desc]) => `
            <label class="share-scope-option">
              <input
                class="shared-profile-edit-visibility"
                name="shared-profile-edit-visibility-${escapeHtml(profile.id)}"
                type="radio"
                value="${value}"
                ${draft.visibility === value ? "checked" : ""}
              />
              <div>
                <strong>${title}</strong>
                <span>${desc}</span>
              </div>
            </label>
          `).join("")}
        </div>
      </fieldset>
      ${input.editUserPickerHtml}
      <div class="shared-profile-editor-actions">
        <button class="button button-secondary" data-action="cancel-edit-shared-profile" ${input.busy ? "disabled" : ""}>取消</button>
        <button
          class="button button-primary"
          data-action="save-shared-profile-users"
          ${input.busy || selectedDisabled ? "disabled" : ""}
        >
          保存共享对象
        </button>
      </div>
    </div>
  `;
}

export function renderOwnedSharedProfiles(input: OwnedSharedProfilesInput): string {
  if (input.authRequired) {
    return "";
  }

  if (input.loading) {
    return `
      <section class="card shared-profiles-panel" data-role="owned-shared-profiles">
        <div class="empty-state" style="padding:28px;">
          <div class="busy-dialog-spinner" style="margin: 0 auto 12px auto; width: 24px; height: 24px;"></div>
          <p>正在加载我已共享的配置...</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="card shared-profiles-panel" data-role="owned-shared-profiles">
      <div class="sharing-section-head">
        <div>
          <h3>我已共享的配置</h3>
          <p>管理自己发布到企业共享库的配置和可见人员。</p>
        </div>
        <span class="sharing-section-badge">${input.profiles.length} 个</span>
      </div>

      ${input.profiles.length === 0 ? `
        <div class="empty-state" style="padding:24px;margin-top:16px;">
          <h3>还没有共享配置</h3>
          <p>上方共享成功后，会出现在这里。</p>
        </div>
      ` : `
        <div class="shared-profile-list">
          ${input.profiles.map((profile) => renderOwnedSharedProfileCard(profile, input)).join("")}
        </div>
      `}
    </section>
  `;
}

function renderOwnedSharedProfileCard(
  profile: NetworkProfile,
  input: OwnedSharedProfilesInput,
): string {
  const draft = input.editDraft?.profileId === profile.id ? input.editDraft : null;
  const editing = Boolean(draft);
  const scope = sharingScopeLabel(profile);
  const selectedDisabled = draft?.visibility === "selected" && draft.selectedUserIds.length === 0;

  return `
    <article class="shared-profile-row" data-role="owned-shared-profile" data-id="${escapeHtml(profile.id)}">
      <div class="shared-profile-row-main">
        <div class="shared-profile-row-title">
          <h4>${escapeHtml(profile.name)}</h4>
          <span class="pill pill-type" style="font-size:0.74rem;">${escapeHtml(scope)}</span>
        </div>
        <p>${escapeHtml(profile.description || "云端共享配置")}</p>
        <div class="shared-profile-row-meta">
          更新: ${formatDateTime(profile.updatedAt || profile.createdAt)}
        </div>
      </div>
      <div class="shared-profile-row-actions">
        ${editing ? `
          <span class="pill pill-type" style="font-size:0.74rem;">编辑中</span>
        ` : `
          <button class="button button-secondary" data-action="edit-shared-profile-users" data-id="${escapeHtml(profile.id)}" ${input.busy ? "disabled" : ""}>修改共享人</button>
          <button class="button button-danger" data-action="delete-shared-profile" data-id="${escapeHtml(profile.id)}" ${input.busy ? "disabled" : ""}>删除</button>
        `}
      </div>

      ${editing && draft ? `
        <div class="shared-profile-editor">
          <fieldset class="field" style="border:0;padding:0;margin:0;">
            <span>共享范围</span>
            <div class="share-scope-options three">
              ${([
                ["selected", "指定用户", "只共享给选中的员工。"],
                ["public", "全部员工", "企业共享库内全部可见。"],
                ["private", "仅自己", "停止对其他人共享。"],
              ] as const).map(([value, title, desc]) => `
                <label class="share-scope-option">
                  <input
                    class="shared-profile-edit-visibility"
                    name="shared-profile-edit-visibility-${escapeHtml(profile.id)}"
                    type="radio"
                    value="${value}"
                    ${draft.visibility === value ? "checked" : ""}
                  />
                  <div>
                    <strong>${title}</strong>
                    <span>${desc}</span>
                  </div>
                </label>
              `).join("")}
            </div>
          </fieldset>
          ${input.editUserPickerHtml}
          <div class="shared-profile-editor-actions">
            <button class="button button-secondary" data-action="cancel-edit-shared-profile" ${input.busy ? "disabled" : ""}>取消</button>
            <button
              class="button button-primary"
              data-action="save-shared-profile-users"
              ${input.busy || selectedDisabled ? "disabled" : ""}
            >
              保存共享对象
            </button>
          </div>
        </div>
      ` : ""}
    </article>
  `;
}

export function renderEnterpriseLibraryTab(input: EnterpriseLibraryTabInput): string {
  return `
    <section class="card sharing-library-panel" data-role="network-profile-library" style="min-height:360px;">
      <div class="card-head">
        <h3>企业共享库</h3>
      </div>
      <p class="card-note">这里展示您有权限查看和导入的云端共享配置。自己共享的配置会标出当前共享范围。</p>
      <div style="margin-top:16px;">
        ${input.authRequired ? `
          <div class="empty-state" data-role="network-auth-prompt" style="padding:28px;">
            <h3>需要登录企业共享库</h3>
            <p>完成钉钉 SSO 登录后，客户端会自动连接企业共享库。</p>
            <button class="button button-primary" data-action="open-network-sso-login" style="margin-top:12px;">钉钉 SSO 登录</button>
          </div>
        ` : renderNetworkProfileLibrarySection(input)}
      </div>
    </section>
  `;
}

function renderNetworkProfileLibrarySection(input: EnterpriseLibraryTabInput): string {
  if (input.loading) {
    return `
      <div class="empty-state" style="border:none;background:transparent;padding:48px 0;">
        <div class="busy-dialog-spinner" style="margin: 0 auto 16px auto; width: 28px; height: 28px;"></div>
        <p style="color:var(--text-muted);">正在获取云端共享配置，请稍候...</p>
      </div>
    `;
  }

  if (input.profiles.length === 0) {
    return `
      <div class="empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-muted);margin-bottom:12px;"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path></svg>
        <h3>云端共享库为空</h3>
        <p>目前还没有任何云端共享的配置文件。</p>
        <button class="button button-secondary" data-action="refresh-network-in-editor" style="margin-top:12px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
          重新加载
        </button>
      </div>
    `;
  }

  return `
    <div class="network-section-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-main); margin:0;">可用云端共享配置 (${input.profiles.length})</h3>
      <button class="button button-secondary" data-action="refresh-network-in-editor" style="padding:4px 10px; font-size:0.8rem; height:28px; display:inline-flex; align-items:center; gap:4px;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
        <span>刷新列表</span>
      </button>
    </div>
    <div class="card-grid" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px;">
      ${input.profiles.map((profile) => renderNetworkProfileLibraryCard(profile, input.currentUser)).join("")}
    </div>
  `;
}

function renderNetworkProfileLibraryCard(
  profile: NetworkProfile,
  currentUser: NetworkUserPrincipal | null,
): string {
  return `
    <article class="card profile-card" style="padding: 16px; display: flex; flex-direction: column; justify-content: space-between; min-height: 160px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-panel); transition: all 0.2s;">
      <div>
        <div class="card-head" style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px;">
          <h4 style="font-size:1rem; font-weight:700; color:var(--text-main); margin:0;" title="${escapeHtml(profile.name)}">${escapeHtml(profile.name)}</h4>
          <span class="pill pill-type" style="font-size:0.7rem; padding: 2px 6px; color:var(--text-muted); border-color:var(--border-light); background:var(--bg-page); flex-shrink: 0;">☁️ 远程</span>
        </div>
        <p style="font-size:0.85rem; color:var(--text-muted); margin: 0 0 12px 0; display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;line-height:1.4;">${escapeHtml(profile.description || "云端共享配置")}</p>
        ${isOwnNetworkProfile(profile, currentUser) ? `
          <div style="display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border-radius:999px; background:rgba(79,70,229,0.10); color:var(--accent); font-size:0.76rem; font-weight:700;">
            <span>我共享的配置</span>
            <span>${escapeHtml(sharingScopeLabelForCurrentUser(profile, currentUser))}</span>
          </div>
        ` : ""}
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border-light); padding-top:12px; margin-top:auto;">
        <span style="font-size:0.75rem; color:var(--text-muted);">更新: ${formatDateTime(profile.createdAt).split(" ")[0]}</span>
        <div style="display:flex; gap:8px;">
          <button class="button button-ghost" data-action="view-network-profile-details" data-id="${escapeHtml(profile.id)}" style="padding: 4px 8px; font-size: 0.8rem; height: 28px;">
            详情
          </button>
          <button class="button button-primary" data-action="import-network-profile-to-editor" data-id="${escapeHtml(profile.id)}" style="padding: 4px 10px; font-size: 0.8rem; height: 28px; display:inline-flex; align-items:center; gap:2px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            导入
          </button>
        </div>
      </div>
    </article>
  `;
}

function sameDingUserId(left: string | null | undefined, right: string | null | undefined): boolean {
  return Boolean(left && right && left.trim().toLowerCase() === right.trim().toLowerCase());
}

function sharedUserIdsExcludingCurrentUser(
  profile: Pick<NetworkProfile, "sharedWith">,
  currentUser: NetworkUserPrincipal | null,
): string[] {
  return (profile.sharedWith ?? []).filter((id) => !sameDingUserId(id, currentUser?.dingUserId));
}

function sharingScopeLabelForCurrentUser(
  profile: Pick<NetworkProfile, "visibility" | "sharedWith">,
  currentUser: NetworkUserPrincipal | null,
): string {
  const visibility = networkProfileVisibility(profile);
  if (visibility === "public") return "全部员工可见";
  if (visibility === "private") return "仅自己可见";

  const sharedCount = sharedUserIdsExcludingCurrentUser(profile, currentUser).length;
  return sharedCount > 0 ? `指定 ${sharedCount} 人` : "未指定共享对象";
}
