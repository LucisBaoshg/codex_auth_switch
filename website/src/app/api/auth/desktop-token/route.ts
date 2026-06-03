import { NextRequest, NextResponse } from "next/server";
import { optionsResponse, noStoreHeaders } from "@/lib/api-response";
import { createDesktopToken, verifySessionCookieValue, sessionCookieName } from "@/lib/auth";

export async function OPTIONS() {
  return optionsResponse();
}

export async function POST(request: NextRequest) {
  const principal = verifySessionCookieValue(request.cookies.get(sessionCookieName)?.value);
  if (!principal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders });
  }

  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const token = await createDesktopToken(principal, body.name || "Desktop client");
  return NextResponse.json(token, { status: 201, headers: noStoreHeaders });
}
