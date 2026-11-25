import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { noStoreHeaders, optionsResponse } from "@/lib/api-response";
import { principalFromRequest, verifySessionCookieValue, sessionCookieName } from "@/lib/auth";
import { getDataDir } from "@/lib/data-paths";
import {
  getVisibleProfile,
  hasOfficialOauthTokens,
  profileVisibility,
  ProfileContentConflictError,
  ProfileShareSafetyError,
  updateProfileMetadata,
} from "@/lib/profile-store";
import { sanitizeSharedConfigToml } from "@/lib/shared-profile-config";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> }
) {
  const p = await params;
  const id = p.id;
  const filename = p.filename;
  const principal = await principalFromRequest(request);
  if (!principal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders });
  }

  const profile = await getVisibleProfile(id, principal);
  if (!profile || !profile.files.includes(filename)) {
    return NextResponse.json({ error: "File not found" }, { status: 404, headers: noStoreHeaders });
  }

  const dataDir = getDataDir();
  const filePath = path.join(dataDir, "files", id, filename);

  try {
    const fileBuffer = await fs.readFile(filePath);
    if (
      filename === "auth.json" &&
      profileVisibility(profile) === "public" &&
      hasOfficialOauthTokens(fileBuffer.toString("utf-8"))
    ) {
      return NextResponse.json({ error: "共享授权不可公开读取" }, { status: 403, headers: noStoreHeaders });
    }
    
    // Check if it's JSON to return it as application/json, otherwise text/plain for normal text
    let contentType = "application/octet-stream";
    if (filename.endsWith('.json')) contentType = "application/json";
    else if (filename.endsWith('.txt')) contentType = "text/plain";
    else contentType = "text/plain"; // default to text parsing for Codex config files

    const responseBody = filename === "config.toml"
      ? sanitizeSharedConfigToml(fileBuffer.toString("utf-8"))
      : fileBuffer;

    return new NextResponse(responseBody, {
      headers: {
        "Content-Type": contentType,
        ...noStoreHeaders,
      },
    });
  } catch (error) {
    console.error("File download error:", error);
    return NextResponse.json({ error: "File not found" }, { status: 404, headers: noStoreHeaders });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> },
) {
  const { id, filename } = await params;
  const principal = verifySessionCookieValue(request.cookies.get(sessionCookieName)?.value);
  if (!principal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders });
  }
  if (filename !== "auth.json" && filename !== "config.toml") {
    return NextResponse.json({ error: "File not found" }, { status: 404, headers: noStoreHeaders });
  }

  try {
    const { content, baseContentVersion, baseContentHash } = await request.json();
    if (typeof content !== "string") {
      return NextResponse.json({ error: "Content is required" }, { status: 400, headers: noStoreHeaders });
    }

    const updated = await updateProfileMetadata(id, principal, {
      ...(filename === "auth.json"
        ? { authContent: content }
        : { configContent: sanitizeSharedConfigToml(content) }),
      baseContentVersion: typeof baseContentVersion === "number" ? baseContentVersion : null,
      baseContentHash: typeof baseContentHash === "string" ? baseContentHash : null,
    });
    if (!updated) {
      return NextResponse.json({ error: "File not found" }, { status: 404, headers: noStoreHeaders });
    }
    return NextResponse.json({
      success: true,
      contentVersion: updated.contentVersion,
      contentHash: updated.contentHash,
    }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ProfileContentConflictError) {
      return NextResponse.json({
        error: error.message,
        currentVersion: error.currentVersion,
        currentHash: error.currentHash,
      }, { status: 409, headers: noStoreHeaders });
    }
    if (error instanceof ProfileShareSafetyError) {
      return NextResponse.json({ error: error.message }, { status: 400, headers: noStoreHeaders });
    }
    console.error("File write error:", error);
    return NextResponse.json({ error: "Failed to write file" }, { status: 500, headers: noStoreHeaders });
  }
}
