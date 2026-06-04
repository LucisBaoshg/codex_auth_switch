import { promises as fs } from "fs";
import path from "path";
import { getDataDir } from "./data-paths";
import type { ProfilePrincipal, ProfileVisibility } from "./profile-store";

export type KnownShareUser = {
  dingUserId: string;
  unionId?: string | null;
  openId?: string | null;
  name?: string | null;
  mobile?: string | null;
  corpId?: string | null;
  deptIds?: string[] | null;
  jobNumber?: string | null;
  active?: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type ShareUserOption = KnownShareUser & {
  label: string;
};

const usersFileName = "known-users.json";

function knownUsersFilePath() {
  return path.join(getDataDir(), usersFileName);
}

async function ensureKnownUserStore() {
  await fs.mkdir(getDataDir(), { recursive: true });
  try {
    await fs.access(knownUsersFilePath());
  } catch {
    await fs.writeFile(knownUsersFilePath(), JSON.stringify([]));
  }
}

export async function readKnownUsers(): Promise<KnownShareUser[]> {
  await ensureKnownUserStore();
  const data = await fs.readFile(knownUsersFilePath(), "utf-8");
  return JSON.parse(data) as KnownShareUser[];
}

async function writeKnownUsers(users: KnownShareUser[]) {
  await ensureKnownUserStore();
  await fs.writeFile(knownUsersFilePath(), JSON.stringify(users, null, 2));
}

function userLabel(user: Pick<KnownShareUser, "name" | "mobile" | "jobNumber" | "dingUserId">) {
  return user.name?.trim() || user.mobile?.trim() || user.jobNumber?.trim() || user.dingUserId;
}

export function listKnownUsersForSharing(users: KnownShareUser[]): ShareUserOption[] {
  return users
    .filter((user) => user.active !== false && Boolean(user.dingUserId?.trim()))
    .map((user) => ({
      ...user,
      label: userLabel(user),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "zh-Hans-CN"));
}

export function upsertKnownUser(
  users: KnownShareUser[],
  principal: ProfilePrincipal,
  now = new Date().toISOString(),
): KnownShareUser[] {
  const dingUserId = principal.dingUserId?.trim();
  if (!dingUserId) return users;

  const index = users.findIndex((user) => user.dingUserId.toLowerCase() === dingUserId.toLowerCase());
  const existing = index >= 0 ? users[index] : null;
  const next: KnownShareUser = {
    dingUserId,
    unionId: principal.unionId ?? existing?.unionId ?? null,
    openId: principal.openId ?? existing?.openId ?? null,
    name: principal.name ?? existing?.name ?? null,
    mobile: principal.mobile ?? existing?.mobile ?? null,
    corpId: principal.corpId ?? existing?.corpId ?? null,
    deptIds: principal.deptIds ?? existing?.deptIds ?? null,
    jobNumber: principal.jobNumber ?? existing?.jobNumber ?? null,
    active: principal.active ?? existing?.active ?? true,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
  };

  if (index >= 0) {
    return users.map((user, userIndex) => (userIndex === index ? next : user));
  }
  return [...users, next];
}

export async function recordKnownUser(principal: ProfilePrincipal) {
  const users = await readKnownUsers();
  await writeKnownUsers(upsertKnownUser(users, principal));
}

function canonicalKnownDingUserIds(users: KnownShareUser[]) {
  const ids = new Map<string, string>();
  for (const user of listKnownUsersForSharing(users)) {
    ids.set(user.dingUserId.trim().toLowerCase(), user.dingUserId);
  }
  return ids;
}

export function resolveSharedWithForVisibility(
  visibility: ProfileVisibility,
  sharedWith: string | string[] | null | undefined,
  knownUsers: KnownShareUser[],
): string[] {
  if (visibility === "public" || visibility === "private") {
    return [];
  }

  const requested = Array.isArray(sharedWith) ? sharedWith : parseSharedWithString(sharedWith);
  const knownIds = canonicalKnownDingUserIds(knownUsers);
  const resolved: string[] = [];
  const seen = new Set<string>();
  const unknown: string[] = [];

  for (const raw of requested) {
    const key = raw.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const canonical = knownIds.get(key);
    if (canonical) {
      resolved.push(canonical);
    } else {
      unknown.push(raw.trim());
    }
  }

  if (unknown.length > 0) {
    throw new Error(`Unknown share target: ${unknown.join(", ")}`);
  }
  if (resolved.length === 0) {
    throw new Error("Selected sharing requires at least one known SSO user.");
  }

  return resolved;
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
