import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import "./styles.css";

type FlashKind = "info" | "success" | "error";
type ViewMode = "cards" | "editor" | "settings" | "sessions" | "session-cleanup";
type EditorMode = "new" | "fromCurrent" | "existing";
type PlatformMode = "codex";
type ProfileLayoutMode = "list" | "grid";

type CodexSessionInfo = {
  id: string;
  rolloutPath?: string | null;
  updatedAtMs: number;
  cwd?: string | null;
  title?: string | null;
  hasUserEvent: boolean;
  archived: boolean;
  modelProvider?: string | null;
  fileSize?: number | null;
};

type CodexMessage = {
  role: string;
  text: string;
};
type NewProfileTemplate = "standaloneThirdParty" | "symbioticThirdParty";
type BusyDialogState = {
  title: string;
  message: string;
} | null;

type CodexUsageWindow = {
  usedPercent: number;
  windowMinutes: number | null;
  resetsAt: string | null;
};

type CodexUsageCredits = {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
};

type CodexUsageSnapshot = {
  source: string;
  planType: string | null;
  primary: CodexUsageWindow | null;
  secondary: CodexUsageWindow | null;
  credits: CodexUsageCredits | null;
  updatedAt: string;
  error?: string | null;
};

type ThirdPartyLatencySnapshot = {
  wireApi: string | null;
  model: string | null;
  ttftMs: number | null;
  totalMs: number | null;
  statusCode: number | null;
  updatedAt: string;
  error: string | null;
};

type ThirdPartyUsageSnapshot = {
  provider: string | null;
  remaining: string | null;
  unit: string | null;
  daily?: ThirdPartyUsageQuotaSnapshot | null;
  weekly?: ThirdPartyUsageQuotaSnapshot | null;
  subscription?: ThirdPartySubscriptionSnapshot | null;
  credit?: ThirdPartyCreditSnapshot | null;
  updatedAt: string;
  error: string | null;
};

type ThirdPartyUsageQuotaSnapshot = {
  used: string | null;
  total: string | null;
  remaining: string | null;
  usedPercent: number | null;
};

type ThirdPartySubscriptionSnapshot = {
  dailyQuota: string | null;
  weeklyQuota: string | null;
  monthlyQuota: string | null;
  expiresAt: string | null;
  amount: string | null;
  packageType: string | null;
};

type ThirdPartyCreditSnapshot = {
  freeBalance: string | null;
  paidBalance: string | null;
  totalBalance: string | null;
};

type ProfileSummary = {
  id: string;
  name: string;
  notes: string;
  authTypeLabel: string;
  modelProviderId?: string | null;
  modelProviderApiKeyId?: string | null;
  modelProviderKey?: string | null;
  modelProviderName?: string | null;
  modelProviderBaseUrl?: string | null;
  modelProviderWireApi?: string | null;
  createdAt: string;
  updatedAt: string;
  authHash: string;
  configHash: string;
  codexUsage: CodexUsageSnapshot | null;
  thirdPartyLatency: ThirdPartyLatencySnapshot | null;
  thirdPartyUsage?: ThirdPartyUsageSnapshot | null;
};

type ProfileInput = {
  name: string;
  notes: string;
  authJson: string;
  configToml: string;
};

type ThirdPartyConfigDraft = {
  template: NewProfileTemplate;
  oauthProfileId: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

type ProfileDocument = {
  id: string;
  name: string;
  notes: string;
  authTypeLabel: string;
  modelProviderId?: string | null;
  modelProviderApiKeyId?: string | null;
  modelProviderKey?: string | null;
  modelProviderName?: string | null;
  modelProviderBaseUrl?: string | null;
  modelProviderWireApi?: string | null;
  createdAt: string;
  updatedAt: string;
  authJson: string;
  configToml: string;
  loadedFromTarget: boolean;
  hasTargetChanges: boolean;
  readOnly?: boolean;
  source?: "local" | "network";
};

type AppSnapshot = {
  targetDir: string;
  usingDefaultTargetDir: boolean;
  targetExists: boolean;
  targetAuthExists: boolean;
  targetConfigExists: boolean;
  targetUpdatedAt: string | null;
  targetAuthTypeLabel: string | null;
  activeProfileId: string | null;
  lastSelectedProfileId: string | null;
  lastSwitchProfileId: string | null;
  lastSwitchedAt: string | null;
  codexUsageApiEnabled: boolean;
  profiles: ProfileSummary[];
};

type LegacyThirdPartyMigrationResult = {
  migratedProfileIds: string[];
  skippedProfileIds: string[];
};

type ThirdPartyWebsocketsDefaultResult = {
  updatedProfileIds: string[];
  skippedProfileIds: string[];
};

type UpdateCheckResult = {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
  publishedAt: string | null;
  notes: string | null;
  kind: string;
  filename: string;
  sha256: string;
  size: number;
  canInstall: boolean;
};

type InstallLocationStatus = {
  updateSafe: boolean;
  requiresApplicationsInstall: boolean;
  installPath: string;
  message: string | null;
};

type SessionRecoveryCounts = {
  sessionIndexEntries: number;
  dbThreads: number;
  archived: number;
  unarchived: number;
  hasUserEventTrue: number;
  hasUserEventFalse: number;
  inferredCurrentModelProvider?: string | null;
  modelProviderCounts?: Record<string, number>;
};

type SessionRecoveryCandidates = {
  missingRolloutFiles: number;
  hasUserEventFalseButRolloutHasUserMessage: number;
  dbTimeMismatchWithSessionIndex: number;
  rolloutMtimeMismatchWithSessionIndex: number;
  dbThreadIdsMissingFromSessionIndex: number;
  sessionIndexIdsMissingFromDb: number;
  appDefaultModelProviderMismatch?: number;
};

type SavedRootOutsideRecentWindowSample = {
  root: string;
  latestThreadId: string;
  latestTitle: string | null;
  latestUpdatedAt: string;
};

type SessionRecoverySamples = {
  missingRolloutFiles: Array<{ id: string; archived: boolean; rolloutPath: string | null }>;
  hasUserEventFalseButRolloutHasUserMessage: Array<{
    id: string;
    archived: boolean;
    cwd: string | null;
    title: string | null;
  }>;
  dbTimeMismatchWithSessionIndex: Array<{
    id: string;
    cwd: string | null;
    dbUpdatedAtMs: number;
    indexedUpdatedAtMs: number;
  }>;
  rolloutMtimeMismatchWithSessionIndex: Array<{
    id: string;
    rolloutPath: string;
    rolloutMtimeMs: number;
    indexedUpdatedAtMs: number;
  }>;
  savedRootsWithChatsOutsideRecentWindow: SavedRootOutsideRecentWindowSample[];
};

type SessionRecoveryReport = {
  codexHome: string;
  dbPath: string;
  sessionIndexPath: string;
  recentLimit: number;
  sqliteIntegrity: string;
  counts: SessionRecoveryCounts;
  repairCandidates: SessionRecoveryCandidates;
  samples: SessionRecoverySamples;
  notes: string[];
};

type SessionRepairUpdateCounts = {
  hasUserEvent: number;
  dbTime: number;
  rolloutMtime: number;
  timeMismatchesNotRepaired: number;
  skippedMissingRolloutFiles: number;
};

type SessionRepairResult = {
  repaired: boolean;
  backupPath: string;
  auditPath: string;
  updates: SessionRepairUpdateCounts;
  note: string;
};

type EditorState = {
  mode: EditorMode;
  profileId: string | null;
  name: string;
  notes: string;
  authJson: string;
  configToml: string;
  thirdParty: ThirdPartyConfigDraft;
  createdAt: string | null;
  updatedAt: string | null;
  loadedFromTarget: boolean;
  hasTargetChanges: boolean;
  readOnly: boolean;
  source: "local" | "network";
  newTab?: "manual-delta" | "manual-full" | "network";
};

type NetworkProfile = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt?: string;
  files: string[];
  ownerName?: string;
  ownerMobile?: string;
  sharedWith?: string[];
};

type NetworkSharingSettings = {
  profilesApi: string;
  token: string;
};

const CANONICAL_NETWORK_PROFILES_HOST = "codex-helper.ite.tool4seller.com";
const LEGACY_NETWORK_PROFILES_HOST = "sub2api.ite.tapcash.com";
const DEFAULT_NETWORK_PROFILES_API = `https://${CANONICAL_NETWORK_PROFILES_HOST}/codex/api/profiles`;
const desktopLoginPollIntervalMs =
  typeof process !== "undefined" && process.env.NODE_ENV === "test" ? 10 : 2000;
const networkProfilesApiStorageKey = "codex-auth-switch.networkProfilesApi";
const networkProfileTokenStorageKey = "codex-auth-switch.networkProfileToken";

const isTauriRuntime = "__TAURI_INTERNALS__" in window;
const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("App root was not found.");
}

const app = appRoot;

function loadNetworkSharingSettings(): NetworkSharingSettings {
  return {
    profilesApi: normalizeNetworkProfilesApiUrl(
      window.localStorage.getItem(networkProfilesApiStorageKey)?.trim() ||
        DEFAULT_NETWORK_PROFILES_API,
    ),
    token: window.localStorage.getItem(networkProfileTokenStorageKey)?.trim() || "",
  };
}

function saveNetworkSharingSettings(settings: NetworkSharingSettings): void {
  settings.profilesApi = normalizeNetworkProfilesApiUrl(settings.profilesApi);
  window.localStorage.setItem(networkProfilesApiStorageKey, settings.profilesApi);
  window.localStorage.setItem(networkProfileTokenStorageKey, settings.token.trim());
}

function normalizeNetworkProfilesApiUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_NETWORK_PROFILES_API;

  try {
    const url = new URL(trimmed);
    if (url.hostname === LEGACY_NETWORK_PROFILES_HOST) {
      url.hostname = CANONICAL_NETWORK_PROFILES_HOST;
      url.protocol = "https:";
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}

function networkProfilesApiUrl(): string {
  const trimmed = normalizeNetworkProfilesApiUrl(state.networkSharing.profilesApi).replace(/\/+$/, "");
  return trimmed || DEFAULT_NETWORK_PROFILES_API;
}

function networkPortalBaseUrl(): string {
  return networkProfilesApiUrl().replace(/\/api\/profiles\/?$/, "");
}

function networkSsoLoginUrl(): string {
  const loginUrl = new URL(`${networkPortalBaseUrl()}/api/auth/login`);
  loginUrl.searchParams.set("returnTo", "/profiles");
  return loginUrl.toString();
}

function networkDesktopLoginApiUrl(): string {
  return `${networkPortalBaseUrl()}/api/auth/desktop-login`;
}

function networkFetchOptions(): RequestInit {
  const token = state.networkSharing.token.trim();
  if (token) {
    return {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };
  }

  return {
    cache: "no-store",
  };
}

function createEditorState(mode: EditorMode = "new"): EditorState {
  return {
    mode,
    profileId: null,
    name: "",
    notes: "",
    authJson: `{
  "user": {
    "email": ""
  },
  "token": ""
}`,
    configToml: `default_model = "gpt-5"
theme = "system"
`,
    thirdParty: {
      template: "standaloneThirdParty",
      oauthProfileId: "",
      provider: "",
      baseUrl: "",
      apiKey: "",
      model: "gpt-5.5",
    },
    createdAt: null,
    updatedAt: null,
    loadedFromTarget: false,
    hasTargetChanges: false,
    readOnly: false,
    source: "local",
    newTab: "manual-delta",
  };
}

const mockSnapshot: AppSnapshot = {
  targetDir: "/Users/example/.codex",
  usingDefaultTargetDir: true,
  targetExists: true,
  targetAuthExists: true,
  targetConfigExists: true,
  targetUpdatedAt: new Date().toISOString(),
  targetAuthTypeLabel: "第三方 API",
  activeProfileId: "profile-2",
  lastSelectedProfileId: "profile-2",
  lastSwitchProfileId: "profile-2",
  lastSwitchedAt: new Date().toISOString(),
  codexUsageApiEnabled: true,
  profiles: [
    {
      id: "profile-1",
      name: "Work Team",
      notes: "工作主账号，常驻使用。",
      authTypeLabel: "官方 OAuth",
      createdAt: "2026-03-16T01:00:00Z",
      updatedAt: "2026-03-18T12:20:00Z",
      authHash: "7da2e87f1bc3",
      configHash: "92ca2d10aa51",
      codexUsage: {
        source: "api",
        planType: "team",
        primary: {
          usedPercent: 24,
          windowMinutes: 300,
          resetsAt: "2026-03-25T18:26:00Z",
        },
        secondary: {
          usedPercent: 7,
          windowMinutes: 10080,
          resetsAt: "2026-04-01T18:26:00Z",
        },
        credits: null,
        updatedAt: new Date().toISOString(),
      },
      thirdPartyLatency: null,
      thirdPartyUsage: null,
    },
    {
      id: "profile-2",
      name: "淘宝 1",
      notes: "主工作账号，额度稳定。",
      authTypeLabel: "第三方 API",
      createdAt: "2026-03-17T01:00:00Z",
      updatedAt: "2026-03-19T04:12:00Z",
      authHash: "d18ff783cb10",
      configHash: "c450c91961af",
      codexUsage: null,
      thirdPartyLatency: {
        wireApi: "responses",
        model: "gpt-5.4",
        ttftMs: 1820,
        totalMs: 4960,
        statusCode: 200,
        updatedAt: new Date().toISOString(),
        error: null,
      },
      thirdPartyUsage: null,
    },
  ],
};


const state: {
  platform: PlatformMode;
  snapshot: AppSnapshot | null;
  view: ViewMode;
  selectedProfileId: string | null;
  editor: EditorState;
  busy: boolean;
  busyDialog: BusyDialogState;
  pendingActions: Set<string>;
  flash: { kind: FlashKind; text: string } | null;
  activeTab: "local" | "network";
  profileLayout: ProfileLayoutMode;
  networkProfiles: NetworkProfile[];
  networkLoading: boolean;
  networkAuthRequired: boolean;
  networkSharing: NetworkSharingSettings;
  appVersion: string | null;
  update: {
    checking: boolean;
    lastResult: UpdateCheckResult | null;
  };
  sessions: CodexSessionInfo[];
  selectedSessionId: string | null;
  sessionMessages: CodexMessage[];
  sessionSearchQuery: string;
  sessionFilter: "all" | "active" | "archived";
  sessionSortOrder: "time" | "cwd";
  sessionsLoading: boolean;
  messagesLoading: boolean;
} = {
  platform: "codex",
  snapshot: null,
  view: "cards",
  selectedProfileId: null,
  editor: createEditorState(),
  busy: false,
  busyDialog: null,
  pendingActions: new Set<string>(),
  flash: null,
  activeTab: "local",
  profileLayout: "list",
  networkProfiles: [],
  networkLoading: false,
  networkAuthRequired: !loadNetworkSharingSettings().token,
  networkSharing: loadNetworkSharingSettings(),
  appVersion: null,
  update: {
    checking: false,
    lastResult: null,
  },
  sessions: [],
  selectedSessionId: null,
  sessionMessages: [],
  sessionSearchQuery: "",
  sessionFilter: "all",
  sessionSortOrder: "time",
  sessionsLoading: false,
  messagesLoading: false,
};

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

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function isPendingAction(key: string): boolean {
  return state.pendingActions.has(key);
}

function isPendingActionPrefix(prefix: string): boolean {
  for (const key of state.pendingActions) {
    if (key === prefix || key.startsWith(`${prefix}:`)) {
      return true;
    }
  }
  return false;
}

function usageRefreshActionKey(profileId: string): string {
  return `codex-usage:${profileId}`;
}

function latencyProbeActionKey(profileId: string): string {
  return `latency-probe:${profileId}`;
}

function thirdPartyUsageActionKey(profileId: string): string {
  return `third-party-usage:${profileId}`;
}

const refreshAllUsageActionKey = "codex-usage:all";
const migrateLegacyThirdPartyActionKey = "third-party:migrate-legacy";
const writeThirdPartyWebsocketsDefaultsActionKey = "third-party:websockets-defaults";

function setSnapshot(snapshot: AppSnapshot): void {
  state.snapshot = snapshot;


  if (!snapshot.profiles.some((profile) => profile.id === state.selectedProfileId)) {
    state.selectedProfileId =
      snapshot.activeProfileId ??
      snapshot.lastSelectedProfileId ??
      snapshot.profiles[0]?.id ??
      null;
  }
  render();
}

function getSelectedProfile(snapshot: AppSnapshot | null): ProfileSummary | null {
  if (!snapshot || snapshot.profiles.length === 0) {
    return null;
  }

  return (
    snapshot.profiles.find((profile) => profile.id === state.selectedProfileId) ??
    snapshot.profiles.find((profile) => profile.id === snapshot.activeProfileId) ??
    snapshot.profiles[0]
  );
}

function createMockCurrentInput(): ProfileInput {
  return {
    name: "",
    notes: "来自当前 Codex 目录",
    authJson: `{
  "auth_mode": "chatgpt",
  "tokens": {
    "id_token": "mock-id-token",
    "access_token": "mock-access-token"
  }
}`,
    configToml: `model = "gpt-5.4"
model_reasoning_effort = "medium"
`,
  };
}

function createEditorFromInput(mode: EditorMode, input: ProfileInput): EditorState {
  const template = createEditorState();
  return {
    mode,
    profileId: null,
    name: input.name,
    notes: input.notes,
    authJson: input.authJson,
    configToml: input.configToml,
    thirdParty: template.thirdParty,
    createdAt: null,
    updatedAt: null,
    loadedFromTarget: false,
    hasTargetChanges: false,
    readOnly: false,
    source: "local",
  };
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function tomlTableKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : `"${escapeTomlString(value)}"`;
}

function getOfficialOauthProfiles(snapshot: AppSnapshot | null): ProfileSummary[] {
  return snapshot?.profiles.filter((profile) => profile.authTypeLabel === "官方 OAuth") ?? [];
}

function resolveSymbioticOauthProfileId(): string {
  const officialProfiles = getOfficialOauthProfiles(state.snapshot);
  if (officialProfiles.length === 0) {
    return "";
  }

  const selected = state.editor.thirdParty.oauthProfileId;
  if (officialProfiles.some((profile) => profile.id === selected)) {
    return selected;
  }

  const activeOfficial = officialProfiles.find(
    (profile) => profile.id === state.snapshot?.activeProfileId,
  );
  return activeOfficial?.id ?? officialProfiles[0].id;
}

function editorCannotSaveBecauseMissingOauth(): boolean {
  return (
    state.editor.mode === "new" &&
    state.editor.thirdParty.template === "symbioticThirdParty" &&
    getOfficialOauthProfiles(state.snapshot).length === 0
  );
}

function standaloneThirdPartyConfigInputFromDraft(editor: EditorState, strict: boolean = true): ProfileInput {
  const baseUrl = editor.thirdParty.baseUrl.trim();
  const apiKey = editor.thirdParty.apiKey.trim();
  const model = editor.thirdParty.model.trim();

  if (strict) {
    if (!baseUrl) {
      throw new Error("请填写第三方 API 的 openai_base_url。");
    }
    if (!apiKey) {
      throw new Error("请填写 auth.json 中 OPENAI_API_KEY 的 value。");
    }
    if (!model) {
      throw new Error("请填写 model。");
    }
  }

  return {
    name: editor.name.trim(),
    notes: editor.notes.trim(),
    authJson: JSON.stringify({ OPENAI_API_KEY: apiKey || "<your_api_key_here>" }, null, 2),
    configToml: `openai_base_url = "${escapeTomlString(baseUrl || "https://api.openai.com/v1")}"
supports_websockets = false
model_provider = "openai"
model = "${escapeTomlString(model || "gpt-5.5")}"
review_model = "${escapeTomlString(model || "gpt-5.5")}"
model_reasoning_effort = "high"
plan_mode_reasoning_effort = "xhigh"
show_raw_agent_reasoning = true
approval_policy = "never"
sandbox_mode = "danger-full-access"
personality = "pragmatic"
web_search = "live"
model_context_window = 1000000
model_auto_compact_token_limit = 400000

[tui]
terminal_title = []
status_line = ["model-with-reasoning", "context-usage", "current-dir", "git-branch"]

[features]
guardian_approval = true
remote_connections = true
memories = true

[sandbox_workspace_write]
network_access = true
`,
  };
}

function symbioticAuthJsonFromOfficial(authJson: string): string {
  const parsed = JSON.parse(authJson) as Record<string, unknown>;
  parsed.auth_mode = "chatgpt";
  parsed.OPENAI_API_KEY = null;
  return JSON.stringify(parsed, null, 2);
}

function symbioticThirdPartyConfigTomlFromDraft(editor: EditorState, strict: boolean = true): string {
  const provider = editor.thirdParty.provider.trim();
  const baseUrl = editor.thirdParty.baseUrl.trim();
  const token = editor.thirdParty.apiKey.trim();
  const model = editor.thirdParty.model.trim();

  if (strict) {
    if (!provider) {
      throw new Error("请填写共生配置的 model_provider。");
    }
    if (!baseUrl) {
      throw new Error("请填写第三方 API 的 base_url。");
    }
    if (!token) {
      throw new Error("请填写第三方 API 的 experimental_bearer_token。");
    }
    if (!model) {
      throw new Error("请填写 model。");
    }
  }

  const resolvedProvider = provider || "custom-provider";
  return `model_provider = "${escapeTomlString(resolvedProvider)}"
model = "${escapeTomlString(model || "gpt-5.5")}"
review_model = "${escapeTomlString(model || "gpt-5.5")}"
model_reasoning_effort = "high"
plan_mode_reasoning_effort = "xhigh"
show_raw_agent_reasoning = true
approval_policy = "never"
sandbox_mode = "danger-full-access"

[model_providers.${tomlTableKey(resolvedProvider)}]
name = "${escapeTomlString(resolvedProvider)}"
base_url = "${escapeTomlString(baseUrl || "https://api.openai.com/v1")}"
experimental_bearer_token = "${escapeTomlString(token || "<your_bearer_token_here>")}"
requires_openai_auth = true
supports_websockets = false

[features]
remote_connections = true
remote_control = true
`;
}

async function symbioticThirdPartyConfigInputFromDraft(
  editor: EditorState,
  strict: boolean = true,
): Promise<ProfileInput> {
  const oauthProfileId = resolveSymbioticOauthProfileId();
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
      document = {
        id: "",
        name: "",
        notes: "",
        authTypeLabel: "",
        modelProviderId: null,
        modelProviderApiKeyId: null,
        modelProviderKey: null,
        modelProviderName: null,
        modelProviderBaseUrl: null,
        modelProviderWireApi: null,
        createdAt: "",
        updatedAt: "",
        authJson: "{}",
        configToml: "",
        loadedFromTarget: false,
        hasTargetChanges: false,
      };
    } else {
      document = createMockDocument(profile);
    }
  } else {
    if (!oauthProfileId) {
      document = {
        id: "",
        name: "",
        notes: "",
        authTypeLabel: "",
        modelProviderId: null,
        modelProviderApiKeyId: null,
        modelProviderKey: null,
        modelProviderName: null,
        modelProviderBaseUrl: null,
        modelProviderWireApi: null,
        createdAt: "",
        updatedAt: "",
        authJson: "{}",
        configToml: "",
        loadedFromTarget: false,
        hasTargetChanges: false,
      };
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
    if (state.editor.newTab === "manual-full" || state.editor.newTab === "network") {
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

function createMockDocument(profile: ProfileSummary): ProfileDocument {
  return {
    id: profile.id,
    name: profile.name,
    notes: profile.notes,
    authTypeLabel: profile.authTypeLabel,
    modelProviderId: profile.modelProviderId ?? null,
    modelProviderApiKeyId: profile.modelProviderApiKeyId ?? null,
    modelProviderKey: profile.modelProviderKey ?? null,
    modelProviderName: profile.modelProviderName ?? null,
    modelProviderBaseUrl: profile.modelProviderBaseUrl ?? null,
    modelProviderWireApi: profile.modelProviderWireApi ?? null,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    authJson: `{
  "user": {
    "email": "${profile.name.toLowerCase()}@example.com"
  },
  "token": "token-for-${profile.id}"
}`,
    configToml: `default_model = "gpt-5"
theme = "system"
profile = "${profile.id}"
`,
    loadedFromTarget: false,
    hasTargetChanges: false,
  };
}

function applyEditorDocument(document: ProfileDocument): void {
  const template = createEditorState();
  state.editor = {
    mode: "existing",
    profileId: document.id,
    name: document.name,
    notes: document.notes,
    authJson: document.authJson,
    configToml: document.configToml,
    thirdParty: template.thirdParty,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    loadedFromTarget: document.loadedFromTarget,
    hasTargetChanges: document.hasTargetChanges,
    readOnly: document.readOnly ?? false,
    source: document.source ?? "local",
  };
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
    setSnapshot(mockSnapshot);
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

function nativeConfirm(msg: string, okText = "确定", isDanger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;transition:all 0.2s;";
    const box = document.createElement("div");
    box.style.cssText = "background:var(--bg-panel);border:1px solid var(--border);padding:28px 32px;border-radius:24px;box-shadow:var(--shadow-lg);max-width:320px;text-align:center;color:var(--text-main);transform:scale(0.95);animation:zoomIn 0.2s forwards;";

    const okColor = isDanger ? "var(--danger)" : "var(--accent)";
    const okShadow = isDanger ? "rgba(239,68,68,0.2)" : "rgba(99,102,241,0.2)";

    box.innerHTML = `<style>@keyframes zoomIn { to { transform: scale(1); } }</style>
      <h3 style="margin:0 0 12px;font-size:1.2rem;">提示</h3>
      <p style="margin:0 0 24px;color:var(--text-muted);font-size:0.95rem;line-height:1.5;">${escapeHtml(msg)}</p>
      <div style="display:flex;gap:12px;justify-content:center;">
        <button id="btn-cancel" style="flex:1;padding:10px;border:none;border-radius:12px;background:var(--bg-page);color:var(--text-main);cursor:pointer;font-weight:600;border:1px solid var(--border);">取消</button>
        <button id="btn-ok" style="flex:1;padding:10px;border:none;border-radius:12px;background:${okColor};color:white;cursor:pointer;font-weight:600;box-shadow:0 4px 12px ${okShadow};">${escapeHtml(okText)}</button>
      </div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    document.getElementById("btn-cancel")!.onclick = () => { document.body.removeChild(overlay); resolve(false); };
    document.getElementById("btn-ok")!.onclick = () => { document.body.removeChild(overlay); resolve(true); };
  });
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
      setSnapshot({
        ...snapshot,
        profiles: snapshot.profiles.filter((profile) => profile.id !== profileId),
        activeProfileId: snapshot.activeProfileId === profileId ? null : snapshot.activeProfileId,
        lastSelectedProfileId:
          snapshot.lastSelectedProfileId === profileId ? null : snapshot.lastSelectedProfileId,
        lastSwitchProfileId:
          snapshot.lastSwitchProfileId === profileId ? null : snapshot.lastSwitchProfileId,
      });
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
    document = createMockDocument(profile);
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

  let apiKey = "";
  try {
    const parsedAuth = JSON.parse(document.authJson);
    apiKey = parsedAuth.OPENAI_API_KEY || "";
  } catch (e) {
    // Ignore JSON parsing errors
  }

  let baseUrl = "";
  let model = "";
  let provider = "";

  const baseUrlMatch = document.configToml.match(/openai_base_url\s*=\s*"([^"]+)"/);
  if (baseUrlMatch) {
    baseUrl = baseUrlMatch[1];
  } else {
    const fallbackBaseUrlMatch = document.configToml.match(/base_url\s*=\s*"([^"]+)"/);
    if (fallbackBaseUrlMatch) {
      baseUrl = fallbackBaseUrlMatch[1];
    }
  }

  const modelMatch = document.configToml.match(/model\s*=\s*"([^"]+)"/);
  if (modelMatch) {
    model = modelMatch[1];
  }

  const providerMatch = document.configToml.match(/model_provider\s*=\s*"([^"]+)"/);
  if (providerMatch) {
    provider = providerMatch[1];
  }

  state.editor = {
    mode: "new",
    profileId: null,
    name: `${document.name} (共生)`,
    notes: document.notes || "",
    authJson: "",
    configToml: "",
    thirdParty: {
      template: "symbioticThirdParty",
      oauthProfileId: resolveSymbioticOauthProfileId(),
      provider: provider || "openai",
      baseUrl: baseUrl || "",
      apiKey: apiKey || "",
      model: model || "gpt-5.5",
    },
    createdAt: null,
    updatedAt: null,
    loadedFromTarget: false,
    hasTargetChanges: false,
    readOnly: false,
    source: "local",
    newTab: "manual-delta",
  };

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
    const document = createMockDocument(selectedProfile);
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
    const res = await fetch(networkProfilesApiUrl(), networkFetchOptions());
    if (res.status === 401) {
      state.networkAuthRequired = true;
      throw new Error("云端共享库需要桌面访问令牌。请先在网页端钉钉 SSO 登录并生成令牌，再到全局设置中填写。");
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

async function openNetworkSsoLogin(): Promise<void> {
  saveNetworkSharingSettings(state.networkSharing);
  try {
    const sessionResponse = await fetch(networkDesktopLoginApiUrl(), {
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
    const loginUrl = new URL(networkSsoLoginUrl());
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
  const pollUrl = new URL(`${networkDesktopLoginApiUrl()}/${sessionId}`);
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
    await fetchNetworkProfiles();
    return;
  }

  throw new Error("钉钉 SSO 登录等待超时，请重新登录。");
}

async function fetchNetworkProfileDocument(networkProfileId: string): Promise<ProfileDocument> {
  const apiUrl = networkProfilesApiUrl();
  const fetchOptions = networkFetchOptions();
  const res = await fetch(`${apiUrl}/${networkProfileId}`, fetchOptions);
  if (res.status === 401) {
    throw new Error("云端共享库需要桌面访问令牌。请先在网页端生成令牌并填入全局设置。");
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


function formatDateTime(value: string | null): string {
  if (!value) {
    return "还没有";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function profileTypeLabel(profile: ProfileSummary | ProfileDocument): string {
  const provider = profile.modelProviderKey?.trim() || profile.modelProviderName?.trim();
  if (profile.authTypeLabel === "共生配置" && provider) {
    return `共生配置 · ${provider}`;
  }
  if (profile.authTypeLabel === "第三方 API" && provider) {
    return provider;
  }
  return profile.authTypeLabel;
}

function isOfficialOauthProfile(profile: ProfileSummary | ProfileDocument): boolean {
  return profile.authTypeLabel === "官方 OAuth";
}

function isThirdPartyBackedProfile(profile: ProfileSummary | ProfileDocument): boolean {
  return profile.authTypeLabel === "第三方 API" || profile.authTypeLabel === "共生配置";
}

function selectUsageWindow(
  usage: CodexUsageSnapshot | null,
  minutes: number,
  fallbackPrimary: boolean,
): CodexUsageWindow | null {
  if (!usage) {
    return null;
  }
  if (usage.primary?.windowMinutes === minutes) {
    return usage.primary;
  }
  if (usage.secondary?.windowMinutes === minutes) {
    return usage.secondary;
  }
  return fallbackPrimary ? usage.primary : usage.secondary;
}

function remainingPercent(usedPercent: number): number {
  return Math.max(0, Math.min(100, Math.floor(100 - usedPercent)));
}

function formatPlanTitle(planType: string | null): string {
  if (!planType) {
    return "Codex Plan";
  }

  const normalized = planType.charAt(0).toUpperCase() + planType.slice(1).toLowerCase();
  return `Codex ${normalized} Plan`;
}

function formatUsageReset(window: CodexUsageWindow | null): string {
  if (!window?.resetsAt) {
    return "--";
  }

  const resetAt = new Date(window.resetsAt);
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(resetAt);
  const date = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(resetAt);
  return `${time} on ${date}`;
}

function formatLatencyDuration(ms: number | null): string {
  if (ms == null) {
    return "--";
  }
  return `${(Math.max(0, ms) / 1000).toFixed(2)}s`;
}

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

function renderCodexUsagePanel(snapshot: AppSnapshot, profile: ProfileSummary): string {
  if (!isOfficialOauthProfile(profile)) {
    return "";
  }

  const usage = profile.codexUsage;
  const primaryWindow = selectUsageWindow(usage, 300, true);
  const weeklyWindow = selectUsageWindow(usage, 10080, false);
  const usageError = usage?.error ?? null;
  const updated = usage ? formatDateTime(usage.updatedAt) : "还没有";
  const refreshingUsage = isPendingAction(usageRefreshActionKey(profile.id));
  const refreshingAllUsage = isPendingAction(refreshAllUsageActionKey);
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
                ${state.busy || refreshingUsage || refreshingAllUsage ? "disabled" : ""}
              >
                ${escapeHtml(usageButtonLabel)}
              </button>
            `
            : `
              <button
                class="button button-ghost usage-refresh-button"
                data-action="enable-codex-usage"
                ${state.busy || refreshingAllUsage ? "disabled" : ""}
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

function renderThirdPartyLatencyPanel(profile: ProfileSummary): string {
  if (!isThirdPartyBackedProfile(profile)) {
    return "";
  }

  const probe = profile.thirdPartyLatency;
  const updated = probe ? formatDateTime(probe.updatedAt) : "还没有";
  const refreshingLatency = isPendingAction(latencyProbeActionKey(profile.id));
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
          ${state.busy || refreshingLatency ? "disabled" : ""}
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

function formatThirdPartyUsageAmount(usage: ThirdPartyUsageSnapshot | null | undefined): string {
  if (!usage?.remaining) {
    return "--";
  }
  return [usage.remaining, usage.unit].filter(Boolean).join(" ");
}

function parseQuotaNumber(value: string | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatQuotaCurrency(value: string | null | undefined): string {
  const parsed = parseQuotaNumber(value);
  return parsed == null ? "--" : `$${parsed.toFixed(2)}`;
}

function clampQuotaPercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, value));
}

function quotaPercent(quota: ThirdPartyUsageQuotaSnapshot | null | undefined): number | null {
  const explicit = clampQuotaPercent(quota?.usedPercent);
  if (explicit != null) {
    return explicit;
  }
  const used = parseQuotaNumber(quota?.used);
  const total = parseQuotaNumber(quota?.total);
  if (used == null || total == null || total <= 0) {
    return null;
  }
  return clampQuotaPercent((used / total) * 100);
}

function formatQuotaPercent(quota: ThirdPartyUsageQuotaSnapshot | null | undefined): string {
  const percent = quotaPercent(quota);
  return percent == null ? "--" : `${Math.round(percent)}%`;
}

function formatProfileSummary(profile: ProfileSummary): string {
  if (isOfficialOauthProfile(profile)) {
    const usage = profile.codexUsage;
    if (usage?.error) {
      return "额度失败";
    }

    const primaryWindow = selectUsageWindow(usage, 300, true);
    const weeklyWindow = selectUsageWindow(usage, 10080, false);
    return `5H ${primaryWindow ? `${remainingPercent(primaryWindow.usedPercent)}%` : "--"} · WEEKLY ${weeklyWindow ? `${remainingPercent(weeklyWindow.usedPercent)}%` : "--"}`;
  }

  if (isThirdPartyBackedProfile(profile)) {
    const usage = profile.thirdPartyUsage;
    const probe = profile.thirdPartyLatency;
    return [
      `今日 ${formatQuotaCurrency(usage?.daily?.used)} / ${formatQuotaCurrency(usage?.daily?.total)}`,
      `本周 ${formatQuotaCurrency(usage?.weekly?.used)} / ${formatQuotaCurrency(usage?.weekly?.total)}`,
      `TTFT ${formatLatencyDuration(probe?.ttftMs ?? null)}`,
    ].join(" · ");
  }

  return "暂无摘要";
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

function renderThirdPartyUsagePanel(profile: ProfileSummary): string {
  if (!isThirdPartyBackedProfile(profile)) {
    return "";
  }

  const usage = profile.thirdPartyUsage ?? null;
  const updated = usage ? formatDateTime(usage.updatedAt) : "还没有";
  const refreshingUsage = isPendingAction(thirdPartyUsageActionKey(profile.id));
  const refreshingAllCodexUsage = isPendingAction(refreshAllUsageActionKey);
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
          ${state.busy || refreshingUsage || refreshingAllCodexUsage ? "disabled" : ""}
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

function renderThirdPartyRuntimePanel(profile: ProfileSummary): string {
  if (!isThirdPartyBackedProfile(profile)) {
    return "";
  }

  const usage = profile.thirdPartyUsage ?? null;
  const probe = profile.thirdPartyLatency;
  const refreshingUsage = isPendingAction(thirdPartyUsageActionKey(profile.id));
  const refreshingLatency = isPendingAction(latencyProbeActionKey(profile.id));
  const refreshingAllCodexUsage = isPendingAction(refreshAllUsageActionKey);
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
            ${state.busy || refreshingUsage || refreshingAllCodexUsage ? "disabled" : ""}
          >
            ${refreshingUsage ? "用量中..." : refreshingAllCodexUsage ? "等待中..." : "刷新用量"}
          </button>
          <button
            class="button button-ghost runtime-action-button"
            data-action="refresh-third-party-latency"
            data-id="${profile.id}"
            data-name="${escapeHtml(profile.name)}"
            ${state.busy || refreshingLatency ? "disabled" : ""}
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

function totalSafeRepairCandidates(report: SessionRecoveryReport): number {
  return (
    report.repairCandidates.missingRolloutFiles +
    report.repairCandidates.hasUserEventFalseButRolloutHasUserMessage +
    report.repairCandidates.dbThreadIdsMissingFromSessionIndex +
    report.repairCandidates.sessionIndexIdsMissingFromDb
  );
}

function totalTimeRepairCandidates(report: SessionRecoveryReport): number {
  return (
    report.repairCandidates.dbTimeMismatchWithSessionIndex +
    report.repairCandidates.rolloutMtimeMismatchWithSessionIndex
  );
}

function formatSessionRecoveryFlash(report: SessionRecoveryReport): string {
  const safeCandidates = totalSafeRepairCandidates(report);
  const timeCandidates = totalTimeRepairCandidates(report);
  const providerMismatch =
    report.repairCandidates.appDefaultModelProviderMismatch ?? 0;
  const outsideRecent =
    report.samples.savedRootsWithChatsOutsideRecentWindow.length;

  if (safeCandidates === 0 && timeCandidates === 0 && providerMismatch === 0) {
    if (outsideRecent > 0) {
      return `诊断完成：未发现真实索引损坏，但有 ${outsideRecent} 个旧项目落在 recent 窗口之外。`;
    }
    return "诊断完成：未发现需要修复的会话索引问题。";
  }

  if (providerMismatch > 0) {
    return `诊断发现 ${providerMismatch} 条活跃会话的 model provider 与当前默认 provider 不一致。切换 profile 时会执行安全会话修复并同步 provider。`;
  }

  return `诊断完成：安全修复候选 ${safeCandidates} 项，时间修复候选 ${timeCandidates} 项。`;
}

function formatSessionRepairFlash(result: SessionRepairResult, advanced: boolean): string {
  if (!result.repaired) {
    return result.note;
  }

  const updates = result.updates;
  const repairedSummary = [
    updates.hasUserEvent > 0 ? `has_user_event ${updates.hasUserEvent} 项` : null,
    updates.dbTime > 0 ? `数据库时间 ${updates.dbTime} 项` : null,
    updates.rolloutMtime > 0 ? `rollout mtime ${updates.rolloutMtime} 项` : null,
  ]
    .filter(Boolean)
    .join("，");

  return advanced
    ? `高级修复已完成：${repairedSummary || "没有需要回写的时间戳"}。`
    : `安全修复已完成：${repairedSummary || "没有需要落盘的修复项"}。`;
}


function renderProfileLayoutToggle(): string {
  return `
    <div class="profile-layout-toggle" role="group" aria-label="Profile layout">
      <button
        class="profile-layout-button ${state.profileLayout === "list" ? "active" : ""}"
        data-action="profile-layout-list"
        ${state.busy ? "disabled" : ""}
      >
        列表
      </button>
      <button
        class="profile-layout-button ${state.profileLayout === "grid" ? "active" : ""}"
        data-action="profile-layout-grid"
        ${state.busy ? "disabled" : ""}
      >
        卡片
      </button>
    </div>
  `;
}

function formatQuotaCurrencyCompact(value: string | null | undefined): string {
  const parsed = parseQuotaNumber(value);
  if (parsed == null) {
    return "--";
  }
  return `$${parsed.toFixed(2).replace(/\.00$/, "")}`;
}

function renderProfileRowMetrics(profile: ProfileSummary): string {
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

function renderProfileList(snapshot: AppSnapshot, profiles: ProfileSummary[]): string {
  return `
    <div class="profile-list" data-role="profile-list">
      ${profiles
        .map((profile) => {
          const live = snapshot.activeProfileId === profile.id;
          const refreshingCodexUsage = isPendingAction(usageRefreshActionKey(profile.id));
          const refreshingAllCodexUsage = isPendingAction(refreshAllUsageActionKey);
          const refreshingThirdPartyUsage = isPendingAction(thirdPartyUsageActionKey(profile.id));
          const refreshingLatency = isPendingAction(latencyProbeActionKey(profile.id));
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
                <span class="profile-row-action-slot" data-role="profile-row-primary-action">
                ${
                  live
                    ? `<span class="profile-row-status profile-row-status-live">生效中</span>`
                    : `<button class="button button-secondary profile-row-switch" data-action="switch" data-id="${profile.id}" data-name="${escapeHtml(profile.name)}" ${state.busy ? "disabled" : ""}>应用</button>`
                }
                </span>
                <span class="profile-row-action-slot" data-role="profile-row-quota-action">
                ${
                  isOfficialOauthProfile(profile)
                    ? snapshot.codexUsageApiEnabled
                      ? `
                        <button
                          class="button button-ghost profile-row-utility"
                          data-action="refresh-codex-usage"
                          data-id="${profile.id}"
                          data-name="${escapeHtml(profile.name)}"
                          ${state.busy || refreshingCodexUsage || refreshingAllCodexUsage ? "disabled" : ""}
                        >
                          ${refreshingCodexUsage ? "刷新中..." : "额度"}
                        </button>
                      `
                      : `
                        <button
                          class="button button-ghost profile-row-utility"
                          data-action="enable-codex-usage"
                          ${state.busy || refreshingAllCodexUsage ? "disabled" : ""}
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
                        ${state.busy || refreshingThirdPartyUsage || refreshingAllCodexUsage ? "disabled" : ""}
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
                        ${state.busy || refreshingLatency ? "disabled" : ""}
                      >
                        ${refreshingLatency ? "测速中..." : "测速"}
                      </button>
                    `
                    : `<span class="profile-row-action-placeholder">--</span>`
                }
                </span>
                <span class="profile-row-action-slot" data-role="profile-row-detail-action" style="display: flex; gap: 4px; align-items: center;">
                ${profile.authTypeLabel === "第三方 API"
                  ? `<button class="button button-ghost" data-action="generate-symbiotic" data-id="${profile.id}" title="以此配置生成共生配置" ${state.busy ? "disabled" : ""}>生成共生</button>`
                  : ""
                }
                <button class="button button-ghost profile-row-detail" title="查看和编辑完整信息" data-action="view-profile-details" data-id="${profile.id}" ${state.busy ? "disabled" : ""}>详情</button>
                </span>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderProfileGrid(snapshot: AppSnapshot, profiles: ProfileSummary[]): string {
  return `
    <div class="card-grid" data-role="profile-grid">
      ${profiles.length === 0 ? `
        <div class="empty-state">
          <h3>暂无存档记录</h3>
          <p>点击右上角 "+ 新建配置" 按钮录入您的第一套 Profile 集合吧！</p>
        </div>
      ` : ""}
      ${profiles
        .map(
          (profile) => `
            <article
              class="card profile-card ${snapshot.activeProfileId === profile.id ? "profile-card-live" : ""}"
              data-role="profile-card"
              data-state="${snapshot.activeProfileId === profile.id ? "live" : "idle"}"
            >
              <div class="card-head">
                <h2 title="${escapeHtml(profile.name)}">${escapeHtml(profile.name)}</h2>
                <div style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
                  ${snapshot.activeProfileId === profile.id ? `
                    <div class="status-badge">
                      <div class="status-dot status-dot-pulse"></div>
                      <span>Active</span>
                    </div>
                  ` : ""}
                  <span class="pill pill-type">${escapeHtml(profileTypeLabel(profile))}</span>
                </div>
              </div>
              <p class="card-note" style="${!profile.notes ? 'opacity:0.5;font-style:italic;' : ''}">${escapeHtml(profile.notes || "暂无备注")}</p>
              ${renderCodexUsagePanel(snapshot, profile)}
              ${renderThirdPartyRuntimePanel(profile)}

              <div class="card-actions-overlay">
                <div style="display: flex; flex-direction: column; gap: 4px; flex-grow: 1;">
                  <p class="card-date">更新于：${formatDateTime(profile.updatedAt)}</p>
                  ${snapshot.activeProfileId === profile.id
                    ? `<div class="env-active-label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> 环境生效中</div>`
                    : `<button class="button button-secondary" style="width:100%" data-action="switch" data-id="${profile.id}" data-name="${escapeHtml(profile.name)}" ${state.busy ? "disabled" : ""}>应用此配置</button>`}
                </div>

                <div class="card-secondary-actions" style="align-self: flex-end; padding-bottom: 2px; display: flex; gap: 4px;">
                  ${profile.authTypeLabel === "第三方 API"
                    ? `<button class="button button-ghost" data-action="generate-symbiotic" data-id="${profile.id}" title="以此配置生成共生配置" ${state.busy ? "disabled" : ""}>生成共生</button>`
                    : ""}
                  <button class="button button-ghost profile-row-detail" title="查看和编辑完整信息" data-action="view-profile-details" data-id="${profile.id}" ${state.busy ? "disabled" : ""}>详情</button>
                </div>
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function getEditorProfileSummary(snapshot: AppSnapshot | null): ProfileSummary | null {
  if (!snapshot || !state.editor.profileId) {
    return null;
  }
  return snapshot.profiles.find((profile) => profile.id === state.editor.profileId) ?? null;
}

function renderEditorRuntimePanel(snapshot: AppSnapshot, profile: ProfileSummary | null): string {
  if (!profile || state.editor.source !== "local") {
    return "";
  }

  const live = snapshot.activeProfileId === profile.id;
  return `
    <section class="editor-runtime" data-role="editor-runtime-panel">
      <div class="editor-runtime-head">
        <div>
          <span class="pill pill-type">${escapeHtml(profileTypeLabel(profile))}</span>
          ${live ? `<span class="profile-row-status profile-row-status-live">生效中</span>` : ""}
        </div>
        ${
          live
            ? ""
            : `<button class="button button-secondary" data-action="switch" data-id="${profile.id}" data-name="${escapeHtml(profile.name)}" ${state.busy ? "disabled" : ""}>应用此配置</button>`
        }
      </div>
      ${renderCodexUsagePanel(snapshot, profile)}
      ${renderThirdPartyUsagePanel(profile)}
      ${renderThirdPartyLatencyPanel(profile)}
    </section>
  `;
}

function renderThirdPartyConfigFields(readOnly: boolean): string {
  const disabled = state.busy || readOnly ? "disabled" : "";
  const officialProfiles = getOfficialOauthProfiles(state.snapshot);
  const selectedOauthProfileId = resolveSymbioticOauthProfileId();
  const isSymbiotic = state.editor.thirdParty.template === "symbioticThirdParty";
  const missingOauth = isSymbiotic && officialProfiles.length === 0;
  const tokenPlaceholder = isSymbiotic ? "第三方 API token" : "sk-...";

  // Build the option panels layout depending on selection
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
          value="${escapeHtml(state.editor.thirdParty.provider)}"
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
          value="${escapeHtml(state.editor.thirdParty.model)}"
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
          value="${escapeHtml(state.editor.thirdParty.baseUrl)}"
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
          value="${escapeHtml(state.editor.thirdParty.apiKey)}"
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
          value="${escapeHtml(state.editor.thirdParty.baseUrl)}"
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
          value="${escapeHtml(state.editor.thirdParty.apiKey)}"
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
          value="${escapeHtml(state.editor.thirdParty.model)}"
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
            ${state.editor.thirdParty.template === "standaloneThirdParty" ? "checked" : ""}
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

function renderNewProfileTabSelector(): string {
  const currentTab = state.editor.newTab || "manual-delta";
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
      <button class="tab-btn ${currentTab === "network" ? "active" : ""}" data-action="editor-tab-network">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path></svg>
        从云端共享库导入
      </button>
    </div>
  `;
}

function renderNewPageNetworkSection(): string {
  const authPrompt = `
    <div data-role="network-auth-prompt" style="display:flex; flex-direction:column; align-items:center; gap:10px; margin-top:14px;">
      <p style="max-width:520px; color:var(--text-muted); line-height:1.5;">
        云端共享库需要钉钉 SSO 登录。完成登录后客户端会自动连接企业共享库。
      </p>
      <div class="content-actions" style="justify-content:center; flex-wrap:wrap;">
        <button class="button button-primary" data-action="open-network-sso-login">
          钉钉 SSO 登录
        </button>
        <button class="button button-secondary" data-action="refresh-network-in-editor">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
          重新加载
        </button>
      </div>
    </div>
  `;

  if (state.networkLoading) {
    return `
      <div class="empty-state" style="border:none;background:transparent;padding:48px 0;">
        <div class="busy-dialog-spinner" style="margin: 0 auto 16px auto; width: 28px; height: 28px;"></div>
        <p style="color:var(--text-muted);">正在获取云端共享配置，请稍候...</p>
      </div>
    `;
  }

  if (state.networkAuthRequired || !state.networkSharing.token.trim()) {
    return `
      <div class="empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-muted);margin-bottom:12px;"><path d="M15 3h4a2 2 0 0 1 2 2v4"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>
        <h3>需要登录企业共享库</h3>
        ${authPrompt}
      </div>
    `;
  }

  if (state.networkProfiles.length === 0) {
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
      <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-main); margin:0;">可用云端共享配置 (${state.networkProfiles.length})</h3>
      <button class="button button-secondary" data-action="refresh-network-in-editor" style="padding:4px 10px; font-size:0.8rem; height:28px; display:inline-flex; align-items:center; gap:4px;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
        <span>刷新列表</span>
      </button>
    </div>
    <div class="card-grid" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px;">
      ${state.networkProfiles.map((profile) => `
        <article class="card profile-card" style="padding: 16px; display: flex; flex-direction: column; justify-content: space-between; min-height: 160px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-panel); transition: all 0.2s;">
          <div>
            <div class="card-head" style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px;">
              <h4 style="font-size:1rem; font-weight:700; color:var(--text-main); margin:0;" title="${escapeHtml(profile.name)}">${escapeHtml(profile.name)}</h4>
              <span class="pill pill-type" style="font-size:0.7rem; padding: 2px 6px; color:var(--text-muted); border-color:var(--border-light); background:var(--bg-page); flex-shrink: 0;">☁️ 远程</span>
            </div>
            <p style="font-size:0.85rem; color:var(--text-muted); margin: 0 0 12px 0; display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;line-height:1.4;">${escapeHtml(profile.description || "云端共享配置")}</p>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border-light); padding-top:12px; margin-top:auto;">
            <span style="font-size:0.75rem; color:var(--text-muted);">更新: ${formatDateTime(profile.createdAt).split(" ")[0]}</span>
            <div style="display:flex; gap:8px;">
              <button class="button button-ghost" data-action="view-network-profile-details" data-id="${profile.id}" style="padding: 4px 8px; font-size: 0.8rem; height: 28px;">
                详情
              </button>
              <button class="button button-primary" data-action="import-network-profile-to-editor" data-id="${profile.id}" style="padding: 4px 10px; font-size: 0.8rem; height: 28px; display:inline-flex; align-items:center; gap:2px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                导入
              </button>
            </div>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

async function importNetworkProfileToEditor(networkProfileId: string): Promise<void> {
  setBusy(true);
  try {
    const document = await fetchNetworkProfileDocument(networkProfileId);
    state.editor.name = document.name;
    state.editor.notes = document.notes;
    state.editor.authJson = document.authJson;
    state.editor.configToml = document.configToml;
    state.editor.newTab = "manual-full";
    state.editor.source = "local";
    state.editor.readOnly = false;
    clearFlash();
    setFlash("success", `已将共享配置「${document.name}」导入编辑器，您可以继续编辑并保存。`);
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
    render();
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getFlashIcon(kind: FlashKind): string {
  switch (kind) {
    case "success":
      return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    case "error":
      return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    case "info":
    default:
      return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  }
}

function renderFlash(): string {
  if (!state.flash) {
    return "";
  }

  return `
    <div class="toast-notification toast-${state.flash.kind}">
      <span class="toast-icon">${getFlashIcon(state.flash.kind)}</span>
      <span class="toast-text">${escapeHtml(state.flash.text)}</span>
      <button class="toast-close" data-action="clear-flash" aria-label="关闭">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
  `;
}

function renderBusyDialog(): string {
  if (!state.busyDialog) {
    return "";
  }

  return `
    <aside
      class="busy-dialog-backdrop"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-role="profile-switch-busy-dialog"
    >
      <div class="busy-dialog">
        <div class="busy-dialog-spinner" aria-hidden="true"></div>
        <div class="busy-dialog-copy">
          <h2>${escapeHtml(state.busyDialog.title)}</h2>
          <p>${escapeHtml(state.busyDialog.message)}</p>
          <div class="busy-dialog-progress" aria-hidden="true">
            <span></span>
          </div>
        </div>
      </div>
    </aside>
  `;
}







function renderCardsPage(snapshot: AppSnapshot): string {
  const migratingLegacyThirdParty = isPendingAction(migrateLegacyThirdPartyActionKey);
  const orderedProfiles = [...snapshot.profiles].sort((a, b) => {
    if (a.id === snapshot.activeProfileId) return -1;
    if (b.id === snapshot.activeProfileId) return 1;
    return 0;
  });

  return `
    <section class="cards-page" data-page="cards">
      <header class="content-header" data-tauri-drag-region>
        <div class="header-title">
          <h2>配置管理</h2>
          <span class="header-subtitle">共 ${snapshot.profiles.length} 个本地配置文件</span>
        </div>
        <div class="content-actions">
          <button class="button button-secondary" title="重新从本地目录读取配置文件" data-role="global-refresh" data-action="refresh" ${state.busy ? "disabled" : ""}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
            <span>同步本地配置</span>
          </button>
          <button class="button button-primary" data-role="add-card" data-action="new-profile" ${state.busy ? "disabled" : ""}>
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
              ${state.busy || isPendingActionPrefix("codex-usage") ? "disabled" : ""}
              style="padding: 6px 12px; font-size: 0.82rem; height: 32px; display: inline-flex; align-items: center; gap: 4px;"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
              <span>${isPendingAction(refreshAllUsageActionKey) ? "更新中..." : "更新全部额度用量"}</span>
            </button>
            ${renderProfileLayoutToggle()}
          </div>
        </div>
        ${
          state.profileLayout === "list"
            ? renderProfileList(snapshot, orderedProfiles)
            : renderProfileGrid(snapshot, orderedProfiles)
        }
      </section>
    </section>
  `;
}

function renderEditorPage(): string {
  const snapshot = state.snapshot;
  if (!snapshot) {
    return "";
  }
  const existing = state.editor.mode === "existing";
  const readOnly = state.editor.readOnly;
  const saveDisabled = state.busy || editorCannotSaveBecauseMissingOauth();
  const editorProfile = getEditorProfileSummary(snapshot);

  const showTabs = state.editor.mode === "new";
  const currentTab = state.editor.newTab || "manual-delta";

  const title =
    readOnly
      ? (state.editor.name || "查看网络共享配置")
      : state.editor.mode === "fromCurrent"
      ? "保存当前 Codex 配置为新 Profile"
      : existing
        ? (state.editor.name || "查看和编辑 Profile")
        : currentTab === "network"
        ? "从云端共享库导入"
        : "手动创建新 Profile";

  const subtitle =
    readOnly
      ? "该配置来自网络共享库，仅供查看，不能直接编辑或保存。"
      : state.editor.mode === "fromCurrent"
      ? "把当前 `.codex` 里的内容复制成一套新的 profile。"
      : existing
        ? "查看和编辑此 Profile 的配置文本。"
        : currentTab === "network"
        ? "选择一个可用的云端共享配置模板并导入到编辑器。"
        : "直接手工填写名称、备注以及配置内容。";

  let bodyContent = "";
  if (showTabs && currentTab === "network") {
    bodyContent = `
      <section class="new-profile-network-section">
        ${renderNewPageNetworkSection()}
      </section>
    `;
  } else {
    const configFields = (showTabs && currentTab === "manual-delta")
      ? renderThirdPartyConfigFields(readOnly)
      : `
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
              ${state.busy || readOnly ? "disabled" : ""}
            >${escapeHtml(state.editor.authJson)}</textarea>
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
              ${state.busy || readOnly ? "disabled" : ""}
            >${escapeHtml(state.editor.configToml)}</textarea>
          </div>
        </div>
      `;

    bodyContent = `
      <div class="editor-layout-grid">
        <!-- Left Main Column: Config inputs / textareas -->
        <div class="editor-main-column">
          ${configFields}
        </div>

        <!-- Right Sidebar Column: Metadata & stats -->
        <div class="editor-sidebar-column">
          <!-- Profile Basic Info Card -->
          <div class="sidebar-card">
            <div class="sidebar-card-title">基本信息</div>
            <label class="field">
              <span>Profile 名称</span>
              <input
                id="editor-name"
                type="text"
                value="${escapeHtml(state.editor.name)}"
                placeholder="例如：淘宝 1 / Work / Backup"
                ${state.busy || readOnly ? "disabled" : ""}
              />
            </label>

            <label class="field" style="margin-top: 16px;">
              <span>备注</span>
              <textarea
                id="editor-notes"
                rows="3"
                placeholder="写一点识别信息，比如账号用途、邮箱、额度状态"
                ${state.busy || readOnly ? "disabled" : ""}
              >${escapeHtml(state.editor.notes)}</textarea>
            </label>

            ${readOnly
              ? (state.editor.source === "network"
                ? `
                  <div class="sidebar-actions">
                    <button class="button button-primary button-full" data-action="import-current-network-profile" ${state.busy ? "disabled" : ""}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><polyline points="4 17 10 11 16 17"></polyline><polyline points="4 6 10 12 16 6"></polyline></svg>
                      导入并编辑配置
                    </button>
                  </div>
                `
                : "")
              : (showTabs && currentTab === "network")
                ? ""
                : `
                  <div class="sidebar-actions">
                    <button class="button button-primary button-full" data-action="save-and-switch" ${saveDisabled ? "disabled" : ""}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                      ${existing ? "保存并立即启动" : "创建并立即启动"}
                    </button>
                    ${existing && editorProfile?.authTypeLabel === "第三方 API" && state.editor.profileId
                      ? `
                        <button class="button button-secondary button-full" style="border-color: var(--accent); color: var(--accent); margin-bottom: 4px;" data-action="generate-symbiotic" data-id="${state.editor.profileId}">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                          生成共生配置
                        </button>
                      `
                      : ""
                    }
                    <div class="sidebar-actions-row">
                      <button class="button button-secondary" data-action="save-editor" ${saveDisabled ? "disabled" : ""}>
                        ${existing
                          ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>保存修改`
                          : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>创建配置`
                        }
                      </button>
                      ${existing && state.editor.profileId
                        ? `
                          <button
                            class="button button-danger"
                            data-action="delete-profile"
                            data-id="${state.editor.profileId}"
                            data-name="${escapeHtml(state.editor.name)}"
                            ${state.busy ? "disabled" : ""}
                          >
                            删除
                          </button>
                        `
                        : ""
                      }
                    </div>
                  </div>
                `
            }
          </div>

          <!-- Runtime panel (Quota metrics, speed tests) -->
          ${renderEditorRuntimePanel(snapshot, editorProfile)}

          <!-- Metadata card (Creation/Update time) -->
          ${existing || readOnly ? `
            <div class="sidebar-card metadata-card">
              <div class="sidebar-card-title">版本与时间</div>
              <div class="meta-row">
                <span class="meta-label">创建时间</span>
                <span class="meta-value">${formatDateTime(state.editor.createdAt)}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">最近更新</span>
                <span class="meta-value">${formatDateTime(state.editor.updatedAt)}</span>
              </div>
            </div>
          ` : ""}
        </div>
      </div>
    `;
  }

  return `
    <section class="editor-page" data-page="editor">
      <header class="editor-header">
        <div class="editor-header-left">
          <button class="button button-ghost" data-action="back-to-cards" ${state.busy ? "disabled" : ""}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            返回卡片网格
          </button>
          <div>
            <p class="eyebrow" style="display: none;">Profile Detail</p>
            <h1 style="margin-top: 4px;">${title}</h1>
            <p class="page-copy" style="display: none;">${subtitle}</p>
          </div>
        </div>
      </header>

      ${readOnly
        ? `
          <aside class="flash flash-info" data-role="editor-readonly-notice">
            <span>网络共享配置仅支持查看详情，不能直接编辑或保存。</span>
          </aside>
        `
        : ""}

      ${state.editor.mode === "existing" && state.editor.hasTargetChanges
        ? `
          <aside class="flash flash-info" data-role="editor-live-change-notice">
            <span>当前运行中的配置有变动，请保存以同步回这套 Profile。</span>
          </aside>
        `
        : ""}

      ${showTabs ? renderNewProfileTabSelector() : ""}

      ${bodyContent}
    </section>
  `;
}

function bindInputValue(selector: string, onInput: (value: string) => void): void {
  document.querySelector<HTMLInputElement>(selector)?.addEventListener("input", (event) => {
    onInput((event.currentTarget as HTMLInputElement).value);
  });
}

function render(): void {
  const snapshot = state.snapshot;

  let content = "";
  if (state.view === "cards" && snapshot) {
    content = renderCardsPage(snapshot);
  } else if (state.view === "settings") {
    content = renderSettingsPage();
  } else if (state.view === "sessions") {
    content = renderSessionsPage();
  } else if (state.view === "session-cleanup") {
    content = renderSessionCleanupPage();
  } else {
    content = renderEditorPage();
  }

  const hasPendingUpdate = state.update.lastResult?.hasUpdate ?? false;
  const currentVersionText = state.update.lastResult?.currentVersion ?? state.appVersion ?? "--";
  const updateVersionText = hasPendingUpdate
    ? `v${state.update.lastResult?.latestVersion ?? "--"}`
    : `v${currentVersionText}`;

  app.innerHTML = `
    <div class="app-layout">
      <aside class="app-sidebar">
        <div class="sidebar-header">
          <div class="app-logo">
            <svg class="app-logo-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="logo-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#22D3EE"/>
                  <stop offset="100%" stop-color="#4F46E5"/>
                </linearGradient>
              </defs>
              <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#logo-grad)"/>
              <rect x="6" y="9" width="12" height="6" rx="3" fill="rgba(255,255,255,0.2)" stroke="#FFFFFF" stroke-width="1.2"/>
              <circle cx="13.5" cy="12" r="2.2" fill="#FFFFFF"/>
            </svg>
            <span>Codex 助手</span>
          </div>
        </div>
        <nav class="sidebar-nav">
          <button class="nav-item ${state.view === 'cards' || state.view === 'editor' ? 'active' : ''}" data-action="nav-profiles">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            配置管理
          </button>
          <button class="nav-item ${state.view === 'sessions' ? 'active' : ''}" data-action="nav-sessions">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            会话管理
          </button>
          <button class="nav-item ${state.view === 'settings' ? 'active' : ''}" data-action="nav-settings">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            全局设置
          </button>
        </nav>
        <div class="sidebar-footer">
          <div class="version-status ${state.update.checking ? 'version-status-checking' : hasPendingUpdate ? 'version-status-update' : 'version-status-latest'}" data-role="update-entry" data-action="check-update" style="display: flex; align-items: center; gap: 8px; cursor: pointer;" title="${hasPendingUpdate ? '有新版本，点击下载并安装' : '最新版本，点击重新检查'}">
            <span class="version-status-dot"></span>
            <span>${
              state.update.checking
                ? "检测版本中..."
                : hasPendingUpdate
                  ? `有新版本 ${updateVersionText}`
                  : `最新版 v${currentVersionText}`
            }</span>
          </div>
        </div>
      </aside>
      <main class="app-main-content">
        ${content}
      </main>
      ${renderFlash()}
    </div>
    ${renderBusyDialog()}
  `;

  bindEvents();
}

function renderSettingsPage(): string {
  const migratingLegacyThirdParty = isPendingAction(migrateLegacyThirdPartyActionKey);
  const writingThirdPartyWebsocketsDefaults = isPendingAction(
    writeThirdPartyWebsocketsDefaultsActionKey,
  );

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
                value="${escapeHtml(state.networkSharing.profilesApi)}"
                placeholder="${escapeHtml(DEFAULT_NETWORK_PROFILES_API)}"
              />
            </label>
            <label class="field">
              <span>桌面访问令牌</span>
              <input
                id="network-profile-token"
                type="password"
                value="${escapeHtml(state.networkSharing.token)}"
                placeholder="cas_..."
                autocomplete="off"
              />
            </label>
            <div class="content-actions">
              <button class="button button-primary" data-action="open-network-sso-login">
                钉钉 SSO 登录
              </button>
              <a class="button button-secondary" href="${escapeHtml(networkPortalBaseUrl())}/profiles" target="_blank" rel="noreferrer">
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
              ${state.busy || migratingLegacyThirdParty ? "disabled" : ""}
            >
              ${migratingLegacyThirdParty ? "迁移中..." : "迁移旧第三方配置"}
            </button>
            <button
              class="button button-secondary"
              data-action="write-third-party-websockets-defaults"
              ${state.busy || writingThirdPartyWebsocketsDefaults ? "disabled" : ""}
            >
              ${writingThirdPartyWebsocketsDefaults ? "写入中..." : "写入第三方 WebSocket 默认值"}
            </button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function getSessionsListHtml(): string {
  // Filter sessions
  let filtered = state.sessions;
  if (state.sessionFilter === "active") {
    filtered = filtered.filter(s => !s.archived);
  } else if (state.sessionFilter === "archived") {
    filtered = filtered.filter(s => s.archived);
  }

  // Search filter
  const query = state.sessionSearchQuery.toLowerCase().trim();
  if (query) {
    filtered = filtered.filter(s =>
      (s.title && s.title.toLowerCase().includes(query)) ||
      s.id.toLowerCase().includes(query) ||
      (s.cwd && s.cwd.toLowerCase().includes(query))
    );
  }

  // Formatting helper for size
  const formatSize = (bytes?: number | null) => {
    if (bytes === undefined || bytes === null) return "未知大小";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const selectedSession = state.sessions.find(s => s.id === state.selectedSessionId);

  // Rendering session list (left pane content)
  let listHtml = "";
  if (state.sessionsLoading) {
    listHtml = `
      <div class="sessions-empty-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 40px 20px;">
        <div class="busy-dialog-spinner" style="margin: 0 auto; width: 24px; height: 24px; border-width: 2px;"></div>
        <span style="color: var(--text-muted); font-size: 0.85rem;">正在加载会话列表...</span>
      </div>
    `;
  } else if (filtered.length === 0) {
    listHtml = `<div class="sessions-empty-state">没有找到符合条件的会话</div>`;
  } else if (state.sessionSortOrder === "cwd") {
    // Group by CWD
    const groups: Record<string, CodexSessionInfo[]> = {};
    for (const s of filtered) {
      const cwd = s.cwd || "未指定工作空间";
      if (!groups[cwd]) groups[cwd] = [];
      groups[cwd].push(s);
    }

    // Sort cwd keys by the most recent session's update time descending (pre-calculated for performance)
    const cwdMaxTimes: Record<string, number> = {};
    for (const cwd of Object.keys(groups)) {
      cwdMaxTimes[cwd] = Math.max(...groups[cwd].map(s => s.updatedAtMs));
    }
    const sortedCwds = Object.keys(groups).sort((a, b) => {
      return cwdMaxTimes[b] - cwdMaxTimes[a];
    });
    for (const cwd of sortedCwds) {
      const folderSessions = groups[cwd];
      // Sort sessions within cwd by updatedAtMs descending
      folderSessions.sort((a, b) => b.updatedAtMs - a.updatedAtMs);

      listHtml += `
        <details class="workspace-group" open>
          <summary class="workspace-header">
            <svg class="icon-folder" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            <span class="workspace-title" title="${escapeHtml(cwd)}">${escapeHtml(cwd.split(/[/\\]/).pop() || cwd)}</span>
            <span class="workspace-count">${folderSessions.length}</span>
            <svg class="icon-chevron" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </summary>
          <div class="workspace-sessions">
            ${folderSessions.map(s => renderSessionItemHtml(s, selectedSession, formatSize)).join("")}
          </div>
        </details>
      `;
    }
  } else {
    // Sort by updatedAtMs descending
    const sorted = [...filtered].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    listHtml = `<div class="sessions-linear-list">${sorted.map(s => renderSessionItemHtml(s, selectedSession, formatSize)).join("")}</div>`;
  }
  return listHtml;
}

function getSessionDetailHtml(): string {
  const selectedSession = state.sessions.find(s => s.id === state.selectedSessionId);

  // Formatting helper for size
  const formatSize = (bytes?: number | null) => {
    if (bytes === undefined || bytes === null) return "未知大小";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  let rightPaneHtml = "";
  if (!selectedSession) {
    rightPaneHtml = `
      <div class="session-detail-empty">
        <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        <p>选择左侧的 Codex 会话以预览历史消息</p>
      </div>
    `;
  } else {
    rightPaneHtml = `
      <div class="session-detail-active">
        <header class="session-detail-header">
          <div class="session-detail-title-row">
            <h3 class="session-detail-title" title="${escapeHtml(selectedSession.title || selectedSession.id)}">
              ${escapeHtml(selectedSession.title || "未命名会话")}
            </h3>
            <span class="session-detail-badge ${selectedSession.archived ? 'badge-archived' : 'badge-active'}">
              ${selectedSession.archived ? '已归档' : '活跃'}
            </span>
          </div>
          <div class="session-detail-meta-row">
            <span class="meta-item">
              <strong>路径:</strong> <code title="${escapeHtml(selectedSession.rolloutPath || '')}">${escapeHtml(selectedSession.rolloutPath || '无')}</code>
            </span>
            <span class="meta-item">
              <strong>工作目录:</strong> <code title="${escapeHtml(selectedSession.cwd || '')}">${escapeHtml(selectedSession.cwd || '无')}</code>
            </span>
            <span class="meta-item">
              <strong>大小:</strong> ${formatSize(selectedSession.fileSize)}
            </span>
            ${selectedSession.modelProvider ? `
              <span class="meta-item">
                <strong>提供商:</strong> <span class="pill pill-provider">${escapeHtml(selectedSession.modelProvider)}</span>
              </span>
            ` : ""}
          </div>
          <div class="session-detail-actions">
            <button class="button button-secondary" data-action="rename-session" data-id="${selectedSession.id}">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
              重命名
            </button>
            <button class="button button-secondary" data-action="toggle-archive-session" data-id="${selectedSession.id}" data-archived="${selectedSession.archived}">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="9"></line><line x1="9" y1="13" x2="15" y2="13"></line><line x1="9" y1="17" x2="15" y2="17"></line></svg>
              ${selectedSession.archived ? '取消归档' : '归档会话'}
            </button>
            <button class="button button-secondary" data-action="export-session" data-id="${selectedSession.id}">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"></path></svg>
              导出
            </button>
            <button class="button button-danger" data-action="delete-session" data-id="${selectedSession.id}">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              彻底删除
            </button>
          </div>
        </header>
        <div class="session-messages-container">
          ${renderSessionMessages()}
        </div>
      </div>
    `;
  }
  return rightPaneHtml;
}

function refreshSessionsListView(): void {
  const listScroll = document.querySelector(".sessions-list-scroll");
  if (listScroll) {
    listScroll.innerHTML = getSessionsListHtml();
  }
}

function refreshSessionDetailPane(): void {
  const detailPane = document.querySelector(".sessions-detail-pane");
  if (detailPane) {
    detailPane.innerHTML = getSessionDetailHtml();
  }
}

function renderSessionsPage(): string {
  const listHtml = getSessionsListHtml();
  const rightPaneHtml = getSessionDetailHtml();

  return `
    <div class="sessions-page-container">
      <div class="sessions-sidebar-pane">
        <div class="sessions-pane-header" data-tauri-drag-region style="display: flex; justify-content: space-between; align-items: center;">
          <h2>Codex 会话管理</h2>
          <button class="icon-button" data-action="nav-session-cleanup" title="清理旧会话" style="width: 28px; height: 28px; border-radius: 6px;">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
        </div>
        <div class="sessions-pane-filters">
          <div class="search-input-wrapper">
            <svg class="search-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" id="session-search" placeholder="搜索标题、工作空间..." value="${escapeHtml(state.sessionSearchQuery)}">
            <span id="search-clear-container">
              ${state.sessionSearchQuery ? `<button class="search-clear-btn" id="session-search-clear">×</button>` : ""}
            </span>
          </div>
          <div class="filter-controls-row">
            <div class="filter-group">
              <button class="filter-tab ${state.sessionFilter === 'all' ? 'active' : ''}" data-filter="all">全部</button>
              <button class="filter-tab ${state.sessionFilter === 'active' ? 'active' : ''}" data-filter="active">活跃</button>
              <button class="filter-tab ${state.sessionFilter === 'archived' ? 'active' : ''}" data-filter="archived">已归档</button>
            </div>
            <div class="sort-group">
              <button class="sort-btn ${state.sessionSortOrder === 'time' ? 'active' : ''}" data-sort="time" title="按时间排序">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              </button>
              <button class="sort-btn ${state.sessionSortOrder === 'cwd' ? 'active' : ''}" data-sort="cwd" title="按工作空间分组">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
              </button>
            </div>
          </div>
        </div>
        <div class="sessions-list-scroll">
          ${listHtml}
        </div>
      </div>
      <div class="sessions-detail-pane">
        ${rightPaneHtml}
      </div>
    </div>
  `;
}

function renderSessionItemHtml(
  s: CodexSessionInfo,
  selectedSession: CodexSessionInfo | undefined,
  formatSize: (bytes?: number | null) => string
): string {
  const isSelected = selectedSession && selectedSession.id === s.id;

  // High-performance custom formatting to bypass slow Intl/toLocaleString inside list renders
  const date = new Date(s.updatedAtMs);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const timeStr = `${month}月${day}日 ${hours}:${minutes}`;

  return `
    <div class="session-item-card ${isSelected ? 'selected' : ''}" data-action="select-session" data-id="${s.id}">
      <div class="session-card-header">
        <span class="session-card-title" title="${escapeHtml(s.title || s.id)}">${escapeHtml(s.title || "未命名会话")}</span>
        ${s.archived ? `<span class="session-card-archive-badge">已归档</span>` : ""}
      </div>
      <div class="session-card-details">
        <span class="session-card-cwd" title="${escapeHtml(s.cwd || '')}">${escapeHtml(s.cwd ? (s.cwd.split(/[/\\]/).pop() || '') : '无目录')}</span>
        <div class="session-card-meta">
          <span>${timeStr}</span>
          <span class="dot-separator">•</span>
          <span>${formatSize(s.fileSize)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderSessionMessages(): string {
  if (state.messagesLoading) {
    return `
      <div class="messages-loading-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 100%; min-height: 200px; padding: 40px 20px;">
        <div class="busy-dialog-spinner" style="margin: 0 auto; width: 24px; height: 24px; border-width: 2px;"></div>
        <span style="color: var(--text-muted); font-size: 0.85rem;">正在加载会话消息...</span>
      </div>
    `;
  }

  if (state.sessionMessages.length === 0) {
    return `<div class="messages-empty">该会话暂无消息，或对话文件为空。</div>`;
  }

  return state.sessionMessages.map(msg => {
    const isUser = msg.role === "user";
    const bubbleClass = isUser ? "msg-user" : "msg-assistant";
    const avatarChar = isUser ? "👤" : "🤖";
    const displayName = isUser ? "User" : "Codex";

    return `
      <div class="message-bubble-wrapper ${bubbleClass}">
        <div class="message-avatar">${avatarChar}</div>
        <div class="message-content-box">
          <div class="message-sender">${displayName}</div>
          <div class="message-text">${formatMessageText(msg.text)}</div>
        </div>
      </div>
    `;
  }).join("");
}

function formatMessageText(text: string): string {
  // Escape HTML first to prevent XSS
  let escaped = escapeHtml(text);

  // Replace code blocks: ```lang ... ```
  escaped = escaped.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, codeContent) => {
    return `<pre class="code-block" data-lang="${lang || 'code'}"><code>${codeContent}</code></pre>`;
  });

  // Replace inline code: `code`
  escaped = escaped.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Replace markdown links: [text](url)
  escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="chat-link">$1</a>');

  // Replace paragraph newlines
  escaped = escaped.split('\n').join('<br>');

  return escaped;
}

function renderSessionCleanupPage(): string {
  const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const oneMonthAgo = now - ONE_MONTH_MS;

  // Formatting helper for size
  const formatSize = (bytes?: number | null) => {
    if (bytes === undefined || bytes === null) return "未知大小";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Group all sessions by CWD
  const groups: Record<string, CodexSessionInfo[]> = {};
  for (const s of state.sessions) {
    const cwd = s.cwd || "未指定工作空间";
    if (!groups[cwd]) groups[cwd] = [];
    groups[cwd].push(s);
  }

  // 1. Projects with NO sessions updated in the last 30 days
  interface InactiveProject {
    cwd: string;
    sessions: CodexSessionInfo[];
    lastActiveTime: number;
  }

  const inactiveProjects: InactiveProject[] = [];
  for (const [cwd, sessions] of Object.entries(groups)) {
    // Find the latest update time in this group
    const latestActive = Math.max(...sessions.map(s => s.updatedAtMs));
    if (latestActive < oneMonthAgo) {
      inactiveProjects.push({
        cwd,
        sessions,
        lastActiveTime: latestActive
      });
    }
  }

  // Sort inactive projects by lastActiveTime descending (most recently inactive first)
  inactiveProjects.sort((a, b) => b.lastActiveTime - a.lastActiveTime);

  // 2. Individual sessions updated more than 30 days ago
  const oldSessions = state.sessions
    .filter(s => s.updatedAtMs < oneMonthAgo)
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);

  // Render inactive projects HTML
  let projectsHtml = "";
  if (inactiveProjects.length === 0) {
    projectsHtml = `<div class="cleanup-empty-state">没有超过 1 个月未活跃的项目</div>`;
  } else {
    projectsHtml = `
      <div class="cleanup-list">
        ${inactiveProjects.map(p => {
          const date = new Date(p.lastActiveTime);
          const timeStr = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
          const totalSize = p.sessions.reduce((acc, s) => acc + (s.fileSize || 0), 0);
          const idsJson = JSON.stringify(p.sessions.map(s => s.id));
          return `
            <div class="cleanup-project-card">
              <div class="project-info">
                <svg class="icon-folder" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                <div class="project-details">
                  <span class="project-path" title="${escapeHtml(p.cwd)}">${escapeHtml(p.cwd)}</span>
                  <div class="project-meta">
                    <span>最后活跃: ${timeStr}</span>
                    <span class="dot-separator">•</span>
                    <span>会话总数: ${p.sessions.length} 个</span>
                    <span class="dot-separator">•</span>
                    <span>总计占用: ${formatSize(totalSize)}</span>
                  </div>
                </div>
              </div>
              <button class="button button-danger btn-clean-project" data-cwd="${escapeHtml(p.cwd)}" data-ids='${escapeHtml(idsJson)}'>
                清空项目会话
              </button>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  // Render old sessions HTML
  let sessionsHtml = "";
  if (oldSessions.length === 0) {
    sessionsHtml = `<div class="cleanup-empty-state">没有超过 1 个月的旧会话</div>`;
  } else {
    sessionsHtml = `
      <div class="batch-action-bar">
        <label class="checkbox-wrapper select-all-wrapper">
          <input type="checkbox" id="cleanup-select-all">
          <span>全选所有旧会话 (${oldSessions.length})</span>
        </label>
        <button class="button button-danger" id="cleanup-batch-delete-btn" disabled>
          批量物理删除 (已选 <span id="cleanup-selected-count">0</span>)
        </button>
      </div>
      <div class="cleanup-table-wrapper">
        <table class="cleanup-table">
          <thead>
            <tr>
              <th width="40"></th>
              <th>会话标题</th>
              <th>工作空间 (CWD)</th>
              <th width="120">最后活跃</th>
              <th width="100">大小</th>
              <th width="80">操作</th>
            </tr>
          </thead>
          <tbody>
            ${oldSessions.map(s => {
              const date = new Date(s.updatedAtMs);
              const timeStr = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
              return `
                <tr class="cleanup-row" data-id="${s.id}">
                  <td>
                    <input type="checkbox" class="cleanup-item-checkbox" data-id="${s.id}">
                  </td>
                  <td class="cell-title" title="${escapeHtml(s.title || s.id)}">
                    <strong>${escapeHtml(s.title || "未命名会话")}</strong>
                    ${s.archived ? `<span class="session-card-archive-badge">已归档</span>` : ""}
                  </td>
                  <td class="cell-cwd" title="${escapeHtml(s.cwd || '')}">
                    <code>${escapeHtml(s.cwd || '无')}</code>
                  </td>
                  <td>${timeStr}</td>
                  <td>${formatSize(s.fileSize)}</td>
                  <td>
                    <button class="button button-danger btn-clean-single-session" data-id="${s.id}">删除</button>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  return `
    <div class="cleanup-page-container">
      <header class="cleanup-header">
        <div style="display: flex; align-items: center; gap: 12px;">
          <button class="icon-button" data-action="back-to-sessions" title="返回会话管理">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          </button>
          <h2>会话清理</h2>
        </div>
        <p class="cleanup-subtitle">清理长期未使用的会话，物理删除对话 rollout 文件，释放磁盘空间。</p>
      </header>

      <div class="cleanup-sections-wrapper">
        <div class="cleanup-section">
          <div class="cleanup-section-header">
            <h3>超过 1 个月没有任何会话产生的工作空间项目 (${inactiveProjects.length})</h3>
            <span class="section-desc">这些项目的开发工作可能已经结束，可以安全清理。</span>
          </div>
          ${projectsHtml}
        </div>

        <div class="cleanup-section">
          <div class="cleanup-section-header">
            <h3>所有项目中早于 1 个月的旧会话 (${oldSessions.length})</h3>
            <span class="section-desc">清理时间久远的聊天记录，保留近期活动。</span>
          </div>
          ${sessionsHtml}
        </div>
      </div>
    </div>
  `;
}

async function fetchCodexSessions(): Promise<void> {
  if (!isTauriRuntime) {
    state.sessions = [
      {
        id: "session-1",
        rolloutPath: "/Users/example/.codex/sessions/2026/05/21/rollout-1.jsonl",
        updatedAtMs: Date.now() - 1000 * 60 * 10,
        cwd: "/Volumes/Acer/Dev/codex_auth_switch",
        title: "新增会话管理功能讨论",
        hasUserEvent: true,
        archived: false,
        modelProvider: "openai",
        fileSize: 12048,
      },
      {
        id: "session-2",
        rolloutPath: "/Users/example/.codex/sessions/2026/05/20/rollout-2.jsonl",
        updatedAtMs: Date.now() - 1000 * 60 * 60 * 25,
        cwd: "/Volumes/Acer/Dev/another_project",
        title: "修复 Tailwind 样式错误",
        hasUserEvent: true,
        archived: false,
        modelProvider: "anthropic",
        fileSize: 4567,
      },
      {
        id: "session-3",
        rolloutPath: "/Users/example/.codex/archived_sessions/rollout-3.jsonl",
        updatedAtMs: Date.now() - 1000 * 60 * 60 * 24 * 5,
        cwd: "/Volumes/Acer/Dev/codex_auth_switch",
        title: "旧的登录逻辑重构",
        hasUserEvent: true,
        archived: true,
        modelProvider: "openai",
        fileSize: 85930,
      }
    ];
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
    state.sessionMessages = [
      { role: "user", text: "我想给 app新增一个功能，就是 codex 会话管理，有什么建议没有" },
      { role: "assistant", text: "这是一个非常好的想法！Codex 的会话非常多，如果能提供会话列表、归档和物理删除功能，对管理磁盘空间 and 历史记录非常有帮助。以下是我的建议：\n\n1. 双栏布局：左侧是会话列表，可以按更新时间或工作空间目录分组；右侧是消息预览。\n2. 重命名：可以调用 SQLite 和 `session_index.jsonl` 同步更新会话标题。\n3. 归档与删除：归档移动到 `archived_sessions/` 目录，删除则物理删除 rollout 文件并从 SQLite 中删除。" },
    ];
    refreshSessionDetailPane();
    return;
  }

  state.messagesLoading = true;
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

function exportCodexSessionToMarkdown(session: CodexSessionInfo, messages: CodexMessage[]) {
  let md = `# Codex Session: ${session.title || "Untitled Session"}\n`;
  md += `- **Session ID**: \`${session.id}\`\n`;
  md += `- **Directory**: \`${session.cwd || "N/A"}\`\n`;
  md += `- **Date**: ${new Date(session.updatedAtMs).toLocaleString()}\n`;
  md += `- **Model Provider**: \`${session.modelProvider || "unknown"}\`\n\n`;
  md += `---\n\n`;

  for (const msg of messages) {
    const roleName = msg.role === "user" ? "User" : "Codex";
    md += `### 👤 ${roleName}\n\n${msg.text}\n\n`;
  }

  const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `codex-session-${session.id}.md`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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
  });

  document.querySelectorAll<HTMLInputElement>('input[name="profile-template"]').forEach((input) => {
    input.addEventListener("change", (event) => {
      const value = (event.currentTarget as HTMLInputElement).value as NewProfileTemplate;
      state.editor.thirdParty.template = value;
      if (value === "symbioticThirdParty") {
        state.editor.thirdParty.oauthProfileId = resolveSymbioticOauthProfileId();
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
      } else if (action === "nav-settings") {
        if (state.view !== "settings") {
          state.view = "settings";
          render();
        }
      } else if (action === "save-network-sharing-settings") {
        saveNetworkSharingSettings(state.networkSharing);
        state.networkAuthRequired = !state.networkSharing.token.trim();
        state.networkProfiles = [];
        setFlash("success", "已保存企业共享库设置。");
        render();
      } else if (action === "open-network-sso-login") {
        await openNetworkSsoLogin();
      } else if (action === "refresh-network-after-settings") {
        saveNetworkSharingSettings(state.networkSharing);
        state.networkAuthRequired = !state.networkSharing.token.trim();
        state.networkProfiles = [];
        state.activeTab = "network";
        state.view = "cards";
        await fetchNetworkProfiles();
      } else if (action === "nav-sessions") {
        if (state.view !== "sessions") {
          state.view = "sessions";
          render();
          await fetchCodexSessions();
        }
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
      } else if (action === "editor-tab-network") {
        state.editor.newTab = "network";
        if (!state.networkSharing.token.trim()) {
          state.networkAuthRequired = true;
          render();
        } else if (state.networkProfiles.length === 0) {
          await fetchNetworkProfiles();
        } else {
          render();
        }
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
        state.editor.mode = "new";
        state.editor.newTab = "manual-full";
        state.editor.source = "local";
        state.editor.readOnly = false;
        clearFlash();
        setFlash("success", `已将共享配置「${state.editor.name}」载入编辑器，您可以修改参数并创建新配置。`);
        render();
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
void loadAppVersion();
void refreshSnapshot();
startAutoUpdateChecker();
