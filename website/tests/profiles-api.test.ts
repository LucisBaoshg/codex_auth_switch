import { expect, test } from "vitest";
import { NextRequest } from "next/server";
import { createDesktopToken } from "../src/lib/auth";
import { POST as createSharedProfile } from "../src/app/api/profiles/route";
import { DELETE as deleteSharedProfile, POST as updateSharedProfile } from "../src/app/api/profiles/[id]/route";
import { GET as getSharedProfileFile } from "../src/app/api/profiles/[id]/[filename]/route";
import { sharedProfileContentHash } from "../src/lib/profile-store";

async function useTempDataDir(prefix: string) {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  process.env.CODEX_PROFILE_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return process.env.CODEX_PROFILE_DATA_DIR;
}

test("creates shared profiles from a desktop bearer token", async () => {
  await useTempDataDir("codex-profiles-api-test-");
  const { token } = await createDesktopToken({
    dingUserId: "Ding-A",
    name: "Alice",
    mobile: "13900000001",
    active: true,
  });

  const formData = new FormData();
  formData.append("name", "Unified API");
  formData.append("description", "provider registry");
  formData.append("visibility", "public");
  formData.append("sharedWith", "[]");
  formData.append("file1", new File(['{"OPENAI_API_KEY":"sk-test"}'], "auth.json", { type: "application/json" }));
  formData.append("file2", new File(['model = "gpt-5.4"\n'], "config.toml", { type: "text/plain" }));

  const response = await createSharedProfile(
    new NextRequest("http://localhost/codex/api/profiles", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
      body: formData,
    }),
  );
  const body = await response.json();

  expect(response.status).toBe(201);
  expect(body).toEqual(expect.objectContaining({
    name: "Unified API",
    ownerDingUserId: "Ding-A",
    ownerName: "Alice",
    visibility: "public",
    contentVersion: 1,
  }));
  expect(body.contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect(body.contentUpdatedAt).toBe(body.updatedAt);
});

test("rejects public sharing for official OAuth auth files", async () => {
  await useTempDataDir("codex-profiles-public-oauth-test-");
  const { token } = await createDesktopToken({
    dingUserId: "Ding-A",
    name: "Alice",
    mobile: "13900000001",
    active: true,
  });

  const formData = new FormData();
  formData.append("name", "ChatGPT Pro");
  formData.append("description", "shared auth");
  formData.append("visibility", "public");
  formData.append("sharedWith", "[]");
  formData.append("file1", new File(['{"auth_mode":"chatgpt","tokens":{"refresh_token":"secret"}}'], "auth.json", { type: "application/json" }));
  formData.append("file2", new File(['model = "gpt-5.5"\n'], "config.toml", { type: "text/plain" }));

  const response = await createSharedProfile(
    new NextRequest("http://localhost/codex/api/profiles", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
      body: formData,
    }),
  );
  const body = await response.json();

  expect(response.status).toBe(400);
  expect(body.error).toContain("官方 OAuth");
});

test("rejects updating official OAuth auth files to public visibility", async () => {
  const dataDir = await useTempDataDir("codex-profiles-public-oauth-update-test-");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const previousAuth = '{"auth_mode":"chatgpt","tokens":{"refresh_token":"secret"}}';
  const configToml = 'model = "gpt-5.5"\n';
  await fs.mkdir(path.join(dataDir, "files", "profile-1"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "files", "profile-1", "auth.json"), previousAuth);
  await fs.writeFile(path.join(dataDir, "files", "profile-1", "config.toml"), configToml);
  await fs.writeFile(path.join(dataDir, "profiles.json"), JSON.stringify([
    {
      id: "profile-1",
      name: "ChatGPT Pro",
      description: "shared auth",
      createdAt: "2026-06-04T10:00:00.000Z",
      updatedAt: "2026-06-04T10:00:00.000Z",
      files: ["auth.json", "config.toml"],
      contentVersion: 1,
      contentHash: sharedProfileContentHash(previousAuth, configToml),
      ownerDingUserId: "Ding-A",
      ownerName: "Alice",
      visibility: "selected",
      sharedWith: ["Ding-B"],
    },
  ]));
  const { token } = await createDesktopToken({
    dingUserId: "Ding-A",
    name: "Alice",
    active: true,
  });

  const response = await updateSharedProfile(
    new NextRequest("http://localhost/codex/api/profiles/profile-1", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: "ChatGPT Pro",
        description: "shared auth",
        visibility: "public",
        sharedWith: [],
      }),
    }),
    { params: Promise.resolve({ id: "profile-1" }) },
  );
  const body = await response.json();

  expect(response.status).toBe(400);
  expect(body.error).toContain("官方 OAuth");
});

