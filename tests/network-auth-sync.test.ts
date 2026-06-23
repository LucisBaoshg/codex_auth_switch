import { expect, test } from "vitest";
import {
  sharedAuthWriteBackBase,
  shouldWriteBackSharedAuth,
} from "../src/network-auth-sync";

test("allows shared auth write back when the local remote version matches the cloud version", () => {
  const local = {
    remoteProfileId: "remote-1",
    remoteContentVersion: 3,
    remoteContentHash: "hash-v3",
  };
  const remote = {
    id: "remote-1",
    contentVersion: 3,
    contentHash: "hash-v3",
  };

  expect(shouldWriteBackSharedAuth(local, remote)).toBe(true);
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
      contentVersion: 3,
      contentHash: "hash-v3",
    },
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
      contentVersion: 3,
      contentHash: "cloud-hash-v3",
    },
  )).toBe(false);
});
