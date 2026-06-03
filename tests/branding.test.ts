import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const displayName = "Codex 助手";
const previousDisplayName = "Codex Auth Switch";

function readProjectFile(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

test("uses Codex assistant as the public app display name", () => {
  const tauriConfig = JSON.parse(readProjectFile("src-tauri/tauri.conf.json")) as {
    productName: string;
    app: { windows: Array<{ title: string }> };
  };

  expect(tauriConfig.productName).toBe(displayName);
  expect(tauriConfig.app.windows[0]?.title).toBe(displayName);

  const publicFiles = [
    "index.html",
    "README.md",
    "website/src/app/layout.tsx",
    "website/src/app/page.tsx",
    "src-tauri/src/core/mod.rs",
    "src-tauri/src/lib.rs",
  ];

  for (const file of publicFiles) {
    const content = readProjectFile(file);
    expect(content, file).toContain(displayName);
    expect(content, file).not.toContain(previousDisplayName);
  }
});
