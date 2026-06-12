import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");

function readProjectFile(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function cargoVersion(path: string): string {
  const content = readProjectFile(path);
  const match = content.match(/^version = "([^"]+)"/m);
  expect(match, `${path} package version`).not.toBeNull();
  return match?.[1] ?? "";
}

function cargoLockPackageVersion(path: string, packageName: string): string {
  const content = readProjectFile(path);
  const packagePattern = new RegExp(
    String.raw`\[\[package\]\]\r?\nname = "${packageName}"\r?\nversion = "([^"]+)"`,
    "m",
  );
  const match = content.match(packagePattern);
  expect(match, `${path} ${packageName} lock version`).not.toBeNull();
  return match?.[1] ?? "";
}

test("keeps all release version metadata synchronized", () => {
  const packageJson = JSON.parse(readProjectFile("package.json")) as { version: string };
  const packageLock = JSON.parse(readProjectFile("package-lock.json")) as {
    version: string;
    packages: Record<string, { version?: string }>;
  };

  const expectedVersion = packageJson.version;

  expect({
    packageJson: packageJson.version,
    packageLock: packageLock.version,
    packageLockRootPackage: packageLock.packages[""]?.version,
    tauriCargoToml: cargoVersion("src-tauri/Cargo.toml"),
    tauriCargoLock: cargoLockPackageVersion("src-tauri/Cargo.lock", "codex-auth-switch"),
    cliCargoToml: cargoVersion("cli/Cargo.toml"),
    cliCargoLock: cargoLockPackageVersion("cli/Cargo.lock", "codex-auth-switch-cli"),
  }).toEqual({
    packageJson: expectedVersion,
    packageLock: expectedVersion,
    packageLockRootPackage: expectedVersion,
    tauriCargoToml: expectedVersion,
    tauriCargoLock: expectedVersion,
    cliCargoToml: expectedVersion,
    cliCargoLock: expectedVersion,
  });
});
