import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import {
  renderAppShell,
} from "./app-chrome-renderers";
import { nativeConfirm, showConfigRecoveryDialog } from "./app-chrome-dialogs";
import type { FlashKind } from "./html-utils";
import {
  profileInputFromDocument,
  standaloneThirdPartyConfigInputFromDraft,
  symbioticAuthJsonFromOfficial,
  symbioticThirdPartyConfigTomlFromDraft,
  type NewProfileTemplate,
  type ProfileInput,
} from "./profile-input-builders";
import {
  createEditorFromDocument,
  createEditorFromInput,
  createEditorState,
  createMockCurrentInput,
  createSymbioticEditorFromDocument,
  type EditorMode,
  type EditorState,
} from "./profile-editor-state";
import {
  renderEditorPage,
} from "./profile-editor-renderers";
import {
  getOfficialOauthProfiles,
  removeProfileFromSnapshot,
  resolveOfficialOauthProfileId,
} from "./profile-selection";
import {
  captureNestedScrollTops,
  currentRenderedPageKey,
  restoreNestedScrollTopsIfSamePage,
  restoreMainScrollIfSamePage,
} from "./scroll-restoration";
import {
  codexUsageActionPrefix,
  latencyProbeActionKey,
  migrateLegacyThirdPartyActionKey,
  refreshAllUsageActionKey,
  thirdPartyUsageActionKey,
  usageRefreshActionKey,
  writeThirdPartyWebsocketsDefaultsActionKey,
} from "./pending-action-keys";
import {
  hasPendingAction,
  hasPendingActionPrefix,
} from "./pending-actions";
import {
  isOwnNetworkProfile,
  type NetworkProfile,
  type NetworkUserPrincipal,
  type ShareUserOption,
  type ShareVisibility,
} from "./network-profile-utils";
import {
  sharedProfileHasNewerRemote,
  sharedAuthWriteBackBase,
  shouldWriteBackSharedAuth,
} from "./network-auth-sync";
import {
  renderNetworkAccountSettings,
  renderSidebarLoginStatus,
} from "./network-account-renderers";
import { renderSettingsPage } from "./settings-renderers";
import {
  DEFAULT_NETWORK_PROFILES_API,
  hasNetworkAccessToken,
  loadNetworkSharingSettings,
  networkAuthHeaders,
  networkDesktopLoginApiUrl,
  networkFetchOptions,
  networkMeApiUrl,
  networkPortalBaseUrl,
  networkProfilesApiUrl,
  networkSsoLoginUrl,
  networkUsersApiUrl,
  saveNetworkSharingSettings,
} from "./network-sharing";
import {
  type CodexMessage,
  type CodexSessionInfo,
} from "./session-utils";
import {
  formatSessionRecoveryFlash,
  formatSessionRepairFlash,
  totalSafeRepairCandidates,
  totalTimeRepairCandidates,
  type SessionRecoveryCandidates,
  type SessionRecoveryCounts,
  type SessionRecoveryReport,
  type SessionRecoverySamples,
  type SessionRepairResult,
  type SessionRepairUpdateCounts,
  type SavedRootOutsideRecentWindowSample,
} from "./session-recovery-utils";
import {
  createPreviewCodexSessionMessages,
  createPreviewCodexSessions,
} from "./session-preview-data";
import { createPreviewAppSnapshot } from "./app-preview-data";
import type {
  AppSnapshot,
  ConfigRecoveryNotice,
  CodexUsageStatsFilter,
  CodexUsageStatsSnapshot,
  InstallLocationStatus,
  LegacyThirdPartyMigrationResult,
  PacProxyStatus,
  ProfileDocument,
  ProfileSummary,
  ThirdPartyWebsocketsDefaultResult,
  UpdateCheckResult,
} from "./desktop-types";
import {
  createEmptyProfileDocument,
  createMockProfileDocument,
} from "./profile-documents";
import {
  renderCardsPage,
} from "./profile-list-renderers";
import {
  isOfficialOauthProfile,
  isThirdPartyBackedProfile,
} from "./usage-formatters";
import {
  renderSessionDetailHtml,
  renderSessionsListHtml,
  renderSessionsPage,
} from "./session-renderers";
import { renderSessionCleanupPage } from "./session-cleanup-renderers";
import { renderCodexUsageStatsPage } from "./usage-stats-renderers";
import {
  renderEnterpriseLibraryTab,
  renderOwnSharingTab,
  renderSharingCenterPage,
  renderSharedProfileEditUserPicker,
  renderShareUserPicker,
  type SharingLibraryTab,
} from "./sharing-center-renderers";
import {
  createSharedProfileEditDraft,
  resolveSharedProfileUpdateScope,
  resolveLocalShareFormState,
} from "./sharing-center-state";
import {
  applySnapshotToDesktopState,
  createDesktopState,
  selectOwnNetworkProfiles,
  selectSessionRenderState,
} from "./desktop-state";
import {
  beginPendingAction,
  clearFlash,
  desktopInvoke,
  endPendingAction,
  errorMessage,
  formatErrorMessage,
  isTauriRuntime,
  registerRender,
  setBusy,
  setFlash,
  state,
} from "./app-runtime";
import {
  networkErrorMessageFromBody,
  networkHttpRequest,
  networkUnauthorizedError,
  parseNetworkJson,
  type NetworkHttpResponse,
} from "./network-http";
import {
  defaultPacProxyOptions,
  pacProxyOptionByKey,
  previewPacProxyStatus,
  selectedPacProxyOptionLabel,
} from "./pac-proxy-presets";
import { createPreviewCodexUsageStats } from "./usage-preview-data";
import {
  bindSessionCleanupEvents,
  bindSessionPageEvents,
  fetchCodexSessions,
  refreshSessionDetailPane,
  refreshSessionsListView,
} from "./session-actions";
import "./styles.css";

const desktopLoginPollIntervalMs =
  typeof process !== "undefined" && process.env.NODE_ENV === "test" ? 10 : 2000;
const sharedAuthAutoSyncIntervalMs = 15000;

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("App root was not found.");
}

const app = appRoot;

const shownConfigRecoveryNoticeIds = new Set<string>();
let configRecoveryDialogInFlight = false;

const promptedRemoteUpdateKeys = new Set<string>();
let remoteUpdateCheckInFlight = false;
let sharedAuthWriteBackInFlight = false;
const checkedRemoteVersionProfileIds = new Set<string>();

function setSnapshot(snapshot: AppSnapshot): void {
  applySnapshotToDesktopState(state, snapshot);
  render();
  void presentConfigRecoveryNotices(snapshot.configRecoveryNotices ?? []);
}

async function presentConfigRecoveryNotices(
  notices: ConfigRecoveryNotice[],
): Promise<void> {
  if (configRecoveryDialogInFlight || !isTauriRuntime) {
    return;
  }
  const pending = notices.filter((notice) => !shownConfigRecoveryNoticeIds.has(notice.id));
  if (pending.length === 0) {
    return;
  }

  configRecoveryDialogInFlight = true;
  const noticeIds = pending.map((notice) => notice.id);
  try {
    const result = await showConfigRecoveryDialog(pending);
    if (result === "openRecoveryDir") {
      await desktopInvoke<void>("open_config_recovery_dir");
    }
    await desktopInvoke<void>("acknowledge_config_recovery", { noticeIds });
    noticeIds.forEach((noticeId) => shownConfigRecoveryNoticeIds.add(noticeId));
  } catch (error) {
    setFlash("error", `处理配置恢复提示失败：${formatErrorMessage(error)}`);
  } finally {
    configRecoveryDialogInFlight = false;
  }
}

async function symbioticThirdPartyConfigInputFromDraft(
  editor: EditorState,
  strict: boolean = true,
): Promise<ProfileInput> {
  const oauthProfileId = resolveOfficialOauthProfileId(
    state.snapshot,
    state.editor.thirdParty.oauthProfileId,
  );
  if (!oauthProfileId) {
    if (strict) {
      throw new Error("请先登录并保存一个官方 OAuth 账号，再创建共生配置。");
    }
  }

  let document: ProfileDocument;
  if (!isTauriRuntime) {
    const profile = getOfficialOauthProfiles(state.snapshot).find(
      (candidate) => candidate.id === oauthProfileId,
    );
    if (!profile) {
      if (strict) {
        throw new Error("请先登录并保存一个官方 OAuth 账号，再创建共生配置。");
      }
      document = createEmptyProfileDocument();
    } else {
      document = createMockProfileDocument(profile);
    }
  } else {
    if (!oauthProfileId) {
      document = createEmptyProfileDocument();
    } else {
      document = await desktopInvoke<ProfileDocument>("get_profile_document", {
        profileId: oauthProfileId,
      });
    }
  }

  return {
    name: editor.name.trim(),
    notes: editor.notes.trim(),
    authJson: symbioticAuthJsonFromOfficial(document.authJson),
    configToml: symbioticThirdPartyConfigTomlFromDraft(editor, strict),
  };
}

async function buildEditorProfileInput(): Promise<ProfileInput> {
  if (state.editor.mode === "new") {
    if (state.editor.newTab === "manual-full") {
      return {
        name: state.editor.name.trim(),
        notes: state.editor.notes.trim(),
        authJson: state.editor.authJson,
        configToml: state.editor.configToml,
      };
    }
    if (state.editor.thirdParty.template === "symbioticThirdParty") {
      return symbioticThirdPartyConfigInputFromDraft(state.editor);
    }
    return standaloneThirdPartyConfigInputFromDraft(state.editor);
  }

  return {
    name: state.editor.name.trim(),
    notes: state.editor.notes.trim(),
    authJson: state.editor.authJson,
    configToml: state.editor.configToml,
  };
}

function applyEditorDocument(document: ProfileDocument): void {
  state.editor = createEditorFromDocument(document);
}

function remoteUpdatedAtFromNetworkProfile(profile: NetworkProfile): string | null {
  return profile.contentUpdatedAt ?? profile.updatedAt ?? profile.createdAt ?? null;
}

function activeProfileHasRemoteProfile(snapshot: AppSnapshot | null = state.snapshot): boolean {
  const activeProfileId = snapshot?.activeProfileId;
  if (!activeProfileId) {
    return false;
  }

  const activeProfile = snapshot.profiles.find((profile) => profile.id === activeProfileId);
  return Boolean(activeProfile?.remoteProfileId?.trim());
}

async function persistRemoteMetadata(
  profileId: string,
  document: ProfileDocument,
): Promise<AppSnapshot | null> {
  const remoteProfileId = document.remoteProfileId?.trim();
  if (!isTauriRuntime || !remoteProfileId) {
    return null;
  }

  return desktopInvoke<AppSnapshot>("set_profile_remote_metadata", {
    profileId,
    remoteProfileId,
    remoteContentVersion: document.remoteContentVersion ?? null,
    remoteContentHash: document.remoteContentHash ?? null,
    remoteUpdatedAt: document.remoteUpdatedAt ?? null,
  });
}

async function refreshSnapshot(): Promise<void> {
  if (!isTauriRuntime) {
    setSnapshot(createPreviewAppSnapshot());
    setFlash("info", "当前是浏览器预览模式，展示的是模拟数据。");
    return;
  }

  setBusy(true);
  try {
    const snapshot = await desktopInvoke<AppSnapshot>("load_snapshot");
    clearFlash();
    setSnapshot(snapshot);
    void syncActiveSharedProfileCloudState({ silent: true });
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    render();
  }
}

function usageFilterPayload(): { filter: CodexUsageStatsFilter } {
  return {
    filter: {
      startDate: state.usageStatsFilter.startDate || null,
      endDate: state.usageStatsFilter.endDate || null,
      model: state.usageStatsFilter.model || null,
      effort: state.usageStatsFilter.effort || null,
    },
  };
}

function usageDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function setUsageStatsRange(range: string): void {
  if (range === "today") {
    const today = new Date().toISOString().slice(0, 10);
    state.usageStatsFilter.startDate = today;
    state.usageStatsFilter.endDate = today;
    return;
  }
  if (range === "7d") {
    state.usageStatsFilter.startDate = usageDateDaysAgo(6);
    state.usageStatsFilter.endDate = new Date().toISOString().slice(0, 10);
    return;
  }
  if (range === "30d") {
    state.usageStatsFilter.startDate = usageDateDaysAgo(29);
    state.usageStatsFilter.endDate = new Date().toISOString().slice(0, 10);
    return;
  }
  if (range === "all") {
    state.usageStatsFilter.startDate = null;
    state.usageStatsFilter.endDate = null;
  }
}

async function applyUsageStatsFilter(): Promise<void> {
  state.usageStats = null;
  await loadUsageStats();
}

async function loadUsageStats(options: { showSuccess?: boolean } = {}): Promise<void> {
  state.usageStatsLoading = true;
  state.usageStatsError = null;
  render();
  try {
    if (!isTauriRuntime) {
      state.usageStats = createPreviewCodexUsageStats();
      if (options.showSuccess) {
        setFlash("info", "当前是浏览器预览模式，展示的是模拟使用统计。");
      }
      return;
    }

    state.usageStats = await desktopInvoke<CodexUsageStatsSnapshot>(
      "refresh_codex_usage_stats",
      usageFilterPayload(),
    );
    if (options.showSuccess) {
      const imported = state.usageStats.sync.imported.toLocaleString("en-US");
      const skipped = state.usageStats.sync.skipped.toLocaleString("en-US");
      setFlash("success", `使用统计已刷新：新增 ${imported} 条，跳过 ${skipped} 条。`);
    }
  } catch (error) {
    const message = formatErrorMessage(error);
    state.usageStatsError = message;
    setFlash("error", message);
  } finally {
    state.usageStatsLoading = false;
    render();
  }
}

async function loadAppVersion(): Promise<void> {
  if (!isTauriRuntime) {
    state.appVersion = "preview";
    render();
    return;
  }

  try {
    state.appVersion = await getVersion();
  } catch {
    state.appVersion = null;
  } finally {
    render();
  }
}

async function switchProfile(profileId: string, profileName: string): Promise<void> {
  state.busy = true;
  state.busyDialog = {
    title: "切换中",
    message: "正在同步会话并修复 Codex 会话，请不要关闭应用。",
  };
  render();
  try {
    const snapshot = await desktopInvoke<AppSnapshot>("switch_profile", { profileId });
    state.selectedProfileId = profileId;
    state.view = "cards";
    setSnapshot(snapshot);
    state.busyDialog = {
      title: "重启 Codex",
      message: "会话修复已完成，正在重启 Codex。",
    };
    render();
    await desktopInvoke("restart_codex");
    setFlash("success", `${profileName} profile 切换成功，Codex 已重启。`);
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    state.busyDialog = null;
    render();
  }
}

async function deleteProfile(profileId: string, profileName: string): Promise<void> {
  const confirmed = await nativeConfirm(`确定要销毁「${profileName}」档案吗？此操作无法撤回！`, "彻底销毁", true);
  if (!confirmed) {
    return;
  }

  setBusy(true);
  try {
    if (!isTauriRuntime) {
      const snapshot = state.snapshot;
      if (!snapshot) {
        throw new Error("当前没有可删除的 profile。");
      }
      setSnapshot(removeProfileFromSnapshot(snapshot, profileId));
    } else {
      const snapshot = await desktopInvoke<AppSnapshot>("delete_profile", { profileId });
      setSnapshot(snapshot);
    }

    if (state.view === "editor" && state.editor.profileId === profileId) {
      state.view = "cards";
      state.editor = createEditorState();
    }

    setFlash("success", `已删除 profile「${profileName}」。`);
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    render();
  }
}

async function openEditorForNewProfile(): Promise<void> {
  state.editor = createEditorState("new");
  state.view = "editor";
  render();
}

async function openEditorForCurrentAccount(): Promise<void> {
  let input: ProfileInput;

  if (!isTauriRuntime) {
    input = createMockCurrentInput();
  } else {
    setBusy(true);
    try {
      input = await desktopInvoke<ProfileInput>("get_target_profile_input");
    } catch (error) {
      setFlash("error", error instanceof Error ? error.message : String(error));
      setBusy(false);
      render();
      return;
    } finally {
      setBusy(false);
    }
  }

  state.editor = createEditorFromInput("fromCurrent", input);
  state.view = "editor";
  setFlash("info", "已载入当前 Codex 账号配置，确认名称后保存即可。");
  render();
}

async function generateSymbioticFromExisting(profileId: string): Promise<void> {
  let document: ProfileDocument;

  if (!isTauriRuntime) {
    const profile = state.snapshot?.profiles.find((candidate) => candidate.id === profileId);
    if (!profile) {
      setFlash("error", "找不到这套 profile。");
      return;
    }
    document = createMockProfileDocument(profile);
  } else {
    setBusy(true);
    try {
      document = await desktopInvoke<ProfileDocument>("get_profile_document", { profileId });
    } catch (error) {
      setFlash("error", error instanceof Error ? error.message : String(error));
      setBusy(false);
      render();
      return;
    } finally {
      setBusy(false);
    }
  }

  state.editor = createSymbioticEditorFromDocument(
    document,
    resolveOfficialOauthProfileId(state.snapshot, state.editor.thirdParty.oauthProfileId),
  );

  state.view = "editor";
  setFlash("info", "已基于第三方 API 配置生成共生配置模板。请选择用于授权的官方账号，并保存。");
  render();
}

async function openEditorForProfile(profileId: string): Promise<void> {
  state.selectedProfileId = profileId;
  const snapshot = state.snapshot;
  const selectedProfile =
    snapshot?.profiles.find((profile) => profile.id === profileId) ?? null;

  if (!selectedProfile) {
    setFlash("error", "找不到这套 profile。");
    return;
  }

  if (!isTauriRuntime) {
    const document = createMockProfileDocument(selectedProfile);
    applyEditorDocument(document);
    state.view = "editor";
    render();
    return;
  }

  setBusy(true);
  try {
    const document = await desktopInvoke<ProfileDocument>("get_profile_document", { profileId });
    applyEditorDocument(document);
    state.view = "editor";
    clearFlash();
    if (selectedProfile.remoteProfileId?.trim() && hasNetworkAccessToken(state.networkSharing)) {
      const didLoadRemoteProfiles = await fetchNetworkProfiles({ silent: true, checkActiveProfileUpdate: false });
      if (didLoadRemoteProfiles) {
        checkedRemoteVersionProfileIds.add(selectedProfile.remoteProfileId.trim());
      }
    }
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    render();
  }
}

async function saveEditorProfile(andSwitch: boolean): Promise<void> {
  if (state.editor.readOnly) {
    setFlash("error", "网络共享配置仅支持查看，不能直接编辑或保存。");
    return;
  }

  const name = state.editor.name.trim();
  if (!name) {
    setFlash("error", "请先填写 profile 名称。");
    return;
  }

  let payload: ProfileInput;
  try {
    payload = await buildEditorProfileInput();
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
    return;
  }

  setBusy(true);
  try {
    let snapshot: AppSnapshot;
    let targetProfileId: string | null = state.editor.profileId;
    const isExisting = state.editor.mode === "existing" && state.editor.profileId;

    if (isExisting) {
      snapshot = await desktopInvoke<AppSnapshot>("update_profile", {
        profileId: state.editor.profileId,
        payload,
      });
    } else {
      snapshot = await desktopInvoke<AppSnapshot>("import_profile", { payload });
      targetProfileId = snapshot.profiles[0]?.id ?? null;
    }

    state.selectedProfileId = targetProfileId;
    setSnapshot(snapshot);

    if (andSwitch && targetProfileId) {
      state.busy = false;
      await switchProfile(targetProfileId, name);
      return;
    }

    if (isExisting && targetProfileId) {
      if (isTauriRuntime) {
        const document = await desktopInvoke<ProfileDocument>("get_profile_document", {
          profileId: targetProfileId,
        });
        applyEditorDocument(document);
      } else {
        const profileSummary =
          snapshot.profiles.find((profile) => profile.id === targetProfileId) ?? null;
        if (profileSummary) {
          state.editor = {
            ...state.editor,
            mode: "existing",
            profileId: profileSummary.id,
            name: profileSummary.name,
            notes: profileSummary.notes,
            createdAt: profileSummary.createdAt,
            updatedAt: profileSummary.updatedAt,
            loadedFromTarget: false,
            hasTargetChanges: false,
            readOnly: false,
            source: "local",
          };
        }
      }
      state.view = "editor";
      setFlash("success", "已保存这套 profile。");
    } else {
      state.view = "cards";
      setFlash("success", `已创建 profile: ${name}`);
    }
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    render();
  }
}

async function fetchNetworkProfiles(
  options: { silent?: boolean; checkActiveProfileUpdate?: boolean } = {},
): Promise<boolean> {
  state.networkLoading = true;
  render();
  try {
    const res = await fetch(networkProfilesApiUrl(state.networkSharing), networkFetchOptions(state.networkSharing));
    if (res.status === 401) {
      throw networkUnauthorizedError("加载企业共享库");
    }
    if (!res.ok) throw new Error("加载网络共享配置失败");
    state.networkProfiles = await res.json();
    state.networkAuthRequired = false;
    await syncActiveSharedAuthWriteBack();
    if (options.checkActiveProfileUpdate ?? true) {
      await checkActiveSharedProfileUpdate();
    }
    return true;
  } catch (error) {
    if (!options.silent) {
      setFlash("error", error instanceof Error ? error.message : String(error));
    }
    return false;
  } finally {
    state.networkLoading = false;
    render();
  }
}

async function syncActiveSharedProfileCloudState(options: { silent?: boolean } = {}): Promise<void> {
  if (
    !isTauriRuntime ||
    state.networkLoading ||
    !hasNetworkAccessToken(state.networkSharing) ||
    !activeProfileHasRemoteProfile()
  ) {
    return;
  }

  await fetchNetworkProfiles({ silent: options.silent ?? true });
}

async function fetchNetworkCurrentUser(options: { silent?: boolean } = {}): Promise<void> {
  if (!hasNetworkAccessToken(state.networkSharing)) {
    state.networkUser = null;
    state.networkUserLoading = false;
    state.networkAuthRequired = true;
    render();
    return;
  }

  state.networkUserLoading = true;
  render();
  try {
    const res = await fetch(networkMeApiUrl(state.networkSharing), networkFetchOptions(state.networkSharing));
    if (res.status === 401) {
      state.networkAuthRequired = false;
      if (!options.silent) {
        setFlash("error", networkUnauthorizedError("登录状态校验").message);
      }
      return;
    }
    if (!res.ok) throw new Error("加载登录用户失败");
    const data = (await res.json()) as { user?: NetworkUserPrincipal | null };
    if (!data.user) {
      state.networkAuthRequired = false;
      if (!options.silent) {
        setFlash("error", networkUnauthorizedError("登录状态校验").message);
      }
      return;
    }

    state.networkUser = data.user;
    state.networkAuthRequired = false;
  } catch (error) {
    if (!options.silent) {
      setFlash("error", error instanceof Error ? error.message : String(error));
    }
  } finally {
    state.networkUserLoading = false;
    render();
  }
}

function logoutNetworkUser(): void {
  state.networkSharing.token = "";
  saveNetworkSharingSettings(state.networkSharing);
  state.networkAuthRequired = true;
  state.networkUser = null;
  state.networkUserLoading = false;
  state.networkProfiles = [];
  state.shareUsers = [];
  state.sharedProfileEditDraft = null;
  setFlash("success", "已退出企业共享库登录。");
  render();
}

