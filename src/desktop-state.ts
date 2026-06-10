import type { BusyDialogState } from "./app-chrome-renderers";
import type {
  AppSnapshot,
  CodexUsageStatsFilter,
  CodexUsageStatsSnapshot,
  UpdateCheckResult,
} from "./desktop-types";
import type { FlashKind } from "./html-utils";
import type {
  NetworkProfile,
  NetworkUserPrincipal,
  ShareUserOption,
} from "./network-profile-utils";
import { isOwnNetworkProfile } from "./network-profile-utils";
import type { NetworkSharingSettings } from "./network-sharing";
import {
  resolveSelectedProfileId,
  resolveShareDraftProfileId,
} from "./profile-selection";
import {
  createEditorState,
  createLocalShareDraft,
  type EditorState,
  type LocalShareDraft,
  type SharedProfileEditDraft,
} from "./profile-editor-state";
import type { ProfileLayoutMode } from "./profile-list-renderers";
import type {
  SessionFilter,
  SessionRenderState,
  SessionSortOrder,
} from "./session-renderers";
import type { CleanupFilter } from "./session-cleanup-renderers";
import type { CodexMessage, CodexSessionInfo } from "./session-utils";
import type { SharingCenterTab } from "./sharing-center-renderers";

export type ViewMode =
  | "cards"
  | "editor"
  | "sharing"
  | "settings"
  | "sessions"
  | "session-cleanup"
  | "usage-stats";
export type PlatformMode = "codex";

export type DesktopState = {
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
  sharingCenterTab: SharingCenterTab;
  profileLayout: ProfileLayoutMode;
  networkProfiles: NetworkProfile[];
  networkLoading: boolean;
  networkAuthRequired: boolean;
  networkSharing: NetworkSharingSettings;
  networkUser: NetworkUserPrincipal | null;
  networkUserLoading: boolean;
  shareUsers: ShareUserOption[];
  shareUsersLoading: boolean;
  shareDraft: LocalShareDraft;
  sharedProfileEditDraft: SharedProfileEditDraft | null;
  appVersion: string | null;
  update: {
    checking: boolean;
    lastResult: UpdateCheckResult | null;
  };
  sessions: CodexSessionInfo[];
  selectedSessionId: string | null;
  sessionMessages: CodexMessage[];
  sessionSearchQuery: string;
  sessionFilter: SessionFilter;
  sessionSortOrder: SessionSortOrder;
  sessionsLoading: boolean;
  messagesLoading: boolean;
  showAllMessages: boolean;
  cleanupFilter: CleanupFilter;
  usageStatsFilter: CodexUsageStatsFilter;
  usageStats: CodexUsageStatsSnapshot | null;
  usageStatsLoading: boolean;
  usageStatsError: string | null;
  usageStatsActiveTab: "logs" | "trends" | "breakdowns";
};

function defaultUsageStatsFilter(): CodexUsageStatsFilter {
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    startDate,
    endDate,
    model: null,
    effort: null,
  };
}

export function createDesktopState(networkSharing: NetworkSharingSettings): DesktopState {
  return {
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
    sharingCenterTab: "own",
    profileLayout: "list",
    networkProfiles: [],
    networkLoading: false,
    networkAuthRequired: !networkSharing.token,
    networkSharing,
    networkUser: null,
    networkUserLoading: false,
    shareUsers: [],
    shareUsersLoading: false,
    shareDraft: createLocalShareDraft(),
    sharedProfileEditDraft: null,
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
    showAllMessages: false,
    cleanupFilter: "30d",
    usageStatsFilter: defaultUsageStatsFilter(),
    usageStats: null,
    usageStatsLoading: false,
    usageStatsError: null,
    usageStatsActiveTab: "logs",
  };
}

export function applySnapshotToDesktopState(state: DesktopState, snapshot: AppSnapshot): void {
  state.snapshot = snapshot;
  state.selectedProfileId = resolveSelectedProfileId(snapshot, state.selectedProfileId);
  state.shareDraft.profileId = resolveShareDraftProfileId(snapshot, state.shareDraft.profileId);
}

export function selectSessionRenderState(state: DesktopState): SessionRenderState {
  return {
    sessions: state.sessions,
    selectedSessionId: state.selectedSessionId,
    sessionMessages: state.sessionMessages,
    sessionSearchQuery: state.sessionSearchQuery,
    sessionFilter: state.sessionFilter,
    sessionSortOrder: state.sessionSortOrder,
    sessionsLoading: state.sessionsLoading,
    messagesLoading: state.messagesLoading,
    showAllMessages: state.showAllMessages,
  };
}

export function selectOwnNetworkProfiles(state: DesktopState): NetworkProfile[] {
  return state.networkProfiles.filter((profile) => isOwnNetworkProfile(profile, state.networkUser));
}
