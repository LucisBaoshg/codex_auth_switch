import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const selectionImportPath = `../src/${"profile-selection"}`;

const profiles = [
  { id: "work", authTypeLabel: "官方 OAuth" },
  { id: "api", authTypeLabel: "第三方 API" },
  { id: "team", authTypeLabel: "官方 OAuth" },
];

test("filters official OAuth profiles without mutating the source list", async () => {
  expect(existsSync(join(root, "src/profile-selection.ts"))).toBe(true);
  const { getOfficialOauthProfiles } = await import(selectionImportPath);

  const officialProfiles = getOfficialOauthProfiles({ profiles });

  expect(officialProfiles.map((profile: { id: string }) => profile.id)).toEqual(["work", "team"]);
  expect(profiles.map((profile) => profile.id)).toEqual(["work", "api", "team"]);
  expect(getOfficialOauthProfiles(null)).toEqual([]);
});

test("resolves selected profile id with the current snapshot fallback order", async () => {
  expect(existsSync(join(root, "src/profile-selection.ts"))).toBe(true);
  const { resolveSelectedProfileId } = await import(selectionImportPath);

  const snapshot = {
    profiles,
    activeProfileId: "api",
    lastSelectedProfileId: "team",
  };

  expect(resolveSelectedProfileId(snapshot, "work")).toBe("work");
  expect(resolveSelectedProfileId(snapshot, "missing")).toBe("api");
  expect(resolveSelectedProfileId({ ...snapshot, activeProfileId: null }, "missing")).toBe("team");
  expect(
    resolveSelectedProfileId({ profiles, activeProfileId: null, lastSelectedProfileId: null }, "missing"),
  ).toBe("work");
  expect(resolveSelectedProfileId({ profiles: [], activeProfileId: null, lastSelectedProfileId: null }, "missing")).toBeNull();
});

test("resolves share draft profile id without using the last selected fallback", async () => {
  expect(existsSync(join(root, "src/profile-selection.ts"))).toBe(true);
  const { resolveShareDraftProfileId } = await import(selectionImportPath);

  expect(resolveShareDraftProfileId({ profiles, activeProfileId: "api" }, "work")).toBe("work");
  expect(resolveShareDraftProfileId({ profiles, activeProfileId: "api" }, "missing")).toBe("api");
  expect(resolveShareDraftProfileId({ profiles, activeProfileId: null }, "missing")).toBe("work");
  expect(resolveShareDraftProfileId({ profiles: [], activeProfileId: null }, "missing")).toBeNull();
});

test("finds a profile by id from the current snapshot", async () => {
  expect(existsSync(join(root, "src/profile-selection.ts"))).toBe(true);
  const { findProfileById } = await import(selectionImportPath);

  expect(findProfileById({ profiles }, "team")).toEqual({ id: "team", authTypeLabel: "官方 OAuth" });
  expect(findProfileById({ profiles }, "missing")).toBeNull();
  expect(findProfileById({ profiles }, null)).toBeNull();
  expect(findProfileById(null, "team")).toBeNull();
});

test("resolves an official OAuth profile id for symbiotic profiles", async () => {
  expect(existsSync(join(root, "src/profile-selection.ts"))).toBe(true);
  const { resolveOfficialOauthProfileId } = await import(selectionImportPath);

  expect(resolveOfficialOauthProfileId({ profiles, activeProfileId: "api" }, "team")).toBe("team");
  expect(resolveOfficialOauthProfileId({ profiles, activeProfileId: "work" }, "api")).toBe("work");
  expect(resolveOfficialOauthProfileId({ profiles, activeProfileId: "api" }, "missing")).toBe("work");
  expect(resolveOfficialOauthProfileId({ profiles: [profiles[1]], activeProfileId: "api" }, "missing")).toBe("");
  expect(resolveOfficialOauthProfileId(null, "team")).toBe("");
});

test("detects when a new symbiotic profile is missing an official OAuth profile", async () => {
  expect(existsSync(join(root, "src/profile-selection.ts"))).toBe(true);
  const { isMissingOfficialOauthForNewSymbioticEditor } = await import(selectionImportPath);

  const symbioticEditor = {
    mode: "new",
    thirdParty: { template: "symbioticThirdParty" },
  };

  expect(isMissingOfficialOauthForNewSymbioticEditor(symbioticEditor, null)).toBe(true);
  expect(
    isMissingOfficialOauthForNewSymbioticEditor(symbioticEditor, {
      profiles: [{ id: "api", authTypeLabel: "第三方 API" }],
    }),
  ).toBe(true);
  expect(isMissingOfficialOauthForNewSymbioticEditor(symbioticEditor, { profiles })).toBe(false);
  expect(
    isMissingOfficialOauthForNewSymbioticEditor(
      { mode: "existing", thirdParty: { template: "symbioticThirdParty" } },
      null,
    ),
  ).toBe(false);
  expect(
    isMissingOfficialOauthForNewSymbioticEditor(
      { mode: "new", thirdParty: { template: "standaloneThirdParty" } },
      null,
    ),
  ).toBe(false);
});

test("removes a profile from a snapshot and clears deleted profile pointers", async () => {
  expect(existsSync(join(root, "src/profile-selection.ts"))).toBe(true);
  const { removeProfileFromSnapshot } = await import(selectionImportPath);

  const snapshot = {
    profiles,
    activeProfileId: "api",
    lastSelectedProfileId: "api",
    lastSwitchProfileId: "team",
  };

  const next = removeProfileFromSnapshot(snapshot, "api");

  expect(next).toEqual({
    profiles: [profiles[0], profiles[2]],
    activeProfileId: null,
    lastSelectedProfileId: null,
    lastSwitchProfileId: "team",
  });
  expect(snapshot.profiles).toEqual(profiles);
  expect(removeProfileFromSnapshot(snapshot, "missing")).toEqual(snapshot);
  expect(removeProfileFromSnapshot({ ...snapshot, lastSwitchProfileId: "api" }, "api").lastSwitchProfileId).toBeNull();
});
