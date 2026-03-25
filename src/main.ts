import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check as checkForAppUpdate } from "@tauri-apps/plugin-updater";
import "./styles.css";

type FlashKind = "info" | "success" | "error";
type ViewMode = "cards" | "editor";
type EditorMode = "new" | "fromCurrent" | "existing";

type CodexUsageWindow = {
  usedPercent: number;
  windowMinutes: number | null;
  resetsAt: string | null;
};

type CodexUsageCredits = {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
};

type CodexUsageSnapshot = {
  source: string;
  planType: string | null;
  primary: CodexUsageWindow | null;
  secondary: CodexUsageWindow | null;
  credits: CodexUsageCredits | null;
  updatedAt: string;
};

type ProfileSummary = {
  id: string;
  name: string;
  notes: string;
  authTypeLabel: string;
  createdAt: string;
  updatedAt: string;
  authHash: string;
  configHash: string;
  codexUsage: CodexUsageSnapshot | null;
};

type ProfileInput = {
  name: string;
  notes: string;
  authJson: string;
  configToml: string;
};

type ProfileDocument = {
  id: string;
  name: string;
  notes: string;
  authTypeLabel: string;
  createdAt: string;
  updatedAt: string;
  authJson: string;
  configToml: string;
};

type AppSnapshot = {
  targetDir: string;
  usingDefaultTargetDir: boolean;
  targetExists: boolean;
  targetAuthExists: boolean;
  targetConfigExists: boolean;
  targetUpdatedAt: string | null;
  targetAuthTypeLabel: string | null;
  activeProfileId: string | null;
  lastSelectedProfileId: string | null;
  lastSwitchProfileId: string | null;
  lastSwitchedAt: string | null;
  codexUsageApiEnabled: boolean;
  profiles: ProfileSummary[];
};

type UpdateCheckResult = {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  publishedAt: string | null;
  releaseName: string | null;
};

type InstallLocationStatus = {
  updateSafe: boolean;
  requiresApplicationsInstall: boolean;
  installPath: string;
  message: string | null;
};

type EditorState = {
  mode: EditorMode;
  profileId: string | null;
  name: string;
  notes: string;
  authJson: string;
  configToml: string;
  createdAt: string | null;
  updatedAt: string | null;
};

type NetworkProfile = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  files: string[];
};

const isTauriRuntime = "__TAURI_INTERNALS__" in window;
const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("App root was not found.");
}

const app = appRoot;

function createEditorState(mode: EditorMode = "new"): EditorState {
  return {
    mode,
    profileId: null,
    name: "",
    notes: "",
    authJson: `{
  "user": {
    "email": ""
  },
  "token": ""
}`,
    configToml: `default_model = "gpt-5"
theme = "system"
`,
    createdAt: null,
    updatedAt: null,
  };
}

const mockSnapshot: AppSnapshot = {
  targetDir: "/Users/example/.codex",
  usingDefaultTargetDir: true,
  targetExists: true,
  targetAuthExists: true,
  targetConfigExists: true,
  targetUpdatedAt: new Date().toISOString(),
  targetAuthTypeLabel: "第三方 API",
  activeProfileId: "profile-2",
  lastSelectedProfileId: "profile-2",
  lastSwitchProfileId: "profile-2",
  lastSwitchedAt: new Date().toISOString(),
  codexUsageApiEnabled: true,
  profiles: [
    {
      id: "profile-1",
      name: "Work Team",
      notes: "工作主账号，常驻使用。",
      authTypeLabel: "官方 OAuth",
      createdAt: "2026-03-16T01:00:00Z",
      updatedAt: "2026-03-18T12:20:00Z",
      authHash: "7da2e87f1bc3",
      configHash: "92ca2d10aa51",
      codexUsage: {
        source: "api",
        planType: "team",
        primary: {
          usedPercent: 24,
          windowMinutes: 300,
          resetsAt: "2026-03-25T18:26:00Z",
        },
        secondary: {
          usedPercent: 7,
          windowMinutes: 10080,
          resetsAt: "2026-04-01T18:26:00Z",
        },
        credits: null,
        updatedAt: new Date().toISOString(),
      },
    },
    {
      id: "profile-2",
      name: "淘宝 1",
      notes: "主工作账号，额度稳定。",
      authTypeLabel: "第三方 API",
      createdAt: "2026-03-17T01:00:00Z",
      updatedAt: "2026-03-19T04:12:00Z",
      authHash: "d18ff783cb10",
      configHash: "c450c91961af",
      codexUsage: null,
    },
  ],
};

const state: {
  snapshot: AppSnapshot | null;
  view: ViewMode;
  selectedProfileId: string | null;
  editor: EditorState;
  busy: boolean;
  flash: { kind: FlashKind; text: string } | null;
  activeTab: "local" | "network";
  networkProfiles: NetworkProfile[];
  networkLoading: boolean;
  appVersion: string | null;
  update: {
    checking: boolean;
    lastResult: UpdateCheckResult | null;
  };
} = {
  snapshot: null,
  view: "cards",
  selectedProfileId: null,
  editor: createEditorState(),
  busy: false,
  flash: null,
  activeTab: "local",
  networkProfiles: [],
  networkLoading: false,
  appVersion: null,
  update: {
    checking: false,
    lastResult: null,
  },
};

