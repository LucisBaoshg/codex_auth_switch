import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import {
  renderAppShell,
} from "./app-chrome-renderers";
import { nativeConfirm } from "./app-chrome-dialogs";
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
  currentRenderedPageKey,
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
import { exportCodexSessionToMarkdown } from "./session-export";
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
  CodexUsageStatsFilter,
  CodexUsageStatsSnapshot,
  InstallLocationStatus,
  LegacyThirdPartyMigrationResult,
  ProfileDocument,
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
import { renderSessionCleanupPage, type CleanupFilter } from "./session-cleanup-renderers";
import { renderCodexUsageStatsPage } from "./usage-stats-renderers";
import {
  renderEnterpriseLibraryTab,
  renderOwnSharingTab,
  renderSharingCenterPage,
  renderSharedProfileEditUserPicker,
  renderShareUserPicker,
} from "./sharing-center-renderers";
import {
  createSharedProfileEditDraft,
  resolveLocalShareFormState,
} from "./sharing-center-state";
import {
  applySnapshotToDesktopState,
  createDesktopState,
  selectOwnNetworkProfiles,
  selectSessionRenderState,
} from "./desktop-state";
import "./styles.css";

const desktopLoginPollIntervalMs =
  typeof process !== "undefined" && process.env.NODE_ENV === "test" ? 10 : 2000;

const isTauriRuntime = "__TAURI_INTERNALS__" in window;
const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("App root was not found.");
}

const app = appRoot;

function networkUnauthorizedError(actionLabel: string): Error {
  if (!hasNetworkAccessToken(state.networkSharing)) {
    state.networkAuthRequired = true;
    return new Error("请先使用钉钉 SSO 登录企业共享中心。");
  }

  state.networkAuthRequired = false;
  return new Error(`${actionLabel}未通过服务端权限校验，已保留当前登录状态。请刷新共享中心或重新登录后再试。`);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const state = createDesktopState(loadNetworkSharingSettings());

let flashTimeoutId: number | null = null;

function setFlash(kind: FlashKind, text: string): void {
  state.flash = { kind, text };
  render();

  if (flashTimeoutId !== null) {
    window.clearTimeout(flashTimeoutId);
  }
  flashTimeoutId = window.setTimeout(() => {
    state.flash = null;
    flashTimeoutId = null;
    render();
  }, 4000);
}

function clearFlash(): void {
  state.flash = null;
  if (flashTimeoutId !== null) {
    window.clearTimeout(flashTimeoutId);
    flashTimeoutId = null;
  }
}

function setBusy(nextBusy: boolean): void {
  state.busy = nextBusy;
  render();
}

function beginPendingAction(key: string): void {
  state.pendingActions.add(key);
  render();
}

function endPendingAction(key: string): void {
  state.pendingActions.delete(key);
  render();
}

function setSnapshot(snapshot: AppSnapshot): void {
  applySnapshotToDesktopState(state, snapshot);
  render();
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

async function desktopInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauriRuntime) {
    throw new Error("当前是浏览器预览模式。请使用 `npm run tauri dev` 启动桌面端。");
  }

  return invoke<T>(command, args);
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
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    render();
  }
}

