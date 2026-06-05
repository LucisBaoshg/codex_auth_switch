import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const utilsImportPath = `../src/${"html-utils"}`;

test("escapes HTML special characters", async () => {
  expect(existsSync(join(root, "src/html-utils.ts"))).toBe(true);
  const { escapeHtml } = await import(utilsImportPath);

  expect(escapeHtml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
});

test("returns stable flash icons for known kinds", async () => {
  expect(existsSync(join(root, "src/html-utils.ts"))).toBe(true);
  const { getFlashIcon } = await import(utilsImportPath);

  expect(getFlashIcon("success")).toContain("polyline");
  expect(getFlashIcon("error")).toContain("circle");
  expect(getFlashIcon("info")).toContain("line");
});

test("formats session message text with current markdown behavior", async () => {
  expect(existsSync(join(root, "src/html-utils.ts"))).toBe(true);
  const { formatMessageText } = await import(utilsImportPath);

  expect(formatMessageText("hello <b>x</b>")).toBe("hello &lt;b&gt;x&lt;/b&gt;");
  expect(formatMessageText("Use `code` now")).toBe("Use <code>code</code> now");
  expect(formatMessageText("[Docs](https://example.com?a=1&b=2)")).toBe(
    '<a href="https://example.com?a=1&amp;b=2" target="_blank" class="chat-link">Docs</a>',
  );
  expect(formatMessageText("```ts\nconst x = '<tag>';\n```")).toBe(
    '<pre class="code-block" data-lang="ts"><code>const x = &#39;&lt;tag&gt;&#39;;<br></code></pre>',
  );
});
