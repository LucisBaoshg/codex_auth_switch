import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

import type { ProfileSummary } from "../src/desktop-types";
import type {
  NetworkProfile,
  NetworkUserPrincipal,
  ShareUserOption,
} from "../src/network-profile-utils";
import type { LocalShareDraft, SharedProfileEditDraft } from "../src/profile-editor-state";

const root = join(import.meta.dirname, "..");
const renderersImportPath = `../src/${"sharing-center-renderers"}`;

function createUser(overrides: Partial<ShareUserOption> = {}): ShareUserOption {
  return {
    dingUserId: "ding-a",
    label: "Alice",
    mobile: "13800000000",
    jobNumber: "A-1",
    ...overrides,
  };
}

function createProfile(overrides: Partial<ProfileSummary> = {}): ProfileSummary {
  return {
    id: "profile-a",
    name: "Profile A",
    notes: "Primary profile",
    authTypeLabel: "官方 OAuth",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    authHash: "auth",
    configHash: "config",
    codexUsage: null,
    thirdPartyLatency: null,
    thirdPartyUsage: null,
    ...overrides,
  };
}

function createDraft(overrides: Partial<LocalShareDraft> = {}): LocalShareDraft {
  return {
    profileId: "profile-a",
    visibility: "selected",
    selectedUserIds: [],
    ...overrides,
  };
}

function createNetworkProfile(overrides: Partial<NetworkProfile> = {}): NetworkProfile {
  return {
    id: "network-a",
    name: "Shared A",
    description: "Shared config",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    files: ["auth.json", "config.toml"],
    ownerDingUserId: "ding-a",
    visibility: "selected",
    sharedWith: ["ding-b", "ding-c"],
    ...overrides,
  };
}

function createNetworkUser(overrides: Partial<NetworkUserPrincipal> = {}): NetworkUserPrincipal {
  return {
    dingUserId: "ding-a",
    name: "Alice",
    mobile: "13800000000",
    jobNumber: "A-1",
    ...overrides,
  };
}

function createEditDraft(overrides: Partial<SharedProfileEditDraft> = {}): SharedProfileEditDraft {
  return {
    profileId: "network-a",
    visibility: "selected",
    selectedUserIds: ["ding-b"],
    ...overrides,
  };
}

test("renders share user checkbox list states without app state", async () => {
  expect(existsSync(join(root, "src/sharing-center-renderers.ts"))).toBe(true);
  const { renderShareUserCheckboxList } = await import(renderersImportPath);

  expect(
    renderShareUserCheckboxList({
      users: [],
      loading: true,
      selectedUserIds: [],
      checkboxClass: "share-user-checkbox",
    }),
  ).toContain("正在加载可分享用户");

  expect(
    renderShareUserCheckboxList({
      users: [],
      loading: false,
      selectedUserIds: [],
      checkboxClass: "share-user-checkbox",
    }),
  ).toContain("暂无可选用户");

  const html = renderShareUserCheckboxList({
    users: [
      createUser({
        dingUserId: "ding-a",
        label: "Alice <Admin>",
        mobile: "",
        jobNumber: "A-1",
      }),
    ],
    loading: false,
    selectedUserIds: ["ding-a"],
    checkboxClass: "share-user-checkbox",
  });

  expect(html).toContain('class="share-user-checkbox"');
  expect(html).toContain('type="checkbox"');
  expect(html).toContain('value="ding-a"');
  expect(html).toContain("checked");
  expect(html).toContain("Alice &lt;Admin&gt;");
  expect(html).toContain("A-1");
});

test("renders local share user picker only for selected visibility", async () => {
  expect(existsSync(join(root, "src/sharing-center-renderers.ts"))).toBe(true);
  const rendererModule = await import(renderersImportPath);

  expect(rendererModule).toHaveProperty("renderShareUserPicker");
  const { renderShareUserPicker } = rendererModule as Record<string, (...args: any[]) => string>;

  expect(
    renderShareUserPicker({
      users: [createUser()],
      loading: false,
      shareDraft: createDraft({ visibility: "public", selectedUserIds: ["ding-a"] }),
    }),
  ).toBe("");

  const html = renderShareUserPicker({
    users: [
      createUser({
        dingUserId: "ding-a",
        label: "Alice <Admin>",
      }),
    ],
    loading: false,
    shareDraft: createDraft({ visibility: "selected", selectedUserIds: ["ding-a"] }),
  });

  expect(html).toContain('data-role="share-user-list"');
  expect(html).toContain('class="share-user-checkbox"');
  expect(html).toContain('type="checkbox"');
  expect(html).toContain('value="ding-a"');
  expect(html).toContain("checked");
  expect(html).toContain("Alice &lt;Admin&gt;");
});