function createPreviewCodexUsageStats(): CodexUsageStatsSnapshot {
  const updatedAt = new Date().toISOString();
  return {
    updatedAt,
    filter: state.usageStatsFilter,
    sync: {
      imported: 3,
      skipped: 2,
      filesScanned: 4,
      errors: [],
    },
    summary: {
      totalRequests: 18,
      totalCostUsd: "0.387250",
      totalInputTokens: 48230,
      totalOutputTokens: 12680,
      totalCacheReadTokens: 39200,
      totalCacheCreationTokens: 0,
      totalReasoningOutputTokens: 5860,
      realTotalTokens: 100110,
      cacheHitRate: 39200 / (48230 + 39200),
    },
    trends: [
      {
        date: "2026-06-06",
        requestCount: 5,
        totalCostUsd: "0.082100",
        totalInputTokens: 12600,
        totalOutputTokens: 2800,
        totalCacheReadTokens: 9200,
        totalCacheCreationTokens: 0,
        totalReasoningOutputTokens: 920,
        realTotalTokens: 24600,
      },
      {
        date: "2026-06-07",
        requestCount: 7,
        totalCostUsd: "0.163900",
        totalInputTokens: 18600,
        totalOutputTokens: 5200,
        totalCacheReadTokens: 15400,
        totalCacheCreationTokens: 0,
        totalReasoningOutputTokens: 2380,
        realTotalTokens: 39200,
      },
      {
        date: "2026-06-08",
        requestCount: 6,
        totalCostUsd: "0.141250",
        totalInputTokens: 17030,
        totalOutputTokens: 4680,
        totalCacheReadTokens: 14600,
        totalCacheCreationTokens: 0,
        totalReasoningOutputTokens: 2560,
        realTotalTokens: 36310,
      },
    ],
    modelBreakdown: [
      {
        name: "gpt-5.4",
        requestCount: 12,
        totalCostUsd: "0.301300",
        totalInputTokens: 34200,
        totalOutputTokens: 9820,
        totalCacheReadTokens: 28800,
        totalCacheCreationTokens: 0,
        totalReasoningOutputTokens: 4720,
        realTotalTokens: 72820,
      },
      {
        name: "gpt-5.4-mini",
        requestCount: 6,
        totalCostUsd: "0.085950",
        totalInputTokens: 14030,
        totalOutputTokens: 2860,
        totalCacheReadTokens: 10400,
        totalCacheCreationTokens: 0,
        totalReasoningOutputTokens: 1140,
        realTotalTokens: 27290,
      },
    ],
    effortBreakdown: [
      {
        name: "high",
        requestCount: 9,
        totalCostUsd: "0.268400",
        totalInputTokens: 27600,
        totalOutputTokens: 8360,
        totalCacheReadTokens: 21400,
        totalCacheCreationTokens: 0,
        totalReasoningOutputTokens: 4620,
        realTotalTokens: 57360,
      },
      {
        name: "medium",
        requestCount: 9,
        totalCostUsd: "0.118850",
        totalInputTokens: 20630,
        totalOutputTokens: 4320,
        totalCacheReadTokens: 17800,
        totalCacheCreationTokens: 0,
        totalReasoningOutputTokens: 1240,
        realTotalTokens: 42750,
      },
    ],
    availableModels: ["gpt-5.4", "gpt-5.4-mini"],
    availableEfforts: ["high", "medium"],
    logs: [
      {
        requestId: "codex_session:preview-a:3",
        sessionId: "preview-a",
        model: "gpt-5.4",
        provider: "openai",
        effort: "high",
        createdAt: updatedAt,
        inputTokens: 2250,
        outputTokens: 760,
        cacheReadTokens: 1800,
        cacheCreationTokens: 0,
        reasoningOutputTokens: 420,
        totalCostUsd: "0.017475",
        sourcePath: "/Users/example/.codex/sessions/2026/06/08/rollout-preview-a.jsonl",
      },
      {
        requestId: "codex_session:preview-b:2",
        sessionId: "preview-b",
        model: "gpt-5.4-mini",
        provider: "openai",
        effort: "medium",
        createdAt: "2026-06-08T08:12:00Z",
        inputTokens: 1680,
        outputTokens: 520,
        cacheReadTokens: 980,
        cacheCreationTokens: 0,
        reasoningOutputTokens: 180,
        totalCostUsd: "0.004335",
        sourcePath: "/Users/example/.codex/sessions/2026/06/08/rollout-preview-b.jsonl",
      },
    ],
  };
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

async function fetchNetworkProfiles(): Promise<void> {
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
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.networkLoading = false;
    render();
  }
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
  if (!window.confirm(`确定删除「${profile.name}」吗？删除后其他人将无法再导入这套共享配置。`)) {
    return;
  }

  setBusy(true);
  try {
    const headers = networkAuthHeaders(state.networkSharing);
    const response = await fetch(`${networkProfilesApiUrl(state.networkSharing)}/${profile.id}`, {
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

async function openNetworkSsoLogin(): Promise<void> {
  saveNetworkSharingSettings(state.networkSharing);
  try {
    const sessionResponse = await fetch(networkDesktopLoginApiUrl(state.networkSharing), {
      method: "POST",
      cache: "no-store",
    });
    if (!sessionResponse.ok) {
      throw new Error("创建桌面登录会话失败。");
    }
    const session = (await sessionResponse.json()) as {
      id: string;
      pollToken: string;
    };
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
    const response = await fetch(pollUrl.toString(), { cache: "no-store" });
    if (response.status === 202) continue;
    if (!response.ok) {
      throw new Error("桌面登录状态检查失败。");
    }

    const result = (await response.json()) as { token?: string };
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
    updatedAt: profileData.createdAt,
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
  const importedProfile = snapshot.profiles[0] ?? null;
  state.selectedProfileId = importedProfile?.id ?? null;
  setSnapshot(snapshot);

  if (options.openEditor && importedProfile) {
    applyEditorDocument({
      ...document,
      id: importedProfile.id,
      name: importedProfile.name,
      notes: importedProfile.notes,
      authTypeLabel: importedProfile.authTypeLabel,
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
  if (state.shareDraft.visibility === "selected" && normalizedSelectedUserIds.length === 0) {
    setFlash("error", "请选择至少一位共享对象，或切换为全部员工可见。");
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
    const formData = new FormData();
    formData.append("name", document.name);
    formData.append("description", document.notes || "");
    formData.append("visibility", state.shareDraft.visibility);
    formData.append(
      "sharedWith",
      JSON.stringify(state.shareDraft.visibility === "selected" ? normalizedSelectedUserIds : []),
    );
    formData.append("file1", new File([document.authJson], "auth.json", { type: "application/json" }));
    formData.append("file2", new File([document.configToml], "config.toml", { type: "text/plain" }));

    const headers = networkAuthHeaders(state.networkSharing);
    const response = await fetch(networkProfilesApiUrl(state.networkSharing), {
      method: "POST",
      cache: "no-store",
      ...(headers ? { headers } : {}),
      body: formData,
    });

    if (response.status === 401) {
      throw networkUnauthorizedError("共享配置");
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || "共享配置失败");
    }

    setFlash("success", `已共享「${document.name}」到企业共享中心。`);
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
  restoreMainScrollIfSamePage({
    appRoot: app,
    previousPageKey,
    previousScrollTop,
    currentView: state.view,
    requestAnimationFrame: window.requestAnimationFrame?.bind(window),
  });
}

function refreshSessionsListView(): void {
  const listScroll = document.querySelector(".sessions-list-scroll");
  if (listScroll) {
    listScroll.innerHTML = renderSessionsListHtml(selectSessionRenderState(state));
  }
}

function refreshSessionDetailPane(): void {
  const detailPane = document.querySelector(".sessions-detail-pane");
  if (detailPane) {
    detailPane.innerHTML = renderSessionDetailHtml(selectSessionRenderState(state));
  }
}

async function fetchCodexSessions(): Promise<void> {
  if (!isTauriRuntime) {
    state.sessions = createPreviewCodexSessions(Date.now());
    state.selectedSessionId = null;
    state.sessionMessages = [];
    render();
    return;
  }

  // Only show the list-wide loading spinner on initial load (when list is empty)
  // to prevent UI layout flash when navigating between active views
  const isFirstLoad = state.sessions.length === 0;
  if (isFirstLoad) {
    state.sessionsLoading = true;
    refreshSessionsListView();
  }
  try {
    const list = await desktopInvoke<CodexSessionInfo[]>("list_codex_sessions");
    state.sessions = list;

    // Preserve the active session selection if it remains in the new list
    if (state.selectedSessionId) {
      const exists = list.some(s => s.id === state.selectedSessionId);
      if (!exists) {
        state.selectedSessionId = null;
        state.sessionMessages = [];
      }
    }
  } catch (error) {
    setFlash("error", `获取会话失败: ${formatErrorMessage(error)}`);
  } finally {
    state.sessionsLoading = false;
    refreshSessionsListView();
    refreshSessionDetailPane();
  }
}

async function fetchCodexSessionMessages(threadId: string): Promise<void> {
  if (!isTauriRuntime) {
    state.selectedSessionId = threadId;
    state.sessionMessages = createPreviewCodexSessionMessages();
    state.showAllMessages = false;
    refreshSessionDetailPane();
    return;
  }

  state.messagesLoading = true;
  state.showAllMessages = false;
  refreshSessionDetailPane();
  try {
    const messages = await desktopInvoke<CodexMessage[]>("get_codex_session_messages", { threadId });
    state.selectedSessionId = threadId;
    state.sessionMessages = messages;
  } catch (error) {
    setFlash("error", `获取会话消息失败: ${formatErrorMessage(error)}`);
  } finally {
    state.messagesLoading = false;
    refreshSessionDetailPane();
  }
}

async function renameCodexSession(threadId: string, title: string): Promise<void> {
  if (!isTauriRuntime) {
    const session = state.sessions.find(s => s.id === threadId);
    if (session) session.title = title;
    setFlash("success", "会话重命名成功");
    refreshSessionsListView();
    refreshSessionDetailPane();
    return;
  }

  setBusy(true);
  try {
    await desktopInvoke("rename_codex_session", { threadId, newTitle: title });
    const session = state.sessions.find(s => s.id === threadId);
    if (session) session.title = title;
    setFlash("success", "会话重命名成功");
  } catch (error) {
    setFlash("error", `重命名失败: ${formatErrorMessage(error)}`);
  } finally {
    setBusy(false);
    refreshSessionsListView();
    refreshSessionDetailPane();
  }
}

async function archiveCodexSession(threadId: string, archive: boolean): Promise<void> {
  if (!isTauriRuntime) {
    const session = state.sessions.find(s => s.id === threadId);
    if (session) {
      session.archived = archive;
      session.rolloutPath = archive
        ? "/Users/example/.codex/archived_sessions/rollout-mock.jsonl"
        : "/Users/example/.codex/sessions/2026/05/21/rollout-mock.jsonl";
    }
    setFlash("success", archive ? "会话归档成功" : "会话已取消归档");
    refreshSessionsListView();
    refreshSessionDetailPane();
    return;
  }

  setBusy(true);
  try {
    await desktopInvoke("archive_codex_session", { threadId, archive });
    const list = await desktopInvoke<CodexSessionInfo[]>("list_codex_sessions");
    state.sessions = list;
    const session = list.find(s => s.id === threadId);
    if (session) {
      const messages = await desktopInvoke<CodexMessage[]>("get_codex_session_messages", { threadId });
      state.sessionMessages = messages;
    } else {
      state.selectedSessionId = null;
      state.sessionMessages = [];
    }
    setFlash("success", archive ? "会话归档成功" : "会话已取消归档");
  } catch (error) {
    setFlash("error", `归档操作失败: ${formatErrorMessage(error)}`);
  } finally {
    setBusy(false);
    refreshSessionsListView();
    refreshSessionDetailPane();
  }
}

async function deleteCodexSession(threadId: string): Promise<void> {
  const confirmed = await nativeConfirm("您确定要物理删除该会话及其对话文件吗？此操作无法撤销，物理文件将被彻底删除以释放磁盘空间！", "确认物理删除", true);
  if (!confirmed) return;

  if (!isTauriRuntime) {
    state.sessions = state.sessions.filter(s => s.id !== threadId);
    if (state.selectedSessionId === threadId) {
      state.selectedSessionId = null;
      state.sessionMessages = [];
    }
    setFlash("success", "会话已物理删除");
    refreshSessionsListView();
    refreshSessionDetailPane();
    return;
  }

  setBusy(true);
  try {
    await desktopInvoke("delete_codex_session", { threadId });
    state.sessions = state.sessions.filter(s => s.id !== threadId);
    if (state.selectedSessionId === threadId) {
      state.selectedSessionId = null;
      state.sessionMessages = [];
    }
    setFlash("success", "会话及文件已物理删除");
  } catch (error) {
    setFlash("error", `删除会话失败: ${formatErrorMessage(error)}`);
  } finally {
    setBusy(false);
    refreshSessionsListView();
    refreshSessionDetailPane();
  }
}

async function deleteProjectSessions(cwd: string, sessionIds: string[]): Promise<void> {
  const confirmed = await nativeConfirm(
    `您确定要物理清空项目 "${cwd}" 的所有会话文件吗？共包含 ${sessionIds.length} 个会话。此操作无法撤销！`,
    "确认清空项目会话",
    true
  );
  if (!confirmed) return;

  if (!isTauriRuntime) {
    state.sessions = state.sessions.filter(s => !sessionIds.includes(s.id));
    setFlash("success", "已成功清理该项目的所有会话");
    render();
    return;
  }

  setBusy(true);
  try {
    for (const id of sessionIds) {
      await desktopInvoke("delete_codex_session", { threadId: id });
    }
    state.sessions = state.sessions.filter(s => !sessionIds.includes(s.id));
    setFlash("success", "已成功物理清理该项目的所有会话文件");
  } catch (error) {
    setFlash("error", `清理项目会话失败: ${formatErrorMessage(error)}`);
  } finally {
    setBusy(false);
    render();
  }
}

async function batchDeleteSessions(sessionIds: string[]): Promise<void> {
  const confirmed = await nativeConfirm(
    `您确定要批量物理删除选中的 ${sessionIds.length} 个会话及其文件吗？此操作无法撤销！`,
    "确认批量删除",
    true
  );
  if (!confirmed) return;

  if (!isTauriRuntime) {
    state.sessions = state.sessions.filter(s => !sessionIds.includes(s.id));
    setFlash("success", "已成功删除选中的会话");
    render();
    return;
  }

  setBusy(true);
  try {
    for (const id of sessionIds) {
      await desktopInvoke("delete_codex_session", { threadId: id });
    }
    state.sessions = state.sessions.filter(s => !sessionIds.includes(s.id));
    setFlash("success", "已成功批量物理删除选中的会话文件");
  } catch (error) {
    setFlash("error", `批量删除会话失败: ${formatErrorMessage(error)}`);
  } finally {
    setBusy(false);
    render();
  }
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
      } else if (action === "view-profile-details" && button.dataset.id) {
        await openEditorForProfile(button.dataset.id);
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
      } else if (action === "refresh-network-in-editor") {
        if (!state.networkSharing.token.trim()) {
          state.networkAuthRequired = true;
          render();
        } else {
          await fetchNetworkProfiles();
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

  // --- Codex Session Management Event Listeners (Delegated) ---
  const sessionsContainer = document.querySelector<HTMLDivElement>(".sessions-page-container");
  if (sessionsContainer) {
    // 1. Session list and action delegation
    sessionsContainer.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement;

      // Load all messages
      const loadAllBtn = target.closest<HTMLButtonElement>("[data-action=\"load-all-messages\"]");
      if (loadAllBtn) {
        state.showAllMessages = true;
        refreshSessionDetailPane();
        return;
      }

      // Toggle message collapse
      const toggleCollapseBtn = target.closest<HTMLButtonElement>("[data-action=\"toggle-message-collapse\"]");
      if (toggleCollapseBtn) {
        const collapsible = toggleCollapseBtn.closest(".collapsible-message") as HTMLDivElement;
        if (collapsible) {
          const preview = collapsible.querySelector(".collapsible-preview") as HTMLDivElement;
          const full = collapsible.querySelector(".collapsible-full") as HTMLDivElement;
          const isCollapsed = collapsible.dataset.collapsed === "true";
          if (isCollapsed) {
            collapsible.dataset.collapsed = "false";
            preview.style.display = "none";
            full.style.display = "block";
            toggleCollapseBtn.innerHTML = "收起 ▴";
          } else {
            collapsible.dataset.collapsed = "true";
            preview.style.display = "block";
            full.style.display = "none";
            const length = collapsible.dataset.length || "";
            toggleCollapseBtn.innerHTML = `展开全部 (${length} 字) ▾`;
          }
        }
        return;
      }

      // Card selection
      const card = target.closest<HTMLDivElement>(".session-item-card");
      if (card) {
        const id = card.dataset.id;
        if (id) {
          sessionsContainer.querySelectorAll(".session-item-card").forEach(c => c.classList.remove("selected"));
          card.classList.add("selected");
          await fetchCodexSessionMessages(id);
        }
        return;
      }

      // Filter tabs
      const tab = target.closest<HTMLButtonElement>(".filter-tab");
      if (tab) {
        const filter = tab.dataset.filter;
        if (filter === "all" || filter === "active" || filter === "archived") {
          state.sessionFilter = filter;
          sessionsContainer.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
          tab.classList.add("active");
          refreshSessionsListView();
        }
        return;
      }

      // Sort button
      const sortBtn = target.closest<HTMLButtonElement>(".sort-btn");
      if (sortBtn) {
        const sort = sortBtn.dataset.sort;
        if (sort === "time" || sort === "cwd") {
          state.sessionSortOrder = sort;
          sessionsContainer.querySelectorAll(".sort-btn").forEach(b => b.classList.remove("active"));
          sortBtn.classList.add("active");
          refreshSessionsListView();
        }
        return;
      }

      // Search clear button
      const clearBtn = target.closest<HTMLButtonElement>("#session-search-clear");
      if (clearBtn) {
        state.sessionSearchQuery = "";
        const searchInput = sessionsContainer.querySelector<HTMLInputElement>("#session-search");
        if (searchInput) {
          searchInput.value = "";
          searchInput.focus();
        }
        const clearContainer = sessionsContainer.querySelector("#search-clear-container");
        if (clearContainer) {
          clearContainer.innerHTML = "";
        }
        refreshSessionsListView();
        return;
      }

      // Rename session button
      const renameBtn = target.closest<HTMLButtonElement>('[data-action="rename-session"]');
      if (renameBtn) {
        const threadId = renameBtn.dataset.id;
        if (threadId) {
          const currentSession = state.sessions.find(s => s.id === threadId);
          const oldTitle = currentSession?.title || "";
          const newTitle = prompt("请输入会话的新标题:", oldTitle);
          if (newTitle !== null) {
            const trimmed = newTitle.trim();
            if (trimmed) {
              await renameCodexSession(threadId, trimmed);
            }
          }
        }
        return;
      }

      // Archive session button
      const archiveBtn = target.closest<HTMLButtonElement>('[data-action="toggle-archive-session"]');
      if (archiveBtn) {
        const threadId = archiveBtn.dataset.id;
        const isArchived = archiveBtn.dataset.archived === "true";
        if (threadId) {
          await archiveCodexSession(threadId, !isArchived);
        }
        return;
      }

      // Export session button
      const exportBtn = target.closest<HTMLButtonElement>('[data-action="export-session"]');
      if (exportBtn) {
        const threadId = exportBtn.dataset.id;
        if (threadId) {
          const session = state.sessions.find(s => s.id === threadId);
          if (session) {
            exportCodexSessionToMarkdown(session, state.sessionMessages);
          }
        }
        return;
      }

      // Delete session button
      const deleteBtn = target.closest<HTMLButtonElement>('[data-action="delete-session"]');
      if (deleteBtn) {
        const threadId = deleteBtn.dataset.id;
        if (threadId) {
          await deleteCodexSession(threadId);
        }
        return;
      }
    });

    // 2. Search Input events
    const searchInput = sessionsContainer.querySelector<HTMLInputElement>("#session-search");
    searchInput?.addEventListener("input", (event) => {
      const val = (event.currentTarget as HTMLInputElement).value;
      state.sessionSearchQuery = val;
      const clearContainer = sessionsContainer.querySelector("#search-clear-container");
      if (clearContainer) {
        clearContainer.innerHTML = val ? `<button class="search-clear-btn" id="session-search-clear">×</button>` : "";
      }
      refreshSessionsListView();
    });
  }

  // --- Session Cleanup Page Event Listeners ---
  document.querySelectorAll<HTMLButtonElement>('[data-action="set-cleanup-filter"]').forEach(btn => {
    btn.addEventListener("click", () => {
      const filter = btn.dataset.filter as CleanupFilter;
      if (filter && state.cleanupFilter !== filter) {
        state.cleanupFilter = filter;
        render();
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-clean-project").forEach(btn => {
    btn.addEventListener("click", async () => {
      const cwd = btn.dataset.cwd;
      const idsJson = btn.dataset.ids;
      if (cwd && idsJson) {
        try {
          const ids = JSON.parse(idsJson) as string[];
          await deleteProjectSessions(cwd, ids);
        } catch (e) {
          console.error("Failed to parse session IDs for project cleanup", e);
        }
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-clean-single-session").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (id) {
        await batchDeleteSessions([id]);
      }
    });
  });

  const selectAllCheckbox = document.querySelector<HTMLInputElement>("#cleanup-select-all");
  const itemCheckboxes = document.querySelectorAll<HTMLInputElement>(".cleanup-item-checkbox");

  function updateBatchDeleteButtonState() {
    const checkedCheckboxes = document.querySelectorAll<HTMLInputElement>(".cleanup-item-checkbox:checked");
    const batchBtn = document.querySelector<HTMLButtonElement>("#cleanup-batch-delete-btn");
    const countSpan = document.querySelector<HTMLSpanElement>("#cleanup-selected-count");

    if (countSpan) {
      countSpan.textContent = checkedCheckboxes.length.toString();
    }
    if (batchBtn) {
      batchBtn.disabled = checkedCheckboxes.length === 0;
    }
  }

  selectAllCheckbox?.addEventListener("change", (event) => {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    itemCheckboxes.forEach(cb => {
      cb.checked = checked;
    });
    updateBatchDeleteButtonState();
  });

  itemCheckboxes.forEach(cb => {
    cb.addEventListener("change", () => {
      const allChecked = Array.from(itemCheckboxes).every(c => c.checked);
      const someChecked = Array.from(itemCheckboxes).some(c => c.checked);
      if (selectAllCheckbox) {
        selectAllCheckbox.checked = allChecked;
        selectAllCheckbox.indeterminate = someChecked && !allChecked;
      }
      updateBatchDeleteButtonState();
    });
  });

  const batchDeleteBtn = document.querySelector<HTMLButtonElement>("#cleanup-batch-delete-btn");
  batchDeleteBtn?.addEventListener("click", async () => {
    const checkedCheckboxes = document.querySelectorAll<HTMLInputElement>(".cleanup-item-checkbox:checked");
    const ids = Array.from(checkedCheckboxes).map(cb => cb.dataset.id).filter(Boolean) as string[];
    if (ids.length > 0) {
      await batchDeleteSessions(ids);
    }
  });
}

render();
if (state.networkSharing.token.trim()) {
  void fetchNetworkCurrentUser({ silent: true });
}
void loadAppVersion();
void refreshSnapshot();
startAutoUpdateChecker();
