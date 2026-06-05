import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

import type { NetworkSharingSettings } from "../src/network-sharing";

const root = join(import.meta.dirname, "..");
const renderersImportPath = `../src/${"settings-renderers"}`;

function createNetworkSharing(overrides: Partial<NetworkSharingSettings> = {}): NetworkSharingSettings {
  return {
    profilesApi: "https://codex-helper.ite.tool4seller.com/codex/api/profiles",
    token: "cas-token",
    ...overrides,
  };
}

test("renders settings page with enterprise sharing fields", async () => {
  expect(existsSync(join(root, "src/settings-renderers.ts"))).toBe(true);
  const { renderSettingsPage } = await import(renderersImportPath);

  const html = renderSettingsPage({
    networkSharing: createNetworkSharing({
      profilesApi: "https://example.com/codex/api/profiles?x=<tag>",
      token: "secret-token",
    }),
    defaultNetworkProfilesApi: "https://default.example.com/api/profiles",
    networkPortalUrl: "https://example.com/codex",
    accountSettingsHtml: "<div data-role=\"network-account-settings\">account</div>",
    busy: false,
    migratingLegacyThirdParty: false,
    writingThirdPartyWebsocketsDefaults: false,
  });

  expect(html).toContain('data-page="settings"');
  expect(html).toContain("全局设置");
  expect(html).toContain('id="network-profiles-api"');
  expect(html).toContain("https://example.com/codex/api/profiles?x=&lt;tag&gt;");
  expect(html).toContain("https://default.example.com/api/profiles");
  expect(html).toContain('id="network-profile-token"');
  expect(html).toContain('value="secret-token"');
  expect(html).toContain('data-role="network-account-settings"');
  expect(html).toContain('href="https://example.com/codex/profiles"');
  expect(html).toContain('data-action="save-network-sharing-settings"');
});

test("renders settings migration pending states", async () => {
  expect(existsSync(join(root, "src/settings-renderers.ts"))).toBe(true);
  const { renderSettingsPage } = await import(renderersImportPath);

  const html = renderSettingsPage({
    networkSharing: createNetworkSharing(),
    defaultNetworkProfilesApi: "https://default.example.com/api/profiles",
    networkPortalUrl: "https://example.com/codex",
    accountSettingsHtml: "",
    busy: true,
    migratingLegacyThirdParty: true,
    writingThirdPartyWebsocketsDefaults: true,
  });

  expect(html).toContain("迁移中...");
  expect(html).toContain("写入中...");
  expect(html).toContain("disabled");
  expect(html).toContain('data-action="migrate-legacy-third-party"');
  expect(html).toContain('data-action="write-third-party-websockets-defaults"');
});