test("renders shared profile edit user picker only for selected edit draft", async () => {
  expect(existsSync(join(root, "src/sharing-center-renderers.ts"))).toBe(true);
  const rendererModule = await import(renderersImportPath);

  expect(rendererModule).toHaveProperty("renderSharedProfileEditUserPicker");
  const { renderSharedProfileEditUserPicker } = rendererModule as Record<string, (...args: any[]) => string>;

  expect(
    renderSharedProfileEditUserPicker({
      users: [createUser()],
      loading: false,
      editDraft: null,
    }),
  ).toBe("");
  expect(
    renderSharedProfileEditUserPicker({
      users: [createUser()],
      loading: false,
      editDraft: createEditDraft({ visibility: "public", selectedUserIds: ["ding-a"] }),
    }),
  ).toBe("");

  const html = renderSharedProfileEditUserPicker({
    users: [
      createUser({
        dingUserId: "ding-b",
        label: "Bob <Ops>",
      }),
    ],
    loading: false,
    editDraft: createEditDraft({ visibility: "selected", selectedUserIds: ["ding-b"] }),
  });

  expect(html).toContain('data-role="share-user-list"');
  expect(html).toContain('class="shared-profile-edit-user-checkbox"');
  expect(html).toContain('type="checkbox"');
  expect(html).toContain('value="ding-b"');
  expect(html).toContain("checked");
  expect(html).toContain("Bob &lt;Ops&gt;");
});

test("renders sharing center tabs with active state", async () => {
  expect(existsSync(join(root, "src/sharing-center-renderers.ts"))).toBe(true);
  const { renderSharingCenterTabs } = await import(renderersImportPath);

  const ownHtml = renderSharingCenterTabs("own");
  expect(ownHtml).toContain('data-action="sharing-tab-own"');
  expect(ownHtml).toContain('tab-btn active');
  expect(ownHtml).toContain("企业共享库");

  const libraryHtml = renderSharingCenterTabs("library");
  expect(libraryHtml).toContain('data-action="sharing-tab-library"');
  expect(libraryHtml).toContain('button class="tab-btn active" data-action="sharing-tab-library"');
});

test("renders sharing center page shell with active tab content", async () => {
  expect(existsSync(join(root, "src/sharing-center-renderers.ts"))).toBe(true);
  const rendererModule = await import(renderersImportPath);

  expect(rendererModule).toHaveProperty("renderSharingCenterPage");
  const { renderSharingCenterPage } = rendererModule as Record<string, (...args: any[]) => string>;

  const html = renderSharingCenterPage({
    activeTab: "library",
    busy: true,
    tabContentHtml: "<section data-role=\"network-profile-library\">Library</section>",
  });

  expect(html).toContain('data-page="sharing-center"');
  expect(html).toContain("配置共享中心");
  expect(html).toContain("共享本地配置，也从企业共享库导入可用配置");
  expect(html).toContain('data-action="refresh-sharing-center" disabled');
  expect(html).toContain('button class="tab-btn active" data-action="sharing-tab-library"');
  expect(html).toContain('data-role="network-profile-library"');
  expect(html).toContain("Library");
});

