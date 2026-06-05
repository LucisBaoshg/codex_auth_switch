import { NextRequest, NextResponse } from "next/server";
import { noStoreHeaders, optionsResponse } from "@/lib/api-response";
import { principalFromRequest } from "@/lib/auth";
import { deleteProfile, getVisibleProfile, normalizeProfileVisibility, publicProfile, updateProfileMetadata } from "@/lib/profile-store";
import { readKnownUsers, resolveSharedWithForVisibility } from "@/lib/user-store";

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

export async function DELETE(
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
    const deleted = await deleteProfile(id, principal);
    if (!deleted) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404, headers: noStoreHeaders });
    }

    return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
  } catch (error) {
    console.error("Error deleting profile:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: noStoreHeaders });
  }
}

export async function POST(
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
    const { name, description, visibility: rawVisibility, sharedWith } = await request.json();
    const visibility = normalizeProfileVisibility(rawVisibility, sharedWith);
    let resolvedSharedWith: string[];
    try {
      resolvedSharedWith = resolveSharedWithForVisibility(visibility, sharedWith, await readKnownUsers());
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid share targets" },
        { status: 400, headers: noStoreHeaders },
      );
    }
    const updated = await updateProfileMetadata(id, principal, {
      name,
      description,
      visibility,
      sharedWith: resolvedSharedWith,
    });

    if (!updated) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404, headers: noStoreHeaders });
    }

    return NextResponse.json(publicProfile(updated), { headers: noStoreHeaders });
  } catch (error) {
    console.error("Error updating profile:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: noStoreHeaders });
  }
}
