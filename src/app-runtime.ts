import { invoke } from "@tauri-apps/api/core";
import type { FlashKind } from "./html-utils";
import { createDesktopState } from "./desktop-state";
import { loadNetworkSharingSettings } from "./network-sharing";

export const isTauriRuntime = "__TAURI_INTERNALS__" in window;

export const state = createDesktopState(loadNetworkSharingSettings());

let renderImpl: (() => void) | null = null;

export function registerRender(fn: () => void): void {
  renderImpl = fn;
}

export function render(): void {
  renderImpl?.();
}

let flashTimeoutId: number | null = null;

export function setFlash(kind: FlashKind, text: string): void {
  state.flash = { kind, text };
  render();

  if (flashTimeoutId !== null) {
    window.clearTimeout(flashTimeoutId);
  }
  flashTimeoutId = window.setTimeout(() => {
    state.flash = null;
    flashTimeoutId = null;
    render();
  }, 4000);
}

export function clearFlash(): void {
  state.flash = null;
  if (flashTimeoutId !== null) {
    window.clearTimeout(flashTimeoutId);
    flashTimeoutId = null;
  }
}

export function setBusy(nextBusy: boolean): void {
  state.busy = nextBusy;
  render();
}

export function beginPendingAction(key: string): void {
  state.pendingActions.add(key);
  render();
}

export function endPendingAction(key: string): void {
  state.pendingActions.delete(key);
  render();
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function desktopInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauriRuntime) {
    throw new Error("当前是浏览器预览模式。请使用 `npm run tauri dev` 启动桌面端。");
  }

  return invoke<T>(command, args);
}
