# Corrupt Config Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让所有启动关键配置损坏时应用仍能启动、隔离应用管理的坏文件，并通过一次性弹框告知用户恢复结果和下一步操作。

**Architecture:** 新建独立的 Rust 配置恢复模块，负责恢复事件、隔离目录、待确认日志和原子 JSON 写入；`ProfileManager` 将启动快照改为宽容扫描，并把有效档案与恢复事件一起返回。Tauri 层用进程内状态桥接启动钩子和前端首次快照，TypeScript 层用专用安全渲染弹框展示和确认事件。

**Tech Stack:** Rust 2021、Serde、Tauri 2、TypeScript、Vitest、JSDOM。

---

## 文件结构

- Create: `src-tauri/src/core/config_recovery.rs` — 恢复事件模型、隔离、待确认日志、原子写入和目录打开。
- Modify: `src-tauri/src/core/mod.rs` — `ProfileManager` 的宽容状态载入、档案扫描、活动配置检查和快照输出。
- Modify: `src-tauri/src/lib.rs` — 启动事件进程内桥接、确认与打开恢复目录命令。
- Modify: `src-tauri/tests/profile_manager_tests.rs` — 截图场景和其他启动关键文件的 Rust 回归测试。
- Modify: `src/desktop-types.ts` — 前端恢复事件数据契约。
- Modify: `src/app-preview-data.ts` — 浏览器预览快照补齐空恢复事件。
- Modify: `src/app-chrome-renderers.ts` — 专用恢复弹框的安全 HTML 渲染。
- Modify: `src/app-chrome-dialogs.ts` — 恢复弹框的 DOM 生命周期与结果类型。
- Modify: `src/main.ts` — 快照触发、去重、打开目录和确认事件。
- Modify: `tests/app-chrome-renderers.test.ts` — 恢复弹框渲染测试。
- Modify: `tests/app-chrome-dialogs.test.ts` — 恢复弹框按钮和不可静默关闭测试。
- Modify: `tests/sidebar-layout.test.ts` — Tauri 命令集成测试。

### Task 1: Rust 恢复基础设施

**Files:**
- Create: `src-tauri/src/core/config_recovery.rs`
- Modify: `src-tauri/src/core/mod.rs:1-35`

- [x] **Step 1: 写入失败测试**

先创建 `config_recovery.rs`，只放测试模块；测试固定恢复事件去重、损坏文件隔离和原子写入：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn notice(id: &str) -> ConfigRecoveryNotice {
        ConfigRecoveryNotice {
            id: id.into(),
            kind: ConfigRecoveryKind::State,
            source_path: "/tmp/state.json".into(),
            recovery_path: None,
            profile_id: None,
            summary: "state.json 损坏".into(),
            action: "检查目标目录".into(),
            occurred_at: Utc::now(),
        }
    }

    #[test]
    fn pending_notice_log_deduplicates_by_id_and_can_acknowledge_selected_items() {
        let app_dir = TempDir::new().unwrap();
        let first = notice("same");
        let second = notice("same");
        record_pending_notices(app_dir.path(), &[first, second]);
        assert_eq!(read_pending_notices(app_dir.path()).len(), 1);
        acknowledge_pending_notices(app_dir.path(), &["same".into()]).unwrap();
        assert!(read_pending_notices(app_dir.path()).is_empty());
    }

    #[test]
    fn quarantine_preserves_the_exact_corrupt_bytes() {
        let app_dir = TempDir::new().unwrap();
        let source = app_dir.path().join("meta.json");
        std::fs::write(&source, [0_u8; 32]).unwrap();
        let recovered = quarantine_corrupt_file(app_dir.path(), &source, "profile-1/meta").unwrap();
        assert!(!source.exists());
        assert_eq!(std::fs::read(recovered).unwrap(), vec![0_u8; 32]);
    }

    #[test]
    fn atomic_json_write_leaves_a_parseable_target_without_temp_files() {
        let app_dir = TempDir::new().unwrap();
        let target = app_dir.path().join("state.json");
        atomic_write_json(&target, &serde_json::json!({"targetDir": "one"})).unwrap();
        atomic_write_json(&target, &serde_json::json!({"targetDir": "two"})).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&target).unwrap()).unwrap();
        assert_eq!(value["targetDir"], "two");
        assert_eq!(std::fs::read_dir(app_dir.path()).unwrap().count(), 1);
    }
}
```

- [x] **Step 2: 运行测试并确认按预期失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml config_recovery::tests -- --nocapture`

