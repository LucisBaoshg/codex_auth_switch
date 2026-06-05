import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const pendingActionsImportPath = `../src/${"pending-actions"}`;

test("checks an exact pending action key", async () => {
  expect(existsSync(join(root, "src/pending-actions.ts"))).toBe(true);
  const { hasPendingAction } = await import(pendingActionsImportPath);

  const actions = new Set(["codex-usage:all", "latency-probe:work"]);

  expect(hasPendingAction(actions, "codex-usage:all")).toBe(true);
  expect(hasPendingAction(actions, "codex-usage:team")).toBe(false);
});

test("checks a pending action prefix without matching partial words", async () => {
  expect(existsSync(join(root, "src/pending-actions.ts"))).toBe(true);
  const { hasPendingActionPrefix } = await import(pendingActionsImportPath);

  expect(hasPendingActionPrefix(new Set(["codex-usage:work"]), "codex-usage")).toBe(true);
  expect(hasPendingActionPrefix(new Set(["codex-usage"]), "codex-usage")).toBe(true);
  expect(hasPendingActionPrefix(new Set(["codex-usage-old:work"]), "codex-usage")).toBe(false);
  expect(hasPendingActionPrefix(new Set(["latency-probe:work"]), "codex-usage")).toBe(false);
});
