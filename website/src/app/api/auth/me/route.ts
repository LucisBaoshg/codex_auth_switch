import { NextRequest, NextResponse } from "next/server";
import { optionsResponse, noStoreHeaders } from "@/lib/api-response";
import { principalFromRequest } from "@/lib/auth";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(request: NextRequest) {
  const principal = await principalFromRequest(request);
  return NextResponse.json({ user: principal }, { headers: noStoreHeaders });
}