test("stores only share-safe config.toml content from desktop uploads", async () => {
  const dataDir = await useTempDataDir("codex-profiles-sanitize-test-");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { token } = await createDesktopToken({
    dingUserId: "Ding-A",
    name: "Alice",
    active: true,
  });

  const formData = new FormData();
  formData.append("name", "ChatGPT Pro");
  formData.append("description", "shared auth");
  formData.append("visibility", "private");
  formData.append("sharedWith", "[]");
  formData.append("file1", new File(['{"auth_mode":"chatgpt","tokens":{"access_token":"shared"}}'], "auth.json", { type: "application/json" }));
  formData.append("file2", new File([[
    'model = "gpt-5.5"',
    'notify = [',
    '  "/Users/lucifer/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseClient",',
    '  "turn-ended",',
    ']',
    '',
    '[desktop]',
    'selected-avatar-id = "custom"',
    '',
    '[projects."/Users/lucifer/work/private"]',
    'trust_level = "trusted"',
    '',
  ].join("\n")], "config.toml", { type: "text/plain" }));

  const response = await createSharedProfile(new NextRequest("http://localhost/codex/api/profiles", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
    },
    body: formData,
  }));
  const body = await response.json();
  const storedConfig = await fs.readFile(path.join(dataDir, "files", body.id, "config.toml"), "utf-8");

  expect(response.status).toBe(201);
  expect(storedConfig).toContain('model = "gpt-5.5"');
  expect(storedConfig).not.toContain("notify");
  expect(storedConfig).not.toContain("SkyComputerUseClient");
  expect(storedConfig).not.toContain("[desktop]");
  expect(storedConfig).not.toContain("[projects");
  expect(storedConfig).not.toContain("private");
});

test("returns derived auth type labels for symbiotic shared profiles", async () => {
  await useTempDataDir("codex-profiles-auth-type-test-");
  const { token } = await createDesktopToken({
    dingUserId: "Ding-A",
    name: "Alice",
    active: true,
  });

  const formData = new FormData();
  formData.append("name", "伊莉思Code");
  formData.append("description", "lancer.he@gmail.com 账号 $100/天");
  formData.append("visibility", "private");
  formData.append("sharedWith", "[]");
  formData.append(
    "file1",
    new File(['{"auth_mode":"chatgpt","tokens":{"access_token":"oauth"}}'], "auth.json", { type: "application/json" }),
  );
  formData.append("file2", new File([[
    'model_provider = "ylscode"',
    'model = "gpt-5.5"',
    '[model_providers.ylscode]',
    'base_url = "https://code.ylsagi.com/codex"',
    'experimental_bearer_token = "provider-token"',
    'requires_openai_auth = true',
  ].join("\n")], "config.toml", { type: "text/plain" }));

  const response = await createSharedProfile(
    new NextRequest("http://localhost/codex/api/profiles", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
      body: formData,
    }),
  );
  const body = await response.json();

  expect(response.status).toBe(201);
  expect(body.authTypeLabel).toBe("共生配置");
});

