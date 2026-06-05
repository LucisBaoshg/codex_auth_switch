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
