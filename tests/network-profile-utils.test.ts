import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const utilsImportPath = `../src/${"network-profile-utils"}`;

test("normalizes network profile visibility and share labels", async () => {
  expect(existsSync(join(root, "src/network-profile-utils.ts"))).toBe(true);
  const { networkProfileVisibility, sharingScopeLabel } = await import(utilsImportPath);

  expect(networkProfileVisibility({ sharedWith: ["Ding-A"] })).toBe("selected");
  expect(networkProfileVisibility({ visibility: "public", sharedWith: ["Ding-A"] })).toBe("public");
  expect(sharingScopeLabel({ visibility: "selected", sharedWith: ["Ding-A", "Ding-B"] })).toBe("指定 2 人");
  expect(sharingScopeLabel({ visibility: "private", sharedWith: ["Ding-A"] })).toBe("仅自己可见");
});

test("formats network user display values without depending on app state", async () => {
  expect(existsSync(join(root, "src/network-profile-utils.ts"))).toBe(true);
  const { isOwnNetworkProfile, networkUserDisplayName, networkUserMeta, shareUserInitial } = await import(
    utilsImportPath
  );

  expect(isOwnNetworkProfile({ ownerDingUserId: " Ding-A " }, { dingUserId: "ding-a" })).toBe(true);
  expect(isOwnNetworkProfile({ ownerDingUserId: "Ding-A" }, null)).toBe(false);
  expect(networkUserDisplayName({ dingUserId: "Ding-A", mobile: " 13800000000 " })).toBe("13800000000");
  expect(networkUserMeta({ dingUserId: "Ding-A", jobNumber: " T-7 " })).toBe("T-7");
  expect(shareUserInitial({ dingUserId: "Ding-A", label: " Alice " })).toBe("A");
});
