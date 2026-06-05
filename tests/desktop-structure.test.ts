import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");

function readProjectFile(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

test("moves repeated session formatting helpers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const sessionUtilsTs = readProjectFile("src/session-utils.ts");

  expect(existsSync(join(root, "src/session-utils.ts"))).toBe(true);
  expect(mainTs).toContain('from "./session-utils"');
  expect(mainTs).not.toContain("const formatSize =");
  expect(mainTs).not.toMatch(/^type CodexSessionInfo/m);
  expect(mainTs).not.toMatch(/^type CodexMessage/m);
  expect(mainTs).not.toContain("# Codex Session:");
  expect(mainTs).not.toContain("### 👤");
  expect(sessionUtilsTs).toContain("export type CodexSessionInfo");
  expect(sessionUtilsTs).toContain("export type CodexMessage");
  expect(sessionUtilsTs).toContain("export function buildCodexSessionMarkdown");
});

test("moves session markdown export DOM helper out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const sessionExportPath = join(root, "src/session-export.ts");
  const hasSessionExport = existsSync(sessionExportPath);

  expect(hasSessionExport).toBe(true);
  if (!hasSessionExport) {
    return;
  }

  const sessionExportTs = readProjectFile("src/session-export.ts");
  expect(mainTs).toContain('from "./session-export"');
  expect(mainTs).not.toContain("function exportCodexSessionToMarkdown");
  expect(mainTs).not.toContain("new Blob([md]");
  expect(mainTs).not.toContain("URL.createObjectURL");
  expect(mainTs).not.toContain('document.createElement("a")');
  expect(sessionExportTs).toContain("export function exportCodexSessionToMarkdown");
});

test("moves network sharing URL and storage helpers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");

  expect(existsSync(join(root, "src/network-sharing.ts"))).toBe(true);
  expect(mainTs).toContain('from "./network-sharing"');
  expect(mainTs).not.toContain("function normalizeNetworkProfilesApiUrl");
  expect(mainTs).not.toContain("const networkProfilesApiStorageKey");
});

test("moves network profile display helpers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");

  expect(existsSync(join(root, "src/network-profile-utils.ts"))).toBe(true);
  expect(mainTs).toContain('from "./network-profile-utils"');
  expect(mainTs).not.toContain("function networkProfileVisibility");
  expect(mainTs).not.toContain("function sharingScopeLabel");
  expect(mainTs).not.toContain("function shareUserInitial");
  expect(mainTs).not.toContain("function networkUserDisplayName");
});

test("moves usage and quota formatting helpers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");

  expect(existsSync(join(root, "src/usage-formatters.ts"))).toBe(true);
  expect(mainTs).toContain('from "./usage-formatters"');
  expect(mainTs).not.toContain("function formatLatencyDuration");
  expect(mainTs).not.toContain("function quotaPercent");
  expect(mainTs).not.toContain("function profileTypeLabel");
});

test("moves session recovery summary helpers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");

  expect(existsSync(join(root, "src/session-recovery-utils.ts"))).toBe(true);
  expect(mainTs).toContain('from "./session-recovery-utils"');
  expect(mainTs).not.toContain("function totalSafeRepairCandidates");
  expect(mainTs).not.toContain("function formatSessionRecoveryFlash");
  expect(mainTs).not.toContain("function formatSessionRepairFlash");
});

test("moves browser preview session fixtures out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const previewDataPath = join(root, "src/session-preview-data.ts");

  expect(existsSync(previewDataPath)).toBe(true);
  if (!existsSync(previewDataPath)) {
    return;
  }

  const previewDataTs = readProjectFile("src/session-preview-data.ts");
  expect(mainTs).toContain('from "./session-preview-data"');
  expect(mainTs).not.toContain("新增会话管理功能讨论");
  expect(mainTs).not.toContain("rollout-1.jsonl");
  expect(mainTs).not.toContain("我想给 app新增一个功能");
  expect(previewDataTs).toContain("export function createPreviewCodexSessions");
  expect(previewDataTs).toContain("export function createPreviewCodexSessionMessages");
});