async function fetchShareUsers(): Promise<void> {
  if (!hasNetworkAccessToken(state.networkSharing)) {
    state.networkAuthRequired = true;
    state.shareUsers = [];
    render();
    return;
  }

  state.shareUsersLoading = true;
  render();
  try {
    const res = await fetch(networkUsersApiUrl(state.networkSharing), networkFetchOptions(state.networkSharing));
    if (res.status === 401) {
      throw networkUnauthorizedError("加载可分享用户");
    }
    if (!res.ok) throw new Error("加载可分享用户失败");
    const data = (await res.json()) as { users?: ShareUserOption[] };
    state.shareUsers = data.users ?? [];
    normalizeSelectedShareTargets();
    state.networkAuthRequired = false;
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.shareUsersLoading = false;
    render();
  }
}

function beginEditSharedProfile(profileId: string): void {
  const profile = state.networkProfiles.find((item) => item.id === profileId);
  if (!profile) {
    setFlash("error", "找不到要编辑的共享配置。");
    return;
  }
  if (!isOwnNetworkProfile(profile, state.networkUser)) {
    setFlash("error", "只能编辑自己共享的配置。");
    return;
  }

  state.sharedProfileEditDraft = createSharedProfileEditDraft(profile);
  normalizeSelectedShareTargets();
  render();
}

function cancelEditSharedProfile(): void {
  state.sharedProfileEditDraft = null;
  render();
}

function sameDingUserId(left: string | null | undefined, right: string | null | undefined): boolean {
  return Boolean(left && right && left.trim().toLowerCase() === right.trim().toLowerCase());
}

function sameProfileName(left: string | null | undefined, right: string | null | undefined): boolean {
  return Boolean(left && right && left.trim().toLowerCase() === right.trim().toLowerCase());
}

function findOwnedNetworkProfileForLocalProfile(profileId: string, profileName: string): NetworkProfile | null {
  const ownedProfiles = state.networkProfiles.filter((profile) => isOwnNetworkProfile(profile, state.networkUser));
  return ownedProfiles.find((profile) => profile.sourceProfileId === profileId) ??
    ownedProfiles.find((profile) => !profile.sourceProfileId && sameProfileName(profile.name, profileName)) ??
    null;
}

function selectShareTargetUsers(): ShareUserOption[] {
  return state.shareUsers.filter((user) => !sameDingUserId(user.dingUserId, state.networkUser?.dingUserId));
}

function normalizeShareTargets(selectedUserIds: readonly string[]): string[] {
  const knownUserIds = selectShareTargetUsers().map((user) => user.dingUserId);
  const knownUserSet = new Set(knownUserIds);
  const normalizedSelectedIds = selectedUserIds.filter((id) =>
    !sameDingUserId(id, state.networkUser?.dingUserId) &&
      (knownUserIds.length === 0 || knownUserSet.has(id)),
  );

  return Array.from(new Set(normalizedSelectedIds));
}

function normalizeSelectedShareTargets(): void {
  if (state.shareDraft.visibility === "selected") {
    state.shareDraft.selectedUserIds = normalizeShareTargets(state.shareDraft.selectedUserIds);
  }

  const editDraft = state.sharedProfileEditDraft;
  if (editDraft?.visibility === "selected") {
    state.sharedProfileEditDraft = {
      ...editDraft,
      selectedUserIds: normalizeShareTargets(editDraft.selectedUserIds),
    };
  }
}

async function saveSharedProfileShareTargets(): Promise<void> {
  const draft = state.sharedProfileEditDraft;
  if (!draft) return;
  const normalizedSelectedUserIds = normalizeShareTargets(draft.selectedUserIds);
  if (!hasNetworkAccessToken(state.networkSharing)) {
    state.networkAuthRequired = true;
    setFlash("error", "请先使用钉钉 SSO 登录企业共享中心。");
    return;
  }
  if (draft.visibility === "selected" && normalizedSelectedUserIds.length === 0) {
    setFlash("error", "请选择至少一位共享对象，或切换为全部员工/仅自己可见。");
    return;
  }

  const profile = state.networkProfiles.find((item) => item.id === draft.profileId);
  if (!profile) {
    setFlash("error", "找不到要保存的共享配置。");
    return;
  }
  if (!isOwnNetworkProfile(profile, state.networkUser)) {
    setFlash("error", "只能编辑自己共享的配置。");
    return;
  }

  setBusy(true);
  try {
    const authHeaders = networkAuthHeaders(state.networkSharing);
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...(authHeaders ?? {}),
    };
    const response = await fetch(`${networkProfilesApiUrl(state.networkSharing)}/${profile.id}`, {
      method: "POST",
      cache: "no-store",
      headers,
      body: JSON.stringify({
        name: profile.name,
        description: profile.description || "",
        visibility: draft.visibility,
        sharedWith: draft.visibility === "selected" ? normalizedSelectedUserIds : [],
      }),
    });

    if (response.status === 401) {
      throw networkUnauthorizedError("保存共享对象");
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || "保存共享对象失败");
    }

    state.sharedProfileEditDraft = null;
    setFlash("success", `已更新「${profile.name}」的共享对象。`);
    await fetchNetworkProfiles();
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

