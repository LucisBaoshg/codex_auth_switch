export type NetworkSharingSettings = {
  profilesApi: string;
  token: string;
  tokenOrigin?: string;
};

export const CANONICAL_NETWORK_PROFILES_HOST = "codex-helper.ite.tool4seller.com";
export const LEGACY_NETWORK_PROFILES_HOST = "sub2api.ite.tapcash.com";
export const DEFAULT_NETWORK_PROFILES_API = `https://${CANONICAL_NETWORK_PROFILES_HOST}/codex/api/profiles`;

const networkProfilesApiStorageKey = "codex-auth-switch.networkProfilesApi";
const networkProfileTokenStorageKey = "codex-auth-switch.networkProfileToken";
const networkTokenOriginStorageKey = "codex-auth-switch.networkTokenOrigin";

export function loadNetworkSharingSettings(storage: Storage = window.localStorage): NetworkSharingSettings {
  const profilesApi = normalizeNetworkProfilesApiUrl(
    storage.getItem(networkProfilesApiStorageKey)?.trim() || DEFAULT_NETWORK_PROFILES_API,
  );
  return {
    profilesApi,
    token: storage.getItem(networkProfileTokenStorageKey)?.trim() || "",
    tokenOrigin: storage.getItem(networkTokenOriginStorageKey) ?? networkOrigin(profilesApi),
  };
}

export function saveNetworkSharingSettings(
  settings: NetworkSharingSettings,
  storage: Storage = window.localStorage,
): void {
  settings.profilesApi = normalizeNetworkProfilesApiUrl(settings.profilesApi);
  setNetworkAccessToken(settings, networkAccessToken(settings));
  storage.setItem(networkProfilesApiStorageKey, settings.profilesApi);
  storage.setItem(networkProfileTokenStorageKey, settings.token);
  storage.setItem(networkTokenOriginStorageKey, settings.tokenOrigin ?? "");
}

export function normalizeNetworkProfilesApiUrl(value: string): string {
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

export function networkProfilesApiUrl(settings: NetworkSharingSettings): string {
  const trimmed = normalizeNetworkProfilesApiUrl(settings.profilesApi).replace(/\/+$/, "");
  return trimmed || DEFAULT_NETWORK_PROFILES_API;
}

export function networkPortalBaseUrl(settings: NetworkSharingSettings): string {
  return networkProfilesApiUrl(settings).replace(/\/api\/profiles\/?$/, "");
}

export function networkSsoLoginUrl(settings: NetworkSharingSettings): string {
  const loginUrl = new URL(`${networkPortalBaseUrl(settings)}/api/auth/login`);
  loginUrl.searchParams.set("returnTo", "/profiles");
  return loginUrl.toString();
}

export function networkDesktopLoginApiUrl(settings: NetworkSharingSettings): string {
  return `${networkPortalBaseUrl(settings)}/api/auth/desktop-login`;
}

export function networkMeApiUrl(settings: NetworkSharingSettings): string {
  return `${networkPortalBaseUrl(settings)}/api/auth/me`;
}

export function networkUsersApiUrl(settings: NetworkSharingSettings): string {
  return `${networkPortalBaseUrl(settings)}/api/users`;
}

function networkOrigin(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

export function setNetworkAccessToken(settings: NetworkSharingSettings, token: string) {
  settings.token = token.trim();
  settings.tokenOrigin = networkOrigin(networkProfilesApiUrl(settings));
}

export function networkAccessToken(settings: NetworkSharingSettings): string {
  const origin = networkOrigin(networkProfilesApiUrl(settings));
  if (!origin || (settings.tokenOrigin !== undefined && settings.tokenOrigin !== origin)) {
    return "";
  }
  return settings.token.trim();
}

export function networkAuthHeaders(settings: NetworkSharingSettings): Record<string, string> | undefined {
  const token = networkAccessToken(settings);
  if (!token) return undefined;
  return {
    Authorization: `Bearer ${token}`,
  };
}

export function networkFetchOptions(settings: NetworkSharingSettings): RequestInit {
  const headers = networkAuthHeaders(settings);
  if (headers) {
    return {
      cache: "no-store",
      headers,
    };
  }

  return {
    cache: "no-store",
  };
}

export function hasNetworkAccessToken(settings: NetworkSharingSettings): boolean {
  return Boolean(networkAccessToken(settings));
}
