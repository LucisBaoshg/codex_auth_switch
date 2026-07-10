import { NextRequest, NextResponse } from "next/server";
import { noStoreHeaders, optionsResponse } from "@/lib/api-response";
import { principalFromRequest } from "@/lib/auth";
import {
  ProfileContentConflictError,
  ProfileShareSafetyError,
  deleteProfile,
  getVisibleProfile,
  normalizeProfileVisibility,
  publicProfileWithAuthType,
  syncProfileAuthContent,
  updateProfileMetadata,
} from "@/lib/profile-store";
import { sanitizeSharedConfigToml } from "@/lib/shared-profile-config";
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

    return NextResponse.json(await publicProfileWithAuthType(profile), { headers: noStoreHeaders });
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
    const body = await request.json();
    const {
      name,
      description,
      visibility: rawVisibility,
      sharedWith,
      sourceProfileId,
      authContent,
      configContent,
      baseContentVersion,
      baseContentHash,
    } = body;

    const isAuthWriteBack =
      authContent !== undefined &&
      configContent === undefined &&
      name === undefined &&
      description === undefined &&
      rawVisibility === undefined &&
      sharedWith === undefined &&
      sourceProfileId === undefined;

    if (isAuthWriteBack) {
      try {
        const synced = await syncProfileAuthContent(id, principal, {
          authContent: String(authContent),
          baseContentVersion: typeof baseContentVersion === "number" ? baseContentVersion : null,
          baseContentHash: typeof baseContentHash === "string" ? baseContentHash : null,
        });

        if (!synced) {
          return NextResponse.json({ error: "Profile not found" }, { status: 404, headers: noStoreHeaders });
        }

        return NextResponse.json(await publicProfileWithAuthType(synced), { headers: noStoreHeaders });
      } catch (error) {
        if (error instanceof ProfileContentConflictError) {
          return NextResponse.json(
            {
              error: error.message,
              currentVersion: error.currentVersion,
              currentHash: error.currentHash,
            },
            { status: 409, headers: noStoreHeaders },
          );
        }
        throw error;
      }
    }

    const hasShareScopeUpdate = rawVisibility !== undefined || sharedWith !== undefined;
    let visibility: ReturnType<typeof normalizeProfileVisibility> | undefined;
    let resolvedSharedWith: string[] | undefined;
    if (hasShareScopeUpdate) {
      visibility = normalizeProfileVisibility(rawVisibility, sharedWith);
      try {
        resolvedSharedWith = resolveSharedWithForVisibility(visibility, sharedWith, await readKnownUsers());
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Invalid share targets" },
          { status: 400, headers: noStoreHeaders },
        );
      }
    }
    const updated = await updateProfileMetadata(id, principal, {
      name,
      description,
      visibility,
      sharedWith: resolvedSharedWith,
      sourceProfileId,
      authContent: authContent === undefined ? undefined : String(authContent),
      configContent: configContent === undefined ? undefined : sanitizeSharedConfigToml(String(configContent)),
      baseContentVersion: typeof baseContentVersion === "number" ? baseContentVersion : null,
      baseContentHash: typeof baseContentHash === "string" ? baseContentHash : null,
    });

    if (!updated) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404, headers: noStoreHeaders });
    }

    return NextResponse.json(await publicProfileWithAuthType(updated), { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ProfileContentConflictError) {
      return NextResponse.json(
        {
          error: error.message,
          currentVersion: error.currentVersion,
          currentHash: error.currentHash,
        },
        { status: 409, headers: noStoreHeaders },
      );
    }
    if (error instanceof ProfileShareSafetyError) {
      return NextResponse.json({ error: error.message }, { status: 400, headers: noStoreHeaders });
    }
    console.error("Error updating profile:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: noStoreHeaders });
  }
}
