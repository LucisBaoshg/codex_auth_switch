import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const p = await params;
  const id = p.id;
  const dataDir = path.join(process.cwd(), "data");
  const profilesFile = path.join(dataDir, "profiles.json");

  try {
    const data = await fs.readFile(profilesFile, "utf-8");
    const profiles = JSON.parse(data);
    const profile = profiles.find((p: any) => p.id === id);

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    return NextResponse.json(profile);
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