async function deleteSharedProfile(profileId: string): Promise<void> {
  if (!hasNetworkAccessToken(state.networkSharing)) {
    state.networkAuthRequired = true;
    setFlash("error", "请先使用钉钉 SSO 登录企业共享中心。");
    return;
  }

  const profile = state.networkProfiles.find((item) => item.id === profileId);
  if (!profile) {
    setFlash("error", "找不到要删除的共享配置。");
    return;
  }
  if (!isOwnNetworkProfile(profile, state.networkUser)) {
    setFlash("error", "只能删除自己共享的配置。");
    return;
  }
  const confirmed = await nativeConfirm(
    `确定删除「${profile.name}」吗？删除后其他人将无法再导入这套共享配置。`,
    "删除",
    true,
  );
  if (!confirmed) {
    return;
  }

  setBusy(true);
  try {
    const profileUrl = `${networkProfilesApiUrl(state.networkSharing)}/${profile.id}`;
    if (isTauriRuntime) {
      const result = await desktopInvoke<NetworkHttpResponse>("delete_network_profile", {
        url: profileUrl,
        token: state.networkSharing.token.trim() || null,
      });
      if (result.status === 401) {
        throw networkUnauthorizedError("删除共享配置");
      }
      if (result.status < 200 || result.status >= 300) {
        throw new Error(networkErrorMessageFromBody(result.body, "删除共享配置失败"));
      }
    } else {
      const headers = networkAuthHeaders(state.networkSharing);
      const response = await fetch(profileUrl, {
        method: "DELETE",
        cache: "no-store",
        ...(headers ? { headers } : {}),
      });

      if (response.status === 401) {
        throw networkUnauthorizedError("删除共享配置");
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || "删除共享配置失败");
      }
    }

    if (state.sharedProfileEditDraft?.profileId === profile.id) {
      state.sharedProfileEditDraft = null;
    }
    setFlash("success", `已删除共享配置「${profile.name}」。`);
    await fetchNetworkProfiles();
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

async function loadSharingCenterData(): Promise<void> {
  saveNetworkSharingSettings(state.networkSharing);
  if (!hasNetworkAccessToken(state.networkSharing)) {
    state.networkAuthRequired = true;
    render();
    return;
  }

  await fetchNetworkCurrentUser({ silent: true });
  if (!hasNetworkAccessToken(state.networkSharing)) {
    return;
  }
  await Promise.all([fetchShareUsers(), fetchNetworkProfiles()]);
}

function remoteUpdateVersion(profile: NetworkProfile): string {
  return typeof profile.contentVersion === "number" ? `v${profile.contentVersion}` : "最新版本";
}

function normalizedProfileName(value: string): string {
  return value.trim().toLowerCase();
}

function findUniqueNetworkProfileByName(name: string): NetworkProfile | null {
  const normalizedName = normalizedProfileName(name);
  if (!normalizedName) {
    return null;
  }

  const matches = state.networkProfiles.filter((profile) => normalizedProfileName(profile.name) === normalizedName);
  return matches.length === 1 ? matches[0] : null;
}

function sharedProfileReplacementTarget(
  localProfile: ProfileSummary | null | undefined,
): { localProfile: ProfileSummary; remoteProfile: NetworkProfile } | null {
  const remoteProfileId = localProfile?.remoteProfileId?.trim();
  if (!localProfile || !remoteProfileId) {
    return null;
  }

  if (state.networkProfiles.some((profile) => profile.id === remoteProfileId)) {
    return null;
  }

  const replacementRemoteProfile = findUniqueNetworkProfileByName(localProfile.name);
  return replacementRemoteProfile ? { localProfile, remoteProfile: replacementRemoteProfile } : null;
}

function sharedProfileUpdateTarget(
  localProfile: ProfileSummary | null | undefined,
): { localProfile: ProfileSummary; remoteProfile: NetworkProfile } | null {
  const remoteProfileId = localProfile?.remoteProfileId?.trim();
  if (!localProfile || !remoteProfileId) {
    return null;
  }

  const remoteProfile = state.networkProfiles.find((profile) => profile.id === remoteProfileId);
  if (!remoteProfile || !sharedProfileHasNewerRemote(localProfile, remoteProfile)) {
    return null;
  }

  return { localProfile, remoteProfile };
}

function activeSharedProfileUpdateTarget(): { activeProfile: ProfileSummary; remoteProfile: NetworkProfile } | null {
  const snapshot = state.snapshot;
  if (!snapshot?.activeProfileId) {
    return null;
  }

  const target = sharedProfileUpdateTarget(
    snapshot.profiles.find((profile) => profile.id === snapshot.activeProfileId),
  );
  return target ? { activeProfile: target.localProfile, remoteProfile: target.remoteProfile } : null;
}

async function syncActiveSharedAuthWriteBack(): Promise<void> {
  if (!isTauriRuntime || sharedAuthWriteBackInFlight || !hasNetworkAccessToken(state.networkSharing)) {
    return;
  }

  const snapshot = state.snapshot;
  const activeProfile = snapshot?.profiles.find((profile) => profile.id === snapshot.activeProfileId);
  const remoteProfileId = activeProfile?.remoteProfileId?.trim();
  if (!activeProfile || !remoteProfileId) {
    return;
  }

  const remoteProfile = state.networkProfiles.find((profile) => profile.id === remoteProfileId);
  if (!shouldWriteBackSharedAuth(activeProfile, remoteProfile)) {
    return;
  }

  sharedAuthWriteBackInFlight = true;
  try {
    const document = await desktopInvoke<ProfileDocument>("get_profile_document", { profileId: activeProfile.id });
    if (!document.loadedFromTarget || !document.hasTargetChanges) {
      return;
    }

    const base = sharedAuthWriteBackBase(activeProfile, remoteProfile);
    const response = await networkHttpRequest(
      "POST",
      `${networkProfilesApiUrl(state.networkSharing)}/${remoteProfileId}`,
      "同步共享授权",
      {
        token: state.networkSharing.token,
        body: JSON.stringify({
          ...base,
          authContent: document.authJson,
        }),
      },
    );

    if (response.status === 401) {
      throw networkUnauthorizedError("同步共享授权");
    }
    if (response.status === 409) {
      setFlash("info", "共享配置已有新版本，已跳过本机授权写回。请先更新到最新版。");
      return;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(networkErrorMessageFromBody(response.body, "同步共享授权失败"));
    }

    const updatedProfile = parseNetworkJson<NetworkProfile>(response.body, "同步共享授权返回内容无法解析。");
    state.networkProfiles = state.networkProfiles.map((profile) =>
      profile.id === updatedProfile.id ? updatedProfile : profile,
    );

    const payload = profileInputFromDocument({
      ...document,
      name: activeProfile.name,
      notes: activeProfile.notes,
    });
    const savedSnapshot = await desktopInvoke<AppSnapshot>("update_profile", {
      profileId: activeProfile.id,
      payload,
    });
    setSnapshot(savedSnapshot);

    const metadataSnapshot = await persistRemoteMetadata(activeProfile.id, {
      ...document,
      remoteProfileId: updatedProfile.id,
      remoteContentVersion: updatedProfile.contentVersion ?? null,
      remoteContentHash: updatedProfile.contentHash ?? null,
      remoteUpdatedAt: remoteUpdatedAtFromNetworkProfile(updatedProfile),
    });
    if (metadataSnapshot) {
      setSnapshot(metadataSnapshot);
    }
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    sharedAuthWriteBackInFlight = false;
  }
}

function remoteUpdatePromptKey(profile: NetworkProfile): string {
  return [
    profile.id,
    profile.contentVersion ?? "",
    profile.contentHash ?? "",
    remoteUpdatedAtFromNetworkProfile(profile) ?? "",
  ].join(":");
}

async function updateLocalSharedProfileFromCloud(
  localProfile: ProfileSummary,
  remoteProfile: NetworkProfile,
  options: { restartIfActive: boolean },
): Promise<void> {
  const isActiveProfile = state.snapshot?.activeProfileId === localProfile.id;
  state.busy = true;
  state.busyDialog = {
    title: "更新共享配置",
    message: "正在下载最新共享配置并更新本地档案。",
  };
  render();

  try {
    const document = await fetchNetworkProfileDocument(remoteProfile.id);
    const updateSnapshot = await desktopInvoke<AppSnapshot>("update_profile", {
      profileId: localProfile.id,
      payload: profileInputFromDocument(document),
    });
    setSnapshot(updateSnapshot);

    const metadataSnapshot = await persistRemoteMetadata(localProfile.id, document);
    if (metadataSnapshot) {
      setSnapshot(metadataSnapshot);
    }

    if (state.editor.profileId === localProfile.id) {
      const refreshedProfile =
        state.snapshot?.profiles.find((profile) => profile.id === localProfile.id) ?? localProfile;
      applyEditorDocument({
        ...document,
        id: localProfile.id,
        name: refreshedProfile.name,
        notes: refreshedProfile.notes,
        authTypeLabel: refreshedProfile.authTypeLabel,
        createdAt: refreshedProfile.createdAt,
        updatedAt: refreshedProfile.updatedAt,
        remoteProfileId: refreshedProfile.remoteProfileId ?? document.remoteProfileId ?? null,
        remoteContentVersion: refreshedProfile.remoteContentVersion ?? document.remoteContentVersion ?? null,
        remoteContentHash: refreshedProfile.remoteContentHash ?? document.remoteContentHash ?? null,
        remoteUpdatedAt: refreshedProfile.remoteUpdatedAt ?? document.remoteUpdatedAt ?? null,
        loadedFromTarget: false,
        hasTargetChanges: false,
        readOnly: false,
        source: "local",
      });
    }

    if (!options.restartIfActive || !isActiveProfile) {
      setFlash("success", `已更新共享配置：${document.name} ${remoteUpdateVersion(remoteProfile)}。`);
      return;
    }

    state.busyDialog = {
      title: "重新应用配置",
      message: "正在让最新共享配置生效并准备重启 Codex。",
    };
    render();

    const switchSnapshot = await desktopInvoke<AppSnapshot>("switch_profile", { profileId: localProfile.id });
    state.selectedProfileId = localProfile.id;
    setSnapshot(switchSnapshot);

    state.busyDialog = {
      title: "重启 Codex",
      message: "配置已更新，正在重启 Codex。",
    };
    render();

    await desktopInvoke("restart_codex");
    setFlash("success", `已更新并重启 Codex：${document.name} ${remoteUpdateVersion(remoteProfile)}。`);
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    state.busyDialog = null;
    render();
  }
}

async function updateActiveSharedProfileFromCloud(
  activeProfile: ProfileSummary,
  remoteProfile: NetworkProfile,
): Promise<void> {
  await updateLocalSharedProfileFromCloud(activeProfile, remoteProfile, { restartIfActive: true });
}

async function checkActiveSharedProfileUpdate(): Promise<void> {
  if (!isTauriRuntime || remoteUpdateCheckInFlight) {
    return;
  }

  const target = activeSharedProfileUpdateTarget();
  if (!target) {
    return;
  }

  const promptKey = remoteUpdatePromptKey(target.remoteProfile);
  if (promptedRemoteUpdateKeys.has(promptKey)) {
    return;
  }
  promptedRemoteUpdateKeys.add(promptKey);

  remoteUpdateCheckInFlight = true;
  try {
    const version = remoteUpdateVersion(target.remoteProfile);
    const confirmed = await nativeConfirm(
      `共享配置「${target.remoteProfile.name}」有新版本 ${version}。\n当前 Codex 正在使用这套配置，是否立即更新并重启 Codex？`,
      "更新并重启",
      false,
    );
    if (!confirmed) {
      return;
    }

    await updateActiveSharedProfileFromCloud(target.activeProfile, target.remoteProfile);
  } finally {
    remoteUpdateCheckInFlight = false;
  }
}

async function openNetworkSsoLogin(): Promise<void> {
  saveNetworkSharingSettings(state.networkSharing);
  try {
    const sessionResponse = await networkHttpRequest(
      "POST",
      networkDesktopLoginApiUrl(state.networkSharing),
      "创建桌面登录会话",
    );
    if (sessionResponse.status < 200 || sessionResponse.status >= 300) {
      throw new Error(
        networkErrorMessageFromBody(
          sessionResponse.body,
          `创建桌面登录会话失败（HTTP ${sessionResponse.status}）。`,
        ),
      );
    }
    const session = parseNetworkJson<{
      id: string;
      pollToken: string;
    }>(sessionResponse.body, "创建桌面登录会话返回内容无法解析。");
    if (!session.id || !session.pollToken) {
      throw new Error("创建桌面登录会话返回内容缺少必要字段。");
    }
    const loginUrl = new URL(networkSsoLoginUrl(state.networkSharing));
    loginUrl.searchParams.set("desktopLoginId", session.id);

    if (isTauriRuntime) {
      await invoke("open_external_url", { url: loginUrl.toString() });
    } else {
      window.open(loginUrl.toString(), "_blank", "noopener,noreferrer");
    }
    setFlash("info", "已打开钉钉 SSO 登录页。完成登录后客户端会自动连接企业共享库。");
    render();
    await pollNetworkDesktopLogin(session.id, session.pollToken);
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    render();
  }
}

async function pollNetworkDesktopLogin(sessionId: string, pollToken: string): Promise<void> {
  const pollUrl = new URL(`${networkDesktopLoginApiUrl(state.networkSharing)}/${sessionId}`);
  pollUrl.searchParams.set("pollToken", pollToken);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, desktopLoginPollIntervalMs));
    const response = await networkHttpRequest("GET", pollUrl.toString(), "桌面登录状态检查");
    if (response.status === 202) continue;
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        networkErrorMessageFromBody(
          response.body,
          `桌面登录状态检查失败（HTTP ${response.status}）。`,
        ),
      );
    }

    const result = parseNetworkJson<{ token?: string }>(response.body, "桌面登录状态返回内容无法解析。");
    if (!result.token) {
      throw new Error("桌面登录没有返回访问令牌。");
    }

    state.networkSharing.token = result.token;
    state.networkAuthRequired = false;
    saveNetworkSharingSettings(state.networkSharing);
    setFlash("success", "已完成钉钉 SSO 登录，并自动连接企业共享库。");
    await fetchNetworkCurrentUser({ silent: true });
    await Promise.all([fetchShareUsers(), fetchNetworkProfiles()]);
    return;
  }

  throw new Error("钉钉 SSO 登录等待超时，请重新登录。");
}

async function fetchNetworkProfileDocument(networkProfileId: string): Promise<ProfileDocument> {
  const apiUrl = networkProfilesApiUrl(state.networkSharing);
  const fetchOptions = networkFetchOptions(state.networkSharing);
  const res = await fetch(`${apiUrl}/${networkProfileId}`, fetchOptions);
  if (res.status === 401) {
    throw networkUnauthorizedError("获取网络配置详情");
  }
  if (!res.ok) {
    throw new Error("获取网络配置详情失败");
  }

  const profileData = (await res.json()) as NetworkProfile;

  let authJson = "{}";
  let configToml = "";

  if (profileData.files?.includes("auth.json")) {
    const authRes = await fetch(
      `${apiUrl}/${networkProfileId}/auth.json`,
      fetchOptions,
    );
    if (authRes.ok) {
      authJson = await authRes.text();
    }
  }

  if (profileData.files?.includes("config.toml")) {
    const configRes = await fetch(
      `${apiUrl}/${networkProfileId}/config.toml`,
      fetchOptions,
    );
    if (configRes.ok) {
      configToml = await configRes.text();
    }
  }

  return {
    id: profileData.id,
    name: profileData.name,
    notes: profileData.description || "从网络资源库获取的共享配置",
    authTypeLabel: "远程资源",
    createdAt: profileData.createdAt,
    updatedAt: profileData.updatedAt ?? profileData.createdAt,
    remoteProfileId: profileData.id,
    remoteContentVersion: profileData.contentVersion ?? null,
    remoteContentHash: profileData.contentHash ?? null,
    remoteUpdatedAt: remoteUpdatedAtFromNetworkProfile(profileData),
    authJson,
    configToml,
    loadedFromTarget: false,
    hasTargetChanges: false,
    readOnly: true,
    source: "network",
  };
}

async function downloadAndApplyNetworkProfile(networkProfileId: string, profileName: string): Promise<void> {
  const confirmed = await nativeConfirm(`确定要下载网络配置「${profileName}」吗？\n如果同名配置已存在，将会生效使用并覆盖运行中环境。`, "下载并应用", false);
  if (!confirmed) return;

  setBusy(true);
  try {
    const document = await fetchNetworkProfileDocument(networkProfileId);

    const payload: ProfileInput = {
      name: profileName,
      notes: document.notes,
      authJson: document.authJson,
      configToml: document.configToml,
    };

    if (isTauriRuntime) {
      const snapshot = await desktopInvoke<AppSnapshot>("import_profile", { payload });
      const targetProfileId = snapshot.profiles[0]?.id;
      if (targetProfileId) {
        const metadataSnapshot = await persistRemoteMetadata(targetProfileId, document);
        if (metadataSnapshot) {
          setSnapshot(metadataSnapshot);
        }
        const afterSwitchSnap = await desktopInvoke<AppSnapshot>("switch_profile", { profileId: targetProfileId });
        state.selectedProfileId = targetProfileId;
        setSnapshot(afterSwitchSnap);
        state.activeTab = "local";
        setFlash("success", `已成功下载并应用网络共享配置「${profileName}」。`);
      } else {
         setFlash("error", "应用配置时发生错误。");
      }
    } else {
      setFlash("info", "当前为浏览器预览模式，无法将外网配置应用到桌面系统。");
    }
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
    render();
  }
}

async function openEditorForNetworkProfile(networkProfileId: string): Promise<void> {
  setBusy(true);
  try {
    const document = await fetchNetworkProfileDocument(networkProfileId);
    applyEditorDocument(document);
    state.view = "editor";
    clearFlash();
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    render();
  }
}