test("moves browser preview app snapshot out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const previewDataPath = join(root, "src/app-preview-data.ts");
  const hasPreviewData = existsSync(previewDataPath);

  expect(hasPreviewData).toBe(true);
  if (!hasPreviewData) {
    return;
  }

  const previewDataTs = readProjectFile("src/app-preview-data.ts");
  expect(mainTs).toContain('from "./app-preview-data"');
  expect(mainTs).not.toContain("const mockSnapshot");
  expect(mainTs).not.toContain("Work Team");
  expect(mainTs).not.toContain("淘宝 1");
  expect(previewDataTs).toContain("export function createPreviewAppSnapshot");
});

test("moves profile input builder helpers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");

  expect(existsSync(join(root, "src/profile-input-builders.ts"))).toBe(true);
  expect(mainTs).toContain('from "./profile-input-builders"');
  expect(mainTs).not.toContain("function escapeTomlString");
  expect(mainTs).not.toContain("function standaloneThirdPartyConfigInputFromDraft");
  expect(mainTs).not.toContain("function symbioticAuthJsonFromOfficial");
  expect(mainTs).not.toContain("function networkDocumentToProfileInput");
});

test("moves HTML and message text helpers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");

  expect(existsSync(join(root, "src/html-utils.ts"))).toBe(true);
  expect(mainTs).toContain('from "./html-utils"');
  expect(mainTs).not.toContain("function escapeHtml");
  expect(mainTs).not.toContain("function getFlashIcon");
  expect(mainTs).not.toContain("function formatMessageText");
});

test("keeps single-file error formatting helper in the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");

  expect(existsSync(join(root, "src/error-utils.ts"))).toBe(false);
  expect(mainTs).not.toContain('from "./error-utils"');
  expect(mainTs).toContain("function formatErrorMessage");
});

test("moves app chrome renderers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const appChromeRenderersTs = readProjectFile("src/app-chrome-renderers.ts");

  expect(existsSync(join(root, "src/app-chrome-renderers.ts"))).toBe(true);
  expect(mainTs).toContain('from "./app-chrome-renderers"');
  expect(mainTs).not.toContain("function renderFlash");
  expect(mainTs).not.toContain("function renderBusyDialog");
  expect(mainTs).not.toContain('class="app-layout"');
  expect(mainTs).not.toContain('class="app-sidebar"');
  expect(mainTs).not.toContain('class="sidebar-nav"');
  expect(mainTs).not.toContain('data-role="update-entry"');
  expect(mainTs).not.toContain("Codex 助手");
  expect(mainTs).not.toContain("@keyframes zoomIn");
  expect(mainTs).not.toContain('id="btn-cancel"');
  expect(mainTs).not.toContain('id="btn-ok"');
  expect(appChromeRenderersTs).toContain("export function renderAppShell");
  expect(appChromeRenderersTs).toContain("export function renderNativeConfirmDialog");
});

test("moves app chrome DOM dialogs out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const appChromeDialogsPath = join(root, "src/app-chrome-dialogs.ts");
  const hasAppChromeDialogs = existsSync(appChromeDialogsPath);

  expect(hasAppChromeDialogs).toBe(true);
  if (!hasAppChromeDialogs) {
    return;
  }

  const appChromeDialogsTs = readProjectFile("src/app-chrome-dialogs.ts");
  expect(mainTs).toContain('from "./app-chrome-dialogs"');
  expect(mainTs).not.toContain("function nativeConfirm");
  expect(mainTs).not.toContain('document.getElementById("btn-cancel")');
  expect(mainTs).not.toContain('document.getElementById("btn-ok")');
  expect(appChromeDialogsTs).toContain("export function nativeConfirm");
});

test("moves scroll restoration helpers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");

  expect(existsSync(join(root, "src/scroll-restoration.ts"))).toBe(true);
  expect(mainTs).toContain('from "./scroll-restoration"');
  expect(mainTs).not.toContain("function renderedPageKeyForView");
  expect(mainTs).not.toContain("function currentRenderedPageKey");
  expect(mainTs).not.toContain("function restoreMainScrollIfSamePage");
});

