import { NextRequest, NextResponse } from "next/server";
import { noStoreHeaders, optionsResponse } from "@/lib/api-response";
import { principalFromRequest } from "@/lib/auth";
import { listKnownUsersForSharing, readKnownUsers, recordKnownUser } from "@/lib/user-store";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(request: NextRequest) {
  const principal = await principalFromRequest(request);
  if (!principal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders });
  }

  await recordKnownUser(principal);

  const users = listKnownUsersForSharing(await readKnownUsers()).map((user) => ({
    dingUserId: user.dingUserId,
    name: user.name ?? null,
    mobile: user.mobile ?? null,
    jobNumber: user.jobNumber ?? null,
    label: user.label,
  }));

  return NextResponse.json({ users }, { headers: noStoreHeaders });
}
