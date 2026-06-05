import { expect, test } from "vitest";
import { NextRequest } from "next/server";
import { createDesktopToken } from "../src/lib/auth";
import { POST as createSharedProfile } from "../src/app/api/profiles/route";
import { DELETE as deleteSharedProfile, POST as updateSharedProfile } from "../src/app/api/profiles/[id]/route";
import { GET as getSharedProfileFile } from "../src/app/api/profiles/[id]/[filename]/route";

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
  }));
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
  formData.append("visibility", "public");
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
  expect(storedProfiles[0].sharedWith).toEqual(["Ding-B"]);
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
