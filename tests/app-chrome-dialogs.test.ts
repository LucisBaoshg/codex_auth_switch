import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const dialogsImportPath = `../src/${"app-chrome-dialogs"}`;

afterEach(() => {
  document.body.innerHTML = "";
});

test("native confirm resolves false and removes overlay when cancelled", async () => {
  expect(existsSync(join(root, "src/app-chrome-dialogs.ts"))).toBe(true);
  const { nativeConfirm } = await import(dialogsImportPath);

  const resultPromise = nativeConfirm("Delete <profile>?", "Destroy", true);

  const cancelButton = document.querySelector<HTMLButtonElement>("#btn-cancel");
  expect(cancelButton).not.toBeNull();
  expect(document.body.textContent).toContain("Delete <profile>?");

  cancelButton?.click();

  await expect(resultPromise).resolves.toBe(false);
  expect(document.querySelector("#btn-cancel")).toBeNull();
});

test("native confirm resolves true and removes overlay when confirmed", async () => {
  expect(existsSync(join(root, "src/app-chrome-dialogs.ts"))).toBe(true);
  const { nativeConfirm } = await import(dialogsImportPath);

  const resultPromise = nativeConfirm("Apply network profile?", "Apply", false);

  const okButton = document.querySelector<HTMLButtonElement>("#btn-ok");
  expect(okButton).not.toBeNull();
  expect(okButton?.textContent).toBe("Apply");

  okButton?.click();

  await expect(resultPromise).resolves.toBe(true);
  expect(document.querySelector("#btn-ok")).toBeNull();
});