test("moves pending action key helpers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");

  expect(existsSync(join(root, "src/pending-action-keys.ts"))).toBe(true);
  expect(mainTs).toContain('from "./pending-action-keys"');
  expect(mainTs).not.toContain("function usageRefreshActionKey");
  expect(mainTs).not.toContain("function latencyProbeActionKey");
  expect(mainTs).not.toContain("function thirdPartyUsageActionKey");
  expect(mainTs).not.toContain("const refreshAllUsageActionKey");
  expect(mainTs).not.toContain("const migrateLegacyThirdPartyActionKey");
  expect(mainTs).not.toContain("const writeThirdPartyWebsocketsDefaultsActionKey");
});

test("moves pending action query helpers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const pendingActionsPath = join(root, "src/pending-actions.ts");
  const hasPendingActions = existsSync(pendingActionsPath);

  expect(hasPendingActions).toBe(true);
  if (!hasPendingActions) {
    return;
  }

  const pendingActionsTs = readProjectFile("src/pending-actions.ts");
  expect(mainTs).toContain('from "./pending-actions"');
  expect(mainTs).not.toContain("function isPendingAction(");
  expect(mainTs).not.toContain("function isPendingActionPrefix");
  expect(pendingActionsTs).toContain("export function hasPendingAction");
  expect(pendingActionsTs).toContain("export function hasPendingActionPrefix");
});

test("moves profile editor state factories out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");

  expect(existsSync(join(root, "src/profile-editor-state.ts"))).toBe(true);
  expect(mainTs).toContain('from "./profile-editor-state"');
  expect(mainTs).not.toMatch(/^type EditorState/m);
  expect(mainTs).not.toMatch(/^type LocalShareDraft/m);
  expect(mainTs).not.toMatch(/^type SharedProfileEditDraft/m);
  expect(mainTs).not.toContain("function createEditorState");
  expect(mainTs).not.toContain("function createLocalShareDraft");
  expect(mainTs).not.toContain("function createMockCurrentInput");
  expect(mainTs).not.toContain("function createEditorFromInput");
  expect(mainTs).not.toContain("createdAt: document.createdAt");
  expect(mainTs).not.toContain("readOnly: document.readOnly ?? false");
  expect(mainTs).not.toContain("const parsedAuth = JSON.parse(document.authJson)");
  expect(mainTs).not.toContain("document.configToml.match(/openai_base_url");
  expect(mainTs).not.toContain('name: `${document.name} (共生)`');
});

test("moves profile selection helpers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");

  expect(existsSync(join(root, "src/profile-selection.ts"))).toBe(true);
  expect(mainTs).toContain('from "./profile-selection"');
  expect(mainTs).not.toContain("function getSelectedProfile");
  expect(mainTs).not.toContain("function getOfficialOauthProfiles");
  expect(mainTs).not.toContain("function getEditorProfileSummary");
  expect(mainTs).not.toContain("function resolveSymbioticOauthProfileId");
  expect(mainTs).not.toContain("function editorCannotSaveBecauseMissingOauth");
  expect(mainTs).not.toContain("snapshot.lastSelectedProfileId ??");
  expect(mainTs).not.toContain("state.shareDraft.profileId = snapshot.activeProfileId");
  expect(mainTs).not.toContain("activeProfileId: snapshot.activeProfileId === profileId");
  expect(mainTs).not.toContain(
    "snapshot.lastSelectedProfileId === profileId ? null : snapshot.lastSelectedProfileId",
  );
  expect(mainTs).not.toContain("snapshot.lastSwitchProfileId === profileId ? null : snapshot.lastSwitchProfileId");
});

test("moves shared desktop data contract types out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const desktopTypesPath = join(root, "src/desktop-types.ts");
  const hasDesktopTypes = existsSync(desktopTypesPath);

  expect(hasDesktopTypes).toBe(true);
  if (!hasDesktopTypes) {
    return;
  }

  const desktopTypesTs = readProjectFile("src/desktop-types.ts");
  expect(mainTs).toContain('from "./desktop-types"');
  expect(mainTs).not.toMatch(/^type ProfileSummary/m);
  expect(mainTs).not.toMatch(/^type ProfileDocument/m);
  expect(mainTs).not.toMatch(/^type AppSnapshot/m);
  expect(mainTs).not.toMatch(/^type UpdateCheckResult/m);
  expect(desktopTypesTs).toContain("export type ProfileSummary");
  expect(desktopTypesTs).toContain("export type AppSnapshot");
});

