import type { NetworkProfile } from "./network-profile-utils";

export const localOauthProfileAuth = '{"auth_mode":"chatgpt"}';

function parseNetworkProfileAuth(authJson: string): Record<string, unknown> {
  const auth: unknown = JSON.parse(authJson);
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) {
    throw new Error("共享授权文件必须是 JSON 对象。");
  }
  return auth as Record<string, unknown>;
}

export function networkProfileAuthContent(authJson: string): string {
  const auth = parseNetworkProfileAuth(authJson);
  const tokens = auth.tokens as Record<string, unknown> | null | undefined;
  if (auth.auth_mode === "chatgpt" || (tokens && typeof tokens === "object")) {
    const accessToken = tokens?.access_token;
    const idToken = tokens?.id_token;
    if (typeof accessToken !== "string" || !accessToken.trim() || typeof idToken !== "string" || !idToken.trim()) {
      throw new Error("该档案缺少可共享的官方授权，请启用这份档案并在 Codex 登录后重新发布。");
    }
  }
  return authJson;
}

export function sharedProfileAuthPreview(authJson: string): string {
  try {
    const auth = parseNetworkProfileAuth(authJson);
    if (auth.tokens && typeof auth.tokens === "object") {
      return JSON.stringify({ auth_mode: auth.auth_mode ?? "chatgpt", tokens: "共享授权已隐藏，应用时使用" }, null, 2);
    }
  } catch {
    // The read-only view can still show entries saved by older clients.
  }
  return authJson;
}

type SharedAuthLocalState = {
  remoteProfileId?: string | null;
  remoteContentVersion?: number | null;
  remoteContentHash?: string | null;
};

type SharedAuthRemoteState = {
  id: string;
  ownerDingUserId?: string | null;
  contentVersion?: number | null;
  contentHash?: string | null;
};

type SharedAuthCurrentUser = {
  dingUserId?: string | null;
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
  currentUser: SharedAuthCurrentUser | null | undefined,
): boolean {
  const remoteProfileId = local.remoteProfileId?.trim();
  if (!remoteProfileId || !remote || remote.id !== remoteProfileId) {
    return false;
  }
  if (
    !remote.ownerDingUserId?.trim() ||
    !currentUser?.dingUserId?.trim() ||
    remote.ownerDingUserId.trim().toLowerCase() !== currentUser.dingUserId.trim().toLowerCase()
  ) {
    return false;
  }

  if (
    typeof local.remoteContentVersion === "number" &&
    typeof remote.contentVersion === "number" &&
    remote.contentVersion !== local.remoteContentVersion
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

export function sharedProfileHasNewerRemote(
  local: SharedAuthLocalState,
  remote: SharedAuthRemoteState | null | undefined,
): boolean {
  const remoteProfileId = local.remoteProfileId?.trim();
  if (!remoteProfileId || !remote || remote.id !== remoteProfileId) {
    return false;
  }

  const localVersion = local.remoteContentVersion;
  const remoteVersion = remote.contentVersion;
  if (typeof remoteVersion === "number") {
    if (typeof localVersion !== "number") {
      return true;
    }
    if (remoteVersion > localVersion) {
      return true;
    }
    if (remoteVersion < localVersion) {
      return false;
    }
  }

  const localHash = normalizedHash(local.remoteContentHash);
  const remoteHash = normalizedHash(remote.contentHash);
  if (remoteHash && !localHash) {
    return true;
  }
  if (localHash && remoteHash && localHash !== remoteHash) {
    return true;
  }

  return false;
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

export async function fetchSharedProfileBundle(
  apiUrl: string,
  networkProfileId: string,
  fetchOptions: RequestInit,
  unauthorized: (action: string) => Error,
) {
  const detailUrl = `${apiUrl}/${encodeURIComponent(networkProfileId)}`;
  const readDetail = async (url: string): Promise<NetworkProfile & {
    authContent?: string;
    configContent?: string;
  }> => {
    let response = await fetch(url, fetchOptions);
    if (response.status === 404 && url !== detailUrl) {
      response = await fetch(detailUrl, fetchOptions);
    }
    if (response.status === 401) {
      throw unauthorized("获取网络配置详情");
    }
    if (!response.ok) {
      throw new Error(`获取网络配置详情失败（HTTP ${response.status}）。`);
    }
    const data = await response.json();
    if (data?.id !== networkProfileId) {
      throw new Error("共享服务返回了其他档案。");
    }
    return data;
  };

  const profileData = await readDetail(`${detailUrl}?bundle=1`);
  let { authContent: authJson, configContent: configToml } = profileData;
  if (authJson === undefined && configToml === undefined) {
    // 旧服务仍可下载，但文件必须齐全，且下载期间档案版本不能变动。
    const files = ["auth.json", "config.toml"];
    if (!files.every((file) => profileData.files?.includes(file))) {
      throw new Error("共享配置缺少授权文件或配置文件。");
    }
    [authJson, configToml] = await Promise.all(files.map(async (file) => {
      const response = await fetch(`${detailUrl}/${file}`, fetchOptions);
      if (response.status === 401) {
        throw unauthorized(`下载 ${file}`);
      }
      if (!response.ok) {
        throw new Error(`下载 ${file} 失败（HTTP ${response.status}）。`);
      }
      return response.text();
    }));
    const latest = await readDetail(detailUrl);
    if (
      latest.contentVersion !== profileData.contentVersion ||
      latest.contentHash !== profileData.contentHash ||
      latest.updatedAt !== profileData.updatedAt
    ) {
      throw new Error("下载期间共享配置发生变化，请重新下载。");
    }
  }
  if (typeof authJson !== "string" || typeof configToml !== "string") {
    throw new Error("共享服务返回了不完整的配置文件。");
  }
  parseNetworkProfileAuth(authJson);
  return { profile: profileData, authJson, configToml };
}
