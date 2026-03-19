import { beforeEach, expect, test, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
});

test("renders a card-only profile gallery without a left sidebar", async () => {
  await import("../src/main");

  expect(document.querySelector('[data-region="sidebar"]')).toBeNull();
  expect(document.querySelector('[data-page="cards"]')).not.toBeNull();
  expect(document.querySelector('[data-role="global-restart"]')).not.toBeNull();
  expect(document.querySelector('[data-role="global-refresh"]')).not.toBeNull();
  expect(document.querySelector('[data-role="add-card"]')).not.toBeNull();
  expect(document.querySelector(".page-header")).toBeNull();
  expect(
    document.querySelector('[data-role="current-config-card"]')?.getAttribute("data-variant"),
  ).toBeNull();
  expect(document.querySelector('[data-role="current-status-band"]')).toBeNull();
  const gridChildren = Array.from(document.querySelectorAll(".card-grid > *"));
  expect(gridChildren[0]?.getAttribute("data-role")).toBe("add-card");
  expect(gridChildren[1]?.getAttribute("data-role")).toBe("current-config-card");
  expect(
    document.querySelector('[data-role="current-config-card"] [data-action="restart-codex"]'),
  ).toBeNull();
  expect(
    document.querySelector('[data-role="current-config-card"] [data-action="refresh"]'),
  ).toBeNull();
  expect(document.querySelector('[data-role="profile-card"][data-state="live"]')).not.toBeNull();
  expect(document.querySelectorAll("[data-role='profile-card']").length).toBeGreaterThan(0);
});

test("opens the editor flow when clicking the add-profile card", async () => {
  await import("../src/main");

  document
    .querySelector<HTMLButtonElement>('[data-action="new-profile"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  expect(document.querySelector('[data-page="editor"]')).not.toBeNull();
  expect(document.querySelector("#editor-name")).not.toBeNull();
  expect(document.querySelector("#editor-auth-json")).not.toBeNull();
  expect(document.querySelector("#editor-config-toml")).not.toBeNull();
});

test("opens the detail editor when clicking view-details on a profile card", async () => {
  await import("../src/main");

  document
    .querySelector<HTMLButtonElement>('[data-action="view-profile-details"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  expect(document.querySelector('[data-page="editor"]')).not.toBeNull();
  expect(document.querySelector("#editor-auth-json")).not.toBeNull();
  expect(document.querySelector("#editor-config-toml")).not.toBeNull();
});
