import { NextRequest, NextResponse } from "next/server";
import { noStoreHeaders } from "@/lib/api-response";
import {
  completeDesktopLoginSession,
  getDesktopLoginConfirmation,
  principalFromRequest,
} from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await principalFromRequest(request);
  if (!principal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders });
  }

  const { id } = await params;
  const confirmation = await getDesktopLoginConfirmation(id);
  if (!confirmation) {
    return NextResponse.json({ error: "Desktop login session not found or expired" }, { status: 404, headers: noStoreHeaders });
  }
  return NextResponse.json(confirmation, { headers: noStoreHeaders });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await principalFromRequest(request);
  if (!principal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders });
  }

  const { id } = await params;
  const completed = await completeDesktopLoginSession(id, principal);
  if (!completed) {
    return NextResponse.json({ error: "Desktop login session not found or expired" }, { status: 404, headers: noStoreHeaders });
  }
  return NextResponse.json({ status: "complete" }, { headers: noStoreHeaders });
}
