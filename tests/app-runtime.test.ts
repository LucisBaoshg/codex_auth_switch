import { afterEach, expect, test, vi } from "vitest";

import {
  clearFlash,
  registerRender,
  setBusy,
  setFlash,
  state,
} from "../src/app-runtime";

afterEach(() => {
  clearFlash();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

test("updates local busy and flash state without a full render", () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div class="app-layout"></div>';
  let renderCount = 0;
  registerRender(() => {
    renderCount += 1;
  });

  setBusy(true, { render: false });
  setFlash("success", "会话清理完成", { render: false });

  expect(state.busy).toBe(true);
  expect(document.querySelector(".toast-text")?.textContent).toBe("会话清理完成");
  expect(renderCount).toBe(0);

  setBusy(false, { render: false });
  vi.advanceTimersByTime(4000);

  expect(state.busy).toBe(false);
  expect(document.querySelector(".toast-notification")).toBeNull();
  expect(renderCount).toBe(0);
});
