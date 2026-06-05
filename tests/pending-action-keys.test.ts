import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const keysImportPath = `../src/${"pending-action-keys"}`;

test("builds stable per-profile pending action keys", async () => {
  expect(existsSync(join(root, "src/pending-action-keys.ts"))).toBe(true);
  const {
    latencyProbeActionKey,
    thirdPartyUsageActionKey,
    usageRefreshActionKey,
  } = await import(keysImportPath);

  expect(usageRefreshActionKey("profile-1")).toBe("codex-usage:profile-1");
  expect(latencyProbeActionKey("profile-1")).toBe("latency-probe:profile-1");
  expect(thirdPartyUsageActionKey("profile-1")).toBe("third-party-usage:profile-1");
});

test("exports stable bulk and maintenance pending action keys", async () => {
  expect(existsSync(join(root, "src/pending-action-keys.ts"))).toBe(true);
  const keys = await import(keysImportPath);

  expect(keys.codexUsageActionPrefix).toBe("codex-usage");
  expect(keys.refreshAllUsageActionKey).toBe("codex-usage:all");
  expect(keys.migrateLegacyThirdPartyActionKey).toBe("third-party:migrate-legacy");
  expect(keys.writeThirdPartyWebsocketsDefaultsActionKey).toBe("third-party:websockets-defaults");
});
