import { NextResponse } from "next/server";
import { noStoreHeaders, optionsResponse } from "@/lib/api-response";
import { createDesktopLoginSession } from "@/lib/auth";

export async function OPTIONS() {
  return optionsResponse();
}

export async function POST() {
  const session = await createDesktopLoginSession();
  return NextResponse.json(session, { status: 201, headers: noStoreHeaders });
}