async function importNetworkProfileDocument(
  document: ProfileDocument,
  options: { openEditor: boolean },
): Promise<void> {
  const payload = profileInputFromDocument(document);

  if (!isTauriRuntime) {
    state.editor = {
      ...createEditorState("new"),
      name: payload.name,
      notes: payload.notes,
      authJson: payload.authJson,
      configToml: payload.configToml,
      newTab: "manual-full",
      source: "local",
      readOnly: false,
    };
    state.view = "editor";
    setFlash("info", "当前为浏览器预览模式，无法写入本地配置，已先载入编辑器。");
    return;
  }

  const snapshot = await desktopInvoke<AppSnapshot>("import_profile", { payload });
  let importedProfile = snapshot.profiles[0] ?? null;
  state.selectedProfileId = importedProfile?.id ?? null;
  setSnapshot(snapshot);

  if (importedProfile) {
    const metadataSnapshot = await persistRemoteMetadata(importedProfile.id, document);
    if (metadataSnapshot) {
      setSnapshot(metadataSnapshot);
      importedProfile = metadataSnapshot.profiles.find((profile) => profile.id === importedProfile?.id) ?? importedProfile;
    }
  }

  if (options.openEditor && importedProfile) {
    applyEditorDocument({
      ...document,
      id: importedProfile.id,
      name: importedProfile.name,
      notes: importedProfile.notes,
      authTypeLabel: importedProfile.authTypeLabel,
      remoteProfileId: importedProfile.remoteProfileId ?? document.remoteProfileId ?? null,
      remoteContentVersion: importedProfile.remoteContentVersion ?? document.remoteContentVersion ?? null,
      remoteContentHash: importedProfile.remoteContentHash ?? document.remoteContentHash ?? null,
      remoteUpdatedAt: importedProfile.remoteUpdatedAt ?? document.remoteUpdatedAt ?? null,
      createdAt: importedProfile.createdAt,
      updatedAt: importedProfile.updatedAt,
      loadedFromTarget: false,
      hasTargetChanges: false,
      readOnly: false,
      source: "local",
    });
    state.view = "editor";
  } else {
    state.activeTab = "local";
    state.view = "cards";
  }

  setFlash("success", `已将共享配置「${document.name}」导入本地配置管理。`);
}

async function importNetworkProfileAsLocal(networkProfileId: string, options: { openEditor: boolean }): Promise<void> {
  setBusy(true);
  try {
    const document = await fetchNetworkProfileDocument(networkProfileId);
    await importNetworkProfileDocument(document, options);
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
    render();
  }
}

async function importCurrentNetworkProfileFromEditor(): Promise<void> {
  setBusy(true);
  try {
    await importNetworkProfileDocument({
      id: state.editor.profileId ?? "",
      name: state.editor.name,
      notes: state.editor.notes,
      authTypeLabel: "远程资源",
      createdAt: state.editor.createdAt ?? new Date().toISOString(),
      updatedAt: state.editor.updatedAt ?? state.editor.createdAt ?? new Date().toISOString(),
      remoteProfileId: state.editor.remoteProfileId,
      remoteContentVersion: state.editor.remoteContentVersion,
      remoteContentHash: state.editor.remoteContentHash,
      remoteUpdatedAt: state.editor.remoteUpdatedAt,
      authJson: state.editor.authJson,
      configToml: state.editor.configToml,
      loadedFromTarget: false,
      hasTargetChanges: false,
      readOnly: true,
      source: "network",
    }, { openEditor: true });
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
    render();
  }
}

async function shareLocalProfileToNetwork(): Promise<void> {
  const profileId = state.shareDraft.profileId;
  const normalizedSelectedUserIds = normalizeShareTargets(state.shareDraft.selectedUserIds);
  if (!profileId) {
    setFlash("error", "请选择要共享的本地配置。");
    return;
  }
  if (!hasNetworkAccessToken(state.networkSharing)) {
    state.networkAuthRequired = true;
    setFlash("error", "请先使用钉钉 SSO 登录企业共享中心。");
    return;
  }
  const summary = state.snapshot?.profiles.find((profile) => profile.id === profileId);
  if (!summary) {
    setFlash("error", "找不到要共享的本地配置。");
    return;
  }

  setBusy(true);
  try {
    const document = isTauriRuntime
      ? await desktopInvoke<ProfileDocument>("get_profile_document", { profileId })
      : createMockProfileDocument(summary);
    const existingProfile = findOwnedNetworkProfileForLocalProfile(profileId, document.name);
    const { visibility, sharedWith } = resolveSharedProfileUpdateScope(
      existingProfile,
      state.shareDraft.visibility,
      normalizedSelectedUserIds,
    );
    if (visibility === "selected" && sharedWith.length === 0) {
      setFlash("error", "请选择至少一位共享对象，或切换为全部员工可见。");
      return;
    }
    const headers = networkAuthHeaders(state.networkSharing);
    const response = existingProfile
      ? await fetch(`${networkProfilesApiUrl(state.networkSharing)}/${existingProfile.id}`, {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            ...(headers ?? {}),
          },
          body: JSON.stringify({
            name: document.name,
            description: document.notes || "",
            visibility,
            sharedWith,
            sourceProfileId: profileId,
            baseContentVersion: existingProfile.contentVersion ?? null,
            baseContentHash: existingProfile.contentHash ?? null,
            authContent: document.authJson,
            configContent: document.configToml,
          }),
        })
      : await fetch(networkProfilesApiUrl(state.networkSharing), {
          method: "POST",
          cache: "no-store",
          ...(headers ? { headers } : {}),
          body: (() => {
            const formData = new FormData();
            formData.append("name", document.name);
            formData.append("description", document.notes || "");
            formData.append("visibility", visibility);
            formData.append("sharedWith", JSON.stringify(sharedWith));
            formData.append("sourceProfileId", profileId);
            formData.append("file1", new File([document.authJson], "auth.json", { type: "application/json" }));
            formData.append("file2", new File([document.configToml], "config.toml", { type: "text/plain" }));
            return formData;
          })(),
        });

    if (response.status === 401) {
      throw networkUnauthorizedError("共享配置");
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || "共享配置失败");
    }
    const updatedProfile = await response.json().catch(() => null) as Partial<NetworkProfile> | null;
    if (existingProfile && (!updatedProfile?.contentHash || typeof updatedProfile.contentVersion !== "number")) {
      throw new Error("企业共享库服务端尚未升级，授权文件没有同步成功。请先部署新版共享中心后端。");
    }

    setFlash("success", existingProfile
      ? `已同步「${document.name}」的授权信息到企业共享中心。`
      : `已共享「${document.name}」到企业共享中心。`);
    await fetchNetworkProfiles();
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

async function checkForUpdate(): Promise<void> {
  if (!isTauriRuntime) {
    setFlash("info", "浏览器预览模式无法检查更新。");
    return;
  }

  state.update.checking = true;
  render();
  try {
    const installLocation = await desktopInvoke<InstallLocationStatus>("check_install_location");
    if (!installLocation.updateSafe) {
      state.update.lastResult = null;
      setFlash(
        "error",
        installLocation.message ??
          "当前安装位置不支持应用内更新。请先将应用移动到标准安装目录后再重试。",
      );
      return;
    }

    const update = await desktopInvoke<UpdateCheckResult>("check_update");
    if (!update.hasUpdate) {
      state.update.lastResult = null;
      setFlash("success", "已是最新版本。");
      return;
    }

    state.update.lastResult = update;
    const noteSnippet = update.notes?.replace(/\s+/g, " ").trim();
    const confirmMessage = update.canInstall
      ? `发现新版本 ${update.latestVersion}（当前 ${update.currentVersion}）。${noteSnippet ? ` 更新说明：${noteSnippet}` : ""} 是否立即下载并安装？`
      : `发现新版本 ${update.latestVersion}（当前 ${update.currentVersion}）。${noteSnippet ? ` 更新说明：${noteSnippet}` : ""} 是否打开内网镜像下载安装包？`;

    const confirmed = await nativeConfirm(
      confirmMessage,
      update.canInstall ? "立即更新" : "下载新版本",
      false,
    );
    if (!confirmed) {
      setFlash("info", `已取消更新，当前可升级到 ${update.latestVersion}。`);
      return;
    }

    setFlash(
      "info",
      update.canInstall
        ? `正在下载并安装更新 ${update.latestVersion}...`
        : `正在打开 ${update.latestVersion} 的内网下载地址...`,
    );
    await desktopInvoke("install_update", {
      payload: {
        latestVersion: update.latestVersion,
        downloadUrl: update.downloadUrl,
        sha256: update.sha256,
        kind: update.kind,
        filename: update.filename,
      },
    });

    setFlash(
      "success",
      update.canInstall
        ? "更新已安装完成。请重新打开应用进入新版本。"
        : "已打开内网镜像下载地址，请按安装包提示完成升级。",
    );
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.update.checking = false;
    render();
  }
}

async function autoCheckForUpdate(): Promise<void> {
  if (!isTauriRuntime) {
    return;
  }

  state.update.checking = true;
  render();

  try {
    const update = await desktopInvoke<UpdateCheckResult>("check_update");
    if (update.hasUpdate) {
      state.update.lastResult = update;
    } else {
      state.update.lastResult = null;
    }
  } catch (error) {
    console.error("自动检查更新失败：", error);
  } finally {
    state.update.checking = false;
    render();
  }
}

function startAutoUpdateChecker(): void {
  setTimeout(() => {
    void autoCheckForUpdate();
  }, 1000);

  setInterval(() => {
    void autoCheckForUpdate();
  }, 8 * 60 * 60 * 1000);
}

function startPacProxyStatusListener(): void {
  const tauriInternals = (window as Window & {
    __TAURI_INTERNALS__?: { transformCallback?: unknown };
  }).__TAURI_INTERNALS__;
  if (!isTauriRuntime || typeof tauriInternals?.transformCallback !== "function") {
    return;
  }

  void listen<PacProxyStatus>("pac-proxy-status-changed", (event) => {
    const previousEnabled = state.pacProxy.enabled;
    const previousPacKey = state.pacProxy.selectedPacKey;
    state.pacProxy = event.payload;
    render();
    const selectedLabel = selectedPacProxyOptionLabel(event.payload);
    const message = previousPacKey !== event.payload.selectedPacKey
      ? `已从系统菜单栏切换 PAC 节点：${selectedLabel}。`
      : event.payload.enabled
        ? "已从系统菜单栏开启 PAC 内网加速。"
        : previousEnabled
          ? "已从系统菜单栏关闭 PAC 内网加速。"
          : `已从系统菜单栏选择 PAC 节点：${selectedLabel}。`;
    setFlash(
      "success",
      message,
    );
  });
}

function startSharedAuthAutoSync(): void {
  if (
    !isTauriRuntime ||
    (typeof process !== "undefined" && process.env.NODE_ENV === "test")
  ) {
    return;
  }

  window.setInterval(() => {
    if (
      state.busy ||
      state.networkLoading ||
      sharedAuthWriteBackInFlight ||
      !hasNetworkAccessToken(state.networkSharing)
    ) {
      return;
    }

    void (async () => {
      try {
        const snapshot = await desktopInvoke<AppSnapshot>("load_snapshot");
        setSnapshot(snapshot);
        await syncActiveSharedProfileCloudState({ silent: true });
      } catch {
        // Background sync is best-effort; explicit refresh still surfaces errors.
      }
    })();
  }, sharedAuthAutoSyncIntervalMs);
}

async function loadPacProxyStatus(options: { silent?: boolean } = {}): Promise<void> {
  state.pacProxyLoading = true;
  render();

  try {
    if (!isTauriRuntime) {
      state.pacProxy = previewPacProxyStatus(false);
      return;
    }

    state.pacProxy = await desktopInvoke<PacProxyStatus>("get_pac_proxy_status");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.pacProxy = {
      ...state.pacProxy,
      supported: false,
      enabled: false,
      message,
    };
    if (!options.silent) {
      setFlash("error", `读取 PAC 内网加速状态失败：${message}`);
    }
  } finally {
    state.pacProxyLoading = false;
    render();
  }
}

async function togglePacProxy(): Promise<void> {
  if (state.pacProxyLoading) {
    return;
  }

  const enabled = !state.pacProxy.enabled;
  state.pacProxyLoading = true;
  render();

  try {
    if (!isTauriRuntime) {
      state.pacProxy = previewPacProxyStatus(enabled, state.pacProxy.selectedPacKey);
    } else {
      state.pacProxy = await desktopInvoke<PacProxyStatus>("set_pac_proxy_enabled", {
        enabled,
      });
    }

    setFlash(
      "success",
      enabled ? "已开启 PAC 内网加速。" : "已关闭 PAC 内网加速。",
    );
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
    if (isTauriRuntime) {
      await loadPacProxyStatus({ silent: true });
    }
  } finally {
    state.pacProxyLoading = false;
    render();
  }
}