test("updates shared profile recipients from a desktop bearer token", async () => {
  const dataDir = await useTempDataDir("codex-profiles-update-test-");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(path.join(dataDir, "files", "profile-1"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "known-users.json"), JSON.stringify([
    {
      dingUserId: "Ding-A",
      name: "Alice",
      active: true,
      firstSeenAt: "2026-06-04T10:00:00.000Z",
      lastSeenAt: "2026-06-04T10:00:00.000Z",
    },
    {
      dingUserId: "Ding-B",
      name: "Bob",
      active: true,
      firstSeenAt: "2026-06-04T10:00:00.000Z",
      lastSeenAt: "2026-06-04T10:00:00.000Z",
    },
  ]));
  await fs.writeFile(path.join(dataDir, "profiles.json"), JSON.stringify([
    {
      id: "profile-1",
      name: "ChatGPT Pro",
      description: "shared auth",
      createdAt: "2026-06-04T10:00:00.000Z",
      files: ["auth.json", "config.toml"],
      ownerDingUserId: "Ding-A",
      ownerName: "Alice",
      visibility: "selected",
      sharedWith: ["Ding-A"],
    },
  ]));
  const { token } = await createDesktopToken({
    dingUserId: "Ding-A",
    name: "Alice",
    active: true,
  });

  const response = await updateSharedProfile(
    new NextRequest("http://localhost/codex/api/profiles/profile-1", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: "ChatGPT Pro",
        description: "shared auth",
        visibility: "selected",
        sharedWith: ["Ding-B"],
      }),
    }),
    { params: Promise.resolve({ id: "profile-1" }) },
  );
  const body = await response.json();
  const storedProfiles = JSON.parse(await fs.readFile(path.join(dataDir, "profiles.json"), "utf-8"));

  expect(response.status).toBe(200);
  expect(body.sharedWith).toEqual(["Ding-B"]);
  expect(body.visibility).toBe("selected");
  expect(body.contentVersion).toBe(1);
  expect(storedProfiles[0].sharedWith).toEqual(["Ding-B"]);
  expect(storedProfiles[0].contentVersion).toBe(1);
});

test("updates shared profile files from a desktop bearer token", async () => {
  const dataDir = await useTempDataDir("codex-profiles-file-update-test-");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(path.join(dataDir, "files", "profile-1"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "files", "profile-1", "auth.json"), '{"auth_mode":"chatgpt","tokens":{"access_token":"old"}}');
  await fs.writeFile(path.join(dataDir, "files", "profile-1", "config.toml"), 'model = "gpt-5"\nnotify = ["local"]');
  await fs.writeFile(path.join(dataDir, "known-users.json"), JSON.stringify([
    {
      dingUserId: "Ding-B",
      name: "Bob",
      active: true,
      firstSeenAt: "2026-06-04T10:00:00.000Z",
      lastSeenAt: "2026-06-04T10:00:00.000Z",
    },
  ]));
  await fs.writeFile(path.join(dataDir, "profiles.json"), JSON.stringify([
    {
      id: "profile-1",
      name: "ChatGPT Pro",
      description: "shared auth",
      createdAt: "2026-06-04T10:00:00.000Z",
      updatedAt: "2026-06-04T10:00:00.000Z",
      files: ["auth.json", "config.toml"],
      contentVersion: 1,
      contentHash: "old-content-hash",
      contentUpdatedAt: "2026-06-04T10:00:00.000Z",
      ownerDingUserId: "Ding-A",
      ownerName: "Alice",
      visibility: "selected",
      sharedWith: ["Ding-B"],
      sourceProfileId: "local-profile-1",
    },
  ]));
  const { token } = await createDesktopToken({
    dingUserId: "Ding-A",
    name: "Alice",
    active: true,
  });

  const response = await updateSharedProfile(
    new NextRequest("http://localhost/codex/api/profiles/profile-1", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: "ChatGPT Pro",
        description: "shared auth",
        visibility: "selected",
        sharedWith: ["Ding-B"],
        sourceProfileId: "local-profile-1",
        authContent: '{"auth_mode":"chatgpt","tokens":{"access_token":"new"}}',
        configContent: 'model = "gpt-5.5"\nnotify = ["local"]',
      }),
    }),
    { params: Promise.resolve({ id: "profile-1" }) },
  );
  const body = await response.json();
  const storedAuth = await fs.readFile(path.join(dataDir, "files", "profile-1", "auth.json"), "utf-8");
  const storedConfig = await fs.readFile(path.join(dataDir, "files", "profile-1", "config.toml"), "utf-8");
  const storedProfiles = JSON.parse(await fs.readFile(path.join(dataDir, "profiles.json"), "utf-8"));

  expect(response.status).toBe(200);
  expect(body.sourceProfileId).toBe("local-profile-1");
  expect(body.contentVersion).toBe(2);
  expect(body.contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect(body.contentHash).not.toBe("old-content-hash");
  expect(new Date(body.updatedAt).getTime()).toBeGreaterThan(new Date("2026-06-04T10:00:00.000Z").getTime());
  expect(storedAuth).toContain('"access_token":"new"');
  expect(storedConfig).toContain('model = "gpt-5.5"');
  expect(storedConfig).not.toContain("notify");
  expect(storedProfiles[0].sourceProfileId).toBe("local-profile-1");
  expect(storedProfiles[0].contentVersion).toBe(2);
});

