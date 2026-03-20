import { invoke } from "@tauri-apps/api/core";
import "./styles.css";

type FlashKind = "info" | "success" | "error";
type ViewMode = "cards" | "editor";
type EditorMode = "new" | "fromCurrent" | "existing";

type ProfileSummary = {
  id: string;
  name: string;
  notes: string;
  authTypeLabel: string;
  createdAt: string;
  updatedAt: string;
  authHash: string;
  configHash: string;
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
  profiles: ProfileSummary[];
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
} = {
  snapshot: null,
  view: "cards",
  selectedProfileId: null,
  editor: createEditorState(),
  busy: false,
  flash: null,
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

function nativeConfirm(msg: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;transition:all 0.2s;";
    const box = document.createElement("div");
    box.style.cssText = "background:var(--bg-panel);border:1px solid var(--border);padding:28px 32px;border-radius:24px;box-shadow:var(--shadow-lg);max-width:320px;text-align:center;color:var(--text-main);transform:scale(0.95);animation:zoomIn 0.2s forwards;";
    box.innerHTML = `<style>@keyframes zoomIn { to { transform: scale(1); } }</style>
      <h3 style="margin:0 0 12px;font-size:1.2rem;">安全确认</h3>
      <p style="margin:0 0 24px;color:var(--text-muted);font-size:0.95rem;line-height:1.5;">${escapeHtml(msg)}</p>
      <div style="display:flex;gap:12px;justify-content:center;">
        <button id="btn-cancel" style="flex:1;padding:10px;border:none;border-radius:12px;background:var(--bg-page);color:var(--text-main);cursor:pointer;font-weight:600;border:1px solid var(--border);">手滑了</button>
        <button id="btn-ok" style="flex:1;padding:10px;border:none;border-radius:12px;background:var(--danger);color:white;cursor:pointer;font-weight:600;box-shadow:0 4px 12px rgba(239,68,68,0.2);">彻底销毁</button>
      </div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    
    document.getElementById("btn-cancel")!.onclick = () => { document.body.removeChild(overlay); resolve(false); };
    document.getElementById("btn-ok")!.onclick = () => { document.body.removeChild(overlay); resolve(true); };
  });
}

async function deleteProfile(profileId: string, profileName: string): Promise<void> {
  const confirmed = window.confirm(`确定要销毁「${profileName}」档案吗？此操作无法撤回！`);
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



function formatDateTime(value: string | null): string {
  if (!value) {
    return "还没有";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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

  return `
    <section class="cards-page" data-page="cards">
      <header class="top-nav" data-tauri-drag-region>
        <div>
          <h1>Codex Auth Switch</h1>
          <p>统一管理与快速分发您的环境代理和身份配置。</p>
        </div>
        <div class="top-nav-actions">
          <button class="icon-button" title="刷新状态" data-role="global-refresh" data-action="refresh" ${state.busy ? "disabled" : ""}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
          </button>
        </div>
      </header>

      ${renderFlash()}

      <section class="grid-container">
        <h3 class="section-title">已保存的配置文件 (${snapshot.profiles.length})</h3>
        <div class="card-grid">
          <button class="card add-profile-card" data-role="add-card" data-action="new-profile" ${state.busy ? "disabled" : ""}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            加配置
          </button>
          <article class="card current-config-card" data-role="current-config-card">
            <div class="card-head">
              <h2>${activeProfile ? escapeHtml(activeProfile.name) : "未知配置"}</h2>
              ${activeProfile ? `<span class="pill pill-type">${escapeHtml(activeProfile.authTypeLabel)}</span>` : ""}
            </div>
            <p class="card-note">${
              snapshot.targetAuthExists && snapshot.targetConfigExists
                ? activeProfile
                  ? escapeHtml(`目前系统正在平稳运行「${activeProfile.name}」身份配置档案。`)
                  : "检测到当前系统的 auth.json 与 config.toml 文件尚未在合集中备份。"
                : "在当前目录中未检测到完整的 Codex 配置文件。"
            }</p>
          </article>
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
                  ${snapshot.activeProfileId === profile.id ? `<div class="card-glow"></div>` : ""}
                  <div class="card-head">
                    <h2>${escapeHtml(profile.name)}</h2>
                    <span class="pill pill-type">${escapeHtml(profile.authTypeLabel)}</span>
                  </div>
                  <p class="card-note" style="${!profile.notes ? 'opacity:0.5;font-style:italic;' : ''}">${escapeHtml(profile.notes || "暂无备注")}</p>
                  <p class="card-date">更新于：${formatDateTime(profile.updatedAt)}</p>
                  
                  <div class="card-actions-overlay">
                    <button
                      class="button ${snapshot.activeProfileId === profile.id ? "button-active" : "button-secondary"}"
                      data-action="switch"
                      data-id="${profile.id}"
                      data-name="${escapeHtml(profile.name)}"
                      ${state.busy ? "disabled" : ""}
                    >
                      ${snapshot.activeProfileId === profile.id ? "当前运行中" : "应用此配置"}
                    </button>
                    <div class="card-secondary-actions">
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
              `,
            )
            .join("")}
        </div>
      </section>
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
        await refreshSnapshot();
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
void refreshSnapshot();
