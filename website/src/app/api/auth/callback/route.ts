import { NextRequest, NextResponse } from "next/server";
import {
  completeDesktopLoginSession,
  createSessionCookieValue,
  requireSsoEnv,
  secureCookiesForRedirectUri,
  sessionCookieName,
} from "@/lib/auth";
import { withBasePath } from "@/lib/base-path";
import type { ProfilePrincipal } from "@/lib/profile-store";

function decodeReturnTo(state: string) {
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf-8")) as {
      returnTo?: string;
    };
    return parsed.returnTo && parsed.returnTo.startsWith("/") ? parsed.returnTo : "/profiles";
  } catch {
    return "/profiles";
  }
}

function decodeDesktopLoginId(state: string) {
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf-8")) as {
      desktopLoginId?: string;
    };
    return parsed.desktopLoginId || null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state") || "";
  const expectedState = request.cookies.get("codex_sso_state")?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.json({ error: "Invalid SSO callback state" }, { status: 400 });
  }

  const { clientId, clientSecret, baseUrl, redirectUri } = requireSsoEnv();
  const tokenUrl = new URL("/sso/token", baseUrl);
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
  });

  const tokenResponse = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!tokenResponse.ok) {
    return NextResponse.json({ error: "SSO token exchange failed" }, { status: 401 });
  }

  const principal = (await tokenResponse.json()) as ProfilePrincipal;
  if (!principal.active || !principal.dingUserId) {
    return NextResponse.json({ error: "SSO user is not allowed" }, { status: 403 });
  }

  await completeDesktopLoginSession(decodeDesktopLoginId(state), principal);

  const response = NextResponse.redirect(new URL(withBasePath(decodeReturnTo(state)), redirectUri));
  response.cookies.set(sessionCookieName, createSessionCookieValue(principal), {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookiesForRedirectUri(redirectUri),
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  response.cookies.delete("codex_sso_state");
  return response;
}
