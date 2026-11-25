import { expect, test, vi } from "vitest";
import {
  sharedProfileHasNewerRemote,
  sharedAuthWriteBackBase,
  shouldWriteBackSharedAuth,
  fetchSharedProfileBundle,
  networkProfileAuthContent,
  sharedProfileAuthPreview,
} from "../src/network-auth-sync";

test("allows shared auth write back when the local remote version matches the cloud version", () => {
  const local = {
    remoteProfileId: "remote-1",
    remoteContentVersion: 3,
    remoteContentHash: "hash-v3",
  };
  const remote = {
    id: "remote-1",
    ownerDingUserId: "Ding-A",
    contentVersion: 3,
    contentHash: "hash-v3",
  };

  expect(shouldWriteBackSharedAuth(local, remote, { dingUserId: "Ding-A" })).toBe(true);
  expect(sharedAuthWriteBackBase(local, remote)).toEqual({
    baseContentVersion: 3,
    baseContentHash: "hash-v3",
  });
});

test("skips shared auth write back when the cloud version is newer than the local base", () => {
  expect(shouldWriteBackSharedAuth(
    {
      remoteProfileId: "remote-1",
      remoteContentVersion: 2,
      remoteContentHash: "hash-v2",
    },
    {
      id: "remote-1",
      ownerDingUserId: "Ding-A",
      contentVersion: 3,
      contentHash: "hash-v3",
    },
    { dingUserId: "Ding-A" },
  )).toBe(false);
});

test("skips shared auth write back when same-version hashes disagree", () => {
  expect(shouldWriteBackSharedAuth(
    {
      remoteProfileId: "remote-1",
      remoteContentVersion: 3,
      remoteContentHash: "local-hash-v3",
    },
    {
      id: "remote-1",
      ownerDingUserId: "Ding-A",
      contentVersion: 3,
      contentHash: "cloud-hash-v3",
    },
    { dingUserId: "Ding-A" },
  )).toBe(false);
});

test("skips shared auth write back for recipients who do not own the cloud profile", () => {
  expect(shouldWriteBackSharedAuth(
    {
      remoteProfileId: "remote-1",
      remoteContentVersion: 3,
      remoteContentHash: "hash-v3",
    },
    {
      id: "remote-1",
      ownerDingUserId: "Ding-A",
      contentVersion: 3,
      contentHash: "hash-v3",
    },
    { dingUserId: "Ding-B" },
  )).toBe(false);
});

test("detects a newer shared center profile by version or hash", () => {
  expect(sharedProfileHasNewerRemote(
    {
      remoteProfileId: "remote-1",
      remoteContentVersion: 1,
      remoteContentHash: "hash-v1",
    },
    {
      id: "remote-1",
      contentVersion: 2,
      contentHash: "hash-v2",
    },
  )).toBe(true);

  expect(sharedProfileHasNewerRemote(
    {
      remoteProfileId: "remote-1",
      remoteContentVersion: null,
      remoteContentHash: null,
    },
    {
      id: "remote-1",
      contentVersion: 2,
      contentHash: "hash-v2",
    },
  )).toBe(true);

  expect(sharedProfileHasNewerRemote(
    {
      remoteProfileId: "remote-1",
      remoteContentVersion: 3,
      remoteContentHash: "hash-v3",
    },
    {
      id: "remote-1",
      contentVersion: 3,
      contentHash: "hash-v3",
    },
  )).toBe(false);
});

test("rejects a failed file download and a mixed legacy revision", async () => {
  const detail = { id: "fixture", contentVersion: 1, files: ["auth.json", "config.toml"] };
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  try {
    fetcher
      .mockResolvedValueOnce(new Response(JSON.stringify(detail)))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response('model = "fixture"'));
    const read = () => fetchSharedProfileBundle("https://example.invalid/profiles", "fixture", {},
      (action) => new Error(action));
    await expect(read()).rejects.toThrow("HTTP 503");

    fetcher
      .mockResolvedValueOnce(new Response(JSON.stringify(detail)))
      .mockResolvedValueOnce(new Response('{"OPENAI_API_KEY":"fixture"}'))
      .mockResolvedValueOnce(new Response('model = "fixture"'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...detail, contentVersion: 2 })));
    await expect(read()).rejects.toThrow("下载期间共享配置发生变化");
  } finally {
    vi.unstubAllGlobals();
  }
});

const sharedOauthAuth = '{"auth_mode":"chatgpt","tokens":{"access_token":"access-fixture","id_token":"id-fixture","refresh_token":"refresh-fixture"}}';

test("publishes complete OAuth authorization and refuses a local login descriptor", () => {
  expect(networkProfileAuthContent(sharedOauthAuth)).toBe(sharedOauthAuth);
  expect(() => networkProfileAuthContent('{"auth_mode":"chatgpt"}')).toThrow("缺少可共享的官方授权");
  expect(networkProfileAuthContent('{"OPENAI_API_KEY":"fixture"}')).toBe('{"OPENAI_API_KEY":"fixture"}');
  expect(() => networkProfileAuthContent("[]")).toThrow("JSON 对象");
});

test("passes authorized OAuth credentials through the bundle without displaying token values", async () => {
  const fixture = { id: "fixture", contentVersion: 1, authContent: sharedOauthAuth, configContent: 'model = "fixture"' };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture))));
  try {
    const downloaded = await fetchSharedProfileBundle("https://example.invalid/profiles", "fixture", {},
      (action) => new Error(action));
    expect(downloaded.authJson).toBe(sharedOauthAuth);
    expect(sharedProfileAuthPreview(downloaded.authJson)).toContain("应用时使用");
    expect(sharedProfileAuthPreview(downloaded.authJson)).not.toContain("refresh-fixture");
  } finally {
    vi.unstubAllGlobals();
  }
});
