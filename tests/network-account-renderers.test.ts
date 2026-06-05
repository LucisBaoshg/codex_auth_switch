import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

import type { NetworkUserPrincipal } from "../src/network-profile-utils";

const root = join(import.meta.dirname, "..");
const renderersImportPath = `../src/${"network-account-renderers"}`;

function createUser(overrides: Partial<NetworkUserPrincipal> = {}): NetworkUserPrincipal {
  return {
    dingUserId: "ding-a",
    name: "Alice <Admin>",
    mobile: "13800000000",
    jobNumber: "A-1",
    ...overrides,
  };
}

test("renders sidebar login status states without app state", async () => {
  expect(existsSync(join(root, "src/network-account-renderers.ts"))).toBe(true);
  const { renderSidebarLoginStatus } = await import(renderersImportPath);

  const guestHtml = renderSidebarLoginStatus({
    hasToken: false,
    authRequired: false,
    userLoading: false,
    user: null,
  });
  expect(guestHtml).toContain('data-role="sidebar-login-status"');
  expect(guestHtml).toContain("未登录");
  expect(guestHtml).toContain('data-action="open-network-sso-login"');

  const loadingHtml = renderSidebarLoginStatus({
    hasToken: true,
    authRequired: false,
    userLoading: true,
    user: null,
  });
  expect(loadingHtml).toContain("检查登录中");
  expect(loadingHtml).toContain("正在连接企业共享库");

  const signedInHtml = renderSidebarLoginStatus({
    hasToken: true,
    authRequired: false,
    userLoading: false,
    user: createUser(),
  });
  expect(signedInHtml).toContain("Alice &lt;Admin&gt;");
  expect(signedInHtml).toContain("13800000000");
  expect(signedInHtml).toContain("A");
});

test("renders network account settings states without app state", async () => {
  expect(existsSync(join(root, "src/network-account-renderers.ts"))).toBe(true);
  const { renderNetworkAccountSettings } = await import(renderersImportPath);

  const loggedOutHtml = renderNetworkAccountSettings({
    hasToken: false,
    authRequired: false,
    user: null,
  });
  expect(loggedOutHtml).toContain('data-role="network-account-settings"');
  expect(loggedOutHtml).toContain("未登录");
  expect(loggedOutHtml).toContain("请先使用钉钉 SSO 登录企业共享库");
  expect(loggedOutHtml).toContain("disabled");

  const signedInHtml = renderNetworkAccountSettings({
    hasToken: true,
    authRequired: false,
    user: createUser({ name: "", mobile: "", jobNumber: "B-7" }),
  });
  expect(signedInHtml).toContain("B-7");
  expect(signedInHtml).toContain('data-action="logout-network-user"');
  expect(signedInHtml).not.toContain("disabled");
});
