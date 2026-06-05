export const codexUsageActionPrefix = "codex-usage";
export const refreshAllUsageActionKey = `${codexUsageActionPrefix}:all`;
export const migrateLegacyThirdPartyActionKey = "third-party:migrate-legacy";
export const writeThirdPartyWebsocketsDefaultsActionKey = "third-party:websockets-defaults";

export function usageRefreshActionKey(profileId: string): string {
  return `${codexUsageActionPrefix}:${profileId}`;
}

export function latencyProbeActionKey(profileId: string): string {
  return `latency-probe:${profileId}`;
}

export function thirdPartyUsageActionKey(profileId: string): string {
  return `third-party-usage:${profileId}`;
}