test("rejects stale shared auth write backs", async () => {
  const dataDir = await useTempDataDir("codex-profiles-auth-sync-stale-test-");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const previousAuth = '{"auth_mode":"chatgpt","tokens":{"refresh_token":"old-refresh"}}';
  const configToml = 'model = "gpt-5.5"\n';
  const currentHash = sharedProfileContentHash(previousAuth, configToml);
  await fs.mkdir(path.join(dataDir, "files", "profile-1"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "files", "profile-1", "auth.json"), previousAuth);
  await fs.writeFile(path.join(dataDir, "files", "profile-1", "config.toml"), configToml);
  await fs.writeFile(path.join(dataDir, "known-users.json"), JSON.stringify([
    {
      dingUserId: "Ding-B",
      name: "Bob",
      active: true,
      firstSeenAt: "2026-06-04T10:00:00.000Z",
      lastSeenAt: "2026-06-04T10:00:00.000Z",
    },
  ]));
  await fs.writeFile(path.join(dataDir, "profiles.json"), JSON.stringify([
    {
      id: "profile-1",
      name: "ChatGPT Pro",
      description: "shared auth",
      createdAt: "2026-06-04T10:00:00.000Z",
      updatedAt: "2026-06-04T10:00:00.000Z",
      files: ["auth.json", "config.toml"],
      contentVersion: 3,
      contentHash: currentHash,
      contentUpdatedAt: "2026-06-04T10:00:00.000Z",
      ownerDingUserId: "Ding-A",
      ownerName: "Alice",
      visibility: "selected",
      sharedWith: ["Ding-B"],
    },
  ]));
  const { token } = await createDesktopToken({
    dingUserId: "Ding-B",
    name: "Bob",
    active: true,
  });

  const response = await updateSharedProfile(
    new NextRequest("http://localhost/codex/api/profiles/profile-1", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        baseContentVersion: 2,
        baseContentHash: "older-hash",
        authContent: '{"auth_mode":"chatgpt","tokens":{"refresh_token":"new-refresh"}}',
      }),
    }),
    { params: Promise.resolve({ id: "profile-1" }) },
  );
  const body = await response.json();
  const storedAuth = await fs.readFile(path.join(dataDir, "files", "profile-1", "auth.json"), "utf-8");
  const storedProfiles = JSON.parse(await fs.readFile(path.join(dataDir, "profiles.json"), "utf-8"));

  expect(response.status).toBe(409);
  expect(body.error).toContain("共享配置已有更新");
  expect(storedAuth).toBe(previousAuth);
  expect(storedProfiles[0].contentVersion).toBe(3);
  expect(storedProfiles[0].contentHash).toBe(currentHash);
});

