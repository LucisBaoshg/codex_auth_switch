import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const scrollImportPath = `../src/${"scroll-restoration"}`;

test("maps sharing view to the rendered page key", async () => {
  expect(existsSync(join(root, "src/scroll-restoration.ts"))).toBe(true);
  const { renderedPageKeyForView } = await import(scrollImportPath);

  expect(renderedPageKeyForView("sharing")).toBe("sharing-center");
  expect(renderedPageKeyForView("cards")).toBe("cards");
});

test("reads the current rendered page key from app content", async () => {
  expect(existsSync(join(root, "src/scroll-restoration.ts"))).toBe(true);
  const { currentRenderedPageKey } = await import(scrollImportPath);
  const app = document.createElement("div");
  app.innerHTML = `<main class="app-main-content"><section data-page="settings"></section></main>`;

  expect(currentRenderedPageKey(app)).toBe("settings");
  app.innerHTML = `<main class="app-main-content"></main>`;
  expect(currentRenderedPageKey(app)).toBeNull();
});

test("restores main scroll only when the rendered page is unchanged", async () => {
  expect(existsSync(join(root, "src/scroll-restoration.ts"))).toBe(true);
  const { restoreMainScrollIfSamePage } = await import(scrollImportPath);
  const app = document.createElement("div");
  app.innerHTML = `<main class="app-main-content"><section data-page="settings"></section></main>`;
  const main = app.querySelector<HTMLElement>(".app-main-content");
  expect(main).not.toBeNull();

  let frameCallback: (() => void) | null = null;
  restoreMainScrollIfSamePage({
    appRoot: app,
    previousPageKey: "settings",
    previousScrollTop: 128,
    currentView: "settings",
    requestAnimationFrame: (callback) => {
      frameCallback = callback;
    },
  });

  expect(main?.scrollTop).toBe(128);
  main!.scrollTop = 0;
  frameCallback?.();
  expect(main?.scrollTop).toBe(128);

  main!.scrollTop = 0;
  restoreMainScrollIfSamePage({
    appRoot: app,
    previousPageKey: "settings",
    previousScrollTop: 128,
    currentView: "cards",
  });
  expect(main?.scrollTop).toBe(0);
});
