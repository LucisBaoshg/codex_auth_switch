# Errors

## [ERR-20260710-004] cli-missing-test-dependency

**Logged**: 2026-07-10T12:57:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary

CLI 测试会编译桌面端共享核心模块的测试代码，但 CLI 清单未声明其中使用的 `tempfile` 开发依赖。

### Error

```text
error[E0432]: unresolved import `tempfile`
--> src/../../src-tauri/src/core/config_recovery.rs:208:9
```

### Context

- `cli/src/main.rs` 通过路径引用 `src-tauri/src/core/mod.rs`。
- 共享模块中的 `config_recovery` 测试使用 `tempfile::TempDir`。
- 正式构建不编译 `#[cfg(test)]` 模块，但 CLI 测试因此无法通过。

### Suggested Fix

在 `cli/Cargo.toml` 中增加 `tempfile` 开发依赖，使直接编译共享测试模块的各个包都独立声明测试依赖。

### Metadata

- Reproducible: yes
- Related Files: cli/Cargo.toml, src-tauri/src/core/config_recovery.rs

### Resolution

- **Resolved**: 2026-07-10T12:57:00+08:00
- **Notes**: 已在 CLI 清单中增加仅测试期的 `tempfile = "3"`。

---

## [ERR-20260710-001] apply_patch

**Logged**: 2026-07-10T12:36:07+08:00
**Priority**: low
**Status**: resolved
**Area**: backend

### Summary

一个覆盖多个 Rust 区域的大补丁因快照构造器上下文与计划文本不完全一致而整体未应用。

### Error

```text
apply_patch verification failed: Failed to find expected lines in src-tauri/src/core/mod.rs
```

### Context

- 操作尝试同时修改 `AppSnapshot`、档案扫描、活动档案识别和元数据写入。
- 补丁依赖计划记录的近似上下文，而不是修改前刚读取的精确源码片段。
- `apply_patch` 保证失败时没有产生部分修改。

### Suggested Fix

修改大型现有文件前先读取每个目标区域的精确上下文，并将跨区域变更拆成多个小补丁。

### Metadata

- Reproducible: yes
- Related Files: src-tauri/src/core/mod.rs

### Resolution

- **Resolved**: 2026-07-10T12:36:07+08:00
- **Notes**: 改为逐段读取并拆分补丁后继续。

---

## [ERR-20260710-003] cli-cargo-fmt-check

**Logged**: 2026-07-10T12:56:20+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

发布前额外执行的 CLI `cargo fmt --check` 因既有格式差异退出，导致同一串行命令中的 CLI 测试和构建尚未运行。

### Error

```text
Diff in cli/src/main.rs
```

### Context

- 版本变更未修改 `cli/src/main.rs`。
- GitHub 正式发布工作流不包含 CLI 格式检查，只执行发布构建。
- 桌面前端、桌面 Rust 和网站测试已经通过。

### Suggested Fix

发布任务中不顺带格式化无关 CLI 源码；单独运行 `cargo test` 与 `cargo build --release` 验证实际发布路径。

### Metadata

- Reproducible: yes
- Related Files: cli/src/main.rs

### Resolution

- **Resolved**: 2026-07-10T12:56:20+08:00
- **Notes**: 将 CLI 测试/发布构建从额外格式检查中拆分执行。

---

## [ERR-20260710-002] cargo-clippy

**Logged**: 2026-07-10T12:46:50+08:00
**Priority**: low
**Status**: resolved
**Area**: backend

### Summary

合并后额外执行的 `cargo clippy --all-targets -- -D warnings` 被 20 条项目历史 lint 和数条新增代码 lint 阻断。

### Error

```text
error: could not compile `codex-auth-switch` due to 20 previous errors
```

### Context

- 项目原有代码没有以 `-D warnings` 作为既有基线。
- 失败项包含 `updates.rs` 和 `core/mod.rs` 中与本功能无关的历史 lint。
- 本次新增代码中的 `type_complexity` 和 `cloned_ref_to_slice_refs` 也被识别出来。

### Suggested Fix

修复本次新增代码的 lint；最终验证时只豁免已确认的历史 lint 类别，不借机重构无关代码。

### Metadata

- Reproducible: yes
- Related Files: src-tauri/src/core/mod.rs, src-tauri/src/core/updates.rs

### Resolution

- **Resolved**: 2026-07-10T12:46:50+08:00
- **Notes**: 已简化新增类型、去除不必要克隆，并将历史 lint 作为显式豁免运行严格检查。

---