test("moves desktop state shape and defaults out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const desktopStatePath = join(root, "src/desktop-state.ts");
  const hasDesktopState = existsSync(desktopStatePath);

  expect(hasDesktopState).toBe(true);
  if (!hasDesktopState) {
    return;
  }

  const desktopStateTs = readProjectFile("src/desktop-state.ts");
  expect(mainTs).toContain('from "./desktop-state"');
  expect(mainTs).not.toMatch(/^type ViewMode/m);
  expect(mainTs).not.toMatch(/^type PlatformMode/m);
  expect(mainTs).not.toContain("const state: {");
  expect(mainTs).not.toContain("networkAuthRequired: !loadNetworkSharingSettings().token");
  expect(mainTs).not.toContain("function sessionRenderState");
  expect(mainTs).not.toContain("function ownNetworkProfiles");
  expect(mainTs).not.toContain("state.selectedProfileId = resolveSelectedProfileId");
  expect(mainTs).not.toContain("state.shareDraft.profileId = resolveShareDraftProfileId");
  expect(desktopStateTs).toContain("export type DesktopState");
  expect(desktopStateTs).toContain("export function createDesktopState");
  expect(desktopStateTs).toContain("export function applySnapshotToDesktopState");
  expect(desktopStateTs).toContain("export function selectOwnNetworkProfiles");
  expect(desktopStateTs).toContain("export function selectSessionRenderState");
});

test("moves profile document factories out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const profileDocumentsPath = join(root, "src/profile-documents.ts");
  const hasProfileDocuments = existsSync(profileDocumentsPath);

  expect(hasProfileDocuments).toBe(true);
  if (!hasProfileDocuments) {
    return;
  }

  const profileDocumentsTs = readProjectFile("src/profile-documents.ts");
  expect(mainTs).toContain('from "./profile-documents"');
  expect(mainTs).not.toContain("function createMockDocument");
  expect(profileDocumentsTs).toContain("export function createMockProfileDocument");
  expect(profileDocumentsTs).toContain("export function createEmptyProfileDocument");
});

test("moves profile runtime renderers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const runtimeRenderersPath = join(root, "src/profile-runtime-renderers.ts");
  const hasRuntimeRenderers = existsSync(runtimeRenderersPath);

  expect(hasRuntimeRenderers).toBe(true);
  if (!hasRuntimeRenderers) {
    return;
  }

  const runtimeRenderersTs = readProjectFile("src/profile-runtime-renderers.ts");
  const profileListRenderersTs = readProjectFile("src/profile-list-renderers.ts");
  const profileEditorRenderersTs = readProjectFile("src/profile-editor-renderers.ts");

  expect(mainTs).not.toContain('from "./profile-runtime-renderers"');
  expect(profileListRenderersTs).toContain('from "./profile-runtime-renderers"');
  expect(profileEditorRenderersTs).toContain('from "./profile-runtime-renderers"');
  expect(mainTs).not.toContain("function renderUsageProgressRow");
  expect(mainTs).not.toContain("function renderCodexUsagePanel");
  expect(mainTs).not.toContain("function renderThirdPartyLatencyPanel");
  expect(mainTs).not.toContain("function renderThirdPartyQuotaCard");
  expect(mainTs).not.toContain("function renderThirdPartyUsagePanel");
  expect(mainTs).not.toContain("function renderThirdPartyRuntimePanel");
  expect(mainTs).not.toContain("function renderProfileRowMetrics");
  expect(runtimeRenderersTs).toContain("export function renderCodexUsagePanel");
  expect(runtimeRenderersTs).toContain("export function renderThirdPartyRuntimePanel");
  expect(runtimeRenderersTs).toContain("export function renderProfileRowMetrics");
});

