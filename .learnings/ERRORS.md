# Errors

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
