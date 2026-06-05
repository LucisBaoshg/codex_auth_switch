import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const renderersImportPath = `../src/${"app-chrome-renderers"}`;

test("renders flash toast HTML without trusting message text", async () => {
  expect(existsSync(join(root, "src/app-chrome-renderers.ts"))).toBe(true);
  const { renderFlash } = await import(renderersImportPath);

  expect(renderFlash(null)).toBe("");
  const html = renderFlash({ kind: "success", text: "<saved>" });

  expect(html).toContain("toast-notification toast-success");
  expect(html).toContain("&lt;saved&gt;");
  expect(html).toContain('data-action="clear-flash"');
});

test("renders busy dialog HTML without trusting copy", async () => {
  expect(existsSync(join(root, "src/app-chrome-renderers.ts"))).toBe(true);
  const { renderBusyDialog } = await import(renderersImportPath);

  expect(renderBusyDialog(null)).toBe("");
  const html = renderBusyDialog({ title: "<Switching>", message: "A & B" });

  expect(html).toContain('role="status"');
  expect(html).toContain("data-role=\"profile-switch-busy-dialog\"");
  expect(html).toContain("&lt;Switching&gt;");
  expect(html).toContain("A &amp; B");
});

test("renders app shell with navigation, update status, content and overlays", async () => {
  expect(existsSync(join(root, "src/app-chrome-renderers.ts"))).toBe(true);
  const rendererModule = await import(renderersImportPath);

  expect(rendererModule).toHaveProperty("renderAppShell");
  const { renderAppShell } = rendererModule as typeof import("../src/app-chrome-renderers");

  const html = renderAppShell({
    view: "editor",
    contentHtml: "<section data-role=\"page-content\">content</section>",
    sidebarLoginStatusHtml: "<div data-role=\"login-status\">signed in</div>",
    flash: { kind: "info", text: "<notice>" },
    busyDialog: { title: "Switch", message: "Please wait" },
    update: {
      checking: false,
      hasPendingUpdate: true,
      currentVersionText: "1.4.31",
      updateVersionText: "v1.4.32",
    },
  });

  expect(html).toContain('class="app-layout"');
  expect(html).toContain('class="app-sidebar"');
  expect(html).toContain('data-action="nav-profiles"');
  expect(html).toContain('nav-item active" data-action="nav-profiles"');
  expect(html).toContain("Codex 助手");
  expect(html).toContain('data-role="login-status"');
  expect(html).toContain('data-role="update-entry"');
  expect(html).toContain("有新版本 v1.4.32");
  expect(html).toContain('data-role="page-content"');
  expect(html).toContain("&lt;notice&gt;");
  expect(html).toContain('data-role="profile-switch-busy-dialog"');
});

test("renders native confirm dialog copy and action styling safely", async () => {
  expect(existsSync(join(root, "src/app-chrome-renderers.ts"))).toBe(true);
  const rendererModule = await import(renderersImportPath);

  expect(rendererModule).toHaveProperty("renderNativeConfirmDialog");
  const { renderNativeConfirmDialog } = rendererModule as typeof import("../src/app-chrome-renderers");

  const html = renderNativeConfirmDialog({
    message: "Delete <profile>?",
    okText: "Destroy & apply",
    isDanger: true,
  });

  expect(html).toContain("@keyframes zoomIn");
  expect(html).toContain("Delete &lt;profile&gt;?");
  expect(html).toContain("Destroy &amp; apply");
  expect(html).toContain('id="btn-cancel"');
  expect(html).toContain('id="btn-ok"');
  expect(html).toContain("background:var(--danger)");
  expect(html).toContain("rgba(239,68,68,0.2)");

  const normalHtml = renderNativeConfirmDialog({
    message: "Continue?",
    okText: "OK",
    isDanger: false,
  });
  expect(normalHtml).toContain("background:var(--accent)");
  expect(normalHtml).toContain("rgba(99,102,241,0.2)");
});