function setFlash(kind: FlashKind, text: string): void {
  state.flash = { kind, text };
  render();
}

function clearFlash(): void {
  state.flash = null;
}

function setBusy(nextBusy: boolean): void {
  state.busy = nextBusy;
  render();
}

function setSnapshot(snapshot: AppSnapshot): void {
  state.snapshot = snapshot;
  if (!snapshot.profiles.some((profile) => profile.id === state.selectedProfileId)) {
    state.selectedProfileId =
      snapshot.activeProfileId ??
      snapshot.lastSelectedProfileId ??
      snapshot.profiles[0]?.id ??
      null;
  }
  render();
}

function getSelectedProfile(snapshot: AppSnapshot | null): ProfileSummary | null {
  if (!snapshot || snapshot.profiles.length === 0) {
    return null;
  }

  return (
    snapshot.profiles.find((profile) => profile.id === state.selectedProfileId) ??
    snapshot.profiles.find((profile) => profile.id === snapshot.activeProfileId) ??
    snapshot.profiles[0]
  );
}

function createMockCurrentInput(): ProfileInput {
  return {
    name: "",
    notes: "来自当前 Codex 目录",
    authJson: `{
  "auth_mode": "chatgpt",
  "tokens": {
    "id_token": "mock-id-token",
    "access_token": "mock-access-token"
  }
}`,
    configToml: `model = "gpt-5.4"
model_reasoning_effort = "medium"
`,
  };
}

function createEditorFromInput(mode: EditorMode, input: ProfileInput): EditorState {
  return {
    mode,
    profileId: null,
    name: input.name,
    notes: input.notes,
    authJson: input.authJson,
    configToml: input.configToml,
    createdAt: null,
    updatedAt: null,
  };
}

function createMockDocument(profile: ProfileSummary): ProfileDocument {
  return {
    id: profile.id,
    name: profile.name,
    notes: profile.notes,
    authTypeLabel: profile.authTypeLabel,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    authJson: `{
  "user": {
    "email": "${profile.name.toLowerCase()}@example.com"
  },
  "token": "token-for-${profile.id}"
}`,
    configToml: `default_model = "gpt-5"
theme = "system"
profile = "${profile.id}"
`,
  };
}

async function desktopInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauriRuntime) {
    throw new Error("当前是浏览器预览模式。请使用 `npm run tauri dev` 启动桌面端。");
  }

  return invoke<T>(command, args);
}

async function refreshSnapshot(): Promise<void> {
  if (!isTauriRuntime) {
    setSnapshot(mockSnapshot);
    setFlash("info", "当前是浏览器预览模式，展示的是模拟数据。");
    return;
  }

  setBusy(true);
  try {
    const snapshot = await desktopInvoke<AppSnapshot>("load_snapshot");
    clearFlash();
    setSnapshot(snapshot);
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    render();
  }
}

async function loadAppVersion(): Promise<void> {
  if (!isTauriRuntime) {
    state.appVersion = "preview";
    render();
    return;
  }

  try {
    state.appVersion = await getVersion();
  } catch {
    state.appVersion = null;
  } finally {
    render();
  }
}

async function switchProfile(profileId: string, profileName: string): Promise<void> {
  setBusy(true);
  try {
    const snapshot = await desktopInvoke<AppSnapshot>("switch_profile", { profileId });
    state.selectedProfileId = profileId;
    state.view = "cards";
    setSnapshot(snapshot);
    setFlash("success", `${profileName} profile 切换成功，请重启 Codex 使用。`);
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    render();
  }
}

