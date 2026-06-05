export type ShareVisibility = "private" | "selected" | "public";

export type NetworkProfile = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt?: string;
  files: string[];
  ownerDingUserId?: string;
  ownerName?: string;
  ownerMobile?: string;
  visibility?: ShareVisibility;
  sharedWith?: string[];
};

export type ShareUserOption = {
  dingUserId: string;
  label: string;
  name?: string | null;
  mobile?: string | null;
  jobNumber?: string | null;
};

export type NetworkUserPrincipal = {
  dingUserId: string;
  name?: string | null;
  mobile?: string | null;
  jobNumber?: string | null;
};

function normalizedId(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function networkProfileVisibility(
  profile: Pick<NetworkProfile, "visibility" | "sharedWith">,
): ShareVisibility {
  if (profile.visibility === "private" || profile.visibility === "selected" || profile.visibility === "public") {
    return profile.visibility;
  }
  return (profile.sharedWith?.length ?? 0) > 0 ? "selected" : "private";
}

export function networkProfileSharedCount(profile: Pick<NetworkProfile, "sharedWith">): number {
  return profile.sharedWith?.length ?? 0;
}

export function isOwnNetworkProfile(
  profile: Pick<NetworkProfile, "ownerDingUserId">,
  user: Pick<NetworkUserPrincipal, "dingUserId"> | null | undefined,
): boolean {
  const currentUserId = normalizedId(user?.dingUserId);
  return Boolean(currentUserId && normalizedId(profile.ownerDingUserId) === currentUserId);
}

export function sharingScopeLabel(profile: Pick<NetworkProfile, "visibility" | "sharedWith">): string {
  const visibility = networkProfileVisibility(profile);
  if (visibility === "public") return "全部员工可见";
  if (visibility === "private") return "仅自己可见";
  return `指定 ${networkProfileSharedCount(profile)} 人`;
}

export function shareUserInitial(user: ShareUserOption): string {
  return (user.label || user.name || user.mobile || user.jobNumber || user.dingUserId || "企")
    .trim()
    .slice(0, 1)
    .toUpperCase();
}

export function networkUserDisplayName(user: NetworkUserPrincipal | null): string {
  return user?.name?.trim() || user?.mobile?.trim() || user?.jobNumber?.trim() || user?.dingUserId || "企业账号";
}

export function networkUserMeta(user: NetworkUserPrincipal | null): string {
  if (!user) return "";
  return user.mobile?.trim() || user.jobNumber?.trim() || user.dingUserId;
}
