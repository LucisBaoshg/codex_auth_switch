import { promises as fs } from "fs";
import path from "path";
import { getDataDir } from "./data-paths";

export type ProfilePrincipal = {
  dingUserId: string;
  unionId?: string | null;
  openId?: string | null;
  name?: string | null;
  mobile?: string | null;
  corpId?: string | null;
  deptIds?: string[] | null;
  jobNumber?: string | null;
  active?: boolean;
  issuedAt?: string;
  expiresAt?: string;
};

export type StoredProfile = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt?: string;
  files: string[];
  ownerDingUserId?: string;
  ownerName?: string | null;
  ownerMobile?: string | null;
  visibility?: ProfileVisibility;
  sharedWith?: string[];
};

export type ProfileVisibility = "private" | "selected" | "public";

export type ProfileInput = {
  name: string;
  description?: string;
  visibility?: ProfileVisibility;
  sharedWith?: string | string[];
  authContent: string;
  configContent: string;
};

const profilesFileName = "profiles.json";

export function normalizeSharedWith(input: string | string[] | null | undefined): string[] {
  const raw = Array.isArray(input) ? input : parseSharedWithString(input);
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of raw) {
    const trimmed = value.trim();
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    normalized.push(trimmed);
  }

  return normalized;
}

function parseSharedWithString(input: string | null | undefined): string[] {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((value) => String(value));
      }
    } catch {
      return [trimmed];
    }
  }
  return trimmed.split(/[\s,，;；]+/);
}

export function normalizeProfileVisibility(
  visibility: string | null | undefined,
  sharedWith: string | string[] | null | undefined,
): ProfileVisibility {
  if (visibility === "public" || visibility === "selected" || visibility === "private") {
    return visibility;
  }
  return normalizeSharedWith(sharedWith).length > 0 ? "selected" : "private";
}

export function profileVisibility(profile: StoredProfile): ProfileVisibility {
  if (!profile.ownerDingUserId) return "public";
  return normalizeProfileVisibility(profile.visibility, profile.sharedWith);
}

function principalIdentifiers(principal: ProfilePrincipal): Set<string> {
  return new Set(
    [
      principal.dingUserId,
      principal.unionId,
      principal.openId,
      principal.mobile,
      principal.jobNumber,
    ]
      .filter((value): value is string => Boolean(value && value.trim()))
      .map((value) => value.trim().toLowerCase()),
  );
}

export function canAccessProfile(profile: StoredProfile, principal: ProfilePrincipal | null): boolean {
  if (!principal) return false;
  if (!profile.ownerDingUserId) return true;
  if (profileVisibility(profile) === "public") return true;

  const identifiers = principalIdentifiers(principal);
  if (identifiers.has(profile.ownerDingUserId.trim().toLowerCase())) return true;

  return normalizeSharedWith(profile.sharedWith).some((recipient) =>
    identifiers.has(recipient.toLowerCase()),
  );
}

export function canEditProfile(profile: StoredProfile, principal: ProfilePrincipal | null): boolean {
  if (!principal || !profile.ownerDingUserId) return false;
  return profile.ownerDingUserId.trim().toLowerCase() === principal.dingUserId.trim().toLowerCase();
}

export function filterProfilesForPrincipal(
  profiles: StoredProfile[],
  principal: ProfilePrincipal | null,
): StoredProfile[] {
  return profiles.filter((profile) => canAccessProfile(profile, principal));
}

export function publicProfile(profile: StoredProfile): StoredProfile {
  return {
    ...profile,
    visibility: profileVisibility(profile),
    sharedWith: normalizeSharedWith(profile.sharedWith),
  };
}

export function profilesFilePath() {
  return path.join(getDataDir(), profilesFileName);
}

export function profileFilesDir() {
  return path.join(getDataDir(), "files");
}

export async function ensureProfileStore() {
  await fs.mkdir(profileFilesDir(), { recursive: true });
  try {
    await fs.access(profilesFilePath());
  } catch {
    await fs.writeFile(profilesFilePath(), JSON.stringify([]));
  }
}

export async function readProfiles(): Promise<StoredProfile[]> {
  await ensureProfileStore();
  const data = await fs.readFile(profilesFilePath(), "utf-8");
  return JSON.parse(data) as StoredProfile[];
}

export async function writeProfiles(profiles: StoredProfile[]) {
  await ensureProfileStore();
  await fs.writeFile(profilesFilePath(), JSON.stringify(profiles, null, 2));
}

export async function getVisibleProfile(id: string, principal: ProfilePrincipal | null) {
  const profiles = await readProfiles();
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!profile || !canAccessProfile(profile, principal)) return null;
  return profile;
}

export async function createProfile(input: ProfileInput, principal: ProfilePrincipal) {
  await ensureProfileStore();

  const id = Date.now().toString();
  const now = new Date().toISOString();
  const profileFolder = path.join(profileFilesDir(), id);
  await fs.mkdir(profileFolder, { recursive: true });
  await fs.writeFile(path.join(profileFolder, "auth.json"), input.authContent);
  await fs.writeFile(path.join(profileFolder, "config.toml"), input.configContent);

  const profile: StoredProfile = {
    id,
    name: input.name,
    description: input.description || "",
    createdAt: now,
    updatedAt: now,
    files: ["auth.json", "config.toml"],
    ownerDingUserId: principal.dingUserId,
    ownerName: principal.name,
    ownerMobile: principal.mobile,
    visibility: normalizeProfileVisibility(input.visibility, input.sharedWith),
    sharedWith: normalizeSharedWith(input.sharedWith),
  };

  const profiles = await readProfiles();
  profiles.unshift(profile);
  await writeProfiles(profiles);
  return profile;
}

export async function updateProfileMetadata(
  id: string,
  principal: ProfilePrincipal,
  updates: { name?: string; description?: string; visibility?: ProfileVisibility; sharedWith?: string | string[] },
) {
  const profiles = await readProfiles();
  const index = profiles.findIndex((profile) => profile.id === id);
  if (index === -1 || !canAccessProfile(profiles[index], principal)) return null;
  if (!canEditProfile(profiles[index], principal)) return null;

  if (updates.name !== undefined && updates.name.trim()) {
    profiles[index].name = updates.name.trim();
  }
  if (updates.description !== undefined) {
    profiles[index].description = updates.description;
  }
  if (updates.sharedWith !== undefined) {
    profiles[index].sharedWith = normalizeSharedWith(updates.sharedWith);
  }
  if (updates.visibility !== undefined) {
    profiles[index].visibility = normalizeProfileVisibility(updates.visibility, profiles[index].sharedWith);
  } else if (updates.sharedWith !== undefined) {
    profiles[index].visibility = normalizeProfileVisibility(profiles[index].visibility, profiles[index].sharedWith);
  }
  if (profiles[index].visibility === "public" || profiles[index].visibility === "private") {
    profiles[index].sharedWith = [];
  }
  profiles[index].updatedAt = new Date().toISOString();

  await writeProfiles(profiles);
  return profiles[index];
}