async function setPacProxySelectedOption(selectedPacKey: string): Promise<void> {
  if (state.pacProxyLoading) {
    return;
  }

  const selectedOption = state.pacProxy.pacOptions.find((option) => option.key === selectedPacKey);
  if (!selectedOption) {
    setFlash("error", "未知 PAC 节点。");
    render();
    return;
  }

  state.pacProxyLoading = true;
  render();

  try {
    if (!isTauriRuntime) {
      state.pacProxy = {
        ...state.pacProxy,
        selectedPacKey: selectedOption.key,
        pacUrl: selectedOption.url,
        services: state.pacProxy.enabled ? state.pacProxy.selectedServices : [],
      };
    } else {
      state.pacProxy = await desktopInvoke<PacProxyStatus>("set_pac_proxy_selected_option", {
        selectedPacKey,
      });
    }

    setFlash("success", `已切换 PAC 节点：${selectedOption.label}。`);
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
    if (isTauriRuntime) {
      await loadPacProxyStatus({ silent: true });
    }
  } finally {
    state.pacProxyLoading = false;
    render();
  }
}

async function setPacProxySelectedServices(selectedServices: string[]): Promise<void> {
  if (selectedServices.length === 0) {
    setFlash("error", "请至少选择一个生效网络服务。");
    render();
    return;
  }

  state.pacProxyLoading = true;
  render();

  try {
    if (!isTauriRuntime) {
      state.pacProxy = {
        ...state.pacProxy,
        selectedServices,
        services: state.pacProxy.enabled ? selectedServices : [],
      };
    } else {
      state.pacProxy = await desktopInvoke<PacProxyStatus>("set_pac_proxy_selected_services", {
        selectedServices,
      });
    }

    setFlash("success", "已保存 PAC 生效网络服务。");
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
    if (isTauriRuntime) {
      await loadPacProxyStatus({ silent: true });
    }
  } finally {
    state.pacProxyLoading = false;
    render();
  }
}

async function setCodexUsageApiEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    const confirmed = await nativeConfirm(
      "启用后会使用已保存的 ChatGPT access token 请求 chatgpt.com/backend-api/wham/usage。这个接口不是公开稳定 API，继续吗？",
      "继续启用",
      false,
    );
    if (!confirmed) {
      return;
    }
  }

  setBusy(true);
  try {
    if (!isTauriRuntime) {
      const snapshot = state.snapshot;
      if (!snapshot) {
        throw new Error("当前没有可用快照。");
      }
      setSnapshot({
        ...snapshot,
        codexUsageApiEnabled: enabled,
      });
    } else {
      const snapshot = await desktopInvoke<AppSnapshot>("set_codex_usage_api_enabled", {
        enabled,
      });
      setSnapshot(snapshot);
    }

    setFlash(
      "success",
      enabled ? "已启用 Codex 额度查询。" : "已关闭 Codex 额度查询。",
    );
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    render();
  }
}

async function refreshProfileCodexUsage(profileId: string, profileName: string): Promise<void> {
  const actionKey = usageRefreshActionKey(profileId);
  beginPendingAction(actionKey);
  try {
    setFlash("info", `正在刷新「${profileName}」的 Codex 额度…`);
    if (!isTauriRuntime) {
      const snapshot = state.snapshot;
      if (!snapshot) {
        throw new Error("当前没有可用快照。");
      }
      setSnapshot(snapshot);
    } else {
      const snapshot = await desktopInvoke<AppSnapshot>("refresh_profile_codex_usage", {
        profileId,
      });
      setSnapshot(snapshot);
    }
    setFlash("success", `已刷新「${profileName}」的 Codex 额度。`);
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    endPendingAction(actionKey);
  }
}

async function refreshAllCodexUsage(): Promise<void> {
  const initialSnapshot = state.snapshot;
  if (!initialSnapshot) {
    throw new Error("当前没有可用快照。");
  }

  // Auto-opt in official Codex usage query if disabled and we have official profiles
  const officialProfiles = initialSnapshot.profiles.filter(isOfficialOauthProfile);
  if (officialProfiles.length > 0 && !initialSnapshot.codexUsageApiEnabled) {
    await setCodexUsageApiEnabled(true);
    if (state.snapshot && !state.snapshot.codexUsageApiEnabled) {
      return;
    }
  }

  beginPendingAction(refreshAllUsageActionKey);
  try {
    let currentSnapshot = state.snapshot;
    if (!currentSnapshot) {
      throw new Error("当前没有可用快照。");
    }

    const thirdPartyProfiles = currentSnapshot.profiles.filter(isThirdPartyBackedProfile);
    const hasOfficial = currentSnapshot.profiles.some(isOfficialOauthProfile);

    let failedThirdPartyCount = 0;

    if (!isTauriRuntime) {
      setSnapshot(currentSnapshot);
    } else {
      // 1. Refresh official profiles first (if any exist)
      if (hasOfficial) {
        setFlash("info", "正在刷新官方 OAuth 档案的 Codex 额度…");
        try {
          currentSnapshot = await desktopInvoke<AppSnapshot>("refresh_all_codex_usage");
          setSnapshot(currentSnapshot);
        } catch (error) {
          console.error("刷新官方 OAuth 额度失败:", error);
          // Do not fail the whole operation, let third-party profiles try
        }
      }

      // 2. Refresh third-party profiles sequentially
      for (let i = 0; i < thirdPartyProfiles.length; i++) {
        const profile = thirdPartyProfiles[i];
        const profileActionKey = thirdPartyUsageActionKey(profile.id);
        beginPendingAction(profileActionKey);
        setFlash(
          "info",
          `正在刷新第三方档案「${profile.name}」的额度 (${i + 1}/${thirdPartyProfiles.length})…`
        );
        try {
          currentSnapshot = await desktopInvoke<AppSnapshot>("refresh_profile_third_party_usage", {
            profileId: profile.id,
          });
          setSnapshot(currentSnapshot);

          const updatedProfile = currentSnapshot.profiles.find((p) => p.id === profile.id);
          if (updatedProfile?.thirdPartyUsage?.error) {
            failedThirdPartyCount++;
          }
        } catch (error) {
          console.error(`刷新第三方档案「${profile.name}」额度失败:`, error);
          failedThirdPartyCount++;
        } finally {
          endPendingAction(profileActionKey);
        }
      }
    }

    const failedOfficialProfiles =
      state.snapshot?.profiles.filter(
        (profile) => isOfficialOauthProfile(profile) && profile.codexUsage?.error,
      ) ?? [];

    const totalFailed = failedOfficialProfiles.length + failedThirdPartyCount;

    if (totalFailed > 0) {
      let msg = "额度刷新完成。";
      const parts: string[] = [];
      if (failedOfficialProfiles.length > 0) {
        parts.push(`${failedOfficialProfiles.length} 个官方档案失败`);
      }
      if (failedThirdPartyCount > 0) {
        parts.push(`${failedThirdPartyCount} 个第三方档案失败`);
      }
      setFlash("error", `${msg}其中 ${parts.join("，")}。`);
    } else {
      setFlash("success", "已刷新全部档案的 Codex 额度。");
    }
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    endPendingAction(refreshAllUsageActionKey);
  }
}

async function refreshProfileLatencyProbe(profileId: string, profileName: string): Promise<void> {
  const actionKey = latencyProbeActionKey(profileId);
  beginPendingAction(actionKey);
  try {
    setFlash("info", `正在为「${profileName}」执行第三方 API 测速…`);
    if (!isTauriRuntime) {
      const snapshot = state.snapshot;
      if (!snapshot) {
        throw new Error("当前没有可用快照。");
      }
      setSnapshot(snapshot);
    } else {
      const snapshot = await desktopInvoke<AppSnapshot>("refresh_profile_latency_probe", {
        profileId,
      });
      setSnapshot(snapshot);
      const probe = snapshot.profiles.find((profile) => profile.id === profileId)?.thirdPartyLatency;
      if (probe?.error) {
        setFlash("error", `「${profileName}」测速失败：${probe.error}`);
        return;
      }
    }
    setFlash("success", `已完成「${profileName}」第三方 API 测速。`);
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    endPendingAction(actionKey);
  }
}

async function refreshProfileThirdPartyUsage(profileId: string, profileName: string): Promise<void> {
  const actionKey = thirdPartyUsageActionKey(profileId);
  beginPendingAction(actionKey);
  try {
    setFlash("info", `正在刷新「${profileName}」第三方 API 用量…`);
    if (!isTauriRuntime) {
      const snapshot = state.snapshot;
      if (!snapshot) {
        throw new Error("当前没有可用快照。");
      }
      setSnapshot(snapshot);
    } else {
      const snapshot = await desktopInvoke<AppSnapshot>("refresh_profile_third_party_usage", {
        profileId,
      });
      setSnapshot(snapshot);
      const usage = snapshot.profiles.find((profile) => profile.id === profileId)?.thirdPartyUsage;
      if (usage?.error) {
        setFlash("error", `「${profileName}」用量刷新失败：${usage.error}`);
        return;
      }
    }
    setFlash("success", `已刷新「${profileName}」第三方 API 用量。`);
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    endPendingAction(actionKey);
  }
}

async function migrateLegacyThirdPartyProfiles(): Promise<void> {
  const actionKey = migrateLegacyThirdPartyActionKey;
  beginPendingAction(actionKey);
  try {
    if (!isTauriRuntime) {
      setFlash("success", "已迁移 0 个旧第三方 API 配置。");
      return;
    }

    const result = await desktopInvoke<LegacyThirdPartyMigrationResult>(
      "migrate_legacy_third_party_profiles",
    );
    const snapshot = await desktopInvoke<AppSnapshot>("load_snapshot");
    setSnapshot(snapshot);
    const migratedCount = result.migratedProfileIds.length;
    const skippedCount = result.skippedProfileIds.length;
    setFlash(
      "success",
      migratedCount > 0
        ? `已迁移 ${migratedCount} 个旧第三方 API 配置，跳过 ${skippedCount} 个无需迁移的配置。`
        : `没有发现需要迁移的旧第三方 API 配置，已检查 ${skippedCount} 个配置。`,
    );
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    endPendingAction(actionKey);
  }
}

async function writeThirdPartyWebsocketsDefaults(): Promise<void> {
  const actionKey = writeThirdPartyWebsocketsDefaultsActionKey;
  beginPendingAction(actionKey);
  try {
    if (!isTauriRuntime) {
      setFlash("success", "已为 0 个第三方 API 配置写入 supports_websockets = false。");
      return;
    }

    const result = await desktopInvoke<ThirdPartyWebsocketsDefaultResult>(
      "write_third_party_websockets_defaults",
    );
    const snapshot = await desktopInvoke<AppSnapshot>("load_snapshot");
    setSnapshot(snapshot);
    const updatedCount = result.updatedProfileIds.length;
    const skippedCount = result.skippedProfileIds.length;
    setFlash(
      "success",
      updatedCount > 0
        ? `已为 ${updatedCount} 个第三方 API 配置写入 supports_websockets = false，跳过 ${skippedCount} 个无需更新的配置。`
        : `没有发现需要更新的第三方 API 配置，已检查 ${skippedCount} 个配置。`,
    );
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    endPendingAction(actionKey);
  }
}

async function importNetworkProfileToEditor(networkProfileId: string): Promise<void> {
  await importNetworkProfileAsLocal(networkProfileId, { openEditor: false });
}