Expected: FAIL，错误包含 `cannot find type ConfigRecoveryNotice` 或 `cannot find function atomic_write_json`。

- [x] **Step 3: 实现最小恢复模块**

在 `core/mod.rs` 加入 `mod config_recovery;` 和公开导出，然后在新模块实现以下契约：

```rust
use super::AppError;
use chrono::{DateTime, Utc};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConfigRecoveryKind {
    State,
    ProfileMetadata,
    TargetMarker,
    TargetAuth,
    TargetConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigRecoveryNotice {
    pub id: String,
    pub kind: ConfigRecoveryKind,
    pub source_path: String,
    pub recovery_path: Option<String>,
    pub profile_id: Option<String>,
    pub summary: String,
    pub action: String,
    pub occurred_at: DateTime<Utc>,
}

pub(super) fn atomic_write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError>;
pub(super) fn read_pending_notices(app_data_dir: &Path) -> Vec<ConfigRecoveryNotice>;
pub(super) fn record_pending_notices(app_data_dir: &Path, notices: &[ConfigRecoveryNotice]);
pub(super) fn acknowledge_pending_notices(
    app_data_dir: &Path,
    notice_ids: &[String],
) -> Result<(), AppError>;
pub(super) fn merge_recovery_notices(
    first: Vec<ConfigRecoveryNotice>,
    second: Vec<ConfigRecoveryNotice>,
) -> Vec<ConfigRecoveryNotice>;
pub(super) fn quarantine_corrupt_file(
    app_data_dir: &Path,
    source: &Path,
    recovery_stem: &str,
) -> Result<PathBuf, AppError>;
pub(super) fn stable_invalid_file_notice(
    kind: ConfigRecoveryKind,
    path: &Path,
    contents: &[u8],
    summary: String,
    action: String,
) -> ConfigRecoveryNotice;
```

临时文件名使用 `.<filename>.<uuid>.tmp`，写完调用 `sync_all`。Unix 用同目录 `rename` 覆盖；Windows 在唯一备份名下保留旧目标，完成替换后删除备份，替换失败时恢复旧目标。待确认日志固定为 `recovery/pending-notices.json`，读取损坏日志时返回空列表而不是传播错误。

- [x] **Step 4: 运行模块测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml config_recovery::tests -- --nocapture`

Expected: 3 tests PASS。

- [x] **Step 5: 提交基础设施**

```bash
git add src-tauri/src/core/config_recovery.rs src-tauri/src/core/mod.rs
git commit -m "feat: add config recovery storage"
```

### Task 2: 恢复损坏的 state.json 与 meta.json

**Files:**
- Modify: `src-tauri/tests/profile_manager_tests.rs`
- Modify: `src-tauri/tests/menu_bar_tests.rs`
- Modify: `src-tauri/src/core/mod.rs:797-878,2552-2585,2808-2853`

- [x] **Step 1: 写入 state.json 失败测试**

```rust
#[test]
fn load_or_default_quarantines_corrupt_state_and_keeps_running() {
    let (app_dir, _target_dir, _manager) = temp_manager();
    fs::write(app_dir.path().join("state.json"), vec![0_u8; 64]).unwrap();

    let reloaded = ProfileManager::load_or_default(app_dir.path().to_path_buf())
        .expect("corrupt state must not stop startup");
    let notices = reloaded.pending_config_recovery_notices();

    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].kind, ConfigRecoveryKind::State);
    assert!(Path::new(notices[0].recovery_path.as_deref().unwrap()).exists());
    serde_json::from_str::<serde_json::Value>(
        &fs::read_to_string(app_dir.path().join("state.json")).unwrap(),
    ).expect("replacement state must be valid json");
}
```

- [x] **Step 2: 运行单测确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test profile_manager_tests load_or_default_quarantines_corrupt_state_and_keeps_running -- --nocapture`

Expected: FAIL，当前返回 `Failed to process JSON data`。

- [x] **Step 3: 实现宽容 state.json 载入**

给 `ProfileManager` 增加 `startup_recovery_notices: Vec<ConfigRecoveryNotice>`，并在 `new` 中初始化为空列表。`load_or_default` 将读取分成不存在、读取失败、解析失败和成功四路：解析失败才隔离，读取失败只生成告警；隔离成功后才原子写入默认状态。新增：