test("allows shared recipients to write back refreshed auth without editing share metadata", async () => {
  const dataDir = await useTempDataDir("codex-profiles-auth-sync-shared-user-test-");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const previousAuth = '{"auth_mode":"chatgpt","tokens":{"refresh_token":"old-refresh"}}';
  const nextAuth = '{"auth_mode":"chatgpt","tokens":{"refresh_token":"new-refresh"}}';
  const configToml = 'model = "gpt-5.5"\n';
  const previousHash = sharedProfileContentHash(previousAuth, configToml);
  await fs.mkdir(path.join(dataDir, "files", "profile-1"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "files", "profile-1", "auth.json"), previousAuth);
  await fs.writeFile(path.join(dataDir, "files", "profile-1", "config.toml"), configToml);
  await fs.writeFile(path.join(dataDir, "known-users.json"), JSON.stringify([
    {
      dingUserId: "Ding-B",
      name: "Bob",
      active: true,
      firstSeenAt: "2026-06-04T10:00:00.000Z",
      lastSeenAt: "2026-06-04T10:00:00.000Z",
    },
  ]));
  await fs.writeFile(path.join(dataDir, "profiles.json"), JSON.stringify([
    {
      id: "profile-1",
      name: "ChatGPT Pro",
      description: "shared auth",
      createdAt: "2026-06-04T10:00:00.000Z",
      updatedAt: "2026-06-04T10:00:00.000Z",
      files: ["auth.json", "config.toml"],
      contentVersion: 1,
      contentHash: previousHash,
      contentUpdatedAt: "2026-06-04T10:00:00.000Z",
      ownerDingUserId: "Ding-A",
      ownerName: "Alice",
      visibility: "selected",
      sharedWith: ["Ding-B"],
    },
  ]));
  const { token } = await createDesktopToken({
    dingUserId: "Ding-B",
    name: "Bob",
    active: true,
  });

  const response = await updateSharedProfile(
    new NextRequest("http://localhost/codex/api/profiles/profile-1", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        baseContentVersion: 1,
        baseContentHash: previousHash,
        authContent: nextAuth,
      }),
    }),
    { params: Promise.resolve({ id: "profile-1" }) },
  );
  const body = await response.json();
  const storedAuth = await fs.readFile(path.join(dataDir, "files", "profile-1", "auth.json"), "utf-8");
  const storedConfig = await fs.readFile(path.join(dataDir, "files", "profile-1", "config.toml"), "utf-8");
  const storedProfiles = JSON.parse(await fs.readFile(path.join(dataDir, "profiles.json"), "utf-8"));

  expect(response.status).toBe(200);
  expect(body.contentVersion).toBe(2);
  expect(body.contentHash).toBe(sharedProfileContentHash(nextAuth, configToml));
  expect(storedAuth).toBe(nextAuth);
  expect(storedConfig).toBe(configToml);
  expect(storedProfiles[0].ownerDingUserId).toBe("Ding-A");
  expect(storedProfiles[0].sharedWith).toEqual(["Ding-B"]);
});

test("rejects stale owner file updates when a base content version is supplied", async () => {
  const dataDir = await useTempDataDir("codex-profiles-owner-stale-update-test-");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const previousAuth = '{"auth_mode":"chatgpt","tokens":{"refresh_token":"current-refresh"}}';
  const configToml = 'model = "gpt-5.5"\n';
  const currentHash = sharedProfileContentHash(previousAuth, configToml);
  await fs.mkdir(path.join(dataDir, "files", "profile-1"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "files", "profile-1", "auth.json"), previousAuth);
  await fs.writeFile(path.join(dataDir, "files", "profile-1", "config.toml"), configToml);
  await fs.writeFile(path.join(dataDir, "known-users.json"), JSON.stringify([
    {
      dingUserId: "Ding-B",
      name: "Bob",
      active: true,
      firstSeenAt: "2026-06-04T10:00:00.000Z",
      lastSeenAt: "2026-06-04T10:00:00.000Z",
    },
  ]));
  await fs.writeFile(path.join(dataDir, "profiles.json"), JSON.stringify([
    {
      id: "profile-1",
      name: "ChatGPT Pro",
      description: "shared auth",
      createdAt: "2026-06-04T10:00:00.000Z",
      updatedAt: "2026-06-04T10:00:00.000Z",
      files: ["auth.json", "config.toml"],
      contentVersion: 5,
      contentHash: currentHash,
      contentUpdatedAt: "2026-06-04T10:00:00.000Z",
      ownerDingUserId: "Ding-A",
      ownerName: "Alice",
      visibility: "selected",
      sharedWith: ["Ding-B"],
    },
  ]));
  const { token } = await createDesktopToken({
    dingUserId: "Ding-A",
    name: "Alice",
    active: true,
  });

  const response = await updateSharedProfile(
    new NextRequest("http://localhost/codex/api/profiles/profile-1", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: "ChatGPT Pro",
        description: "shared auth",
        visibility: "selected",
        sharedWith: ["Ding-B"],
        baseContentVersion: 4,
        baseContentHash: "stale-hash",
        authContent: '{"auth_mode":"chatgpt","tokens":{"refresh_token":"stale-refresh"}}',
        configContent: configToml,
      }),
    }),
    { params: Promise.resolve({ id: "profile-1" }) },
  );
  const body = await response.json();
  const storedAuth = await fs.readFile(path.join(dataDir, "files", "profile-1", "auth.json"), "utf-8");

  expect(response.status).toBe(409);
  expect(body.error).toContain("共享配置已有更新");
  expect(storedAuth).toBe(previousAuth);
});