function renderCardsView(snapshot: AppSnapshot): string {
  const orderedProfiles = [...snapshot.profiles].sort((a, b) => {
    if (a.id === snapshot.activeProfileId) return -1;
    if (b.id === snapshot.activeProfileId) return 1;
    return 0;
  });

  return renderCardsPage({
    snapshot,
    profiles: orderedProfiles,
    layout: state.profileLayout,
    busy: state.busy,
    pendingActions: state.pendingActions,
  });
}

function renderSharingCenterView(snapshot: AppSnapshot): string {
  const authRequired = state.networkAuthRequired || !state.networkSharing.token.trim();
  let sharingTabHtml = "";

  if (state.sharingCenterTab === "own") {
    const shareTargetUsers = selectShareTargetUsers();
    const localShareForm = resolveLocalShareFormState(snapshot.profiles, state.shareDraft);
    if (localShareForm.profileIdToPersist && state.shareDraft.profileId !== localShareForm.profileIdToPersist) {
      state.shareDraft.profileId = localShareForm.profileIdToPersist;
    }

    sharingTabHtml = renderOwnSharingTab({
      profiles: snapshot.profiles,
      authRequired,
      busy: state.busy,
      currentUser: state.networkUser,
      shareDraft: state.shareDraft,
      localShareForm,
      shareUserPickerHtml: renderShareUserPicker({
        users: shareTargetUsers,
        loading: state.shareUsersLoading,
        shareDraft: state.shareDraft,
      }),
      ownedProfilesLoading: state.networkLoading,
      ownedProfiles: selectOwnNetworkProfiles(state),
      editDraft: state.sharedProfileEditDraft,
      editUserPickerHtml: renderSharedProfileEditUserPicker({
        users: shareTargetUsers,
        loading: state.shareUsersLoading,
        editDraft: state.sharedProfileEditDraft,
      }),
    });
  } else {
    sharingTabHtml = renderEnterpriseLibraryTab({
      authRequired,
      loading: state.networkLoading,
      profiles: state.networkProfiles,
      currentUser: state.networkUser,
      activeLibraryTab: state.sharingLibraryTab,
    });
  }

  return renderSharingCenterPage({
    activeTab: state.sharingCenterTab,
    busy: state.busy,
    tabContentHtml: sharingTabHtml,
  });
}

function bindInputValue(selector: string, onInput: (value: string) => void): void {
  document.querySelector<HTMLInputElement>(selector)?.addEventListener("input", (event) => {
    onInput((event.currentTarget as HTMLInputElement).value);
  });
}

function render(): void {
  const previousMain = app.querySelector<HTMLElement>(".app-main-content");
  const previousPageKey = currentRenderedPageKey(app);
  const previousScrollTop = previousMain?.scrollTop ?? 0;
  const previousNestedScrollTops = captureNestedScrollTops(app);
  const snapshot = state.snapshot;

  let content = "";
  if (state.view === "cards" && snapshot) {
    content = renderCardsView(snapshot);
  } else if (state.view === "sharing" && snapshot) {
    content = renderSharingCenterView(snapshot);
  } else if (state.view === "settings") {
    content = renderSettingsPage({
      networkSharing: state.networkSharing,
      defaultNetworkProfilesApi: DEFAULT_NETWORK_PROFILES_API,
      networkPortalUrl: networkPortalBaseUrl(state.networkSharing),
      accountSettingsHtml: renderNetworkAccountSettings({
        hasToken: Boolean(state.networkSharing.token.trim()),
        authRequired: state.networkAuthRequired,
        user: state.networkUser,
      }),
      busy: state.busy,
      migratingLegacyThirdParty: hasPendingAction(
        state.pendingActions,
        migrateLegacyThirdPartyActionKey,
      ),
      writingThirdPartyWebsocketsDefaults: hasPendingAction(
        state.pendingActions,
        writeThirdPartyWebsocketsDefaultsActionKey,
      ),
      pacProxy: state.pacProxy,
      pacProxyLoading: state.pacProxyLoading,
    });
  } else if (state.view === "sessions") {
    content = renderSessionsPage(selectSessionRenderState(state));
  } else if (state.view === "session-cleanup") {
    content = renderSessionCleanupPage({
      sessions: state.sessions,
      nowMs: Date.now(),
      cleanupFilter: state.cleanupFilter,
    });
  } else if (state.view === "usage-stats") {
    content = renderCodexUsageStatsPage({
      loading: state.usageStatsLoading,
      error: state.usageStatsError,
      stats: state.usageStats,
      filter: state.usageStatsFilter,
      activeTab: state.usageStatsActiveTab,
    });
  } else {
    content = renderEditorPage({
      snapshot: state.snapshot,
      editor: state.editor,
      networkProfiles: state.networkProfiles,
      hasNetworkAccessToken: hasNetworkAccessToken(state.networkSharing),
      remoteVersionCheckAttempted: state.editor.remoteProfileId
        ? checkedRemoteVersionProfileIds.has(state.editor.remoteProfileId)
        : false,
      busy: state.busy,
      pendingActions: state.pendingActions,
    });
  }

  const hasPendingUpdate = state.update.lastResult?.hasUpdate ?? false;
  const currentVersionText = state.update.lastResult?.currentVersion ?? state.appVersion ?? "--";
  const updateVersionText = hasPendingUpdate
    ? `v${state.update.lastResult?.latestVersion ?? "--"}`
    : `v${currentVersionText}`;

  app.innerHTML = renderAppShell({
    view: state.view,
    contentHtml: content,
    sidebarLoginStatusHtml: renderSidebarLoginStatus({
      hasToken: Boolean(state.networkSharing.token.trim()),
      authRequired: state.networkAuthRequired,
      userLoading: state.networkUserLoading,
      user: state.networkUser,
    }),
    flash: state.flash,
    busyDialog: state.busyDialog,
    update: {
      checking: state.update.checking,
      hasPendingUpdate,
      currentVersionText,
      updateVersionText,
    },
  });

  bindEvents();
  const requestAnimationFrame = window.requestAnimationFrame?.bind(window);
  restoreMainScrollIfSamePage({
    appRoot: app,
    previousPageKey,
    previousScrollTop,
    currentView: state.view,
    requestAnimationFrame,
  });
  restoreNestedScrollTopsIfSamePage({
    appRoot: app,
    previousPageKey,
    previousScrollTops: previousNestedScrollTops,
    currentView: state.view,
    requestAnimationFrame,
  });
}