```rust
pub fn pending_config_recovery_notices(&self) -> Vec<ConfigRecoveryNotice> {
    merge_recovery_notices(
        self.startup_recovery_notices.clone(),
        read_pending_notices(&self.app_data_dir),
    )
}

pub fn acknowledge_config_recovery(&self, notice_ids: &[String]) -> Result<(), AppError> {
    acknowledge_pending_notices(&self.app_data_dir, notice_ids)
}
```

`persist_state` 改用 `atomic_write_json(self.state_path(), &self.state)`。

- [x] **Step 4: 运行 state.json 单测**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test profile_manager_tests load_or_default_quarantines_corrupt_state_and_keeps_running -- --nocapture`

Expected: PASS。

- [x] **Step 5: 写入空字节 meta.json 失败测试**

```rust
fn recovery_profile_input(name: &str, api_key: &str) -> ProfileInput {
    ProfileInput {
        name: name.into(),
        notes: String::new(),
        auth_json: api_key_auth_json(api_key),
        config_toml: third_party_config_toml("gpt-5"),
    }
}

#[test]
fn snapshot_quarantines_nul_filled_metadata_and_keeps_valid_profiles() {
    let (app_dir, _target_dir, manager) = temp_manager();
    let broken = manager.import_profile(recovery_profile_input("Broken", "sk-broken")).unwrap();
    let valid = manager.import_profile(recovery_profile_input("Valid", "sk-valid")).unwrap();
    let broken_dir = app_dir.path().join("profiles").join(&broken.id);
    let saved_auth = fs::read(broken_dir.join("auth.json")).unwrap();
    let saved_config = fs::read(broken_dir.join("config.toml")).unwrap();
    fs::write(broken_dir.join("meta.json"), vec![0_u8; 1342]).unwrap();

    let snapshot = manager.snapshot().expect("bad metadata must be isolated");

    assert_eq!(snapshot.profiles.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), vec![valid.id]);
    assert_eq!(snapshot.config_recovery_notices.len(), 1);
    assert_eq!(fs::read(broken_dir.join("auth.json")).unwrap(), saved_auth);
    assert_eq!(fs::read(broken_dir.join("config.toml")).unwrap(), saved_config);
    assert!(!broken_dir.join("meta.json").exists());
}
```

- [x] **Step 6: 运行 meta.json 单测确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test profile_manager_tests snapshot_quarantines_nul_filled_metadata_and_keeps_valid_profiles -- --nocapture`

Expected: FAIL，当前 `snapshot()` 返回 JSON 解析错误。

- [x] **Step 7: 实现统一宽容档案扫描**

实现私有 `collect_profiles_with_recovery() -> Result<(Vec<ProfileSummary>, Vec<ConfigRecoveryNotice>), AppError>`：成功解析的元数据加入结果；解析失败的 `meta.json` 被隔离并记录；读取失败只记录并跳过；缺少元数据继续沿用现有静默跳过。`list_profiles` 只返回元组第一项，`snapshot` 先扫描一次并把同一列表传入 `detect_active_profile_from_profiles`，避免二次扫描提前吞掉恢复事件。

`AppSnapshot` 增加：

```rust
#[serde(default)]
pub config_recovery_notices: Vec<ConfigRecoveryNotice>,
```

同时给 `src-tauri/tests/menu_bar_tests.rs` 中的 `AppSnapshot` 基础构造器补上 `config_recovery_notices: Vec::new()`；其余使用结构体更新语法的测试自动继承该字段。

- [x] **Step 8: 增加不重复备份测试并运行目标测试**

