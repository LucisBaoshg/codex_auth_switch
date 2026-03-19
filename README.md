# Codex Auth Switch

一个用于管理多套 Codex 账号配置的跨平台桌面工具。

每个 profile 都是一对文件：

- `auth.json`
- `config.toml`

## 功能

- 卡片方式展示所有 profile
- 首页第一个固定卡片是“添加 Profile”，点击后进入手动创建
- 首页第二个固定卡片是“当前 Codex 配置”，支持直接保存为新的 profile
- 已保存的 profile 卡片支持快速切换和查看详情
- 详情页可直接浏览和编辑名称、备注、`auth.json` 与 `config.toml`
- 一键切换当前生效的 `auth.json` 和 `config.toml`
- 切换前自动备份当前生效文件
- 自动识别当前目标目录对应的是哪一套 profile

## 默认目标路径

- macOS / Linux: `~/.codex`
- Windows: `%USERPROFILE%\\.codex`

如果你的 Codex 配置位于默认的 `.codex` 隐藏目录，可以直接使用“当前 Codex 配置”卡片，不需要手动在文件选择器里找隐藏文件。

## 技术栈

- Tauri 2
- Rust
- Vite
- TypeScript

## 开发

```bash
npm install
npm run tauri dev
```

## 构建

```bash
npm run tauri build
```

当前 macOS 会产出标准应用包：

```text
src-tauri/target/release/bundle/macos/Codex Auth Switch.app
```

也仍然会保留原始可执行文件：

```text
src-tauri/target/release/codex-auth-switch
```

## 测试

```bash
cd src-tauri
cargo test
```
