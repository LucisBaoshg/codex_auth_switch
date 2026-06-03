import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { noStoreHeaders, optionsResponse } from "@/lib/api-response";
import { principalFromRequest, verifySessionCookieValue, sessionCookieName } from "@/lib/auth";
import { getDataDir } from "@/lib/data-paths";
import { getVisibleProfile } from "@/lib/profile-store";

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
    
    // Check if it's JSON to return it as application/json, otherwise text/plain for normal text
    let contentType = "application/octet-stream";
    if (filename.endsWith('.json')) contentType = "application/json";
    else if (filename.endsWith('.txt')) contentType = "text/plain";
    else contentType = "text/plain"; // default to text parsing for Codex config files

    return new NextResponse(fileBuffer, {
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
  { params }: { params: Promise<{ id: string; filename: string }> }
) {
  const p = await params;
  const id = p.id;
  const filename = p.filename;
  const principal = verifySessionCookieValue(request.cookies.get(sessionCookieName)?.value);
  if (!principal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders });
  }

  const profile = await getVisibleProfile(id, principal);
  if (!profile || !profile.files.includes(filename) || profile.ownerDingUserId !== principal.dingUserId) {
    return NextResponse.json({ error: "File not found" }, { status: 404, headers: noStoreHeaders });
  }

  const dataDir = getDataDir();
  const filePath = path.join(dataDir, "files", id, filename);

  try {
    const { content } = await request.json();
    
    if (content === undefined) {
      return NextResponse.json({ error: "Content is required" }, { status: 400, headers: noStoreHeaders });
    }

    await fs.writeFile(filePath, content, "utf-8");

    return NextResponse.json({ success: true }, { headers: noStoreHeaders });
  } catch (error) {
    console.error("File write error:", error);
    return NextResponse.json({ error: "Failed to write file" }, { status: 500, headers: noStoreHeaders });
  }
}
