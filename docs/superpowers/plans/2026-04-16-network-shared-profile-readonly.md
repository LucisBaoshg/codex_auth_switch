# Network Shared Profile Readonly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a detail view for network shared profiles while keeping that detail surface strictly read-only.

**Architecture:** Reuse the existing editor/detail page and extend editor state with a readonly/source marker. Network shared cards load remote file contents into that state, and the page disables fields plus removes save actions when the source is network-shared.

**Tech Stack:** TypeScript, Vite, Vitest, existing single-file UI in `src/main.ts`.

---

### Task 1: Add the failing readonly detail test

**Files:**
- Modify: `tests/sidebar-layout.test.ts`
- Test: `tests/sidebar-layout.test.ts`

- [ ] **Step 1: Write the failing test**

Add a Vitest case that switches to the network tab, stubs the remote `fetch` calls, opens the shared-profile detail view, and asserts the editor page is readonly.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/sidebar-layout.test.ts`
Expected: FAIL because the network card does not yet expose a detail action and the editor has no readonly mode.

- [ ] **Step 3: Implement the minimal UI changes**

Extend the network card actions and editor state in `src/main.ts` so network shared profiles can open a readonly detail page using fetched remote contents.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- --run tests/sidebar-layout.test.ts`
Expected: PASS with the new readonly detail scenario.

### Task 2: Keep existing local detail behavior green

**Files:**
- Modify: `src/main.ts`
- Test: `tests/sidebar-layout.test.ts`
- Test: `tests/profile-editor-live-config.test.ts`

- [ ] **Step 1: Verify existing local detail tests still describe editable behavior**

Use the current local profile detail tests as regression coverage for editable mode.

- [ ] **Step 2: Run targeted regression tests**

Run: `npm test -- --run tests/sidebar-layout.test.ts tests/profile-editor-live-config.test.ts`
Expected: PASS, proving local profile detail remains editable and live-change notice still works.