test("moves session page renderers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const sessionRenderersPath = join(root, "src/session-renderers.ts");
  const hasSessionRenderers = existsSync(sessionRenderersPath);

  expect(hasSessionRenderers).toBe(true);
  if (!hasSessionRenderers) {
    return;
  }

  const sessionRenderersTs = readProjectFile("src/session-renderers.ts");
  expect(mainTs).toContain('from "./session-renderers"');
  expect(mainTs).not.toContain("function getSessionsListHtml");
  expect(mainTs).not.toContain("function getSessionDetailHtml");
  expect(mainTs).not.toContain("function renderSessionsPage");
  expect(mainTs).not.toContain("function renderSessionItemHtml");
  expect(mainTs).not.toContain("function renderSessionMessages");
  expect(mainTs).not.toContain("groupSessionsByCwd(filtered)");
  expect(sessionRenderersTs).toContain("export function renderSessionsListHtml");
  expect(sessionRenderersTs).toContain("export function renderSessionDetailHtml");
  expect(sessionRenderersTs).toContain("export function renderSessionsPage");
});

test("moves session cleanup renderer out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const cleanupRenderersPath = join(root, "src/session-cleanup-renderers.ts");
  const hasCleanupRenderers = existsSync(cleanupRenderersPath);

  expect(hasCleanupRenderers).toBe(true);
  if (!hasCleanupRenderers) {
    return;
  }

  const cleanupRenderersTs = readProjectFile("src/session-cleanup-renderers.ts");
  expect(mainTs).toContain('from "./session-cleanup-renderers"');
  expect(mainTs).not.toContain("function renderSessionCleanupPage");
  expect(mainTs).not.toContain("SESSION_CLEANUP_WINDOW_MS");
  expect(mainTs).not.toContain("getInactiveSessionProjects");
  expect(mainTs).not.toContain("getOldSessions");
  expect(cleanupRenderersTs).toContain("export function renderSessionCleanupPage");
});

test("moves simple sharing center renderers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const sharingRenderersPath = join(root, "src/sharing-center-renderers.ts");
  const hasSharingRenderers = existsSync(sharingRenderersPath);

  expect(hasSharingRenderers).toBe(true);
  if (!hasSharingRenderers) {
    return;
  }

  const sharingRenderersTs = readProjectFile("src/sharing-center-renderers.ts");
  expect(mainTs).toContain('from "./sharing-center-renderers"');
  expect(mainTs).not.toContain("function renderSharingCenterPage");
  expect(mainTs).not.toContain("data-page=\"sharing-center\"");
  expect(mainTs).not.toContain("function renderShareUserCheckboxList");
  expect(mainTs).not.toContain("function renderSharingCenterTabs");
  expect(mainTs).not.toContain("function renderShareUserPicker");
  expect(mainTs).not.toContain("function renderSharedProfileEditUserPicker");
  expect(sharingRenderersTs).toContain("export function renderSharingCenterPage");
  expect(sharingRenderersTs).toContain("export function renderShareUserCheckboxList");
  expect(sharingRenderersTs).toContain("export function renderSharingCenterTabs");
  expect(sharingRenderersTs).toContain("export function renderShareUserPicker");
  expect(sharingRenderersTs).toContain("export function renderSharedProfileEditUserPicker");
});

test("moves local share form state calculation out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const sharingStatePath = join(root, "src/sharing-center-state.ts");
  const hasSharingState = existsSync(sharingStatePath);

  expect(hasSharingState).toBe(true);
  if (!hasSharingState) {
    return;
  }

  const sharingStateTs = readProjectFile("src/sharing-center-state.ts");
  expect(mainTs).toContain('from "./sharing-center-state"');
  expect(mainTs).not.toContain("const selectedProfileId = state.shareDraft.profileId ?? profiles[0]?.id ?? null");
  expect(mainTs).not.toContain("const selectedUserCount = state.shareDraft.selectedUserIds.length");
  expect(mainTs).not.toContain("const shareSummary =");
  expect(sharingStateTs).toContain("export function resolveLocalShareFormState");
});

test("moves shared profile edit draft factory out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const sharingStateTs = readProjectFile("src/sharing-center-state.ts");

  expect(mainTs).toContain('from "./sharing-center-state"');
  expect(mainTs).toContain("createSharedProfileEditDraft");
  expect(mainTs).not.toContain("networkProfileVisibility");
  expect(mainTs).not.toContain("const visibility = networkProfileVisibility(profile)");
  expect(mainTs).not.toContain("profile.sharedWith ??");
  expect(sharingStateTs).toContain("export function createSharedProfileEditDraft");
});

