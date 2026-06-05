import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

import type { ProfileSummary } from "../src/desktop-types";
import type { NetworkProfile } from "../src/network-profile-utils";
import type { LocalShareDraft } from "../src/profile-editor-state";

const root = join(import.meta.dirname, "..");
const stateImportPath = `../src/${"sharing-center-state"}`;

function createProfile(overrides: Partial<ProfileSummary> = {}): ProfileSummary {
  return {
    id: "profile-a",
    name: "Profile A",
    notes: "Primary",
    authTypeLabel: "官方 OAuth",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    authHash: "auth",
    configHash: "config",
    codexUsage: null,
    thirdPartyLatency: null,
    thirdPartyUsage: null,
    ...overrides,
  };
}

function createDraft(overrides: Partial<LocalShareDraft> = {}): LocalShareDraft {
  return {
    profileId: "profile-a",
    visibility: "selected",
    selectedUserIds: ["ding-a"],
    ...overrides,
  };
}

function createNetworkProfile(overrides: Partial<NetworkProfile> = {}): NetworkProfile {
  return {
    id: "shared-profile-a",
    name: "Shared Profile A",
    description: "Shared profile",
    createdAt: "2026-06-01T00:00:00.000Z",
    files: ["auth.json", "config.toml"],
    ownerDingUserId: "owner-a",
    visibility: "selected",
    sharedWith: ["ding-a"],
    ...overrides,
  };
}

test("keeps a valid local share profile selection", async () => {
  expect(existsSync(join(root, "src/sharing-center-state.ts"))).toBe(true);
  const { resolveLocalShareFormState } = await import(stateImportPath);

  const result = resolveLocalShareFormState(
    [createProfile(), createProfile({ id: "profile-b", name: "Profile B" })],
    createDraft({ profileId: "profile-b", selectedUserIds: ["ding-a", "ding-b"] }),
  );

  expect(result.selectedProfile?.id).toBe("profile-b");
  expect(result.profileIdToPersist).toBe("profile-b");
  expect(result.selectedUserCount).toBe(2);
  expect(result.selectedShareDisabled).toBe(false);
  expect(result.shareSummary).toBe("已选择 2 人");
});

test("falls back to the first profile when the draft selection is missing or stale", async () => {
  expect(existsSync(join(root, "src/sharing-center-state.ts"))).toBe(true);
  const { resolveLocalShareFormState } = await import(stateImportPath);

  const result = resolveLocalShareFormState(
    [createProfile({ id: "profile-a" }), createProfile({ id: "profile-b" })],
    createDraft({ profileId: "missing-profile", selectedUserIds: [] }),
  );

  expect(result.selectedProfile?.id).toBe("profile-a");
  expect(result.profileIdToPersist).toBe("profile-a");
  expect(result.selectedShareDisabled).toBe(true);
  expect(result.shareSummary).toBe("请选择共享对象");
});

test("does not invent a profile id when there are no local profiles", async () => {
  expect(existsSync(join(root, "src/sharing-center-state.ts"))).toBe(true);
  const { resolveLocalShareFormState } = await import(stateImportPath);

  const result = resolveLocalShareFormState([], createDraft({ visibility: "public" }));

  expect(result.selectedProfile).toBeNull();
  expect(result.profileIdToPersist).toBeNull();
  expect(result.selectedShareDisabled).toBe(false);
  expect(result.shareSummary).toBe("全部已登录员工可见");
});

test("creates shared profile edit drafts from profile visibility", async () => {
  expect(existsSync(join(root, "src/sharing-center-state.ts"))).toBe(true);
  const { createSharedProfileEditDraft } = await import(stateImportPath);

  const selectedDraft = createSharedProfileEditDraft(createNetworkProfile({
    id: "profile-selected",
    visibility: "selected",
    sharedWith: ["ding-a", "ding-b"],
  }));
  expect(selectedDraft).toEqual({
    profileId: "profile-selected",
    visibility: "selected",
    selectedUserIds: ["ding-a", "ding-b"],
  });

  const publicDraft = createSharedProfileEditDraft(createNetworkProfile({
    id: "profile-public",
    visibility: "public",
    sharedWith: ["ding-a"],
  }));
  expect(publicDraft).toEqual({
    profileId: "profile-public",
    visibility: "public",
    selectedUserIds: [],
  });
});
