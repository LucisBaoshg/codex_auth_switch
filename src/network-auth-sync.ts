type SharedAuthLocalState = {
  remoteProfileId?: string | null;
  remoteContentVersion?: number | null;
  remoteContentHash?: string | null;
};

type SharedAuthRemoteState = {
  id: string;
  contentVersion?: number | null;
  contentHash?: string | null;
};

export type SharedAuthWriteBackBase = {
  baseContentVersion: number | null;
  baseContentHash: string | null;
};

function normalizedHash(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function shouldWriteBackSharedAuth(
  local: SharedAuthLocalState,
  remote: SharedAuthRemoteState | null | undefined,
): boolean {
  const remoteProfileId = local.remoteProfileId?.trim();
  if (!remoteProfileId || !remote || remote.id !== remoteProfileId) {
    return false;
  }

  if (
    typeof local.remoteContentVersion === "number" &&
    typeof remote.contentVersion === "number" &&
    remote.contentVersion > local.remoteContentVersion
  ) {
    return false;
  }

  const localHash = normalizedHash(local.remoteContentHash);
  const remoteHash = normalizedHash(remote.contentHash);
  if (
    localHash &&
    remoteHash &&
    localHash !== remoteHash &&
    local.remoteContentVersion === remote.contentVersion
  ) {
    return false;
  }

  return true;
}

export function sharedAuthWriteBackBase(
  local: SharedAuthLocalState,
  remote: SharedAuthRemoteState | null | undefined,
): SharedAuthWriteBackBase {
  return {
    baseContentVersion: local.remoteContentVersion ?? remote?.contentVersion ?? null,
    baseContentHash: normalizedHash(local.remoteContentHash) ?? normalizedHash(remote?.contentHash),
  };
}
