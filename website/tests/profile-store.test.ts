import { describe, expect, test } from "vitest";
import {
  canAccessProfile,
  filterProfilesForPrincipal,
  normalizeSharedWith,
  type ProfilePrincipal,
  type StoredProfile,
} from "../src/lib/profile-store";
import { hashDesktopToken } from "../src/lib/auth";

const userA: ProfilePrincipal = {
  dingUserId: "Ding-A",
  unionId: "Union-A",
  openId: "Open-A",
  name: "Alice",
  mobile: "13900000001",
  jobNumber: "A001",
};

const userB: ProfilePrincipal = {
  dingUserId: "Ding-B",
  unionId: "Union-B",
  openId: "Open-B",
  name: "Bob",
  mobile: "13900000002",
  jobNumber: "B001",
};

function profile(overrides: Partial<StoredProfile>): StoredProfile {
  return {
    id: "profile-1",
    name: "Team Profile",
    description: "",
    createdAt: "2026-05-22T00:00:00.000Z",
    files: ["auth.json", "config.toml"],
    ownerDingUserId: "Ding-A",
    ownerName: "Alice",
    sharedWith: [],
    ...overrides,
  };
}

describe("profile sharing permissions", () => {
  test("owners can always access their own profiles", () => {
    expect(canAccessProfile(profile({ sharedWith: [] }), userA)).toBe(true);
  });

  test("specified recipients can access shared profiles by mobile or DingTalk id", () => {
    expect(canAccessProfile(profile({ sharedWith: ["13900000002"] }), userB)).toBe(true);
    expect(canAccessProfile(profile({ sharedWith: ["ding-b"] }), userB)).toBe(true);
  });

  test("unlisted employees cannot access private profiles", () => {
    expect(canAccessProfile(profile({ sharedWith: ["someone-else"] }), userB)).toBe(false);
  });

  test("legacy profiles without an owner remain visible to authenticated employees", () => {
    expect(canAccessProfile(profile({ ownerDingUserId: undefined, sharedWith: undefined }), userB)).toBe(true);
  });

  test("filters profile lists to only visible records", () => {
    const visibleOwned = profile({ id: "owned" });
    const visibleShared = profile({ id: "shared", sharedWith: ["13900000002"] });
    const hidden = profile({ id: "hidden", sharedWith: ["13900000003"] });

    expect(filterProfilesForPrincipal([visibleOwned, visibleShared, hidden], userB).map((p) => p.id)).toEqual([
      "shared",
    ]);
  });

  test("normalizes comma, newline, and whitespace separated recipients", () => {
    expect(normalizeSharedWith(" 13900000002, Ding-B\nB001  ")).toEqual([
      "13900000002",
      "Ding-B",
      "B001",
    ]);
  });
});

describe("desktop token hashing", () => {
  test("hashes desktop tokens deterministically without returning the original token", () => {
    const hash = hashDesktopToken("cas_test_token");

    expect(hash).toBe(hashDesktopToken("cas_test_token"));
    expect(hash).not.toContain("cas_test_token");
  });
});