test("moves local share form renderer out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const sharingRenderersTs = readProjectFile("src/sharing-center-renderers.ts");

  expect(mainTs).toContain('from "./sharing-center-renderers"');
  expect(mainTs).not.toContain("function renderLocalShareForm");
  expect(mainTs).not.toContain("data-role=\"local-share-form\"");
  expect(sharingRenderersTs).toContain("export function renderLocalShareForm");
});

test("moves owned shared profile renderers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const sharingRenderersTs = readProjectFile("src/sharing-center-renderers.ts");

  expect(mainTs).toContain('from "./sharing-center-renderers"');
  expect(mainTs).not.toContain("function renderOwnSharingTab");
  expect(mainTs).not.toContain("function renderOwnedSharedProfiles");
  expect(mainTs).not.toContain("function renderOwnedSharedProfileCard");
  expect(mainTs).not.toContain("sharing-own-stack");
  expect(sharingRenderersTs).toContain("export function renderOwnSharingTab");
  expect(mainTs).not.toContain("data-role=\"owned-shared-profiles\"");
  expect(sharingRenderersTs).toContain("export function renderOwnedSharedProfiles");
});

test("moves enterprise library renderers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const sharingRenderersTs = readProjectFile("src/sharing-center-renderers.ts");

  expect(mainTs).toContain('from "./sharing-center-renderers"');
  expect(mainTs).not.toContain("function renderEnterpriseLibraryTab");
  expect(mainTs).not.toContain("function renderNewPageNetworkSection");
  expect(mainTs).not.toContain("data-role=\"network-profile-library\"");
  expect(sharingRenderersTs).toContain("export function renderEnterpriseLibraryTab");
});

test("moves profile list and grid renderers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const profileListRenderersPath = join(root, "src/profile-list-renderers.ts");

  expect(existsSync(profileListRenderersPath)).toBe(true);
  if (!existsSync(profileListRenderersPath)) {
    return;
  }

  const profileListRenderersTs = readProjectFile("src/profile-list-renderers.ts");
  expect(mainTs).toContain('from "./profile-list-renderers"');
  expect(mainTs).not.toContain("function renderCardsPage");
  expect(mainTs).not.toContain("function renderProfileLayoutToggle");
  expect(mainTs).not.toContain("function renderProfileList");
  expect(mainTs).not.toContain("function renderProfileGrid");
  expect(mainTs).not.toContain("function profileRuntimeRenderContext");
  expect(mainTs).not.toContain("data-page=\"cards\"");
  expect(mainTs).not.toContain("data-role=\"profile-list\"");
  expect(mainTs).not.toContain("data-role=\"profile-grid\"");
  expect(profileListRenderersTs).toContain("export function renderCardsPage");
  expect(profileListRenderersTs).toContain("export function renderProfileLayoutToggle");
  expect(profileListRenderersTs).toContain("export function renderProfileList");
  expect(profileListRenderersTs).toContain("export function renderProfileGrid");
});

test("moves profile editor field renderers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const profileEditorRenderersPath = join(root, "src/profile-editor-renderers.ts");

  expect(existsSync(profileEditorRenderersPath)).toBe(true);
  if (!existsSync(profileEditorRenderersPath)) {
    return;
  }

  const profileEditorRenderersTs = readProjectFile("src/profile-editor-renderers.ts");
  expect(mainTs).toContain('from "./profile-editor-renderers"');
  expect(mainTs).not.toContain("function renderThirdPartyConfigFields");
  expect(mainTs).not.toContain("function renderNewProfileTabSelector");
  expect(mainTs).not.toContain("data-role=\"third-party-delta-form\"");
  expect(mainTs).not.toContain("data-role=\"editor-template-tabs\"");
  expect(profileEditorRenderersTs).toContain("export function renderThirdPartyConfigFields");
  expect(profileEditorRenderersTs).toContain("export function renderNewProfileTabSelector");
});

