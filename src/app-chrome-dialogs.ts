import {
  renderConfigRecoveryDialog,
  renderNativeConfirmDialog,
} from "./app-chrome-renderers";
import type { ConfigRecoveryNotice } from "./desktop-types";

export function nativeConfirm(message: string, okText = "确定", isDanger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;transition:all 0.2s;";

    const box = document.createElement("div");
    box.style.cssText = "background:var(--bg-panel);border:1px solid var(--border);padding:28px 32px;border-radius:24px;box-shadow:var(--shadow-lg);max-width:320px;text-align:center;color:var(--text-main);transform:scale(0.95);animation:zoomIn 0.2s forwards;";
    box.innerHTML = renderNativeConfirmDialog({
      message,
      okText,
      isDanger,
    });

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    box.querySelector<HTMLButtonElement>("#btn-cancel")!.onclick = () => {
      document.body.removeChild(overlay);
      resolve(false);
    };
    box.querySelector<HTMLButtonElement>("#btn-ok")!.onclick = () => {
      document.body.removeChild(overlay);
      resolve(true);
    };
  });
}

export type ConfigRecoveryDialogResult = "openRecoveryDir" | "acknowledge";

export function showConfigRecoveryDialog(
  notices: ConfigRecoveryNotice[],
): Promise<ConfigRecoveryDialogResult> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.dataset.role = "config-recovery-backdrop";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,0.56);backdrop-filter:blur(5px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:28px;";
    overlay.innerHTML = renderConfigRecoveryDialog(notices);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
      }
    };
    const finish = (result: ConfigRecoveryDialogResult) => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(result);
    };

    overlay
      .querySelector<HTMLButtonElement>('[data-action="open-config-recovery-dir"]')!
      .onclick = () => finish("openRecoveryDir");
    overlay
      .querySelector<HTMLButtonElement>('[data-action="acknowledge-config-recovery"]')!
      .onclick = () => finish("acknowledge");

    document.addEventListener("keydown", onKeyDown);
    document.body.appendChild(overlay);
  });
}