test("renders local share form auth prompt and selected profile form", async () => {
  expect(existsSync(join(root, "src/sharing-center-renderers.ts"))).toBe(true);
  const { renderLocalShareForm } = await import(renderersImportPath);
  const profile = createProfile({ id: "profile-b", name: "Profile <B>", notes: "Team account" });

  const authHtml = renderLocalShareForm({
    profiles: [profile],
    authRequired: true,
    busy: false,
    currentUser: null,
    shareDraft: createDraft({ profileId: "profile-b" }),
    localShareForm: {
      selectedProfile: profile,
      profileIdToPersist: "profile-b",
      selectedUserCount: 0,
      selectedShareDisabled: true,
      shareSummary: "请选择共享对象",
    },
    shareUserPickerHtml: "<div data-role=\"share-user-list\">picker</div>",
    ownedProfilesLoading: false,
    ownedProfiles: [],
    editDraft: null,
    editUserPickerHtml: "",
  });

  expect(authHtml).toContain("需要登录企业共享中心");
  expect(authHtml).toContain('data-action="open-network-sso-login"');

  const formHtml = renderLocalShareForm({
    profiles: [createProfile(), profile],
    authRequired: false,
    busy: false,
    currentUser: null,
    shareDraft: createDraft({ profileId: "profile-b", visibility: "selected" }),
    localShareForm: {
      selectedProfile: profile,
      profileIdToPersist: "profile-b",
      selectedUserCount: 0,
      selectedShareDisabled: true,
      shareSummary: "请选择共享对象",
    },
    shareUserPickerHtml: "<div data-role=\"share-user-list\">picker</div>",
    ownedProfilesLoading: false,
    ownedProfiles: [],
    editDraft: null,
    editUserPickerHtml: "",
  });

  expect(formHtml).toContain("共享我的本地配置");
  expect(formHtml).toContain('data-role="local-profile-tabs"');
  expect(formHtml).toContain('data-action="select-share-profile-tab"');
  expect(formHtml).toContain('data-profile-id="profile-b"');
  expect(formHtml.match(/local-profile-tab-card active/g) ?? []).toHaveLength(1);
  expect(formHtml).toContain("Profile &lt;B&gt;");
  expect(formHtml).toContain("Team account");
  expect(formHtml).toContain('data-role="share-user-list"');
  expect(formHtml).toContain("请选择共享对象");
  expect(formHtml).toContain('data-action="share-local-profile"');
  expect(formHtml).toContain("disabled");
});

test("renders own sharing tab as local profile tabs with inline share controls", async () => {
  expect(existsSync(join(root, "src/sharing-center-renderers.ts"))).toBe(true);
  const rendererModule = await import(renderersImportPath);

  expect(rendererModule).toHaveProperty("renderOwnSharingTab");
  const { renderOwnSharingTab } = rendererModule as Record<string, (...args: any[]) => string>;
  const profile = createProfile({ name: "Profile <A>", notes: "Local notes" });
  const ownedProfile = createNetworkProfile({ id: "network-owned-a", name: "Profile <A>" });

  const html = renderOwnSharingTab({
    profiles: [profile],
    authRequired: false,
    busy: true,
    currentUser: null,
    shareDraft: createDraft({ selectedUserIds: ["ding-a"] }),
    localShareForm: {
      selectedProfile: profile,
      profileIdToPersist: profile.id,
      selectedUserCount: 1,
      selectedShareDisabled: false,
      shareSummary: "指定 1 人",
    },
    shareUserPickerHtml: "<div data-role=\"share-user-list\">picker</div>",
    ownedProfilesLoading: false,
    ownedProfiles: [ownedProfile],
    editDraft: createEditDraft({ profileId: "network-owned-a" }),
    editUserPickerHtml: "<div data-role=\"share-user-list\">edit picker</div>",
  });

  expect(html).toContain("共享我的本地配置");
  expect(html).toContain('data-role="local-profile-tabs"');
  expect(html).toContain('data-action="select-share-profile-tab"');
  expect(html).toContain('data-owned-id="network-owned-a"');
  expect(html).toContain("Profile &lt;A&gt;");
  expect(html).toContain("已共享");
  expect(html).not.toContain("我已共享的配置");
  expect(html).not.toContain('data-role="owned-shared-profiles"');
  expect(html).toContain("edit picker");
  expect(html).toContain('data-action="save-shared-profile-users"');
  expect(html).toContain("disabled");
});