function nativeConfirm(msg: string, okText = "确定", isDanger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;transition:all 0.2s;";
    const box = document.createElement("div");
    box.style.cssText = "background:var(--bg-panel);border:1px solid var(--border);padding:28px 32px;border-radius:24px;box-shadow:var(--shadow-lg);max-width:320px;text-align:center;color:var(--text-main);transform:scale(0.95);animation:zoomIn 0.2s forwards;";
    
    const okColor = isDanger ? "var(--danger)" : "var(--accent)";
    const okShadow = isDanger ? "rgba(239,68,68,0.2)" : "rgba(99,102,241,0.2)";

    box.innerHTML = `<style>@keyframes zoomIn { to { transform: scale(1); } }</style>
      <h3 style="margin:0 0 12px;font-size:1.2rem;">提示</h3>
      <p style="margin:0 0 24px;color:var(--text-muted);font-size:0.95rem;line-height:1.5;">${escapeHtml(msg)}</p>
      <div style="display:flex;gap:12px;justify-content:center;">
        <button id="btn-cancel" style="flex:1;padding:10px;border:none;border-radius:12px;background:var(--bg-page);color:var(--text-main);cursor:pointer;font-weight:600;border:1px solid var(--border);">取消</button>
        <button id="btn-ok" style="flex:1;padding:10px;border:none;border-radius:12px;background:${okColor};color:white;cursor:pointer;font-weight:600;box-shadow:0 4px 12px ${okShadow};">${escapeHtml(okText)}</button>
      </div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    
    document.getElementById("btn-cancel")!.onclick = () => { document.body.removeChild(overlay); resolve(false); };
    document.getElementById("btn-ok")!.onclick = () => { document.body.removeChild(overlay); resolve(true); };
  });
}

async function deleteProfile(profileId: string, profileName: string): Promise<void> {
  const confirmed = await nativeConfirm(`确定要销毁「${profileName}」档案吗？此操作无法撤回！`, "彻底销毁", true);
  if (!confirmed) {
    return;
  }

  setBusy(true);
  try {
    if (!isTauriRuntime) {
      const snapshot = state.snapshot;
      if (!snapshot) {
        throw new Error("当前没有可删除的 profile。");
      }
      setSnapshot({
        ...snapshot,
        profiles: snapshot.profiles.filter((profile) => profile.id !== profileId),
        activeProfileId: snapshot.activeProfileId === profileId ? null : snapshot.activeProfileId,
        lastSelectedProfileId:
          snapshot.lastSelectedProfileId === profileId ? null : snapshot.lastSelectedProfileId,
        lastSwitchProfileId:
          snapshot.lastSwitchProfileId === profileId ? null : snapshot.lastSwitchProfileId,
      });
    } else {
      const snapshot = await desktopInvoke<AppSnapshot>("delete_profile", { profileId });
      setSnapshot(snapshot);
    }

    if (state.view === "editor" && state.editor.profileId === profileId) {
      state.view = "cards";
      state.editor = createEditorState();
    }

    setFlash("success", `已删除 profile「${profileName}」。`);
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    render();
  }
}

async function openEditorForNewProfile(): Promise<void> {
  state.editor = createEditorState("new");
  state.view = "editor";
  render();
}

async function openEditorForProfile(profileId: string): Promise<void> {
  state.selectedProfileId = profileId;
  const snapshot = state.snapshot;
  const selectedProfile =
    snapshot?.profiles.find((profile) => profile.id === profileId) ?? null;

  if (!selectedProfile) {
    setFlash("error", "找不到这套 profile。");
    return;
  }

  if (!isTauriRuntime) {
    const document = createMockDocument(selectedProfile);
    state.editor = {
      mode: "existing",
      profileId: document.id,
      name: document.name,
      notes: document.notes,
      authJson: document.authJson,
      configToml: document.configToml,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
    state.view = "editor";
    render();
    return;
  }

  setBusy(true);
  try {
    const document = await desktopInvoke<ProfileDocument>("get_profile_document", { profileId });
    state.editor = {
      mode: "existing",
      profileId: document.id,
      name: document.name,
      notes: document.notes,
      authJson: document.authJson,
      configToml: document.configToml,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
    state.view = "editor";
    clearFlash();
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    render();
  }
}

async function saveEditorProfile(andSwitch: boolean): Promise<void> {
  const name = state.editor.name.trim();
  if (!name) {
    setFlash("error", "请先填写 profile 名称。");
    return;
  }

  const payload: ProfileInput = {
    name,
    notes: state.editor.notes.trim(),
    authJson: state.editor.authJson,
    configToml: state.editor.configToml,
  };

  setBusy(true);
  try {
    let snapshot: AppSnapshot;
    let targetProfileId: string | null = state.editor.profileId;
    const isExisting = state.editor.mode === "existing" && state.editor.profileId;

    if (isExisting) {
      snapshot = await desktopInvoke<AppSnapshot>("update_profile", {
        profileId: state.editor.profileId,
        payload,
      });
    } else {
      snapshot = await desktopInvoke<AppSnapshot>("import_profile", { payload });
      targetProfileId = snapshot.profiles[0]?.id ?? null;
    }

    state.selectedProfileId = targetProfileId;
    setSnapshot(snapshot);

    if (andSwitch && targetProfileId) {
      state.busy = false;
      await switchProfile(targetProfileId, name);
      return;
    }

    if (isExisting && targetProfileId) {
      const profileSummary =
        snapshot.profiles.find((profile) => profile.id === targetProfileId) ?? null;
      if (profileSummary) {
        state.editor = {
          ...state.editor,
          mode: "existing",
          profileId: profileSummary.id,
          name: profileSummary.name,
          notes: profileSummary.notes,
          createdAt: profileSummary.createdAt,
          updatedAt: profileSummary.updatedAt,
        };
      }
      state.view = "editor";
      setFlash("success", "已保存这套 profile。");
    } else {
      state.view = "cards";
      setFlash("success", `已创建 profile: ${name}`);
    }
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    render();
  }
}

async function fetchNetworkProfiles(): Promise<void> {
  state.networkLoading = true;
  render();
  try {
    const res = await fetch("http://sub2api.ite.tapcash.com/codex/api/profiles");
    if (!res.ok) throw new Error("加载网络共享配置失败");
    state.networkProfiles = await res.json();
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.networkLoading = false;
    render();
  }
}

async function downloadAndApplyNetworkProfile(networkProfileId: string, profileName: string): Promise<void> {
  const confirmed = await nativeConfirm(`确定要下载网络配置「${profileName}」吗？\n如果同名配置已存在，将会生效使用并覆盖运行中环境。`, "下载并应用", false);
  if (!confirmed) return;

  setBusy(true);
  try {
    const res = await fetch(`http://sub2api.ite.tapcash.com/codex/api/profiles/${networkProfileId}`);
    if (!res.ok) throw new Error("获取网络配置详情失败");
    const profileData = await res.json();

    let authJson = "";
    let configToml = "";

    if (profileData.files && profileData.files.includes("auth.json")) {
      const authRes = await fetch(`http://sub2api.ite.tapcash.com/codex/api/profiles/${networkProfileId}/auth.json`);
      if (authRes.ok) authJson = await authRes.text();
    }
    if (profileData.files && profileData.files.includes("config.toml")) {
      const configRes = await fetch(`http://sub2api.ite.tapcash.com/codex/api/profiles/${networkProfileId}/config.toml`);
      if (configRes.ok) configToml = await configRes.text();
    }

    const payload: ProfileInput = {
      name: profileName,
      notes: profileData.description || "从网络资源库获取的共享配置",
      authJson: authJson || "{}",
      configToml: configToml || "",
    };

    if (isTauriRuntime) {
      const snapshot = await desktopInvoke<AppSnapshot>("import_profile", { payload });
      const targetProfileId = snapshot.profiles[0]?.id;
      if (targetProfileId) {
        const afterSwitchSnap = await desktopInvoke<AppSnapshot>("switch_profile", { profileId: targetProfileId });
        state.selectedProfileId = targetProfileId;
        setSnapshot(afterSwitchSnap);
        state.activeTab = "local";
        setFlash("success", `已成功下载并应用网络共享配置「${profileName}」。`);
      } else {
         setFlash("error", "应用配置时发生错误。");
      }
    } else {
      setFlash("info", "当前为浏览器预览模式，无法将外网配置应用到桌面系统。");
    }
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
    render();
  }
}