第二次调用 `snapshot()`，断言恢复目录中的 `meta.corrupt-*` 数量仍为 1，且持久化待确认事件仍只有一个。

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test profile_manager_tests quarantines -- --nocapture`

Expected: 相关测试 PASS。

- [x] **Step 9: 提交 state/meta 恢复**

```bash
git add src-tauri/src/core/mod.rs src-tauri/tests/profile_manager_tests.rs src-tauri/tests/menu_bar_tests.rs
git commit -m "fix: recover corrupt profile metadata"
```

### Task 3: 覆盖活动标记与 Codex 配置损坏

**Files:**
- Modify: `src-tauri/tests/profile_manager_tests.rs`
- Modify: `src-tauri/src/core/mod.rs:2552-2585,2798-2824,3258-3270`

- [x] **Step 1: 写入损坏标记回归测试**

```rust
#[test]
fn snapshot_quarantines_corrupt_target_marker_and_detects_profile_by_hash() {
    let (_app_dir, target_dir, mut manager) = temp_manager();
    let profile = manager.import_profile(recovery_profile_input("Current", "sk-current")).unwrap();
    manager.switch_profile(&profile.id).unwrap();
    fs::write(target_dir.path().join("codex-auth-switch.json"), b"\0\0\0").unwrap();

    let snapshot = manager.snapshot().expect("bad marker must not stop snapshot");

    assert_eq!(snapshot.active_profile_id.as_deref(), Some(profile.id.as_str()));
    assert!(snapshot.config_recovery_notices.iter().any(|n| n.kind == ConfigRecoveryKind::TargetMarker));
}
```

- [x] **Step 2: 写入无效活动配置回归测试**

```rust
#[test]
fn snapshot_reports_invalid_live_auth_without_modifying_it() {
    let (_app_dir, target_dir, manager) = temp_manager();
    fs::write(target_dir.path().join("auth.json"), "{broken").unwrap();
    fs::write(target_dir.path().join("config.toml"), official_config_toml("gpt-5")).unwrap();

    let snapshot = manager.snapshot().expect("bad live auth must degrade to unknown");

    assert_eq!(snapshot.active_profile_id, None);
    assert_eq!(snapshot.target_auth_type_label, None);
    assert_eq!(fs::read_to_string(target_dir.path().join("auth.json")).unwrap(), "{broken");
    assert!(snapshot.config_recovery_notices.iter().any(|n| n.kind == ConfigRecoveryKind::TargetAuth));
}
```

另加同形的无效 `config.toml` 测试，期望 `TargetConfig`。

- [x] **Step 3: 运行三项测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test profile_manager_tests 'snapshot_quarantines_corrupt_target_marker|snapshot_reports_invalid_live' -- --nocapture`

Expected: FAIL，当前快照传播 JSON/TOML 错误。

- [x] **Step 4: 实现活动配置预检和标记隔离**

增加 `inspect_target_config`，读取存在的活动文件后先调用 `validate_auth_json` 和 `validate_config_toml`。无效时用文件路径和 SHA-256 内容指纹构造稳定事件，并返回未知活动状态；不要移动或写回文件。有效时才计算哈希、识别档案和认证类型。

保留操作命令使用的严格 `read_target_marker`，另加启动快照专用的 `read_target_marker_with_recovery(&mut notices)`；解析失败时隔离到应用恢复目录后按 `None` 继续，使档案哈希匹配仍能工作。这样不会扩大非启动操作的错误语义。

- [x] **Step 5: 运行所有配置恢复 Rust 测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test profile_manager_tests snapshot_ -- --nocapture`

Expected: 新增测试和既有 snapshot 测试全部 PASS。

- [x] **Step 6: 提交活动配置恢复**

```bash
git add src-tauri/src/core/mod.rs src-tauri/tests/profile_manager_tests.rs
git commit -m "fix: tolerate invalid active Codex config"
```

### Task 4: Tauri 启动桥接与恢复命令

**Files:**
- Modify: `src-tauri/src/lib.rs:1-70,595-700`
- Modify: `src-tauri/src/core/config_recovery.rs`

- [x] **Step 1: 写入纯函数失败测试**

在 `lib.rs` 的 `#[cfg(test)]` 模块测试进程内与快照事件按 ID 合并，以及确认后只移除指定 ID：

```rust
#[test]
fn merge_pending_recovery_notices_is_stable_and_deduplicated() {
    let state = PendingConfigRecoveryState::from_notices(vec![notice("one"), notice("two")]);
    let merged = state.merge(vec![notice("two"), notice("three")]);
    assert_eq!(merged.iter().map(|n| n.id.as_str()).collect::<Vec<_>>(), vec!["one", "two", "three"]);
    state.remove(&["two".into()]);
    assert_eq!(state.ids(), vec!["one", "three"]);
}
```

- [x] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml merge_pending_recovery_notices_is_stable_and_deduplicated -- --nocapture`

Expected: FAIL，`PendingConfigRecoveryState` 尚不存在。

- [x] **Step 3: 实现桥接与命令**

实现：

```rust
#[derive(Default)]
struct PendingConfigRecoveryState(std::sync::Mutex<Vec<ConfigRecoveryNotice>>);

#[tauri::command]
fn acknowledge_config_recovery(app: AppHandle, notice_ids: Vec<String>) -> Result<(), String>;

