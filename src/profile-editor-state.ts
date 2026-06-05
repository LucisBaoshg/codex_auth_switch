import type { ShareVisibility } from "./network-profile-utils";
import type { ProfileDocument } from "./desktop-types";
import type { ProfileInput, ThirdPartyConfigDraft } from "./profile-input-builders";

export type EditorMode = "new" | "fromCurrent" | "existing";

export type EditorState = {
  mode: EditorMode;
  profileId: string | null;
  name: string;
  notes: string;
  authJson: string;
  configToml: string;
  thirdParty: ThirdPartyConfigDraft;
  createdAt: string | null;
  updatedAt: string | null;
  loadedFromTarget: boolean;
  hasTargetChanges: boolean;
  readOnly: boolean;
  source: "local" | "network";
  newTab?: "manual-delta" | "manual-full";
};

export type LocalShareDraft = {
  profileId: string | null;
  visibility: ShareVisibility;
  selectedUserIds: string[];
};

export type SharedProfileEditDraft = {
  profileId: string;
  visibility: ShareVisibility;
  selectedUserIds: string[];
};

export function createEditorState(mode: EditorMode = "new"): EditorState {
  return {
    mode,
    profileId: null,
    name: "",
    notes: "",
    authJson: `{
  "user": {
    "email": ""
  },
  "token": ""
}`,
    configToml: `default_model = "gpt-5"
theme = "system"
`,
    thirdParty: {
      template: "standaloneThirdParty",
      oauthProfileId: "",
      provider: "",
      baseUrl: "",
      apiKey: "",
      model: "gpt-5.5",
    },
    createdAt: null,
    updatedAt: null,
    loadedFromTarget: false,
    hasTargetChanges: false,
    readOnly: false,
    source: "local",
    newTab: "manual-delta",
  };
}

export function createLocalShareDraft(): LocalShareDraft {
  return {
    profileId: null,
    visibility: "selected",
    selectedUserIds: [],
  };
}

export function createMockCurrentInput(): ProfileInput {
  return {
    name: "",
    notes: "来自当前 Codex 目录",
    authJson: `{
  "auth_mode": "chatgpt",
  "tokens": {
    "id_token": "mock-id-token",
    "access_token": "mock-access-token"
  }
}`,
    configToml: `model = "gpt-5.4"
model_reasoning_effort = "medium"
`,
  };
}

export function createEditorFromInput(mode: EditorMode, input: ProfileInput): EditorState {
  const template = createEditorState();
  return {
    mode,
    profileId: null,
    name: input.name,
    notes: input.notes,
    authJson: input.authJson,
    configToml: input.configToml,
    thirdParty: template.thirdParty,
    createdAt: null,
    updatedAt: null,
    loadedFromTarget: false,
    hasTargetChanges: false,
    readOnly: false,
    source: "local",
  };
}

export function createEditorFromDocument(document: ProfileDocument): EditorState {
  const template = createEditorState();
  return {
    mode: "existing",
    profileId: document.id,
    name: document.name,
    notes: document.notes,
    authJson: document.authJson,
    configToml: document.configToml,
    thirdParty: template.thirdParty,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    loadedFromTarget: document.loadedFromTarget,
    hasTargetChanges: document.hasTargetChanges,
    readOnly: document.readOnly ?? false,
    source: document.source ?? "local",
  };
}

export function createSymbioticEditorFromDocument(
  document: ProfileDocument,
  oauthProfileId: string,
): EditorState {
  let apiKey = "";
  try {
    const parsedAuth = JSON.parse(document.authJson);
    apiKey = parsedAuth.OPENAI_API_KEY || "";
  } catch {
    // Keep the generated editor usable even if the source auth.json is malformed.
  }

  let baseUrl = "";
  let model = "";
  let provider = "";

  const baseUrlMatch = document.configToml.match(/openai_base_url\s*=\s*"([^"]+)"/);
  if (baseUrlMatch) {
    baseUrl = baseUrlMatch[1];
  } else {
    const fallbackBaseUrlMatch = document.configToml.match(/base_url\s*=\s*"([^"]+)"/);
    if (fallbackBaseUrlMatch) {
      baseUrl = fallbackBaseUrlMatch[1];
    }
  }

  const modelMatch = document.configToml.match(/model\s*=\s*"([^"]+)"/);
  if (modelMatch) {
    model = modelMatch[1];
  }

  const providerMatch = document.configToml.match(/model_provider\s*=\s*"([^"]+)"/);
  if (providerMatch) {
    provider = providerMatch[1];
  }

  return {
    mode: "new",
    profileId: null,
    name: `${document.name} (共生)`,
    notes: document.notes || "",
    authJson: "",
    configToml: "",
    thirdParty: {
      template: "symbioticThirdParty",
      oauthProfileId,
      provider: provider || "openai",
      baseUrl: baseUrl || "",
      apiKey: apiKey || "",
      model: model || "gpt-5.5",
    },
    createdAt: null,
    updatedAt: null,
    loadedFromTarget: false,
    hasTargetChanges: false,
    readOnly: false,
    source: "local",
    newTab: "manual-delta",
  };
}
