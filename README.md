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

## Antigravity 支持

- 在同一个桌面应用里新增 `Antigravity` 平台页签
- 从本机当前已登录的 `Antigravity.app` 导入账号状态
- 把 Antigravity 登录状态保存为可重复切换的本地快照
- 切换前自动备份当前 `state.vscdb` 里的登录相关键值
- 一键恢复最近一次 Antigravity 备份
- 切换完成后自动重启 `Antigravity.app`

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

如果你在本机做 macOS release 构建，建议优先用下面这条命令：

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Your Company Name (TEAMID)" npm run build:mac:release-local
```

这个脚本会优先使用系统自带的 `/usr/bin/xattr`，避免 Homebrew 版本的 `xattr` 与 Tauri bundler 参数不兼容。

## GitHub Actions

仓库包含一个 Windows 打包 workflow：

- [windows-installer.yml](/Volumes/Acer/Dev/codex_auth_switch/.github/workflows/windows-installer.yml)
- [publish-release.yml](/Volumes/Acer/Dev/codex_auth_switch/.github/workflows/publish-release.yml)

触发方式：

- 手动在 GitHub Actions 页面点击 `Windows Installer`
- 或者向 `main` 推送与前端 / Tauri 相关的改动

这个 workflow 会在 `windows-latest` runner 上：

- 安装 Node 24 和 Rust stable
- 运行 `npm test`
- 构建 `NSIS` Windows 安装包
- 直接把生成的 `.exe` 和 `.sig` 作为 workflow artifact 上传

## 发布 Release

如果希望用户直接在 GitHub Releases 页面下载安装包，可以通过推送版本 tag 触发自动发布：

```bash
git tag v0.1.1
git push origin v0.1.1
```

这会触发 [publish-release.yml](/Volumes/Acer/Dev/codex_auth_switch/.github/workflows/publish-release.yml)：

- 在 `windows-latest` 上构建 `NSIS` 安装包
- 在 `macos-latest` 上构建 `.app` / `.dmg`
- 自动创建对应版本的 GitHub Release
- 把生成的 Windows 和 macOS 安装包上传到 Release 附件

如果要启用 macOS 签名，需要在 GitHub repository secrets 中配置：

- `APPLE_CERTIFICATE_P12`：`.p12` 文件的 base64 内容
- `APPLE_CERTIFICATE_PASSWORD`：导出 `.p12` 时设置的密码
- `APPLE_SIGNING_IDENTITY`：你的 Developer ID Application 签名身份，例如 `Developer ID Application: Your Company Name (TEAMID)`

## CLI 安装与使用

项目还提供一个命令行版本 `codex-auth-switch-cli`，适合在 Linux 服务器上同步远程 profiles 或执行快速切换。

当前通过 GitHub Release 提供的 CLI 附件只有 Linux x64 版本。

### 从 GitHub Release 安装 Linux CLI

```bash
VERSION=1.4.6
curl -L \
  -o /tmp/codex-auth-switch-cli.tar.gz \
  "https://github.com/LucisBaoshg/codex_auth_switch/releases/download/v${VERSION}/codex-auth-switch-cli_${VERSION}_linux_x64.tar.gz"

tar -xzf /tmp/codex-auth-switch-cli.tar.gz -C /tmp
mkdir -p ~/.local/bin
install /tmp/codex-auth-switch-cli ~/.local/bin/codex-auth-switch-cli

~/.local/bin/codex-auth-switch-cli help
```

如果希望全局直接使用，请确认 `~/.local/bin` 已经在 `PATH` 中。

### CLI 命令

```bash
codex-auth-switch-cli list
codex-auth-switch-cli sync-remote
codex-auth-switch-cli switch <profile-id-or-name>
```

### CLI 环境变量

- `CODEX_AUTH_SWITCH_TARGET_DIR`：指定目标 Codex 配置目录，默认是 `~/.codex`
- `CODEX_AUTH_SWITCH_REMOTE_BASE_URL`：覆盖远程 profiles 地址
- `CODEX_AUTH_SWITCH_REMOTE_TOKEN`：如果远程接口要求鉴权，可通过这个变量传入 Bearer Token

## 测试

```bash
cd src-tauri
cargo test
```