test("renders owned shared profiles panel states and cards", async () => {
  expect(existsSync(join(root, "src/sharing-center-renderers.ts"))).toBe(true);
  const { renderOwnedSharedProfiles } = await import(renderersImportPath);

  expect(
    renderOwnedSharedProfiles({
      authRequired: true,
      loading: false,
      profiles: [],
      busy: false,
      editDraft: null,
      editUserPickerHtml: "",
    }),
  ).toBe("");

  expect(
    renderOwnedSharedProfiles({
      authRequired: false,
      loading: true,
      profiles: [],
      busy: false,
      editDraft: null,
      editUserPickerHtml: "",
    }),
  ).toContain("正在加载我已共享的配置");

  expect(
    renderOwnedSharedProfiles({
      authRequired: false,
      loading: false,
      profiles: [],
      busy: false,
      editDraft: null,
      editUserPickerHtml: "",
    }),
  ).toContain("还没有共享配置");

  const html = renderOwnedSharedProfiles({
    authRequired: false,
    loading: false,
    profiles: [createNetworkProfile({ name: "Shared <A>" })],
    busy: true,
    editDraft: null,
    editUserPickerHtml: "",
  });

  expect(html).toContain("我已共享的配置");
  expect(html).toContain("Shared &lt;A&gt;");
  expect(html).toContain("指定 2 人");
  expect(html).toContain('data-action="edit-shared-profile-users"');
  expect(html).toContain('data-action="delete-shared-profile"');
  expect(html).toContain("disabled");
});

test("renders owned shared profile edit state", async () => {
  expect(existsSync(join(root, "src/sharing-center-renderers.ts"))).toBe(true);
  const { renderOwnedSharedProfiles } = await import(renderersImportPath);

  const html = renderOwnedSharedProfiles({
    authRequired: false,
    loading: false,
    profiles: [createNetworkProfile()],
    busy: false,
    editDraft: createEditDraft({ selectedUserIds: [] }),
    editUserPickerHtml: "<div data-role=\"share-user-list\">picker</div>",
  });

  expect(html).toContain("编辑中");
  expect(html).toContain('name="shared-profile-edit-visibility-network-a"');
  expect(html).toContain('value="selected"');
  expect(html).toContain("checked");
  expect(html).toContain('data-role="share-user-list"');
  expect(html).toContain('data-action="save-shared-profile-users"');
  expect(html).toContain("disabled");
});

test("renders enterprise library tab states and network cards", async () => {
  expect(existsSync(join(root, "src/sharing-center-renderers.ts"))).toBe(true);
  const { renderEnterpriseLibraryTab } = await import(renderersImportPath);

  const authHtml = renderEnterpriseLibraryTab({
    authRequired: true,
    loading: false,
    profiles: [],
    currentUser: null,
  });
  expect(authHtml).toContain('data-role="network-profile-library"');
  expect(authHtml).toContain("需要登录企业共享库");
  expect(authHtml).toContain('data-action="open-network-sso-login"');

  const loadingHtml = renderEnterpriseLibraryTab({
    authRequired: false,
    loading: true,
    profiles: [],
    currentUser: null,
  });
  expect(loadingHtml).toContain("正在获取云端共享配置");

  const emptyHtml = renderEnterpriseLibraryTab({
    authRequired: false,
    loading: false,
    profiles: [],
    currentUser: null,
  });
  expect(emptyHtml).toContain("云端共享库为空");
  expect(emptyHtml).toContain('data-action="refresh-network-in-editor"');

  const cardHtml = renderEnterpriseLibraryTab({
    authRequired: false,
    loading: false,
    profiles: [
      createNetworkProfile({
        id: "network-a",
        name: "Shared <A>",
        description: "Use <safe> config",
      }),
    ],
    currentUser: createNetworkUser(),
  });

  expect(cardHtml).toContain("可用云端共享配置 (1)");
  expect(cardHtml).toContain("Shared &lt;A&gt;");
  expect(cardHtml).toContain("Use &lt;safe&gt; config");
  expect(cardHtml).toContain("我共享的配置");
  expect(cardHtml).toContain("指定 2 人");
  expect(cardHtml).toContain('data-action="view-network-profile-details"');
  expect(cardHtml).toContain('data-action="import-network-profile-to-editor"');
});
