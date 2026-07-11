import re

with open("src/main.ts", "r") as f:
    content = f.read()

# 1. Remove Antigravity imports
content = re.sub(r'import\s+\{.*?(?:Antigravity|antigravity).*?\}\s+from\s+"./antigravity";\n?', '', content, flags=re.DOTALL)

# 2. Update PlatformMode
content = re.sub(r'type PlatformMode = "codex" \| "antigravity";', 'type PlatformMode = "codex";', content)

# 3. Remove mockAntigravitySnapshot
content = re.sub(r'const mockAntigravitySnapshot.*?};\n', '', content, flags=re.DOTALL)

# 4. Remove antigravitySnapshot from state
content = re.sub(r'\s*antigravitySnapshot:\s*AntigravitySnapshot\s*\|\s*null;', '', content)
content = re.sub(r'\s*antigravitySnapshot:\s*null,', '', content)

# 5. Remove antigravity functions
functions_to_remove = [
    r'async function fetchAntigravitySnapshot\(\)[\s\S]*?\n\}',
    r'async function refreshAntigravitySnapshot\(\)[\s\S]*?\n\}',
    r'async function handleImportCurrentAntigravity\(\)[\s\S]*?\n\}',
    r'async function handleSwitchAntigravityProfile\([\s\S]*?\n\}',
    r'async function handleRestoreAntigravityBackup\(\)[\s\S]*?\n\}',
    r'async function handleRevealAntigravitySource\(\)[\s\S]*?\n\}',
    r'function renderAntigravityPage\(\)[\s\S]*?\n\}',
    r'function renderPlatformTabs\(\)[\s\S]*?\n\}'
]
for f_regex in functions_to_remove:
    content = re.sub(f_regex, '', content)

# 6. Remove platform tabs from renderApp
content = re.sub(r'\$\{renderPlatformTabs\(\)\}', '', content)
content = re.sub(r'if \(state\.platform === "antigravity"\) \{[\s\S]*?\} else \{([\s\S]*?)\}', r'\1', content)

# 7. Remove click handlers for antigravity
content = re.sub(r'if \(\w+\.dataset\.platform\) \{[\s\S]*?\}\n\n', '', content)
content = re.sub(r'if \(action === "import-current-antigravity"\) \{[\s\S]*?\} else ', '', content)
content = re.sub(r'if \(action === "switch-antigravity"\) \{[\s\S]*?\} else ', '', content)
content = re.sub(r'if \(action === "restore-antigravity-backup"\) \{[\s\S]*?\} else ', '', content)
content = re.sub(r'if \(action === "reveal-antigravity-source"\) \{[\s\S]*?\} else ', '', content)

# 8. Remove 高级修复 (Advanced Repair)
# Find the section in renderSessionRecoveryReport
content = re.sub(r'<div class="action-card warning-card">[\s\S]*?<strong>高级会话工具</strong>[\s\S]*?</div>', '', content)
# Find the handler handleRepairCodexSessionsAdvanced
content = re.sub(r'async function handleRepairCodexSessionsAdvanced\(\)[\s\S]*?\n\}', '', content)
content = re.sub(r'if \(action === "repair-codex-sessions-advanced"\) \{[\s\S]*?\} else ', '', content)
content = re.sub(r'const repairCodexSessionsAdvancedActionKey = "session-recovery:repair-times";\n', '', content)

with open("src/main.ts", "w") as f:
    f.write(content)

print("Done")
