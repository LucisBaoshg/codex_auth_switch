import { describe, expect, test } from "vitest";
import { NextRequest } from "next/server";
import { createDesktopToken } from "../src/lib/auth";
import { GET as getUsers } from "../src/app/api/users/route";
import {
  listKnownUsersForSharing,
  resolveSharedWithForVisibility,
  upsertKnownUser,
  type KnownShareUser,
} from "../src/lib/user-store";

describe("known SSO users", () => {
  test("records SSO principals as selectable share users without exposing inactive users", () => {
    const now = "2026-06-04T10:00:00.000Z";
    const users = upsertKnownUser([], {
      dingUserId: "Ding-A",
      name: "Alice",
      mobile: "13900000001",
      jobNumber: "A001",
      active: true,
    }, now);

    const withInactive = upsertKnownUser(users, {
      dingUserId: "Ding-B",
      name: "Bob",
      active: false,
    }, now);

    expect(listKnownUsersForSharing(withInactive)).toEqual([
      expect.objectContaining({
        dingUserId: "Ding-A",
        label: "Alice",
        mobile: "13900000001",
      }),
    ]);
  });

  test("adds the authenticated desktop principal to selectable share users", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    process.env.CODEX_PROFILE_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "codex-users-test-"));

    const { token } = await createDesktopToken({
      dingUserId: "Ding-A",
      name: "Alice",
      mobile: "13900000001",
      jobNumber: "A001",
      active: true,
    });

    const response = await getUsers(new NextRequest("http://localhost/codex/api/users", {
      headers: {
        authorization: `Bearer ${token}`,
      },
    }));
    const body = await response.json();

    expect(body.users).toEqual([
      expect.objectContaining({
        dingUserId: "Ding-A",
        label: "Alice",
      }),
    ]);
  });
});

describe("profile share target validation", () => {
  const knownUsers: KnownShareUser[] = [
    {
      dingUserId: "Ding-A",
      name: "Alice",
      mobile: "13900000001",
      active: true,
      firstSeenAt: "2026-06-04T10:00:00.000Z",
      lastSeenAt: "2026-06-04T10:00:00.000Z",
    },
    {
      dingUserId: "Ding-B",
      name: "Bob",
      mobile: "13900000002",
      active: true,
      firstSeenAt: "2026-06-04T10:00:00.000Z",
      lastSeenAt: "2026-06-04T10:00:00.000Z",
    },
  ];

  test("accepts selected users only when they are known SSO users", () => {
    expect(resolveSharedWithForVisibility("selected", ["ding-b"], knownUsers)).toEqual(["Ding-B"]);
  });

  test("rejects manually typed recipients that have never logged in", () => {
    expect(() => resolveSharedWithForVisibility("selected", ["13900000009"], knownUsers)).toThrow(
      /Unknown share target/,
    );
  });

  test("stores public sharing without individual recipients", () => {
    expect(resolveSharedWithForVisibility("public", ["Ding-A"], knownUsers)).toEqual([]);
  });
});
