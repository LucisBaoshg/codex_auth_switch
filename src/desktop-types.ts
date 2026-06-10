import type {
  CodexUsageSnapshot,
  ThirdPartyLatencySnapshot,
  ThirdPartyUsageSnapshot,
} from "./usage-formatters";

export type ProfileSummary = {
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

export type ProfileDocument = {
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

export type AppSnapshot = {
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

export type CodexUsageStatsSyncResult = {
  imported: number;
  skipped: number;
  filesScanned: number;
  errors: string[];
};

export type CodexUsageStatsFilter = {
  startDate?: string | null;
  endDate?: string | null;
  model?: string | null;
  effort?: string | null;
};

export type CodexUsageStatsSummary = {
  totalRequests: number;
  totalCostUsd: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalReasoningOutputTokens: number;
  realTotalTokens: number;
  cacheHitRate: number;
};

export type CodexUsageStatsTrend = {
  date: string;
  requestCount: number;
  totalCostUsd: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalReasoningOutputTokens: number;
  realTotalTokens: number;
};

export type CodexUsageStatsBreakdown = {
  name: string;
  requestCount: number;
  totalCostUsd: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalReasoningOutputTokens: number;
  realTotalTokens: number;
};

export type CodexUsageStatsLog = {
  requestId: string;
  sessionId: string;
  model: string;
  provider: string;
  effort: string;
  createdAt: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningOutputTokens: number;
  totalCostUsd: string;
  sourcePath: string;
};

export type CodexUsageStatsSnapshot = {
  updatedAt: string;
  filter: CodexUsageStatsFilter;
  sync: CodexUsageStatsSyncResult;
  summary: CodexUsageStatsSummary;
  trends: CodexUsageStatsTrend[];
  modelBreakdown: CodexUsageStatsBreakdown[];
  effortBreakdown: CodexUsageStatsBreakdown[];
  availableModels: string[];
  availableEfforts: string[];
  logs: CodexUsageStatsLog[];
};

export type LegacyThirdPartyMigrationResult = {
  migratedProfileIds: string[];
  skippedProfileIds: string[];
};

export type ThirdPartyWebsocketsDefaultResult = {
  updatedProfileIds: string[];
  skippedProfileIds: string[];
};

export type UpdateCheckResult = {
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

export type InstallLocationStatus = {
  updateSafe: boolean;
  requiresApplicationsInstall: boolean;
  installPath: string;
  message: string | null;
};