async function checkForUpdate(): Promise<void> {
  if (!isTauriRuntime) {
    setFlash("info", "浏览器预览模式无法检查更新。");
    return;
  }

  state.update.checking = true;
  render();
  try {
    const installLocation = await desktopInvoke<InstallLocationStatus>("check_install_location");
    if (!installLocation.updateSafe) {
      state.update.lastResult = null;
      setFlash(
        "error",
        installLocation.message ??
          "当前安装位置不支持应用内更新。请先将应用移动到标准安装目录后再重试。",
      );
      return;
    }

    const update = await checkForAppUpdate();
    if (!update) {
      state.update.lastResult = null;
      setFlash("success", "已是最新版本。");
      return;
    }

    state.update.lastResult = {
      hasUpdate: true,
      currentVersion: update.currentVersion,
      latestVersion: update.version,
      releaseUrl: "",
      publishedAt: update.date ?? null,
      releaseName: null,
    };

    const confirmed = await nativeConfirm(
      `发现新版本 ${update.version}（当前 ${update.currentVersion}）。是否立即下载并安装？`,
      "立即更新",
      false,
    );
    if (!confirmed) {
      setFlash("info", `已取消更新，当前可升级到 ${update.version}。`);
      return;
    }

    let downloadedBytes = 0;
    setFlash("info", `正在下载更新 ${update.version}...`);
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        const total = event.data.contentLength;
        setFlash(
          "info",
          total
            ? `开始下载更新，大小约 ${(total / 1024 / 1024).toFixed(1)} MB。`
            : "开始下载更新包。",
        );
      } else if (event.event === "Progress") {
        downloadedBytes += event.data.chunkLength;
        setFlash("info", `正在下载更新，已接收 ${(downloadedBytes / 1024 / 1024).toFixed(1)} MB。`);
      } else if (event.event === "Finished") {
        setFlash("info", "更新包下载完成，正在安装。");
      }
    });

    setFlash("success", "更新已安装完成。请重新打开应用进入新版本。");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("cross-device link")) {
      setFlash(
        "error",
        "更新失败：当前应用不在标准安装目录中。请先将 Codex Auth Switch 拖到 Applications 文件夹后重新打开，再执行更新。",
      );
    } else {
      setFlash("error", message);
    }
  } finally {
    state.update.checking = false;
    render();
  }
}

async function setCodexUsageApiEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    const confirmed = await nativeConfirm(
      "启用后会使用已保存的 ChatGPT access token 请求 chatgpt.com/backend-api/wham/usage。这个接口不是公开稳定 API，继续吗？",
      "继续启用",
      false,
    );
    if (!confirmed) {
      return;
    }
  }

  setBusy(true);
  try {
    if (!isTauriRuntime) {
      const snapshot = state.snapshot;
      if (!snapshot) {
        throw new Error("当前没有可用快照。");
      }
      setSnapshot({
        ...snapshot,
        codexUsageApiEnabled: enabled,
      });
    } else {
      const snapshot = await desktopInvoke<AppSnapshot>("set_codex_usage_api_enabled", {
        enabled,
      });
      setSnapshot(snapshot);
    }

    setFlash(
      "success",
      enabled ? "已启用 Codex 额度查询。" : "已关闭 Codex 额度查询。",
    );
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    render();
  }
}

