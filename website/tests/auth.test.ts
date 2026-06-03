import { describe, expect, test } from "vitest";
import {
  completeDesktopLoginSession,
  consumeDesktopLoginToken,
  createDesktopLoginSession,
  normalizeSsoRedirectUri,
  secureCookiesForRedirectUri,
} from "../src/lib/auth";

describe("auth cookie security", () => {
  test("does not require Secure cookies for HTTP SSO callback deployments", () => {
    expect(secureCookiesForRedirectUri("http://localhost:3000/codex/api/auth/callback", "production")).toBe(
      false,
    );
  });

  test("requires Secure cookies for HTTPS SSO callback deployments", () => {
    expect(
      secureCookiesForRedirectUri("https://codex-helper.ite.tool4seller.com/codex/api/auth/callback", "production"),
    ).toBe(true);
  });
});

describe("SSO redirect URI normalization", () => {
  test("migrates the old Tapcash callback URL to the Tool4seller host", () => {
    expect(normalizeSsoRedirectUri("http://sub2api.ite.tapcash.com/codex/api/auth/callback")).toBe(
      "https://codex-helper.ite.tool4seller.com/codex/api/auth/callback",
    );
  });
});

describe("desktop login sessions", () => {
  test("exchanges a completed desktop login session for one desktop token", async () => {
    const dataDir = await import("node:fs/promises").then(async (fs) => {
      const os = await import("node:os");
      const path = await import("node:path");
      return fs.mkdtemp(path.join(os.tmpdir(), "codex-auth-test-"));
    });
    process.env.CODEX_PROFILE_DATA_DIR = dataDir;

    const session = await createDesktopLoginSession();
    await completeDesktopLoginSession(session.id, {
      dingUserId: "Ding-A",
      unionId: "Union-A",
      openId: "Open-A",
      name: "Alice",
      mobile: "13900000001",
      jobNumber: "A001",
    });

    const completed = await consumeDesktopLoginToken(session.id, session.pollToken);
    expect(completed?.token).toMatch(/^cas_/);
    expect(completed?.principal.name).toBe("Alice");
    await expect(consumeDesktopLoginToken(session.id, session.pollToken)).resolves.toBeNull();
  });
});
