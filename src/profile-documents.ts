import type { ProfileDocument, ProfileSummary } from "./desktop-types";

export function createEmptyProfileDocument(): ProfileDocument {
  return {
    id: "",
    name: "",
    notes: "",
    authTypeLabel: "",
    modelProviderId: null,
    modelProviderApiKeyId: null,
    modelProviderKey: null,
    modelProviderName: null,
    modelProviderBaseUrl: null,
    modelProviderWireApi: null,
    createdAt: "",
    updatedAt: "",
    authJson: "{}",
    configToml: "",
    loadedFromTarget: false,
    hasTargetChanges: false,
  };
}

export function createMockProfileDocument(profile: ProfileSummary): ProfileDocument {
  return {
    id: profile.id,
    name: profile.name,
    notes: profile.notes,
    authTypeLabel: profile.authTypeLabel,
    modelProviderId: profile.modelProviderId ?? null,
    modelProviderApiKeyId: profile.modelProviderApiKeyId ?? null,
    modelProviderKey: profile.modelProviderKey ?? null,
    modelProviderName: profile.modelProviderName ?? null,
    modelProviderBaseUrl: profile.modelProviderBaseUrl ?? null,
    modelProviderWireApi: profile.modelProviderWireApi ?? null,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    authJson: `{
  "user": {
    "email": "${profile.name.toLowerCase()}@example.com"
  },
  "token": "token-for-${profile.id}"
}`,
    configToml: `default_model = "gpt-5"
theme = "system"
profile = "${profile.id}"
`,
    loadedFromTarget: false,
    hasTargetChanges: false,
  };
}
