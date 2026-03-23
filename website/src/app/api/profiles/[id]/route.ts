import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders });
}

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
      return NextResponse.json({ error: "Profile not found" }, { status: 404, headers: corsHeaders });
    }

    return NextResponse.json(profile, { headers: corsHeaders });
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: corsHeaders });
  }
}

export async function POST(
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
    const profileIndex = profiles.findIndex((p: any) => p.id === id);

    if (profileIndex === -1) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const { name, description } = await request.json();
    
    if (name !== undefined && name.trim() !== '') {
      profiles[profileIndex].name = name;
    }
    if (description !== undefined) {
      profiles[profileIndex].description = description;
    }

    await fs.writeFile(profilesFile, JSON.stringify(profiles, null, 2));

    return NextResponse.json(profiles[profileIndex]);
  } catch (error) {
    console.error("Error updating profile:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
