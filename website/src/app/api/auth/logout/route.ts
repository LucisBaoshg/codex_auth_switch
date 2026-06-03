import { NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(sessionCookieName);
  response.cookies.delete("codex_sso_state");
  return response;
}
