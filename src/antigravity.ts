import { invoke } from "@tauri-apps/api/core";

export type AntigravityProfileSummary = {
  id: string;
  name: string;
  notes: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AntigravitySnapshot = {
  sourceDbPath: string;
  sourceExists: boolean;
  activeProfileId: string | null;
  lastSelectedProfileId: string | null;
  lastSwitchProfileId: string | null;
  lastSwitchedAt: string | null;
  profiles: AntigravityProfileSummary[];
};

export type AntigravitySwitchResult = {
  profileId: string;
  backupId: string;
  switchedAt: string;
};

export function loadAntigravitySnapshot(): Promise<AntigravitySnapshot> {
  return invoke("load_antigravity_snapshot", undefined);
}

export function importCurrentAntigravityProfile(): Promise<AntigravityProfileSummary> {
  return invoke("import_current_antigravity_profile", {
    name: "Current Antigravity Account",
    notes: "Imported from local state.vscdb",
  });
}

export function switchAntigravityProfile(
  profileId: string,
): Promise<AntigravitySwitchResult> {
  return invoke("switch_antigravity_profile", { profileId });
}

export function restoreLastAntigravityBackup(): Promise<AntigravitySwitchResult> {
  return invoke("restore_last_antigravity_backup", undefined);
}

export function revealAntigravitySource(): Promise<void> {
  return invoke("reveal_antigravity_source", undefined);
}
