import re

with open("src/main.ts", "r") as f:
    content = f.read()

# 1. Update ViewMode
content = re.sub(
    r'type ViewMode = "cards" \| "editor";',
    'type ViewMode = "cards" | "editor" | "settings";',
    content
)

# 2. Update render() to include settings page and version display
render_func_pattern = re.compile(r'function render\(\): void \{.*?bindEvents\(\);\n\}', re.DOTALL)
new_render_func = """function render(): void {
  const snapshot = state.snapshot;

  let content = "";
  if (state.view === "cards" && snapshot) {
    content = renderCardsPage(snapshot);
  } else if (state.view === "settings") {
    content = renderSettingsPage();
  } else {
    content = renderEditorPage();
  }

  const hasPendingUpdate = state.update.lastResult?.hasUpdate ?? false;
  const currentVersionText = state.update.lastResult?.currentVersion ?? state.appVersion ?? "--";
  const updateVersionText = hasPendingUpdate
    ? `v${state.update.lastResult?.latestVersion ?? "--"}`
    : `v${currentVersionText}`;

  app.innerHTML = `
    <div class="app-layout">
      <aside class="app-sidebar">
        <div class="sidebar-header">
          <div class="app-logo">Codex Auth</div>
        </div>
        <nav class="sidebar-nav">
          <button class="nav-item ${state.view === 'cards' || state.view === 'editor' ? 'active' : ''}" data-action="nav-profiles">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            配置管理
          </button>
          <button class="nav-item ${state.view === 'settings' ? 'active' : ''}" data-action="nav-settings">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            全局设置
          </button>
        </nav>
        <div class="sidebar-footer">
          <button class="nav-item ${hasPendingUpdate ? 'version-update-entry-available' : ''}" data-action="check-update" style="display: flex; justify-content: space-between;">
            <div style="display:flex; align-items:center; gap: 12px;">
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.13 15.57a10 10 0 1 0 3.4-9.26L2.5 8"></path></svg>
              <span>检查更新</span>
            </div>
            <span style="font-size: 0.8rem; font-weight: bold; color: ${hasPendingUpdate ? 'var(--danger)' : 'var(--text-muted)'}">${updateVersionText}</span>
          </button>
        </div>
      </aside>
      <main class="app-main-content">
        ${content}
      </main>
    </div>
    ${renderBusyDialog()}
  `;

  bindEvents();
}

function renderSettingsPage(): string {
  const migratingLegacyThirdParty = isPendingAction(migrateLegacyThirdPartyActionKey);
  const anyUsageRefreshPending = isPendingActionPrefix("codex-usage");
  const isUsageEnabled = state.snapshot?.codexUsageApiEnabled ?? false;
  
  return `
    <section class="cards-page" data-page="settings">
      <header class="content-header" data-tauri-drag-region>
        <h2>全局设置</h2>
      </header>
      ${renderFlash()}
      
      <div class="grid-container" style="max-width: 600px;">
        <div class="card">
          <div class="card-head">
            <h3>数据迁移</h3>
          </div>
          <p class="card-note">将旧版本的第三方 API 配置迁移到新的配置格式。如果您之前有使用旧版配置，建议执行此操作。</p>
          <div class="content-actions" style="margin-top: 16px;">
            <button
              class="button button-secondary"
              data-action="migrate-legacy-third-party"
              ${state.busy || migratingLegacyThirdParty ? "disabled" : ""}
            >
              ${migratingLegacyThirdParty ? "迁移中..." : "迁移旧第三方配置"}
            </button>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>Codex 额度查询</h3>
          </div>
          <p class="card-note">全局启用或关闭 Codex 官方账号的用量与额度查询功能。</p>
          <div class="content-actions" style="margin-top: 16px;">
            ${
              isUsageEnabled
                ? `
                  <button class="button button-secondary" data-action="refresh-all-codex-usage" ${state.busy || anyUsageRefreshPending ? "disabled" : ""}>
                    ${isPendingAction(refreshAllUsageActionKey) ? "刷新中..." : "刷新全部额度"}
                  </button>
                  <button class="button button-ghost" data-action="disable-codex-usage" ${state.busy || anyUsageRefreshPending ? "disabled" : ""}>
                    关闭额度查询
                  </button>
                `
                : `
                  <button class="button button-secondary" data-action="enable-codex-usage" ${state.busy || anyUsageRefreshPending ? "disabled" : ""}>
                    启用 Codex 额度查询
                  </button>
                `
            }
          </div>
        </div>
      </div>
    </section>
  `;
}
"""
content = render_func_pattern.sub(new_render_func, content)