function bindEvents(): void {
  const editorNameInput = document.querySelector<HTMLInputElement>("#editor-name");
  editorNameInput?.addEventListener("input", (event) => {
    const val = (event.currentTarget as HTMLInputElement).value;
    state.editor.name = val;
    const readOnly = state.editor.readOnly;
    const existing = state.editor.mode === "existing";
    if (readOnly || existing) {
      const titleEl = document.querySelector(".editor-header h1");
      if (titleEl) {
        titleEl.textContent = val || (readOnly ? "查看网络共享配置" : "查看和编辑 Profile");
      }
    }
  });

  const editorNotesInput = document.querySelector<HTMLTextAreaElement>("#editor-notes");
  editorNotesInput?.addEventListener("input", (event) => {
    state.editor.notes = (event.currentTarget as HTMLTextAreaElement).value;
  });

  const editorAuthInput = document.querySelector<HTMLTextAreaElement>("#editor-auth-json");
  editorAuthInput?.addEventListener("input", (event) => {
    state.editor.authJson = (event.currentTarget as HTMLTextAreaElement).value;
  });

  const editorConfigInput = document.querySelector<HTMLTextAreaElement>("#editor-config-toml");
  editorConfigInput?.addEventListener("input", (event) => {
    state.editor.configToml = (event.currentTarget as HTMLTextAreaElement).value;
  });

  document
    .querySelector<HTMLInputElement>('[data-action="set-usage-start-date"]')
    ?.addEventListener("change", async (event) => {
      state.usageStatsFilter.startDate = (event.currentTarget as HTMLInputElement).value || null;
      await applyUsageStatsFilter();
    });

  document
    .querySelector<HTMLInputElement>('[data-action="set-usage-end-date"]')
    ?.addEventListener("change", async (event) => {
      state.usageStatsFilter.endDate = (event.currentTarget as HTMLInputElement).value || null;
      await applyUsageStatsFilter();
    });

  document
    .querySelector<HTMLSelectElement>('[data-action="set-usage-model"]')
    ?.addEventListener("change", async (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      state.usageStatsFilter.model = value === "all" ? null : value;
      await applyUsageStatsFilter();
    });

  document
    .querySelector<HTMLSelectElement>('[data-action="set-usage-effort"]')
    ?.addEventListener("change", async (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      state.usageStatsFilter.effort = value === "all" ? null : value;
      await applyUsageStatsFilter();
    });

  bindInputValue("#third-party-base-url", (value) => {
    state.editor.thirdParty.baseUrl = value;
  });
  bindInputValue("#third-party-provider", (value) => {
    state.editor.thirdParty.provider = value;
  });
  bindInputValue("#third-party-api-key", (value) => {
    state.editor.thirdParty.apiKey = value;
  });
  bindInputValue("#third-party-model", (value) => {
    state.editor.thirdParty.model = value;
  });
  bindInputValue("#network-profiles-api", (value) => {
    state.networkSharing.profilesApi = value;
  });
  bindInputValue("#network-profile-token", (value) => {
    state.networkSharing.token = value;
    state.networkAuthRequired = !value.trim();
    state.networkUser = null;
  });
  document.querySelectorAll<HTMLInputElement>('input[name="share-visibility"]').forEach((input) => {
    input.addEventListener("change", (event) => {
      state.shareDraft.visibility = (event.currentTarget as HTMLInputElement).value as ShareVisibility;
      normalizeSelectedShareTargets();
      render();
    });
  });
  document.querySelectorAll<HTMLInputElement>(".share-user-checkbox").forEach((input) => {
    input.addEventListener("change", (event) => {
      const checkbox = event.currentTarget as HTMLInputElement;
      const selectedUserIds = new Set(state.shareDraft.selectedUserIds);
      if (checkbox.checked) {
        selectedUserIds.add(checkbox.value);
      } else {
        selectedUserIds.delete(checkbox.value);
      }
      state.shareDraft.selectedUserIds = normalizeShareTargets(Array.from(selectedUserIds));
      render();
    });
  });
  document.querySelectorAll<HTMLInputElement>(".shared-profile-edit-user-checkbox").forEach((input) => {
    input.addEventListener("change", (event) => {
      const draft = state.sharedProfileEditDraft;
      if (!draft) return;
      const checkbox = event.currentTarget as HTMLInputElement;
      const selectedUserIds = new Set(draft.selectedUserIds);
      if (checkbox.checked) {
        selectedUserIds.add(checkbox.value);
      } else {
        selectedUserIds.delete(checkbox.value);
      }
      state.sharedProfileEditDraft = {
        ...draft,
        selectedUserIds: normalizeShareTargets(Array.from(selectedUserIds)),
      };
      render();
    });
  });
  document.querySelectorAll<HTMLInputElement>(".shared-profile-edit-visibility").forEach((input) => {
    input.addEventListener("change", (event) => {
      const draft = state.sharedProfileEditDraft;
      if (!draft) return;
      const visibility = (event.currentTarget as HTMLInputElement).value as ShareVisibility;
      state.sharedProfileEditDraft = {
        ...draft,
        visibility,
        selectedUserIds: visibility === "selected" ? normalizeShareTargets(draft.selectedUserIds) : [],
      };
      render();
    });
  });

  document.querySelectorAll<HTMLInputElement>('input[name="profile-template"]').forEach((input) => {
    input.addEventListener("change", (event) => {
      const value = (event.currentTarget as HTMLInputElement).value as NewProfileTemplate;
      state.editor.thirdParty.template = value;
      if (value === "symbioticThirdParty") {
        state.editor.thirdParty.oauthProfileId = resolveOfficialOauthProfileId(
          state.snapshot,
          state.editor.thirdParty.oauthProfileId,
        );
      }
      render();
    });
  });

  document
    .querySelector<HTMLSelectElement>("#symbiotic-oauth-profile")
    ?.addEventListener("change", (event) => {
      state.editor.thirdParty.oauthProfileId = (event.currentTarget as HTMLSelectElement).value;
    });

  document
    .querySelectorAll<HTMLInputElement>('[data-action="toggle-pac-proxy-service"]')
    .forEach((input) => {
      input.addEventListener("change", async (event) => {
        const checkbox = event.currentTarget as HTMLInputElement;
        const selectedServices = new Set(state.pacProxy.selectedServices);
        if (checkbox.checked) {
          selectedServices.add(checkbox.value);
        } else {
          selectedServices.delete(checkbox.value);
        }

        const normalized = state.pacProxy.availableServices.filter((service) =>
          selectedServices.has(service),
        );
        if (normalized.length === 0) {
          checkbox.checked = true;
          setFlash("error", "请至少选择一个生效网络服务。");
          return;
        }

        await setPacProxySelectedServices(normalized);
      });
    });

  document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.action;

      if (action === "clear-flash") {
        clearFlash();
        render();
        return;
      }

      if (action === "refresh") {

          await refreshSnapshot();

      } else if (action === "nav-profiles") {
        if (state.view !== "cards") {
          state.view = "cards";
          render();
        }
      } else if (action === "nav-sharing") {
        if (state.view !== "sharing") {
          state.view = "sharing";
          render();
        }
        await loadSharingCenterData();
      } else if (action === "nav-settings") {
        if (state.view !== "settings") {
          state.view = "settings";
          render();
        }
      } else if (action === "toggle-pac-proxy") {
        await togglePacProxy();
      } else if (action === "select-pac-proxy-option") {
        const selectedPacKey = button.dataset.pacKey;
        if (selectedPacKey) {
          await setPacProxySelectedOption(selectedPacKey);
        }
      } else if (action === "save-network-sharing-settings") {
        saveNetworkSharingSettings(state.networkSharing);
        state.networkAuthRequired = !state.networkSharing.token.trim();
        state.networkProfiles = [];
        state.sharedProfileEditDraft = null;
        setFlash("success", "已保存企业共享库设置。");
        if (state.networkSharing.token.trim()) {
          await fetchNetworkCurrentUser({ silent: true });
        }
        render();
      } else if (action === "open-network-sso-login") {
        await openNetworkSsoLogin();
      } else if (action === "logout-network-user") {
        logoutNetworkUser();
      } else if (action === "refresh-network-after-settings") {
        saveNetworkSharingSettings(state.networkSharing);
        state.networkAuthRequired = !state.networkSharing.token.trim();
        state.networkProfiles = [];
        state.sharedProfileEditDraft = null;
        state.view = "sharing";
        await loadSharingCenterData();
      } else if (action === "refresh-sharing-center") {
        await loadSharingCenterData();
      } else if (action === "select-share-profile-tab") {
        if (button.dataset.profileId) {
          state.shareDraft.profileId = button.dataset.profileId;
        }
        if (button.dataset.ownedId) {
          beginEditSharedProfile(button.dataset.ownedId);
        } else {
          state.sharedProfileEditDraft = null;
          render();
        }
      } else if (action === "share-local-profile") {
        await shareLocalProfileToNetwork();
      } else if (action === "sharing-tab-own") {
        state.sharingCenterTab = "own";
        render();
        if (!state.networkProfiles.length && state.networkSharing.token.trim()) {
          await loadSharingCenterData();
        }
      } else if (action === "sharing-tab-library") {
        state.sharingCenterTab = "library";
        render();
        if (!state.networkProfiles.length && state.networkSharing.token.trim()) {
          await loadSharingCenterData();
        }
      } else if (action === "sharing-library-tab" && button.dataset.libraryTab) {
        state.sharingLibraryTab = button.dataset.libraryTab as SharingLibraryTab;
        render();
      } else if (action === "edit-shared-profile-users" && button.dataset.id) {
        beginEditSharedProfile(button.dataset.id);
      } else if (action === "cancel-edit-shared-profile") {
        cancelEditSharedProfile();
      } else if (action === "save-shared-profile-users") {
        await saveSharedProfileShareTargets();
      } else if (action === "delete-shared-profile" && button.dataset.id) {
        await deleteSharedProfile(button.dataset.id);
      } else if (action === "nav-sessions") {
        if (state.view !== "sessions") {
          state.view = "sessions";
          render();
          await fetchCodexSessions();
        }
      } else if (action === "nav-usage-stats") {
        if (state.view !== "usage-stats") {
          state.view = "usage-stats";
          render();
        }
        if (!state.usageStats && !state.usageStatsLoading) {
          await loadUsageStats();
        }
      } else if (action === "refresh-usage-stats") {
        await loadUsageStats({ showSuccess: true });
      } else if (action === "set-usage-range" && button.dataset.range) {
        setUsageStatsRange(button.dataset.range);
        await applyUsageStatsFilter();
      } else if (action === "set-usage-tab" && button.dataset.tab) {
        state.usageStatsActiveTab = button.dataset.tab as any;
        render();
      } else if (action === "nav-session-cleanup") {
        if (state.view !== "session-cleanup") {
          state.view = "session-cleanup";
          render();
          await fetchCodexSessions();
        }
      } else if (action === "back-to-sessions") {
        state.view = "sessions";
        render();
        await fetchCodexSessions();
      } else if (action === "tab-local") {
        state.activeTab = "local";
        render();
      } else if (action === "tab-network") {
        state.activeTab = "network";
        if (state.networkProfiles.length === 0) {
          await fetchNetworkProfiles();
        } else {
          render();
        }
      } else if (action === "download-and-apply" && button.dataset.id && button.dataset.name) {
        await downloadAndApplyNetworkProfile(button.dataset.id, button.dataset.name);
      } else if (action === "view-network-profile-details" && button.dataset.id) {
        await openEditorForNetworkProfile(button.dataset.id);
      } else if (action === "enable-codex-usage") {
        await setCodexUsageApiEnabled(true);
      } else if (action === "disable-codex-usage") {
        await setCodexUsageApiEnabled(false);
      } else if (action === "refresh-all-codex-usage") {
        await refreshAllCodexUsage();
      } else if (action === "migrate-legacy-third-party") {
        await migrateLegacyThirdPartyProfiles();
      } else if (action === "write-third-party-websockets-defaults") {
        await writeThirdPartyWebsocketsDefaults();
      } else if (action === "refresh-codex-usage" && button.dataset.id && button.dataset.name) {
        await refreshProfileCodexUsage(button.dataset.id, button.dataset.name);
      } else if (action === "profile-layout-list") {
        state.profileLayout = "list";
        render();
      } else if (action === "profile-layout-grid") {
        state.profileLayout = "grid";
        render();
      } else if (
        action === "refresh-third-party-latency" &&
        button.dataset.id &&
        button.dataset.name
      ) {
        await refreshProfileLatencyProbe(button.dataset.id, button.dataset.name);
      } else if (
        action === "refresh-third-party-usage" &&
        button.dataset.id &&
        button.dataset.name
      ) {
        await refreshProfileThirdPartyUsage(button.dataset.id, button.dataset.name);
      } else if (action === "generate-symbiotic" && button.dataset.id) {
        await generateSymbioticFromExisting(button.dataset.id);
      } else if (action === "new-profile") {
        await openEditorForNewProfile();
      } else if (action === "save-current-account") {
        await openEditorForCurrentAccount();
      } else if (action === "view-profile-details" && button.dataset.id) {
        await openEditorForProfile(button.dataset.id);
      } else if (action === "update-shared-profile-from-cloud" && button.dataset.id) {
        const localProfile = state.snapshot?.profiles.find((profile) => profile.id === button.dataset.id);
        if (localProfile?.remoteProfileId?.trim() && !state.networkProfiles.some((profile) => profile.id === localProfile.remoteProfileId)) {
          const didLoadRemoteProfiles = await fetchNetworkProfiles({ checkActiveProfileUpdate: false });
          if (!didLoadRemoteProfiles) {
            return;
          }
        }
        const replacementTarget = sharedProfileReplacementTarget(localProfile);
        if (replacementTarget) {
          await updateLocalSharedProfileFromCloud(replacementTarget.localProfile, replacementTarget.remoteProfile, {
            restartIfActive: true,
          });
          return;
        }
        const target = sharedProfileUpdateTarget(localProfile);
        if (!target) {
          setFlash("info", "当前配置已经是共享中心最新版。");
          render();
        } else {
          await updateLocalSharedProfileFromCloud(target.localProfile, target.remoteProfile, {
            restartIfActive: true,
          });
        }
      } else if (action === "switch" && button.dataset.id && button.dataset.name) {
        await switchProfile(button.dataset.id, button.dataset.name);
      } else if (action === "delete-profile" && button.dataset.id && button.dataset.name) {
        await deleteProfile(button.dataset.id, button.dataset.name);
      } else if (action === "back-to-cards") {
        state.view = "cards";
        render();
      } else if (action === "editor-tab-delta") {
        state.editor.newTab = "manual-delta";
        render();
      } else if (action === "editor-tab-full") {
        const defaultState = createEditorState();
        const isAuthDefault = state.editor.authJson === defaultState.authJson;
        const isConfigDefault = state.editor.configToml === defaultState.configToml;

        if (isAuthDefault && isConfigDefault) {
          const hasDeltaInput = state.editor.thirdParty.baseUrl.trim() || state.editor.thirdParty.apiKey.trim();
          if (hasDeltaInput) {
            try {
              let generated;
              if (state.editor.thirdParty.template === "symbioticThirdParty") {
                generated = await symbioticThirdPartyConfigInputFromDraft(state.editor, false);
              } else {
                generated = standaloneThirdPartyConfigInputFromDraft(state.editor, false);
              }
              state.editor.authJson = generated.authJson;
              state.editor.configToml = generated.configToml;
            } catch (e) {
              // Ignore generation errors during tab switching
            }
          }
        }
        state.editor.newTab = "manual-full";
        render();
      } else if (action === "editor-detail-overview") {
        state.editor.detailTab = "overview";
        render();
      } else if (action === "editor-detail-config") {
        state.editor.detailTab = "config";
        render();
      } else if (action === "refresh-network-in-editor") {
        if (!state.networkSharing.token.trim()) {
          state.networkAuthRequired = true;
          render();
        } else {
          const remoteProfileId = state.editor.remoteProfileId?.trim();
          const didLoadRemoteProfiles = await fetchNetworkProfiles({ checkActiveProfileUpdate: false });
          if (remoteProfileId && didLoadRemoteProfiles) {
            checkedRemoteVersionProfileIds.add(remoteProfileId);
          }
        }
      } else if (action === "import-network-profile-to-editor" && button.dataset.id) {
        await importNetworkProfileToEditor(button.dataset.id);
      } else if (action === "import-current-network-profile") {
        await importCurrentNetworkProfileFromEditor();
      } else if (action === "save-editor") {
        await saveEditorProfile(false);
      } else if (action === "save-and-switch") {
        await saveEditorProfile(true);
      } else if (action === "check-update") {
        await checkForUpdate();
      } else if (action === "restart-codex") {
        state.busy = true; render();
        try {
          await desktopInvoke("restart_codex");
          setFlash("success", "Codex 程序已被拉起重启指令！");
        } catch (error) {
          console.error("重启 Codex 失败", error);
          setFlash("error", `重启 Codex 失败：${formatErrorMessage(error)}`);
        } finally {
          state.busy = false; render();
        }
      }
    });
  });

  bindSessionPageEvents();

  bindSessionCleanupEvents();
}

registerRender(render);
render();
if (state.networkSharing.token.trim()) {
  void fetchNetworkCurrentUser({ silent: true });
}
void loadAppVersion();
void refreshSnapshot();
void loadPacProxyStatus({ silent: true });
startPacProxyStatusListener();
startSharedAuthAutoSync();
startAutoUpdateChecker();
