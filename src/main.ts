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
    setFlash("success", `已切换到 ${profileName}`);
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    render();
  }
}

async function restartCodex(): Promise<void> {
  setBusy(true);
  try {
    await desktopInvoke("restart_codex");
    setFlash("success", "Codex.app 已开始重启。");
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

async function openEditorForCurrentConfig(): Promise<void> {
  if (!isTauriRuntime) {
    state.editor = createEditorFromInput("fromCurrent", createMockCurrentInput());
    state.view = "editor";
    render();
    return;
  }

  setBusy(true);
  try {
    const input = await desktopInvoke<ProfileInput>("get_target_profile_input");
    state.editor = createEditorFromInput("fromCurrent", input);
    state.view = "editor";
    clearFlash();
  } catch (error) {
    setFlash("error", error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    render();
  }
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
  const currentConfigNote = snapshot.targetAuthExists && snapshot.targetConfigExists
    ? activeProfile
      ? `当前 Codex 正在使用已保存的 profile「${activeProfile.name}」。`
      : "当前目录里检测到了 auth.json 与 config.toml，可以保存为新的 profile。"
    : "当前目录里还没有同时检测到 auth.json 和 config.toml。";

  return `
    <section class="cards-page" data-page="cards">
      <div class="cards-toolbar">
        <button
          class="button button-ghost"
          data-role="global-refresh"
          data-action="refresh"
          ${state.busy ? "disabled" : ""}
        >
          刷新状态
        </button>
        <button
          class="button button-ghost"
          data-role="global-restart"
          data-action="restart-codex"
          ${state.busy ? "disabled" : ""}
        >
          重启 Codex
        </button>
      </div>

      ${renderFlash()}

      <section class="card-grid">
        <button class="card add-card" data-role="add-card" data-action="new-profile" ${state.busy ? "disabled" : ""}>
          <span class="add-card-mark">+</span>
          <strong>添加 Profile</strong>
          <p>手动填写名称、备注、auth.json 和 config.toml。</p>
        </button>

        <article class="card profile-card current-config-card" data-role="current-config-card">
          <div class="card-head">
            <div>
              <p class="card-kicker">Current Codex</p>
              <h2>当前 Codex 配置</h2>
            </div>
            <div class="card-badges">
              ${snapshot.targetAuthTypeLabel ? `<span class="pill pill-type">${escapeHtml(snapshot.targetAuthTypeLabel)}</span>` : ""}
              ${activeProfile ? `<span class="pill pill-active">当前生效</span>` : ""}
            </div>
          </div>
          <p class="card-note">${escapeHtml(currentConfigNote)}</p>
          <p class="card-date">更新时间：${formatDateTime(snapshot.targetUpdatedAt)}</p>
          <div class="card-actions">
            <button
              class="button button-secondary"
              data-action="save-current-as-profile"
              ${state.busy || !snapshot.targetAuthExists || !snapshot.targetConfigExists ? "disabled" : ""}
            >
              保存为 Profile
            </button>
          </div>
        </article>

        ${snapshot.profiles
          .map(
            (profile) => `
              <article
                class="card profile-card ${snapshot.activeProfileId === profile.id ? "profile-card-live" : ""}"
                data-role="profile-card"
                data-state="${snapshot.activeProfileId === profile.id ? "live" : "idle"}"
              >
                <div class="card-head">
                  <div>
                    <p class="card-kicker">Saved Profile</p>
                    <h2>${escapeHtml(profile.name)}</h2>
                  </div>
                  <div class="card-badges">
                    <span class="pill pill-type">${escapeHtml(profile.authTypeLabel)}</span>
                    ${snapshot.activeProfileId === profile.id ? `<span class="pill pill-active">当前生效</span>` : ""}
                  </div>
                </div>
                <p class="card-note">${escapeHtml(profile.notes || "没有备注")}</p>
                <p class="card-date">更新时间：${formatDateTime(profile.updatedAt)}</p>
                <div class="card-actions">
                  <button
                    class="button ${snapshot.activeProfileId === profile.id ? "button-secondary" : "button-primary"}"
                    data-action="switch"
                    data-id="${profile.id}"
                    data-name="${escapeHtml(profile.name)}"
                    ${state.busy ? "disabled" : ""}
                  >
                    ${snapshot.activeProfileId === profile.id ? "当前已生效" : "切换到当前"}
                  </button>
                  <button
                    class="button button-ghost"
                    data-action="view-profile-details"
                    data-id="${profile.id}"
                    ${state.busy ? "disabled" : ""}
                  >
                    查看详情
                  </button>
                </div>
              </article>
            `,
          )
          .join("")}
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
            返回卡片页
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
                  保存修改
                </button>
              `
              : `
                <button class="button button-secondary" data-action="save-editor" ${state.busy ? "disabled" : ""}>
                  创建 Profile
                </button>
              `
          }
          <button class="button button-primary" data-action="save-and-switch" ${state.busy ? "disabled" : ""}>
            ${existing ? "保存并切换" : "创建并切换"}
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
      } else if (action === "save-current-as-profile") {
        await openEditorForCurrentConfig();
      } else if (action === "restart-codex") {
        await restartCodex();
      } else if (action === "view-profile-details" && button.dataset.id) {
        await openEditorForProfile(button.dataset.id);
      } else if (action === "switch" && button.dataset.id && button.dataset.name) {
        await switchProfile(button.dataset.id, button.dataset.name);
      } else if (action === "back-to-cards") {
        state.view = "cards";
        render();
      } else if (action === "save-editor") {
        await saveEditorProfile(false);
      } else if (action === "save-and-switch") {
        await saveEditorProfile(true);
      }
    });
  });
}

render();
void refreshSnapshot();