# 3. Completely remove renderSessionRecoveryPanel and related functions
functions_to_remove = [
    r'function renderSessionRecoveryPanel\(\): string \{[\s\S]*?\n\}',
    r'async function handleDiagnoseCodexSessions\(\)[\s\S]*?\n\}',
    r'async function handleRepairCodexSessions\(\)[\s\S]*?\n\}'
]

# Note: renderSessionRecoveryPanel calls other functions or is quite large. 
# We'll use a more precise regex to remove it.
# Actually, since it's a TST, let's just use re.sub with cautious pattern
panel_pattern = re.compile(r'function renderSessionRecoveryPanel\(\): string \{.*?(?=\nfunction |\nasync function |$)', re.DOTALL)
content = panel_pattern.sub('', content)

diag_pattern = re.compile(r'async function handleDiagnoseCodexSessions\(\): Promise<void> \{.*?(?=\nfunction |\nasync function |$)', re.DOTALL)
content = diag_pattern.sub('', content)

repair_pattern = re.compile(r'async function handleRepairCodexSessions\(\): Promise<void> \{.*?(?=\nfunction |\nasync function |$)', re.DOTALL)
content = repair_pattern.sub('', content)

# 4. Remove session recovery variables from state type and default state
content = re.sub(r'\s*sessionRecoveryExpanded:\s*boolean;', '', content)
content = re.sub(r'\s*sessionRecoveryReport:\s*SessionRecoveryReport\s*\|\s*null;', '', content)
content = re.sub(r'\s*sessionRecoveryLastResult:\s*SessionRepairResult\s*\|\s*null;', '', content)

content = re.sub(r'\s*sessionRecoveryExpanded:\s*false,', '', content)
content = re.sub(r'\s*sessionRecoveryReport:\s*null,', '', content)
content = re.sub(r'\s*sessionRecoveryLastResult:\s*null,', '', content)

# Remove the action keys
content = re.sub(r'const diagnoseCodexSessionsActionKey = "session-recovery:diagnose";\n', '', content)
content = re.sub(r'const repairCodexSessionsActionKey = "session-recovery:repair";\n', '', content)

# Also remove related click handlers in handleAppClick
content = re.sub(r'\} else if \(action === "nav-profiles"\) \{[\s\S]*?\} else if ', '} else if ', content) # Just in case
# We need to add our new nav click handlers
click_handlers = """
      } else if (action === "nav-profiles") {
        state.view = "cards";
        render();
      } else if (action === "nav-settings") {
        state.view = "settings";
        render();
"""
content = re.sub(r'\} else if \(action === "tab-local"\) \{', click_handlers + '} else if (action === "tab-local") {', content)

# Remove the old click handlers for session recovery
content = re.sub(r'\} else if \(action === "toggle-session-recovery-panel"\) \{[\s\S]*?render\(\);\n', '', content)
content = re.sub(r'\} else if \(action === "diagnose-codex-sessions"\) \{[\s\S]*?else if', '} else if', content)
content = re.sub(r'\} else if \(action === "repair-codex-sessions"\) \{[\s\S]*?else if', '} else if', content)


with open("src/main.ts", "w") as f:
    f.write(content)
print("done")
