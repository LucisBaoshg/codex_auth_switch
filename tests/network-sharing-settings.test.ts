import { afterEach, beforeEach, expect, test, vi } from "vitest";

const invokeMock = vi.fn();
const getVersionMock = vi.fn();
const fetchMock = vi.fn();

const appSnapshot = {
  targetDir: "/Users/example/.codex",
  usingDefaultTargetDir: true,
  targetExists: true,
  targetAuthExists: true,
  targetConfigExists: true,
  targetUpdatedAt: "2026-05-22T00:00:00Z",
  targetAuthTypeLabel: "第三方 API",
  activeProfileId: null,
  lastSelectedProfileId: null,
  lastSwitchProfileId: null,
  lastSwitchedAt: null,
  codexUsageApiEnabled: false,
  profiles: [],
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: getVersionMock,
}));

beforeEach(() => {
  vi.resetModules();
  invokeMock.mockReset();
  getVersionMock.mockReset();
  fetchMock.mockReset();
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  getVersionMock.mockResolvedValue("1.4.26");
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => [],
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test("uses saved desktop bearer token when refreshing the network shared library", async () => {
  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-settings"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  const apiInput = document.querySelector<HTMLInputElement>("#network-profiles-api");
  const tokenInput = document.querySelector<HTMLInputElement>("#network-profile-token");
  expect(apiInput).not.toBeNull();
  expect(tokenInput).not.toBeNull();

  apiInput!.value = "https://share.example.com/codex/api/profiles";
  apiInput!.dispatchEvent(new Event("input", { bubbles: true }));
  tokenInput!.value = "cas_desktop_token";
  tokenInput!.dispatchEvent(new Event("input", { bubbles: true }));

  document
    .querySelector<HTMLButtonElement>('[data-action="refresh-network-after-settings"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();

  expect(fetchMock).toHaveBeenCalledWith("https://share.example.com/codex/api/profiles", {
    cache: "no-store",
    headers: {
      Authorization: "Bearer cas_desktop_token",
    },
  });
});

test("shows DingTalk login prompt in the sidebar before network login", async () => {
  await import("../src/main");
  await flushUi();

  const status = document.querySelector('[data-role="sidebar-login-status"]');
  expect(status).not.toBeNull();
  expect(status?.textContent).toContain("未登录");
  expect(status?.textContent).toContain("钉钉 SSO 登录");
  expect(status?.querySelector('[data-action="open-network-sso-login"]')).not.toBeNull();
});

test("shows the logged in user in the sidebar and logs out from settings", async () => {
  localStorage.setItem("codex-auth-switch.networkProfileToken", "cas_desktop_token");
  fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/auth/me") {
      expect(init).toEqual({
        cache: "no-store",
        headers: {
          Authorization: "Bearer cas_desktop_token",
        },
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          user: {
            dingUserId: "Ding-A",
            name: "Alice",
            mobile: "13900000001",
            jobNumber: "A001",
          },
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => [],
    };
  });

  await import("../src/main");
  await flushUi();
  await flushUi();

  const status = document.querySelector('[data-role="sidebar-login-status"]');
  expect(status?.textContent).toContain("Alice");
  expect(status?.textContent).toContain("13900000001");

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-settings"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  const accountCard = document.querySelector('[data-role="network-account-settings"]');
  expect(accountCard?.textContent).toContain("Alice");
  expect(accountCard?.textContent).toContain("13900000001");

  accountCard
    ?.querySelector<HTMLButtonElement>('[data-action="logout-network-user"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  expect(localStorage.getItem("codex-auth-switch.networkProfileToken")).toBe("");
  expect(document.querySelector('[data-role="sidebar-login-status"]')?.textContent).toContain("未登录");
  expect(document.querySelector<HTMLInputElement>("#network-profile-token")?.value).toBe("");
});

test("starts DingTalk SSO login from the cloud sharing settings", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  fetchMock.mockImplementation(async (input: string | URL | Request) => {
    const url = input.toString();
    if (url === "https://share.example.com/codex/api/auth/desktop-login") {
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: "desktop-login-1", pollToken: "poll-token-1" }),
      };
    }
    if (url === "https://share.example.com/codex/api/auth/desktop-login/desktop-login-1?pollToken=poll-token-1") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "complete", token: "cas_auto_token" }),
      };
    }
    if (url === "https://share.example.com/codex/api/profiles") {
      return {
        ok: true,
        status: 200,
        json: async () => [],
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") return appSnapshot;
    if (command === "open_external_url") return undefined;
    throw new Error(`unexpected command: ${command}`);
  });

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-settings"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  const apiInput = document.querySelector<HTMLInputElement>("#network-profiles-api");
  expect(apiInput).not.toBeNull();
  apiInput!.value = "https://share.example.com/codex/api/profiles";
  apiInput!.dispatchEvent(new Event("input", { bubbles: true }));

  const loginButton = document.querySelector<HTMLButtonElement>('[data-action="open-network-sso-login"]');
  expect(loginButton).not.toBeNull();
  expect(loginButton!.textContent).toContain("钉钉 SSO 登录");

  loginButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("open_external_url", {
    url: "https://share.example.com/codex/api/auth/login?returnTo=%2Fprofiles&desktopLoginId=desktop-login-1",
  });
  expect(localStorage.getItem("codex-auth-switch.networkProfileToken")).toBe("cas_auto_token");
  expect(fetchMock).toHaveBeenCalledWith("https://share.example.com/codex/api/profiles", {
    cache: "no-store",
    headers: {
      Authorization: "Bearer cas_auto_token",
    },
  });
});

