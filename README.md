# Codex 助手

> 多账号、多平台、支持共生配置的 Codex 桌面控制台。<br>
> A desktop control center for Codex profiles, Antigravity accounts, and symbiotic third-party API workflows.

[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Release](https://img.shields.io/github/v/release/LucisBaoshg/codex_auth_switch?label=release)](https://github.com/LucisBaoshg/codex_auth_switch/releases)

Codex 助手是一个跨平台桌面工具，用来管理多套 Codex（Codex）账号配置、第三方 API（Third-party API）配置、共生配置（Symbiotic Config），以及 Google Antigravity（Antigravity）的本地登录状态。共生配置复用官方 OAuth（OAuth）登录状态，同时把模型请求转到第三方 API，不再需要单独的增强启动（Enhanced Launch）流程。

## Highlights

- **Codex profile switcher**：保存、编辑和一键切换多套 `auth.json` + `config.toml`
- **第三方 API 配置管理**：支持独立第三方 API 与复用官方 OAuth 的共生配置
- **额度与延迟面板**：可刷新官方 OAuth（OAuth）额度，也可查看第三方 API 用量和首响延迟
- **Antigravity account switcher**：导入、保存、切换和恢复 Antigravity 本地登录快照
- **共生配置**：通过 `model_providers.*.requires_openai_auth` 保持官方 OAuth 登录上下文，并接入第三方 API
- **菜单栏状态**：macOS 菜单栏显示当前 profile 的额度摘要，并提供刷新和打开主窗口
- **安全备份**：切换 Codex 或 Antigravity 状态前保留本地备份，降低误切换风险
- **CLI companion**：Linux 服务器可用 `codex-auth-switch-cli` 同步和切换远程 profiles

## Screens And Modes

| Area | What it does |
| --- | --- |
| Codex profiles | 管理本地 Codex 配置档案，识别当前生效配置，切换前自动备份 |
| Network shared library | 从远程 profiles API 同步共享配置 |
| Third-party API | 管理独立第三方 API 与共生配置，刷新用量，探测响应延迟 |
| Antigravity | 读取 `state.vscdb` 中的登录相关键值，保存为可切换账号快照 |
| Menu bar | 显示额度摘要，刷新用量，打开主窗口 |

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

1. 打开 Codex 助手
2. 在 Codex 页签中点击“加配置”，或从当前 `~/.codex` 导入现有配置
3. 选择一个 profile，点击“应用”
4. 需要第三方 API 同时保留官方 OAuth 能力时，创建“共生配置”

### Antigravity

1. 打开 Antigravity 页签
2. 确认本机已经登录 `Antigravity.app`
3. 点击“导入当前账号”
4. 保存多个账号快照后即可一键切换

### Menu Bar

macOS 菜单栏会显示当前 profile 的额度摘要。菜单项包括：

- 刷新额度
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

## Symbiotic Config

共生配置已经替代增强启动。创建共生配置时，先选择一套已保存的官方 OAuth profile，再填写第三方 API 的 `base_url`、`experimental_bearer_token` 和模型名。应用后，Codex 继续使用官方 OAuth 登录状态，同时模型请求走配置的第三方 provider。

生成的 `config.toml` 会包含：

```toml
model_provider = "ylscode"

[model_providers.ylscode]
requires_openai_auth = true
experimental_bearer_token = "..."
```

这意味着插件入口等依赖官方登录状态的能力由 OAuth 上下文提供，不再需要通过本应用执行 CDP（Chromium DevTools Protocol）注入或单独唤起宠物浮层。

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
VERSION=1.4.25
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
git tag v1.4.25
git push origin v1.4.25
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
src-tauri/src/menu_bar.rs
                        macOS menu bar status and actions
cli/                    Linux-friendly command line companion
website/                Profile sharing web surface
```

## Safety Model

- Codex 切换写入前会备份当前 `auth.json` 和 `config.toml`
- Antigravity 切换写入前会备份当前受管键值
- 共生配置只写入受管 profile 文件，不修改 Codex App 安装文件
- 本项目会读取和写入本机认证状态文件，请只在可信设备上使用

## 中文 / English Summary

**中文**：Codex 助手是一个面向重度 Codex 用户的本地控制台，解决多账号配置切换、第三方 API 与共生配置管理，以及 Antigravity 登录状态切换的问题。

**English**: Codex 助手 is a local desktop control center for power Codex users. It manages multiple Codex profiles, third-party API and symbiotic API setups, plus Antigravity account snapshots.

## License

No license file is currently included. Treat the repository as source-available unless a license is added later.
