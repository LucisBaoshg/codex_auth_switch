import { NextRequest, NextResponse } from "next/server";
import { noStoreHeaders, optionsResponse } from "@/lib/api-response";
import { principalFromRequest } from "@/lib/auth";
import {
  createProfile,
  filterProfilesForPrincipal,
  normalizeProfileVisibility,
  publicProfile,
  readProfiles,
} from "@/lib/profile-store";
import { sanitizeSharedConfigToml } from "@/lib/shared-profile-config";
import { readKnownUsers, resolveSharedWithForVisibility } from "@/lib/user-store";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  const principal = await principalFromRequest(req);
  if (!principal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders });
  }

  const profiles = filterProfilesForPrincipal(await readProfiles(), principal).map(publicProfile);
  return NextResponse.json(profiles, { headers: noStoreHeaders });
}

export async function POST(req: NextRequest) {
  const principal = await principalFromRequest(req);
  if (!principal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders });
  }

  try {
    const formData = await req.formData();
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const visibility = normalizeProfileVisibility(formData.get("visibility") as string | null, formData.get("sharedWith") as string | null);
    const sharedWith = formData.get("sharedWith") as string;
    const file1 = formData.get("file1") as File | null;
    const file2 = formData.get("file2") as File | null;

    if (!name || !file1 || !file2) {
      return NextResponse.json({ error: "Missing required fields or files" }, { status: 400, headers: noStoreHeaders });
    }

    let resolvedSharedWith: string[];
    try {
      resolvedSharedWith = resolveSharedWithForVisibility(visibility, sharedWith, await readKnownUsers());
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid share targets" },
        { status: 400, headers: noStoreHeaders },
      );
    }

    const newProfile = await createProfile({
      name,
      description,
      visibility,
      sharedWith: resolvedSharedWith,
      authContent: await file1.text(),
      configContent: sanitizeSharedConfigToml(await file2.text()),
    }, principal);

    return NextResponse.json(publicProfile(newProfile), { status: 201, headers: noStoreHeaders });
  } catch (error) {
    console.error("Upload Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: noStoreHeaders });
  }
}
