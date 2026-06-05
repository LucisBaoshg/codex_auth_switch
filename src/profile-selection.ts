export type ProfileListSnapshot<TProfile> = {
  profiles: TProfile[];
};

export type ProfileSelectionSnapshot<TProfile extends { id: string }> = {
  profiles: TProfile[];
  activeProfileId: string | null;
  lastSelectedProfileId: string | null;
};

export type ActiveProfileSnapshot<TProfile extends { id: string }> = {
  profiles: TProfile[];
  activeProfileId: string | null;
};

export type ProfileRemovalSnapshot<TProfile extends { id: string }> = {
  profiles: TProfile[];
  activeProfileId: string | null;
  lastSelectedProfileId: string | null;
  lastSwitchProfileId: string | null;
};

export type SymbioticEditorCandidate = {
  mode: string;
  thirdParty: {
    template: string;
  };
};

export function getOfficialOauthProfiles<TProfile extends { authTypeLabel: string }>(
  snapshot: ProfileListSnapshot<TProfile> | null,
): TProfile[] {
  return snapshot?.profiles.filter((profile) => profile.authTypeLabel === "官方 OAuth") ?? [];
}

export function findProfileById<TProfile extends { id: string }>(
  snapshot: ProfileListSnapshot<TProfile> | null,
  profileId: string | null,
): TProfile | null {
  if (!snapshot || !profileId) {
    return null;
  }
  return snapshot.profiles.find((profile) => profile.id === profileId) ?? null;
}

export function resolveOfficialOauthProfileId<TProfile extends { id: string; authTypeLabel: string }>(
  snapshot: ActiveProfileSnapshot<TProfile> | null,
  selectedProfileId: string | null,
): string {
  const officialProfiles = getOfficialOauthProfiles(snapshot);
  if (officialProfiles.length === 0) {
    return "";
  }

  if (officialProfiles.some((profile) => profile.id === selectedProfileId)) {
    return selectedProfileId ?? "";
  }

  const activeOfficial = officialProfiles.find((profile) => profile.id === snapshot?.activeProfileId);
  return activeOfficial?.id ?? officialProfiles[0].id;
}

export function isMissingOfficialOauthForNewSymbioticEditor<TProfile extends { authTypeLabel: string }>(
  editor: SymbioticEditorCandidate,
  snapshot: ProfileListSnapshot<TProfile> | null,
): boolean {
  return (
    editor.mode === "new" &&
    editor.thirdParty.template === "symbioticThirdParty" &&
    getOfficialOauthProfiles(snapshot).length === 0
  );
}

export function removeProfileFromSnapshot<
  TProfile extends { id: string },
  TSnapshot extends ProfileRemovalSnapshot<TProfile>,
>(
  snapshot: TSnapshot,
  profileId: string,
): TSnapshot {
  return {
    ...snapshot,
    profiles: snapshot.profiles.filter((profile) => profile.id !== profileId),
    activeProfileId: snapshot.activeProfileId === profileId ? null : snapshot.activeProfileId,
    lastSelectedProfileId:
      snapshot.lastSelectedProfileId === profileId ? null : snapshot.lastSelectedProfileId,
    lastSwitchProfileId: snapshot.lastSwitchProfileId === profileId ? null : snapshot.lastSwitchProfileId,
  };
}

export function resolveSelectedProfileId<TProfile extends { id: string }>(
  snapshot: ProfileSelectionSnapshot<TProfile>,
  currentProfileId: string | null,
): string | null {
  if (snapshot.profiles.some((profile) => profile.id === currentProfileId)) {
    return currentProfileId;
  }

  return (
    snapshot.activeProfileId ??
    snapshot.lastSelectedProfileId ??
    snapshot.profiles[0]?.id ??
    null
  );
}

export function resolveShareDraftProfileId<TProfile extends { id: string }>(
  snapshot: Pick<ProfileSelectionSnapshot<TProfile>, "profiles" | "activeProfileId">,
  currentProfileId: string | null,
): string | null {
  if (snapshot.profiles.some((profile) => profile.id === currentProfileId)) {
    return currentProfileId;
  }

  return snapshot.activeProfileId ?? snapshot.profiles[0]?.id ?? null;
}
