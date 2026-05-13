# Codex Auth Switch

> 多账号、多平台、带增强启动能力的 Codex 桌面控制台。  
> A desktop control center for Codex profiles, Antigravity accounts, and enhanced Codex launch workflows.

[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Release](https://img.shields.io/github/v/release/LucisBaoshg/codex_auth_switch?label=release)](https://github.com/LucisBaoshg/codex_auth_switch/releases)

Codex Auth Switch 是一个跨平台桌面工具，用来管理多套 Codex（Codex）账号配置、第三方 API（Third-party API）配置，以及 Google Antigravity（Antigravity）的本地登录状态。它也提供“增强启动”（Enhanced Launch）能力：从同一个应用里启动 Codex，并尝试解锁 API Key（API Key）登录模式下不可用的插件入口（Plugins），同时唤起 Codex 宠物浮层。

## Highlights

- **Codex profile switcher**：保存、编辑和一键切换多套 `auth.json` + `config.toml`
- **第三方 API 配置管理**：支持基于 `openai_base_url` / `model_provider` 的第三方模型配置
- **额度与延迟面板**：可刷新官方 OAuth（OAuth）额度，也可查看第三方 API 用量和首响延迟
- **Antigravity account switcher**：导入、保存、切换和恢复 Antigravity 本地登录快照
- **Enhanced Launch**：通过 CDP（Chromium DevTools Protocol）增强启动 Codex，解锁插件入口并唤起宠物
- **菜单栏状态**：macOS 菜单栏显示当前 profile 的额度摘要，并提供刷新、增强启动、打开主窗口
- **安全备份**：切换 Codex 或 Antigravity 状态前保留本地备份，降低误切换风险
- **CLI companion**：Linux 服务器可用 `codex-auth-switch-cli` 同步和切换远程 profiles

## Screens And Modes

| Area | What it does |
| --- | --- |
| Codex profiles | 管理本地 Codex 配置档案，识别当前生效配置，切换前自动备份 |
| Network shared library | 从远程 profiles API 同步共享配置 |
| Third-party API | 迁移旧第三方配置，刷新用量，探测响应延迟 |
| Antigravity | 读取 `state.vscdb` 中的登录相关键值，保存为可切换账号快照 |
| Menu bar | 显示额度摘要，刷新用量，增强启动 Codex，打开主窗口 |

## Install

从 GitHub Releases 下载对应平台安装包：

[Download latest release](https://github.com/LucisBaoshg/codex_auth_switch/releases/latest)

当前发布流程会构建：

- Windows NSIS installer（`.exe`）
- macOS Apple Silicon app / dmg（`.app` / `.dmg`）
- Linux x64 CLI archive（`.tar.gz`）

如果需要 macOS Intel 包，可以通过仓库里的 `publish-macos-intel.yml` workflow 单独构建并上传到同一个 Release。

## Quick Start

### Desktop App

1. 打开 Codex Auth Switch
2. 在 Codex 页签中点击“加配置”，或从当前 `~/.codex` 导入现有配置
3. 选择一个 profile，点击“应用”
4. 需要插件入口或宠物浮层时，点击“增强启动 + 唤起宠物”

### Antigravity

1. 打开 Antigravity 页签
2. 确认本机已经登录 `Antigravity.app`
3. 点击“导入当前账号”
4. 保存多个账号快照后即可一键切换

### Menu Bar

macOS 菜单栏会显示当前 profile 的额度摘要。菜单项包括：

- 刷新额度
- 增强启动
- 打开主窗口
- 退出

## Default Paths

### Codex

- macOS / Linux: `~/.codex`
- Windows: `%USERPROFILE%\.codex`

每个 Codex profile 包含：

```text
auth.json
config.toml
```

### Antigravity

当前桌面端优先支持 macOS 默认路径：

```text
~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb
```

管理的 Antigravity 键值包括：

- `antigravityAuthStatus`
- `antigravityUnifiedStateSync.oauthToken`
- `antigravityUnifiedStateSync.userStatus`
- `antigravityUnifiedStateSync.enterprisePreferences`
- `antigravityUnifiedStateSync.modelCredits`
- `antigravity.profileUrl`

## Enhanced Launch

增强启动的目标是把 Codex 的日常启动动作统一放进一个辅助应用里。

当前流程：

1. 退出正在运行的 Codex（macOS）
2. 写入 Codex 宠物浮层开启状态
3. 使用随机本地端口启动 Codex，并附带 `--remote-debugging-port`
4. 通过 CDP 连接 Codex 渲染页
5. 注入最小脚本，尝试把插件入口解除禁用并标记为 unlocked

Important notes:

- 这是运行时增强，不会修改 Codex 安装目录或 `app.asar`
- CDP 端口绑定在 `127.0.0.1`
- 插件入口解锁依赖 Codex 当前 UI 与 React（React）内部结构，Codex 更新后可能需要调整选择器
- 当前增强启动优先支持 macOS

## CLI

项目同时提供 Linux CLI，适合服务器或远程环境：

```bash
codex-auth-switch-cli list
codex-auth-switch-cli sync-remote
codex-auth-switch-cli switch <profile-id-or-name>
```

环境变量：

- `CODEX_AUTH_SWITCH_TARGET_DIR`：指定目标 Codex 配置目录，默认 `~/.codex`
- `CODEX_AUTH_SWITCH_REMOTE_BASE_URL`：覆盖远程 profiles 地址
- `CODEX_AUTH_SWITCH_REMOTE_TOKEN`：远程接口 Bearer Token

安装最新 Linux CLI：

```bash
VERSION=1.4.23
curl -L \
  -o /tmp/codex-auth-switch-cli.tar.gz \
  "https://github.com/LucisBaoshg/codex_auth_switch/releases/download/v${VERSION}/codex-auth-switch-cli_${VERSION}_linux_x64.tar.gz"

tar -xzf /tmp/codex-auth-switch-cli.tar.gz -C /tmp
mkdir -p ~/.local/bin
install /tmp/codex-auth-switch-cli ~/.local/bin/codex-auth-switch-cli
```

## Development

Requirements:

- Node.js 24
- Rust stable
- Tauri 2 toolchain prerequisites for your OS

```bash
npm install
npm run tauri dev
```

Run checks:

```bash
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

Build desktop app:

```bash
npm run tauri build
```

Local macOS release build:

```bash
npm run build:mac:release-local
```

如果本地没有配置 `TAURI_SIGNING_PRIVATE_KEY`，Tauri updater artifact signing 可能会在最后一步失败；通常 `.app` 和 `.dmg` 已经生成，可以用于本机测试。

## Release

正式发布通过 Git tag 触发：

```bash
git tag v1.4.23
git push origin v1.4.23
```

`publish-release.yml` 会：

- 创建或复用 GitHub Release
- 同步版本号到桌面端和 CLI
- 运行前端测试
- 构建 Windows / macOS Apple Silicon 桌面安装包
- 构建 Linux x64 CLI
- 上传所有 release assets

macOS 签名需要在 GitHub repository secrets 中配置：

- `APPLE_CERTIFICATE_P12`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## Architecture

```text
src/                    Vite + TypeScript desktop UI
src-tauri/src/core/     Codex profile storage, switching, usage and repair logic
src-tauri/src/antigravity/
                        Antigravity SQLite payload import / switch / restore
src-tauri/src/codex_enhance.rs
                        Enhanced Codex launch via local CDP injection
src-tauri/src/menu_bar.rs
                        macOS menu bar status and actions
cli/                    Linux-friendly command line companion
website/                Profile sharing web surface
```

## Safety Model

- Codex 切换写入前会备份当前 `auth.json` 和 `config.toml`
- Antigravity 切换写入前会备份当前受管键值
- 增强启动只做运行时注入，不修改 Codex App 安装文件
- 本项目会读取和写入本机认证状态文件，请只在可信设备上使用

## 中文 / English Summary

**中文**：Codex Auth Switch 是一个面向重度 Codex 用户的本地控制台，解决多账号配置切换、第三方 API 管理、Antigravity 登录状态切换，以及 Codex 插件入口增强启动的问题。

**English**: Codex Auth Switch is a local desktop control center for power Codex users. It manages multiple Codex profiles, third-party API setups, Antigravity account snapshots, and an enhanced Codex launch flow for plugin entry unlocking.

## License

No license file is currently included. Treat the repository as source-available unless a license is added later.
