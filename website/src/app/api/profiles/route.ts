import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const dataDir = path.join(process.cwd(), "data");
const profilesFile = path.join(dataDir, "profiles.json");
const filesDir = path.join(dataDir, "files");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const noStoreHeaders = {
  ...corsHeaders,
  "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: noStoreHeaders });
}

// 确保目录和文件存在
async function ensureDataFiles() {
  try {
    await fs.mkdir(filesDir, { recursive: true });
    try {
      await fs.access(profilesFile);
    } catch {
      await fs.writeFile(profilesFile, JSON.stringify([]));
    }
  } catch (error) {
    console.error("Data dir init error:", error);
  }
}

export async function GET() {
  await ensureDataFiles();
  const data = await fs.readFile(profilesFile, "utf-8");
  return NextResponse.json(JSON.parse(data), { headers: noStoreHeaders });
}

export async function POST(req: NextRequest) {
  await ensureDataFiles();
  try {
    const formData = await req.formData();
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const file1 = formData.get("file1") as File | null;
    const file2 = formData.get("file2") as File | null;

    if (!name || !file1 || !file2) {
      return NextResponse.json({ error: "Missing required fields or files" }, { status: 400, headers: noStoreHeaders });
    }

    const id = Date.now().toString();
    const profileFolder = path.join(filesDir, id);
    await fs.mkdir(profileFolder, { recursive: true });

    // 保存文件
    const buffer1 = Buffer.from(await file1.arrayBuffer());
    await fs.writeFile(path.join(profileFolder, file1.name), buffer1);

    const buffer2 = Buffer.from(await file2.arrayBuffer());
    await fs.writeFile(path.join(profileFolder, file2.name), buffer2);

    const newProfile = {
      id,
      name,
      description: description || "",
      createdAt: new Date().toISOString(),
      files: [file1.name, file2.name]
    };

    const existingProfiles = JSON.parse(await fs.readFile(profilesFile, "utf-8"));
    existingProfiles.unshift(newProfile);
    
    await fs.writeFile(profilesFile, JSON.stringify(existingProfiles, null, 2));

    return NextResponse.json(newProfile, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    console.error("Upload Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: noStoreHeaders });
  }
}
