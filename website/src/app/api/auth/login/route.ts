import { NextRequest, NextResponse } from "next/server";
import { requireSsoEnv, secureCookiesForRedirectUri } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const { clientId, baseUrl, redirectUri } = requireSsoEnv();
  const returnTo = request.nextUrl.searchParams.get("returnTo") || "/profiles";
  const desktopLoginId = request.nextUrl.searchParams.get("desktopLoginId") || undefined;
  const state = Buffer.from(
    JSON.stringify({
      nonce: crypto.randomUUID(),
      returnTo,
      desktopLoginId,
    }),
  ).toString("base64url");

  const loginUrl = new URL("/sso/login", baseUrl);
  loginUrl.searchParams.set("client_id", clientId);
  loginUrl.searchParams.set("redirect_uri", redirectUri);
  loginUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(loginUrl);
  response.cookies.set("codex_sso_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookiesForRedirectUri(redirectUri),
    path: "/",
    maxAge: 600,
  });
  return response;
}
