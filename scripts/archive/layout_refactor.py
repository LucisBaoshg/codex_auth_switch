import re

def refactor_main_ts():
    with open('src/main.ts', 'r') as f:
        content = f.read()
    
    # 1. Update render() function
    render_func_pattern = re.compile(r'function render\(\): void \{.*?bindEvents\(\);\n\}', re.DOTALL)
    
    new_render_func = """function render(): void {
  const snapshot = state.snapshot;

  let content = "";
  if (state.view === "cards" && snapshot) {
    content = renderCardsPage(snapshot);
  } else {
    content = renderEditorPage();
  }

  app.innerHTML = `
    <div class="app-layout">
      <aside class="app-sidebar">
        <div class="sidebar-header">
          <div class="app-logo">Codex Auth</div>
        </div>
        <nav class="sidebar-nav">
          <button class="nav-item ${state.view === 'cards' ? 'active' : ''}" data-action="nav-profiles">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            配置管理
          </button>
        </nav>
        <div class="sidebar-footer">
          <button class="nav-item" data-action="check-update">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.13 15.57a10 10 0 1 0 3.4-9.26L2.5 8"></path></svg>
            检查更新
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
}"""
    content = render_func_pattern.sub(new_render_func, content)
    
    # 2. Update renderCardsPage to remove the top-nav and reorganize actions
    # Find the top-nav header and replace it with just the tabs and actions
    cards_page_pattern = re.compile(r'<header class="top-nav" data-tauri-drag-region>.*?</header>', re.DOTALL)
    
    new_header = """<header class="content-header" data-tauri-drag-region>
        <div class="tabs">
          <button class="tab-button ${state.activeTab === 'local' ? 'active' : ''}" data-action="tab-local">本地档案</button>
          <button class="tab-button ${state.activeTab === 'network' ? 'active' : ''}" data-action="tab-network">网络共享库</button>
        </div>
        <div class="content-actions">
          <button class="button button-primary" data-action="new-profile">+ 新建配置</button>
          <button class="icon-button section-refresh-button" title="刷新状态" data-role="global-refresh" data-action="refresh" ${state.busy ? "disabled" : ""}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
          </button>
        </div>
      </header>"""
    content = cards_page_pattern.sub(new_header, content)

    # Remove the old tabs div that was rendered below the header
    old_tabs_pattern = re.compile(r'<div class="tabs">\s*<button.*?🏠 本地档案</button>\s*<button.*?☁️ 网络共享库</button>\s*</div>', re.DOTALL)
    content = old_tabs_pattern.sub('', content)

    # 3. Clean up the section actions (remove migrate legacy, codex usage, etc)
    section_actions_pattern = re.compile(r'<div class="section-actions">\s*\$\{renderProfileLayoutToggle\(\)\}.*?<button class="icon-button section-refresh-button" title="刷新状态" data-role="global-refresh" data-action="refresh" \$\{state\.busy \? "disabled" : ""\}>\s*<svg.*?</svg>\s*</button>\s*</div>', re.DOTALL)
    new_section_actions = """<div class="section-actions">
            ${renderProfileLayoutToggle()}
          </div>"""
    content = section_actions_pattern.sub(new_section_actions, content)

    # 4. Remove the "+ 加配置" card/row from the list
    add_row_pattern = re.compile(r'^\s*<div class="profile-row profile-row-add" data-action="new-profile">.*?</div>\n', re.MULTILINE | re.DOTALL)
    content = add_row_pattern.sub('', content)
    add_card_pattern = re.compile(r'^\s*<div class="card add-profile-card" data-action="new-profile">.*?</div>\n', re.MULTILINE | re.DOTALL)
    content = add_card_pattern.sub('', content)

    with open('src/main.ts', 'w') as f:
        f.write(content)

def refactor_styles_css():
    with open('src/styles.css', 'r') as f:
        content = f.read()
    
    # Replace .app-shell with .app-layout
    app_layout_css = """
/* App Layout */
.app-layout {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.app-sidebar {
  width: 260px;
  background-color: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  z-index: 10;
}

.sidebar-header {
  padding: 24px;
  border-bottom: 1px solid var(--border-light);
}

.app-logo {
  font-size: 1.25rem;
  font-weight: 800;
  color: var(--text-main);
  letter-spacing: -0.02em;
}

.sidebar-nav {
  flex: 1;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sidebar-footer {
  padding: 16px 12px;
  border-top: 1px solid var(--border-light);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  width: 100%;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
}

.nav-item:hover {
  background-color: var(--border-light);
  color: var(--text-main);
}

.nav-item.active {
  background-color: var(--accent);
  color: white;
}

.app-main-content {
  flex: 1;
  overflow-y: auto;
  padding: 32px 48px;
  background-color: var(--bg-page);
}

.content-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 32px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-light);
}

.content-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
"""
    content = re.sub(r'\.app-shell \{.*?\}', app_layout_css, content, flags=re.DOTALL)
    
    with open('src/styles.css', 'w') as f:
        f.write(content)

if __name__ == '__main__':
    refactor_main_ts()
    refactor_styles_css()
    print("Refactor complete.")
