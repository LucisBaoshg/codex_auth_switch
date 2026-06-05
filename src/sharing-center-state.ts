import type { ProfileSummary } from "./desktop-types";
import {
  networkProfileVisibility,
  type NetworkProfile,
} from "./network-profile-utils";
import type {
  LocalShareDraft,
  SharedProfileEditDraft,
} from "./profile-editor-state";

export type LocalShareFormState = {
  selectedProfile: ProfileSummary | null;
  profileIdToPersist: string | null;
  selectedUserCount: number;
  selectedShareDisabled: boolean;
  shareSummary: string;
};

export function resolveLocalShareFormState(
  profiles: readonly ProfileSummary[],
  draft: LocalShareDraft,
): LocalShareFormState {
  const requestedProfileId = draft.profileId ?? profiles[0]?.id ?? null;
  const selectedProfile = profiles.find((profile) => profile.id === requestedProfileId) ?? profiles[0] ?? null;
  const selectedUserCount = draft.selectedUserIds.length;
  const selectedShareDisabled = draft.visibility === "selected" && selectedUserCount === 0;
  const shareSummary =
    draft.visibility === "public"
      ? "全部已登录员工可见"
      : selectedUserCount > 0
        ? `已选择 ${selectedUserCount} 人`
        : "请选择共享对象";

  return {
    selectedProfile,
    profileIdToPersist: selectedProfile?.id ?? null,
    selectedUserCount,
    selectedShareDisabled,
    shareSummary,
  };
}

export function createSharedProfileEditDraft(
  profile: Pick<NetworkProfile, "id" | "visibility" | "sharedWith">,
): SharedProfileEditDraft {
  const visibility = networkProfileVisibility(profile);
  return {
    profileId: profile.id,
    visibility,
    selectedUserIds: visibility === "selected" ? [...(profile.sharedWith ?? [])] : [],
  };
}
