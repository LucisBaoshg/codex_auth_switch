import { describe, expect, test } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  canEditProfile,
  canAccessProfile,
  createProfile,
  filterProfilesForPrincipal,
  normalizeSharedWith,
  publicProfileWithAuthType,
  readProfiles,
  sharedProfileContentHash,
  updateProfileMetadata,
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

  test("legacy profiles without an owner are visible but not editable by ordinary users", () => {
    expect(canEditProfile(profile({ ownerDingUserId: undefined, sharedWith: undefined }), userB)).toBe(false);
  });

  test("profiles explicitly shared with everyone are visible to any authenticated employee", () => {
    expect(canAccessProfile(profile({ visibility: "public", sharedWith: [] }), userB)).toBe(true);
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

describe("profile auth type labels", () => {
  test("derives labels from current files instead of stale stored labels", async () => {
    const previousDataDir = process.env.CODEX_PROFILE_DATA_DIR;
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-profile-store-auth-type-"));
    try {
      process.env.CODEX_PROFILE_DATA_DIR = dataDir;
      await fs.mkdir(path.join(dataDir, "files", "profile-1"), { recursive: true });
      await fs.writeFile(
        path.join(dataDir, "files", "profile-1", "auth.json"),
        JSON.stringify({ OPENAI_API_KEY: "sk-test" }),
      );
      await fs.writeFile(
        path.join(dataDir, "files", "profile-1", "config.toml"),
        'model = "gpt-5.5"\nopenai_base_url = "https://muyuan.do"\n',
      );

      const result = await publicProfileWithAuthType(profile({ authTypeLabel: "官方 OAuth" }));

      expect(result.authTypeLabel).toBe("第三方 API");
    } finally {
      if (previousDataDir === undefined) {
        delete process.env.CODEX_PROFILE_DATA_DIR;
      } else {
        process.env.CODEX_PROFILE_DATA_DIR = previousDataDir;
      }
    }
  });
});

describe("profile file store concurrency", () => {
  test("serializes concurrent creates and generates collision-resistant ids", async () => {
    const previousDataDir = process.env.CODEX_PROFILE_DATA_DIR;
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-profile-store-concurrent-create-"));
    try {
      process.env.CODEX_PROFILE_DATA_DIR = dataDir;
      const created = await Promise.all(Array.from({ length: 16 }, (_, index) => createProfile({
        name: `Profile ${index}`,
        authContent: JSON.stringify({ OPENAI_API_KEY: `sk-${index}` }),
        configContent: `model = "model-${index}"`,
      }, userA)));

      expect(new Set(created.map((profile) => profile.id)).size).toBe(16);
      expect(await readProfiles()).toHaveLength(16);
    } finally {
      if (previousDataDir === undefined) delete process.env.CODEX_PROFILE_DATA_DIR;
      else process.env.CODEX_PROFILE_DATA_DIR = previousDataDir;
    }
  });

  test("allows only one concurrent update from the same base version", async () => {
    const previousDataDir = process.env.CODEX_PROFILE_DATA_DIR;
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-profile-store-concurrent-update-"));
    try {
      process.env.CODEX_PROFILE_DATA_DIR = dataDir;
      const authContent = JSON.stringify({ OPENAI_API_KEY: "sk-old" });
      const configContent = 'model = "old"';
      const created = await createProfile({ name: "Concurrent", authContent, configContent }, userA);
      const baseHash = sharedProfileContentHash(authContent, configContent);

      const results = await Promise.allSettled([
        updateProfileMetadata(created.id, userA, {
          authContent: JSON.stringify({ OPENAI_API_KEY: "sk-a" }),
          baseContentVersion: 1,
          baseContentHash: baseHash,
        }),
        updateProfileMetadata(created.id, userA, {
          authContent: JSON.stringify({ OPENAI_API_KEY: "sk-b" }),
          baseContentVersion: 1,
          baseContentHash: baseHash,
        }),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect((await readProfiles())[0].contentVersion).toBe(2);
    } finally {
      if (previousDataDir === undefined) delete process.env.CODEX_PROFILE_DATA_DIR;
      else process.env.CODEX_PROFILE_DATA_DIR = previousDataDir;
    }
  });
});
