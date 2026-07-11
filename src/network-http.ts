import { hasNetworkAccessToken } from "./network-sharing";
import { desktopInvoke, errorMessage, isTauriRuntime, state } from "./app-runtime";

export type NetworkHttpResponse = {
  status: number;
  body: string;
};

export function networkUnauthorizedError(actionLabel: string): Error {
  if (!hasNetworkAccessToken(state.networkSharing)) {
    state.networkAuthRequired = true;
    return new Error("请先使用钉钉 SSO 登录企业共享中心。");
  }

  state.networkAuthRequired = false;
  return new Error(`${actionLabel}未通过服务端权限校验，已保留当前登录状态。请刷新共享中心或重新登录后再试。`);
}

export function networkErrorMessageFromBody(body: string, fallback: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: string };
    return parsed.error || fallback;
  } catch {
    return fallback;
  }
}

export function parseNetworkJson<T>(body: string, fallback: string): T {
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(fallback);
  }
}

export async function networkHttpRequest(
  method: "GET" | "POST",
  url: string,
  actionLabel: string,
  options: {
    token?: string | null;
    body?: string | null;
    contentType?: string;
  } = {},
): Promise<NetworkHttpResponse> {
  const token = options.token?.trim() || null;
  const body = options.body ?? null;
  if (isTauriRuntime) {
    try {
      return await desktopInvoke<NetworkHttpResponse>("network_request", {
        method,
        url,
        token,
        body,
      });
    } catch (error) {
      throw new Error(`${actionLabel}请求失败：${errorMessage(error)}`);
    }
  }

  try {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (body !== null) {
      headers["Content-Type"] = options.contentType ?? "application/json";
    }
    const response = await fetch(url, {
      method,
      cache: "no-store",
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(body !== null ? { body } : {}),
    });
    return {
      status: response.status,
      body: await response.text(),
    };
  } catch (error) {
    throw new Error(`${actionLabel}请求失败：${errorMessage(error)}`);
  }
}
