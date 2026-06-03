import { NextRequest, NextResponse } from "next/server";
import { noStoreHeaders, optionsResponse } from "@/lib/api-response";
import { consumeDesktopLoginToken } from "@/lib/auth";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pollToken = request.nextUrl.searchParams.get("pollToken") || "";
  const result = await consumeDesktopLoginToken(id, pollToken);
  if (!result) {
    return NextResponse.json({ status: "pending" }, { status: 202, headers: noStoreHeaders });
  }

  return NextResponse.json({ status: "complete", ...result }, { headers: noStoreHeaders });
}