#[tauri::command]
fn open_config_recovery_dir(app: AppHandle) -> Result<(), String>;
```

`setup` 用初始 `snapshot.config_recovery_notices` 初始化 `PendingConfigRecoveryState`。`snapshot_and_sync` 将新快照事件合并进该状态再返回。确认命令同时更新持久化日志和内存状态；打开目录命令确保 `recovery/` 存在，并使用与 `open_target_dir` 相同的平台命令。

把两个命令加入 `generate_handler!`。

- [x] **Step 4: 运行 Rust 测试与格式检查**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: 所有 Rust 测试 PASS。

- [x] **Step 5: 提交 Tauri 桥接**

```bash
git add src-tauri/src/lib.rs src-tauri/src/core/config_recovery.rs
git commit -m "feat: expose config recovery actions"
```

### Task 5: 配置损坏弹框

**Files:**
- Modify: `src/desktop-types.ts`
- Modify: `src/app-preview-data.ts`
- Modify: `src/app-chrome-renderers.ts`
- Modify: `src/app-chrome-dialogs.ts`
- Modify: `tests/app-chrome-renderers.test.ts`
- Modify: `tests/app-chrome-dialogs.test.ts`

- [ ] **Step 1: 写入安全渲染失败测试**

```ts
test("renders config recovery details and actions without trusting file paths", async () => {
  const { renderConfigRecoveryDialog } = await import(renderersImportPath);
  const html = renderConfigRecoveryDialog([{
    id: "notice-1",
    kind: "profileMetadata",
    sourcePath: "<profile>/meta.json",
    recoveryPath: "/recovery/<meta>.json",
    profileId: "profile-1",
    summary: "配置 <损坏>",
    action: "重新导入 & 检查",
    occurredAt: "2026-07-10T00:00:00Z",
  }]);
  expect(html).toContain("检测到配置文件损坏");
  expect(html).toContain("&lt;profile&gt;/meta.json");
  expect(html).toContain("重新导入 &amp; 检查");
  expect(html).toContain('data-action="open-config-recovery-dir"');
  expect(html).toContain('data-action="acknowledge-config-recovery"');
}
```

- [ ] **Step 2: 写入 DOM 行为失败测试**

```ts
test("config recovery dialog only resolves through its two explicit actions", async () => {
  const { showConfigRecoveryDialog } = await import(dialogsImportPath);
  const result = showConfigRecoveryDialog([noticeFixture]);
  document.querySelector<HTMLElement>('[data-role="config-recovery-backdrop"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(document.querySelector('[data-role="config-recovery-dialog"]')).not.toBeNull();
  document.querySelector<HTMLButtonElement>('[data-action="open-config-recovery-dir"]')?.click();
  await expect(result).resolves.toBe("openRecoveryDir");
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -- tests/app-chrome-renderers.test.ts tests/app-chrome-dialogs.test.ts`

Expected: FAIL，缺少两个恢复弹框导出。

- [ ] **Step 4: 实现类型、渲染和弹框生命周期**

在 `desktop-types.ts` 增加：

```ts
export type ConfigRecoveryKind =
  | "state" | "profileMetadata" | "targetMarker" | "targetAuth" | "targetConfig";

export type ConfigRecoveryNotice = {
  id: string;
  kind: ConfigRecoveryKind;
  sourcePath: string;
  recoveryPath: string | null;
  profileId: string | null;
  summary: string;
  action: string;
  occurredAt: string;
};
```

`AppSnapshot` 增加 `configRecoveryNotices?: ConfigRecoveryNotice[]`，兼容旧测试夹具；后端正式快照始终返回数组，预览快照显式设置为空数组。

`renderConfigRecoveryDialog` 使用 `escapeHtml` 渲染三段内容，包含滚动区域、`打开恢复目录` 与 `我知道了`。`showConfigRecoveryDialog` 创建 `role="alertdialog"` 的遮罩，点击遮罩和按 Escape 均不关闭，只在两个按钮点击时移除并返回 `"openRecoveryDir" | "acknowledge"`。

- [ ] **Step 5: 运行弹框单测**

Run: `npm test -- tests/app-chrome-renderers.test.ts tests/app-chrome-dialogs.test.ts`

Expected: 新增和既有测试全部 PASS。

- [ ] **Step 6: 提交弹框组件**

```bash
git add src/desktop-types.ts src/app-preview-data.ts src/app-chrome-renderers.ts src/app-chrome-dialogs.ts tests/app-chrome-renderers.test.ts tests/app-chrome-dialogs.test.ts
git commit -m "feat: add corrupt config recovery dialog"
```

### Task 6: 前端命令集成与整体验证

**Files:**
- Modify: `src/main.ts:1-20,257-310,423-445`
- Modify: `tests/sidebar-layout.test.ts`

- [ ] **Step 1: 写入“我知道了”集成失败测试**

Tauri 模拟的 `load_snapshot` 返回一个恢复事件；导入 `main` 后断言弹框出现，点击 `我知道了`，并断言：

```ts
expect(invokeMock).toHaveBeenCalledWith("acknowledge_config_recovery", {
  noticeIds: ["notice-1"],
});
expect(document.querySelector('[data-role="config-recovery-dialog"]')).toBeNull();
```

- [ ] **Step 2: 写入“打开恢复目录”集成失败测试**

点击 `打开恢复目录` 后按顺序断言：

```ts
expect(invokeMock).toHaveBeenCalledWith("open_config_recovery_dir", undefined);
expect(invokeMock).toHaveBeenCalledWith("acknowledge_config_recovery", {
  noticeIds: ["notice-1"],
});
```

再次返回相同事件并刷新快照，断言当前进程不再次显示相同 ID。

- [ ] **Step 3: 运行集成测试确认失败**

Run: `npm test -- tests/sidebar-layout.test.ts -t 'config recovery'`

Expected: FAIL，没有弹框或命令调用。

- [ ] **Step 4: 实现快照触发、去重和命令调用**

在 `main.ts` 引入 `showConfigRecoveryDialog`，维护：

```ts
const shownConfigRecoveryNoticeIds = new Set<string>();
let configRecoveryDialogInFlight = false;
```

`setSnapshot` 后调用 `void presentConfigRecoveryNotices(snapshot.configRecoveryNotices ?? [])`。函数过滤已显示 ID、设置 in-flight、等待弹框结果；如果结果为 `openRecoveryDir`，先调用 `open_config_recovery_dir`；随后调用 `acknowledge_config_recovery`。只有确认命令成功后才把 ID 加入集合；失败时用现有 `setFlash("error", ...)` 显示错误，并允许后续重试。

- [ ] **Step 5: 运行前端测试和构建**

Run: `npm test`

Expected: 36 个以上测试文件全部 PASS。

Run: `npm run build`

Expected: TypeScript 检查和 Vite 构建成功。

- [ ] **Step 6: 运行完整 Rust 验证**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: 所有 Rust 测试 PASS。

- [ ] **Step 7: 提交前端集成**

```bash
git add src/main.ts tests/sidebar-layout.test.ts
git commit -m "feat: notify users about recovered config"
```

### Task 7: 合并主工作区现有改动

**Files:**
- 主工作区所有当前已修改文件
- 本计划产生的实现文件

- [ ] **Step 1: 记录两个工作区状态**

Run in feature worktree: `git status --short && git log --oneline main..HEAD`

Run in main workspace: `git status --short`

Expected: 功能工作树干净；主工作区只包含用户原有修改。

- [ ] **Step 2: 提交用户原有修改**

在主工作区逐项检查 `git diff --check` 和差异内容，确认没有临时产物后，只暂存用户原有修改并提交：

```bash
git add src/main.ts src/profile-editor-renderers.ts src/profile-list-renderers.ts src/profile-runtime-renderers.ts src/scroll-restoration.ts src/sharing-center-renderers.ts src/styles.css tests/sidebar-layout.test.ts 'website/src/app/api/profiles/[id]/route.ts' website/tests/profiles-api.test.ts
git commit -m "feat: preserve local workspace updates"
```

- [ ] **Step 3: 合并功能分支并解决重叠**

Run: `git merge --no-ff codex/corrupt-config-recovery`

Expected: 自动合并或只在 `src/main.ts`、`tests/sidebar-layout.test.ts` 等真实重叠处产生冲突。逐段同时保留用户功能与配置恢复逻辑，不接受整文件覆盖。

- [ ] **Step 4: 在合并结果上重新验证**

Run: `npm install --include=dev && npm test && npm run build`

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && cargo test --manifest-path src-tauri/Cargo.toml`

Run: `npm --prefix website install --include=dev && npm --prefix website test`

Expected: 桌面前端、Rust 和 website 测试全部 PASS。

- [ ] **Step 5: 完成合并提交**

如果合并产生冲突，解决后运行：

```bash
git add src/main.ts tests/sidebar-layout.test.ts
git commit
```

Expected: 主分支工作区干净，历史同时包含用户原有修改和配置恢复实现。