test("migrates the saved Tapcash cloud sharing URL before starting SSO login", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") return appSnapshot;
    if (command === "open_external_url") return undefined;
    throw new Error(`unexpected command: ${command}`);
  });
  fetchMock.mockImplementation(async (input: string | URL | Request) => {
    const url = input.toString();
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/auth/desktop-login") {
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: "desktop-login-2", pollToken: "poll-token-2" }),
      };
    }
    if (
      url ===
      "https://codex-helper.ite.tool4seller.com/codex/api/auth/desktop-login/desktop-login-2?pollToken=poll-token-2"
    ) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "complete", token: "cas_auto_token" }),
      };
    }
    if (url === "https://codex-helper.ite.tool4seller.com/codex/api/profiles") {
      return {
        ok: true,
        status: 200,
        json: async () => [],
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  localStorage.setItem(
    "codex-auth-switch.networkProfilesApi",
    "http://sub2api.ite.tapcash.com/codex/api/profiles",
  );

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-settings"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="open-network-sso-login"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await flushUi();

  expect(invokeMock).toHaveBeenCalledWith("open_external_url", {
    url: "https://codex-helper.ite.tool4seller.com/codex/api/auth/login?returnTo=%2Fprofiles&desktopLoginId=desktop-login-2",
  });
});

test("shows DingTalk SSO login inside the sharing center", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "load_snapshot") return appSnapshot;
    if (command === "open_external_url") return undefined;
    throw new Error(`unexpected command: ${command}`);
  });
  localStorage.setItem(
    "codex-auth-switch.networkProfilesApi",
    "https://share.example.com/codex/api/profiles",
  );

  await import("../src/main");
  await flushUi();

  document
    .querySelector<HTMLButtonElement>('[data-action="nav-sharing"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();
  await flushUi();
  await flushUi();

  const prompt = document.querySelector('[data-role="network-auth-prompt"]');
  expect(prompt).not.toBeNull();
  expect(prompt?.textContent).toContain("钉钉 SSO 登录");
  expect(prompt?.textContent).toContain("自动连接企业共享库");

  prompt
    ?.querySelector<HTMLButtonElement>('[data-action="open-network-sso-login"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushUi();

  expect(fetchMock).toHaveBeenCalledWith("https://share.example.com/codex/api/auth/desktop-login", {
    method: "POST",
    cache: "no-store",
  });
});