async function refreshProfileCodexUsage(profileId: string, profileName: string): Promise<void> {
  setBusy(true);
  try {
    if (!isTauriRuntime) {
      const snapshot = state.snapshot;
      if (!snapshot) {
        throw new Error("当前没有可用快照。");
      }
      setSnapshot(snapshot);
    } else {
      const snapshot = await desktopInvoke<AppSnapshot>("refresh_profile_codex_usage", {
        profileId,
      });
      setSnapshot(snapshot);
    }
    setFlash("success", `已刷新「${profileName}」的 Codex 额度。`);
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    render();
  }
}

async function refreshAllCodexUsage(): Promise<void> {
  setBusy(true);
  try {
    if (!isTauriRuntime) {
      const snapshot = state.snapshot;
      if (!snapshot) {
        throw new Error("当前没有可用快照。");
      }
      setSnapshot(snapshot);
    } else {
      const snapshot = await desktopInvoke<AppSnapshot>("refresh_all_codex_usage");
      setSnapshot(snapshot);
    }
    setFlash("success", "已刷新全部官方 OAuth 档案的 Codex 额度。");
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    render();
  }
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "还没有";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function selectUsageWindow(
  usage: CodexUsageSnapshot | null,
  minutes: number,
  fallbackPrimary: boolean,
): CodexUsageWindow | null {
  if (!usage) {
    return null;
  }
  if (usage.primary?.windowMinutes === minutes) {
    return usage.primary;
  }
  if (usage.secondary?.windowMinutes === minutes) {
    return usage.secondary;
  }
  return fallbackPrimary ? usage.primary : usage.secondary;
}

function remainingPercent(usedPercent: number): number {
  return Math.max(0, Math.min(100, Math.floor(100 - usedPercent)));
}

function formatPlanTitle(planType: string | null): string {
  if (!planType) {
    return "Codex Plan";
  }

  const normalized = planType.charAt(0).toUpperCase() + planType.slice(1).toLowerCase();
  return `Codex ${normalized} Plan`;
}

function formatUsageReset(window: CodexUsageWindow | null): string {
  if (!window?.resetsAt) {
    return "--";
  }

  const resetAt = new Date(window.resetsAt);
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(resetAt);
  const date = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(resetAt);
  return `${time} on ${date}`;
}

function renderUsageProgressRow(label: string, window: CodexUsageWindow | null): string {
  const remaining = window ? remainingPercent(window.usedPercent) : 0;

  return `
    <div class="usage-progress-row">
      <div class="usage-progress-head">
        <span class="usage-progress-label">${escapeHtml(label)}</span>
        <span class="usage-progress-reset">${escapeHtml(formatUsageReset(window))}</span>
      </div>
      <div class="usage-progress-line">
        <div class="usage-progress-track">
          <div class="usage-progress-fill" style="width:${remaining}%"></div>
        </div>
        <span class="usage-progress-value">${window ? `${remaining}%` : "--"}</span>
      </div>
    </div>
  `;
}

function renderCodexUsagePanel(snapshot: AppSnapshot, profile: ProfileSummary): string {
  if (profile.authTypeLabel !== "官方 OAuth") {
    return "";
  }

  const usage = profile.codexUsage;
  const primaryWindow = selectUsageWindow(usage, 300, true);
  const weeklyWindow = selectUsageWindow(usage, 10080, false);
  const updated = usage ? formatDateTime(usage.updatedAt) : "还没有";

  return `
    <section class="usage-panel">
      <div class="usage-panel-head">
        <div class="usage-panel-copy">
          <strong>${escapeHtml(formatPlanTitle(usage?.planType ?? null))}</strong>
          <span class="usage-panel-updated">更新于：${escapeHtml(updated)}</span>
        </div>
        ${
          snapshot.codexUsageApiEnabled
            ? `
              <button
                class="button button-ghost usage-refresh-button"
                data-action="refresh-codex-usage"
                data-id="${profile.id}"
                data-name="${escapeHtml(profile.name)}"
                ${state.busy ? "disabled" : ""}
              >
                刷新额度
              </button>
            `
            : `
              <button
                class="button button-ghost usage-refresh-button"
                data-action="enable-codex-usage"
                ${state.busy ? "disabled" : ""}
              >
                启用额度查询
              </button>
            `
        }
      </div>
      <div class="usage-progress-list">
        ${renderUsageProgressRow("5H", primaryWindow)}
        ${renderUsageProgressRow("WEEKLY", weeklyWindow)}
      </div>
    </section>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderFlash(): string {
  if (!state.flash) {
    return "";
  }

  return `
    <aside class="flash flash-${state.flash.kind}">
      <span>${escapeHtml(state.flash.text)}</span>
    </aside>
  `;
}

function renderCardsPage(snapshot: AppSnapshot): string {
  const activeProfile =
    snapshot.profiles.find((profile) => profile.id === snapshot.activeProfileId) ?? null;
  const hasPendingUpdate = state.update.lastResult?.hasUpdate ?? false;
  const currentVersionText = state.update.lastResult?.currentVersion ?? state.appVersion ?? "--";
  const updateLabelText = hasPendingUpdate ? "发现新版本" : "当前版本";
  const updateVersionText = hasPendingUpdate
    ? `v${state.update.lastResult?.latestVersion ?? "--"}`
    : `v${currentVersionText}`;
  const updateActionText = state.update.checking
    ? "检查中…"
    : hasPendingUpdate
      ? "立即更新"
      : "检查更新";
  const updateHint = hasPendingUpdate
    ? `当前 v${currentVersionText}，点击下载并安装`
    : "通过 GitHub Release 获取最新安装包";
  const updateEntryClass = hasPendingUpdate
    ? "version-update-entry version-update-entry-available"
    : "version-update-entry";

  return `
    <section class="cards-page" data-page="cards">
      <header class="top-nav" data-tauri-drag-region>
        <div class="top-nav-copy">
          <h1>Codex Auth Switch</h1>
          <p>统一管理与快速分发您的环境代理和身份配置。</p>
        </div>
        <div class="top-nav-actions" style="align-items: center;">
          <button
            class="${updateEntryClass}"
            title="检查更新"
            data-role="update-entry"
            data-action="check-update"
            ${state.busy || state.update.checking ? "disabled" : ""}
          >
            <span class="version-update-copy">
              <span class="version-update-label">${escapeHtml(updateLabelText)}</span>
              <strong>${escapeHtml(updateVersionText)}</strong>
            </span>
            <span class="version-update-action">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"></polyline></svg>
              ${escapeHtml(updateActionText)}
            </span>
          </button>
        </div>
      </header>

      ${renderFlash()}

      <div class="tabs">
        <button class="tab-button ${state.activeTab === 'local' ? 'active' : ''}" data-action="tab-local">🏠 本地档案</button>
        <button class="tab-button ${state.activeTab === 'network' ? 'active' : ''}" data-action="tab-network">☁️ 网络共享库</button>
      </div>

      ${state.activeTab === 'local' ? `
      <section class="grid-container">
        <div class="section-header">
          <h3 class="section-title">已保存的配置文件 (${snapshot.profiles.length})</h3>
          <div class="section-actions">
            ${snapshot.profiles.some((profile) => profile.authTypeLabel === "官方 OAuth") ? `
              ${
                snapshot.codexUsageApiEnabled
                  ? `
                    <button class="button button-secondary" data-action="refresh-all-codex-usage" ${state.busy ? "disabled" : ""}>
                      刷新全部额度
                    </button>
                    <button class="button button-ghost" data-action="disable-codex-usage" ${state.busy ? "disabled" : ""}>
                      关闭额度查询
                    </button>
                  `
                  : `
                    <button class="button button-secondary" data-action="enable-codex-usage" ${state.busy ? "disabled" : ""}>
                      启用 Codex 额度查询
                    </button>
                  `
              }
            ` : ""}
            <button class="icon-button section-refresh-button" title="刷新状态" data-role="global-refresh" data-action="refresh" ${state.busy ? "disabled" : ""}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
            </button>
          </div>
        </div>
        <div class="card-grid">
          <button class="card add-profile-card" data-role="add-card" data-action="new-profile" ${state.busy ? "disabled" : ""}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            加配置
          </button>

          ${snapshot.profiles.length === 0 ? `
            <div class="empty-state">
              <h3>暂无存档记录</h3>
              <p>点击 "加配置" 录入您的第一套 Profile 集合吧！</p>
            </div>
          ` : ""}
          ${[...snapshot.profiles]
              .sort((a, b) => {
                if (a.id === snapshot.activeProfileId) return -1;
                if (b.id === snapshot.activeProfileId) return 1;
                return 0;
              })
            .map(
              (profile) => `
                <article
                  class="card profile-card ${snapshot.activeProfileId === profile.id ? "profile-card-live" : ""}"
                  data-role="profile-card"
                  data-state="${snapshot.activeProfileId === profile.id ? "live" : "idle"}"
                >
                  <div class="card-head">
                    <h2>${escapeHtml(profile.name)}</h2>
                    <div style="display: flex; gap: 8px; align-items: center;">
                      ${snapshot.activeProfileId === profile.id ? `
                        <div class="status-badge">
                          <div class="status-dot status-dot-pulse"></div>
                          <span>Active</span>
                        </div>
                      ` : ""}
                      <span class="pill pill-type">${escapeHtml(profile.authTypeLabel)}</span>
                    </div>
                  </div>
                  <p class="card-note" style="${!profile.notes ? 'opacity:0.5;font-style:italic;' : ''}">${escapeHtml(profile.notes || "暂无备注")}</p>
                  ${renderCodexUsagePanel(snapshot, profile)}
                  
                  <div class="card-actions-overlay">
                    <div style="display: flex; flex-direction: column; gap: 4px; flex-grow: 1;">
                      <p class="card-date">更新于：${formatDateTime(profile.updatedAt)}</p>
                      ${snapshot.activeProfileId === profile.id 
                        ? `<div class="env-active-label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> 环境生效中</div>` 
                        : `<button class="button button-secondary" style="width:100%" data-action="switch" data-id="${profile.id}" data-name="${escapeHtml(profile.name)}" ${state.busy ? "disabled" : ""}>应用此配置</button>`}
                    </div>
                    
                    <div class="card-secondary-actions" style="align-self: flex-end; padding-bottom: 2px;">
                      <button
                        class="icon-button"
                        title="查看文件详细内容"
                        data-action="view-profile-details"
                        data-id="${profile.id}"
                        ${state.busy ? "disabled" : ""}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                      </button>
                      <button
                        class="icon-button text-red"
                        title="销毁"
                        data-action="delete-profile"
                        data-id="${profile.id}"
                        data-name="${escapeHtml(profile.name)}"
                        ${state.busy ? "disabled" : ""}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                      </button>
                    </div>
                  </div>
                </article>
              `
            )
            .join("")}
        </div>
      </section>
      ` : `
      <section class="grid-container">
        <div class="section-header">
          <h3 class="section-title">网络共享库 (${state.networkProfiles.length})</h3>
          <button class="icon-button section-refresh-button" title="刷新状态" data-role="global-refresh" data-action="refresh" ${state.busy ? "disabled" : ""}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
          </button>
        </div>
        ${state.networkLoading ? `
          <div class="empty-state" style="border:none;background:transparent;">
            <p>正在获取网络共享配置，请稍候...</p>
          </div>
        ` : `
          <div class="card-grid">
            ${state.networkProfiles.length === 0 ? `
              <div class="empty-state">
                <h3>暂无网络存档</h3>
                <p>资源分发中心目前还没有任何共享配置。</p>
              </div>
            ` : ""}
            ${state.networkProfiles.map((profile) => `
              <article class="card profile-card" data-role="profile-card">
                <div class="card-head">
                  <h2>${escapeHtml(profile.name)}</h2>
                  <span class="pill pill-type" style="color:var(--text-main);border-color:var(--border);background:transparent;">☁️ 远程资源</span>
                </div>
                <p class="card-note">${escapeHtml(profile.description || "提供自线上团队分享")}</p>
                
                <div class="card-actions-overlay">
                  <div style="display: flex; flex-direction: column; gap: 4px; flex-grow: 1;">
                    <p class="card-date">上传于：${formatDateTime(profile.createdAt)}</p>
                    <button
                      class="button button-primary"
                      data-action="download-and-apply"
                      data-id="${profile.id}"
                      data-name="${escapeHtml(profile.name)}"
                      ${state.busy ? "disabled" : ""}
                      style="width: 100%;"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                      安装并应用
                    </button>
                  </div>
                </div>
              </article>
            `).join("")}
          </div>
        `}
      </section>
      `}
    </section>
  `;
}

function renderEditorPage(): string {
  const existing = state.editor.mode === "existing";
  const title =
    state.editor.mode === "fromCurrent"
      ? "保存当前 Codex 配置为新 Profile"
      : existing
        ? "查看和编辑 Profile"
        : "手动创建新 Profile";

  const subtitle =
    state.editor.mode === "fromCurrent"
      ? "把当前 `.codex` 里的内容复制成一套新的 profile。"
      : existing
        ? "你现在编辑的是已保存 profile 的完整配置文本。"
        : "直接手工填写名称、备注以及两份配置内容。";

  return `
    <section class="editor-page" data-page="editor">
      <header class="editor-header">
        <div class="editor-header-left">
          <button class="button button-ghost" data-action="back-to-cards" ${state.busy ? "disabled" : ""}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            返回卡片网格
          </button>
          <div>
            <p class="eyebrow">Profile Detail</p>
            <h1>${title}</h1>
            <p class="page-copy">${subtitle}</p>
          </div>
        </div>
        <div class="editor-header-actions">
          ${
            existing
              ? `
                <button class="button button-secondary" data-action="save-editor" ${state.busy ? "disabled" : ""}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                  保存修改
                </button>
              `
              : `
                <button class="button button-secondary" data-action="save-editor" ${state.busy ? "disabled" : ""}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  创建配置
                </button>
              `
          }
          <button class="button button-primary" data-action="save-and-switch" ${state.busy ? "disabled" : ""}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            ${existing ? "保存并立即启动" : "创建并立即启动"}
          </button>
        </div>
      </header>

      ${renderFlash()}

      <section class="editor-meta">
        <div class="meta-chip">
          <span>创建时间</span>
          <strong>${formatDateTime(state.editor.createdAt)}</strong>
        </div>
        <div class="meta-chip">
          <span>最近更新</span>
          <strong>${formatDateTime(state.editor.updatedAt)}</strong>
        </div>
      </section>

      <section class="editor-body">
        <label class="field">
          <span>Profile 名称</span>
          <input
            id="editor-name"
            type="text"
            value="${escapeHtml(state.editor.name)}"
            placeholder="例如：淘宝 1 / Work / Backup"
            ${state.busy ? "disabled" : ""}
          />
        </label>

        <label class="field">
          <span>备注</span>
          <textarea
            id="editor-notes"
            rows="3"
            placeholder="写一点识别信息，比如账号用途、邮箱、额度状态"
            ${state.busy ? "disabled" : ""}
          >${escapeHtml(state.editor.notes)}</textarea>
        </label>

        <div class="editor-panels">
          <label class="field">
            <span>auth.json</span>
            <textarea
              id="editor-auth-json"
              class="code-textarea"
              rows="18"
              spellcheck="false"
              ${state.busy ? "disabled" : ""}
            >${escapeHtml(state.editor.authJson)}</textarea>
          </label>

          <label class="field">
            <span>config.toml</span>
            <textarea
              id="editor-config-toml"
              class="code-textarea"
              rows="18"
              spellcheck="false"
              ${state.busy ? "disabled" : ""}
            >${escapeHtml(state.editor.configToml)}</textarea>
          </label>
        </div>
      </section>
    </section>
  `;
}

function render(): void {
  const snapshot = state.snapshot;

  if (!snapshot) {
    app.innerHTML = `
      <main class="app-shell">
        <section class="loading-page" data-page="cards">
          <p class="eyebrow">Codex Profiles</p>
          <h1>正在读取配置…</h1>
        </section>
      </main>
    `;
    return;
  }

  app.innerHTML = `
    <main class="app-shell">
      ${state.view === "cards" ? renderCardsPage(snapshot) : renderEditorPage()}
    </main>
  `;

  bindEvents();
}

function bindEvents(): void {
  const editorNameInput = document.querySelector<HTMLInputElement>("#editor-name");
  editorNameInput?.addEventListener("input", (event) => {
    state.editor.name = (event.currentTarget as HTMLInputElement).value;
  });

  const editorNotesInput = document.querySelector<HTMLTextAreaElement>("#editor-notes");
  editorNotesInput?.addEventListener("input", (event) => {
    state.editor.notes = (event.currentTarget as HTMLTextAreaElement).value;
  });

  const editorAuthInput = document.querySelector<HTMLTextAreaElement>("#editor-auth-json");
  editorAuthInput?.addEventListener("input", (event) => {
    state.editor.authJson = (event.currentTarget as HTMLTextAreaElement).value;
  });

  const editorConfigInput = document.querySelector<HTMLTextAreaElement>("#editor-config-toml");
  editorConfigInput?.addEventListener("input", (event) => {
    state.editor.configToml = (event.currentTarget as HTMLTextAreaElement).value;
  });

  document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.action;

      if (action === "refresh") {
        if (state.activeTab === "network") {
          await fetchNetworkProfiles();
        } else {
          await refreshSnapshot();
        }
      } else if (action === "tab-local") {
        state.activeTab = "local";
        render();
      } else if (action === "tab-network") {
        state.activeTab = "network";
        if (state.networkProfiles.length === 0) {
          await fetchNetworkProfiles();
        } else {
          render();
        }
      } else if (action === "download-and-apply" && button.dataset.id && button.dataset.name) {
        await downloadAndApplyNetworkProfile(button.dataset.id, button.dataset.name);
      } else if (action === "enable-codex-usage") {
        await setCodexUsageApiEnabled(true);
      } else if (action === "disable-codex-usage") {
        await setCodexUsageApiEnabled(false);
      } else if (action === "refresh-all-codex-usage") {
        await refreshAllCodexUsage();
      } else if (action === "refresh-codex-usage" && button.dataset.id && button.dataset.name) {
        await refreshProfileCodexUsage(button.dataset.id, button.dataset.name);
      } else if (action === "new-profile") {
        await openEditorForNewProfile();
      } else if (action === "view-profile-details" && button.dataset.id) {
        await openEditorForProfile(button.dataset.id);
      } else if (action === "switch" && button.dataset.id && button.dataset.name) {
        await switchProfile(button.dataset.id, button.dataset.name);
      } else if (action === "delete-profile" && button.dataset.id && button.dataset.name) {
        await deleteProfile(button.dataset.id, button.dataset.name);
      } else if (action === "back-to-cards") {
        state.view = "cards";
        render();
      } else if (action === "save-editor") {
        await saveEditorProfile(false);
      } else if (action === "save-and-switch") {
        await saveEditorProfile(true);
      } else if (action === "check-update") {
        await checkForUpdate();
      } else if (action === "restart-codex") {
        state.busy = true; render();
        try {
          await desktopInvoke("restart_codex");
          setFlash("success", "Codex 程序已被拉起重启指令！");
        } catch (error) {
          console.error("重启 Codex 失败", error);
          setFlash("error", "通过 AppleScript 触发重启失败，或者目标程序未执行！");
        } finally {
          state.busy = false; render();
        }
      }
    });
  });
}

render();
void loadAppVersion();
void refreshSnapshot();
