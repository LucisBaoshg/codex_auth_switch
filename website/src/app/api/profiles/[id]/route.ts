import { NextRequest, NextResponse } from "next/server";
import { noStoreHeaders, optionsResponse } from "@/lib/api-response";
import { principalFromRequest, verifySessionCookieValue, sessionCookieName } from "@/lib/auth";
import { getVisibleProfile, publicProfile, updateProfileMetadata } from "@/lib/profile-store";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const p = await params;
  const id = p.id;
  const principal = await principalFromRequest(request);
  if (!principal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders });
  }

  try {
    const profile = await getVisibleProfile(id, principal);

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404, headers: noStoreHeaders });
    }

    return NextResponse.json(publicProfile(profile), { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: noStoreHeaders });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const p = await params;
  const id = p.id;
  const principal = verifySessionCookieValue(request.cookies.get(sessionCookieName)?.value);
  if (!principal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders });
  }

  try {
    const { name, description, sharedWith } = await request.json();
    const updated = await updateProfileMetadata(id, principal, { name, description, sharedWith });

    if (!updated) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404, headers: noStoreHeaders });
    }

    return NextResponse.json(publicProfile(updated), { headers: noStoreHeaders });
  } catch (error) {
    console.error("Error updating profile:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: noStoreHeaders });
  }
}