test("deletes an owned shared profile and removes its stored files", async () => {
  const dataDir = await useTempDataDir("codex-profiles-delete-test-");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(path.join(dataDir, "files", "profile-delete"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "files", "profile-delete", "auth.json"), "{}");
  await fs.writeFile(path.join(dataDir, "files", "profile-delete", "config.toml"), 'model = "gpt-5.5"');
  await fs.writeFile(path.join(dataDir, "profiles.json"), JSON.stringify([
    {
      id: "profile-delete",
      name: "ChatGPT Pro",
      description: "shared auth",
      createdAt: "2026-06-04T10:00:00.000Z",
      files: ["auth.json", "config.toml"],
      ownerDingUserId: "Ding-A",
      ownerName: "Alice",
      visibility: "public",
      sharedWith: [],
    },
  ]));
  const { token } = await createDesktopToken({
    dingUserId: "Ding-A",
    name: "Alice",
    active: true,
  });

  const response = await deleteSharedProfile(
    new NextRequest("http://localhost/codex/api/profiles/profile-delete", {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${token}`,
      },
    }),
    { params: Promise.resolve({ id: "profile-delete" }) },
  );
  const body = await response.json();
  const storedProfiles = JSON.parse(await fs.readFile(path.join(dataDir, "profiles.json"), "utf-8"));
  const fileFolderExists = await fs.access(path.join(dataDir, "files", "profile-delete"))
    .then(() => true)
    .catch(() => false);

  expect(response.status).toBe(200);
  expect(response.headers.get("Access-Control-Allow-Methods")).toContain("DELETE");
  expect(body).toEqual({ ok: true });
  expect(storedProfiles).toEqual([]);
  expect(fileFolderExists).toBe(false);
});

test("downloads legacy stored config.toml through the share-safe sanitizer", async () => {
  const dataDir = await useTempDataDir("codex-profiles-download-sanitize-test-");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(path.join(dataDir, "files", "legacy-1"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "profiles.json"), JSON.stringify([
    {
      id: "legacy-1",
      name: "Legacy Shared",
      description: "",
      createdAt: "2026-06-04T10:00:00.000Z",
      files: ["auth.json", "config.toml"],
      ownerDingUserId: "Ding-A",
      ownerName: "Alice",
      visibility: "public",
      sharedWith: [],
    },
  ]));
  await fs.writeFile(path.join(dataDir, "files", "legacy-1", "config.toml"), [
    'model = "gpt-5.5"',
    'notify = ["/Users/lucifer/local-app", "turn-ended"]',
    '[projects."/Users/lucifer/work/private"]',
    'trust_level = "trusted"',
  ].join("\n"));
  const { token } = await createDesktopToken({
    dingUserId: "Ding-B",
    name: "Bob",
    active: true,
  });

  const response = await getSharedProfileFile(
    new NextRequest("http://localhost/codex/api/profiles/legacy-1/config.toml", {
      headers: {
        authorization: `Bearer ${token}`,
      },
    }),
    { params: Promise.resolve({ id: "legacy-1", filename: "config.toml" }) },
  );
  const config = await response.text();

  expect(response.status).toBe(200);
  expect(config).toContain('model = "gpt-5.5"');
  expect(config).not.toContain("notify");
  expect(config).not.toContain("[projects");
  expect(config).not.toContain("private");
});
