import { NextRequest, NextResponse } from "next/server";
import { getDesktopLoginConfirmation, requireSsoEnv, secureCookiesForRedirectUri } from "@/lib/auth";

const desktopLoginIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const { clientId, baseUrl, redirectUri } = requireSsoEnv();
  let returnTo = request.nextUrl.searchParams.get("returnTo") || "/profiles";
  const legacyDesktopLoginId = request.nextUrl.searchParams.get("desktopLoginId");
  if (legacyDesktopLoginId) {
    if (!desktopLoginIdPattern.test(legacyDesktopLoginId)) {
      return NextResponse.json({ error: "Invalid desktop login session" }, { status: 400 });
    }
    const confirmation = await getDesktopLoginConfirmation(legacyDesktopLoginId);
    if (!confirmation) {
      return NextResponse.json(
        { error: "Desktop login session not found or expired" },
        { status: 404 },
      );
    }
    returnTo = `/desktop-login/${legacyDesktopLoginId}?legacy=1`;
  }
  const state = Buffer.from(
    JSON.stringify({
      nonce: crypto.randomUUID(),
      returnTo,
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
