import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> }
) {
  const p = await params;
  const id = p.id;
  const filename = p.filename;

  const dataDir = path.join(process.cwd(), "data");
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
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("File download error:", error);
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