test("moves editor detail sub-renderers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const profileEditorRenderersTs = readProjectFile("src/profile-editor-renderers.ts");

  expect(mainTs).toContain('from "./profile-editor-renderers"');
  expect(mainTs).not.toContain("class=\"editor-panels\"");
  expect(mainTs).not.toContain("editor-layout-grid");
  expect(mainTs).not.toContain("editor-sidebar-column");
  expect(mainTs).not.toContain("sidebar-card-title\">基本信息");
  expect(mainTs).not.toContain("sidebar-card metadata-card");
  expect(profileEditorRenderersTs).toContain("export function renderEditorLayout");
  expect(profileEditorRenderersTs).toContain("export function renderEditorCodePanels");
  expect(profileEditorRenderersTs).toContain("export function renderEditorBasicInfoCard");
  expect(profileEditorRenderersTs).toContain("export function renderEditorMetadataCard");
});

test("moves editor runtime panel renderer out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const profileEditorRenderersTs = readProjectFile("src/profile-editor-renderers.ts");

  expect(mainTs).toContain('from "./profile-editor-renderers"');
  expect(mainTs).not.toContain("function renderEditorRuntimePanel");
  expect(mainTs).not.toContain("data-role=\"editor-runtime-panel\"");
  expect(profileEditorRenderersTs).toContain("export function renderEditorRuntimePanel");
});

test("moves editor page shell renderer out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const profileEditorRenderersTs = readProjectFile("src/profile-editor-renderers.ts");

  expect(mainTs).toContain('from "./profile-editor-renderers"');
  expect(mainTs).not.toContain('data-page="editor"');
  expect(mainTs).not.toContain('data-role="editor-readonly-notice"');
  expect(mainTs).not.toContain('data-role="editor-live-change-notice"');
  expect(mainTs).not.toContain("返回卡片网格");
  expect(profileEditorRenderersTs).toContain("export function renderEditorPageShell");
});

test("moves complete editor page renderer out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const profileEditorRenderersTs = readProjectFile("src/profile-editor-renderers.ts");

  expect(mainTs).toContain('from "./profile-editor-renderers"');
  expect(mainTs).not.toContain("function renderEditorPage");
  expect(mainTs).not.toContain("手动创建新 Profile");
  expect(mainTs).not.toContain("把当前 `.codex` 里的内容复制成一套新的 profile。");
  expect(profileEditorRenderersTs).toContain("export function renderEditorPage");
});

test("moves network account status renderers out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const networkAccountRenderersPath = join(root, "src/network-account-renderers.ts");

  expect(existsSync(networkAccountRenderersPath)).toBe(true);
  if (!existsSync(networkAccountRenderersPath)) {
    return;
  }

  const networkAccountRenderersTs = readProjectFile("src/network-account-renderers.ts");
  expect(mainTs).toContain('from "./network-account-renderers"');
  expect(mainTs).not.toContain("function renderSidebarLoginStatus");
  expect(mainTs).not.toContain("function renderNetworkAccountSettings");
  expect(mainTs).not.toContain("data-role=\"sidebar-login-status\"");
  expect(mainTs).not.toContain("data-role=\"network-account-settings\"");
  expect(networkAccountRenderersTs).toContain("export function renderSidebarLoginStatus");
  expect(networkAccountRenderersTs).toContain("export function renderNetworkAccountSettings");
});

test("moves settings page renderer out of the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");
  const settingsRenderersPath = join(root, "src/settings-renderers.ts");

  expect(existsSync(settingsRenderersPath)).toBe(true);
  if (!existsSync(settingsRenderersPath)) {
    return;
  }

  const settingsRenderersTs = readProjectFile("src/settings-renderers.ts");
  expect(mainTs).toContain('from "./settings-renderers"');
  expect(mainTs).not.toContain("function renderSettingsPage");
  expect(mainTs).not.toContain("data-page=\"settings\"");
  expect(mainTs).not.toContain("id=\"network-profiles-api\"");
  expect(mainTs).not.toContain("data-action=\"migrate-legacy-third-party\"");
  expect(settingsRenderersTs).toContain("export function renderSettingsPage");
});

test("keeps bindEvents-only input binding helper in the desktop entrypoint", () => {
  const mainTs = readProjectFile("src/main.ts");

  expect(existsSync(join(root, "src/form-bindings.ts"))).toBe(false);
  expect(mainTs).not.toContain('from "./form-bindings"');
  expect(mainTs).toContain("function bindInputValue");
});
