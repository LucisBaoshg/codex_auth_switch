import { describe, expect, test } from "vitest";
import {
  consumeDesktopLoginToken,
  createSessionCookieValue,
  createDesktopLoginSession,
  getDesktopLoginConfirmation,
  normalizeSsoRedirectUri,
  secureCookiesForRedirectUri,
} from "../src/lib/auth";
import { POST as confirmDesktopLogin } from "../src/app/api/auth/desktop-login/[id]/confirm/route";
import { GET as startSsoLogin } from "../src/app/api/auth/login/route";
import { decodeReturnTo } from "../src/app/api/auth/callback/route";
import { NextRequest } from "next/server";

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
  test("requires an authenticated browser confirmation before issuing one desktop token", async () => {
    const dataDir = await import("node:fs/promises").then(async (fs) => {
      const os = await import("node:os");
      const path = await import("node:path");
      return fs.mkdtemp(path.join(os.tmpdir(), "codex-auth-test-"));
    });
    process.env.CODEX_PROFILE_DATA_DIR = dataDir;

    const session = await createDesktopLoginSession();
    expect(session.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await expect(consumeDesktopLoginToken(session.id, session.pollToken)).resolves.toBeNull();
    await expect(getDesktopLoginConfirmation(session.id)).resolves.toEqual(expect.objectContaining({
      userCode: session.userCode,
      completed: false,
    }));

    const principal = {
      dingUserId: "Ding-A",
      unionId: "Union-A",
      openId: "Open-A",
      name: "Alice",
      mobile: "13900000001",
      jobNumber: "A001",
    };
    const unauthenticated = await confirmDesktopLogin(
      new NextRequest(`http://localhost/api/auth/desktop-login/${session.id}/confirm`, { method: "POST" }),
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(unauthenticated.status).toBe(401);

    const authenticated = await confirmDesktopLogin(
      new NextRequest(`http://localhost/api/auth/desktop-login/${session.id}/confirm`, {
        method: "POST",
        headers: { cookie: `codex_share_session=${createSessionCookieValue(principal)}` },
      }),
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(authenticated.status).toBe(200);

    const completed = await consumeDesktopLoginToken(session.id, session.pollToken);
    expect(completed?.token).toMatch(/^cas_/);
    expect(completed?.principal.name).toBe("Alice");
    await expect(consumeDesktopLoginToken(session.id, session.pollToken)).resolves.toBeNull();
  });

  test("routes legacy desktop clients through the explicit confirmation page", async () => {
    const dataDir = await import("node:fs/promises").then(async (fs) => {
      const os = await import("node:os");
      const path = await import("node:path");
      return fs.mkdtemp(path.join(os.tmpdir(), "codex-auth-legacy-test-"));
    });
    process.env.CODEX_PROFILE_DATA_DIR = dataDir;
    process.env.SSO_CLIENT_ID = "client-test";
    process.env.SSO_CLIENT_SECRET = "secret-test";
    process.env.SSO_BASE_URL = "https://sso.example.com";
    process.env.SSO_REDIRECT_URI = "https://share.example.com/codex/api/auth/callback";

    const session = await createDesktopLoginSession();
    const response = await startSsoLogin(
      new NextRequest(
        `https://share.example.com/codex/api/auth/login?returnTo=%2Fprofiles&desktopLoginId=${session.id}`,
      ),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).not.toBeNull();
    const state = new URL(location!).searchParams.get("state");
    expect(state).not.toBeNull();
    expect(decodeReturnTo(state!)).toBe(`/desktop-login/${session.id}?legacy=1`);
    await expect(consumeDesktopLoginToken(session.id, session.pollToken)).resolves.toBeNull();
  });

  test("rejects an unknown legacy desktop login session", async () => {
    process.env.SSO_CLIENT_ID = "client-test";
    process.env.SSO_CLIENT_SECRET = "secret-test";
    process.env.SSO_BASE_URL = "https://sso.example.com";
    process.env.SSO_REDIRECT_URI = "https://share.example.com/codex/api/auth/callback";

    const response = await startSsoLogin(
      new NextRequest(
        "https://share.example.com/codex/api/auth/login?desktopLoginId=00000000-0000-4000-8000-000000000000",
      ),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Desktop login session not found or expired" });
  });
});

describe("SSO return target validation", () => {
  test("rejects protocol-relative and backslash redirect targets", () => {
    const encodeState = (returnTo: string) => Buffer.from(JSON.stringify({ returnTo })).toString("base64url");
    expect(decodeReturnTo(encodeState("/profiles"))).toBe("/profiles");
    expect(decodeReturnTo(encodeState("//evil.example"))).toBe("/profiles");
    expect(decodeReturnTo(encodeState("/\\evil.example"))).toBe("/profiles");
  });
});
