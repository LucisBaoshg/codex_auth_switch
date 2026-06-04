import { expect, test } from "vitest";
import { NextRequest } from "next/server";
import { createDesktopToken } from "../src/lib/auth";
import { POST as createSharedProfile } from "../src/app/api/profiles/route";
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
