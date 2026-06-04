import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");

function readProjectFile(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

test("publishes every desktop platform from the main release workflow", () => {
  const publishRelease = readProjectFile(".github/workflows/publish-release.yml");

  expect(publishRelease).toContain("name: Windows");
  expect(publishRelease).toContain("name: macOS Apple Silicon");
  expect(publishRelease).toContain("name: macOS Intel");
  expect(publishRelease).toContain("--target aarch64-apple-darwin --bundles app,dmg");
  expect(publishRelease).toContain("--target x86_64-apple-darwin --bundles app,dmg");
  expect(publishRelease).toContain("rustup target add ${{ matrix.rust_target }}");
  expect(existsSync(join(root, ".github/workflows/publish-macos-intel.yml"))).toBe(false);
});
