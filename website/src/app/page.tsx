import Link from "next/link";

export default function Home() {
  return (
    <main className="max-w-6xl mx-auto px-6 py-20 lg:py-32 space-y-24 relative z-10">
      {/* Hero Section */}
      <section className="text-center space-y-6">
        <div className="mx-auto w-fit rounded-full border border-indigo-200 bg-white/80 dark:border-indigo-500/30 dark:bg-indigo-500/10 px-4 py-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-300 shadow-sm backdrop-blur-md mb-8 transition-colors">
          內部资源中心
        </div>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-br from-neutral-800 to-neutral-500 dark:from-white dark:to-gray-400">
          Codex Auth Switch
        </h1>
        <p className="text-lg md:text-xl text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto leading-relaxed transition-colors">
          在您的 Codex 账号额度不够时，提供团队共享账号的一键快速切换方案，彻底免去手动配置底层文件的繁琐步骤。
        </p>
      </section>

      {/* Usage Steps Section */}
      <section className="space-y-10">
        <div className="text-center space-y-4">
          <h2 className="text-3xl font-semibold text-neutral-900 dark:text-neutral-100 transition-colors">快速开始 (使用步骤)</h2>
          <p className="text-neutral-500 dark:text-neutral-400 transition-colors">只需三步即可完成全套工具准备与配置工作</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl lg:max-w-6xl mx-auto">
          {/* Step 1 */}
          <div className="group relative overflow-hidden rounded-2xl border border-neutral-200 bg-white/60 p-8 shadow-xl dark:shadow-2xl backdrop-blur-xl transition-all hover:bg-white/90 hover:border-neutral-300 dark:border-white/10 dark:bg-white/[0.02] dark:hover:bg-white/[0.04] dark:hover:border-white/20">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent dark:from-indigo-500/10 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            <div className="relative h-full flex flex-col">
              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-500/20 dark:text-indigo-300 dark:ring-indigo-500/30 shrink-0 transition-colors">
                <span className="text-xl font-bold">1</span>
              </div>
              <h3 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-white transition-colors">下载 Codex 桌面版</h3>
              <p className="mb-8 text-neutral-600 dark:text-neutral-400 flex-1 transition-colors">
                请先前往官方页面下载并安装最新版的 ChatGPT Codex 桌面客户端。
              </p>
              <a
                href="https://chatgpt.com/codex"
                target="_blank"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 px-5 py-3 text-sm font-medium transition active:scale-95 dark:hover:bg-neutral-200"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                前往下载 Codex
              </a>
            </div>
          </div>

          {/* Step 2 */}
          <div className="group relative overflow-hidden rounded-2xl border border-neutral-200 bg-white/60 p-8 shadow-xl dark:shadow-2xl backdrop-blur-xl transition-all hover:bg-white/90 hover:border-neutral-300 dark:border-white/10 dark:bg-white/[0.02] dark:hover:bg-white/[0.04] dark:hover:border-white/20">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent dark:from-emerald-500/10 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            <div className="relative h-full flex flex-col">
              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:ring-emerald-500/30 shrink-0 transition-colors">
                <span className="text-xl font-bold">2</span>
              </div>
              <h3 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-white transition-colors">安装本项目客户端</h3>
              <p className="mb-8 text-neutral-600 dark:text-neutral-400 flex-1 transition-colors whitespace-pre-line">
                下载安装 Codex Auth Switch 的最新客户端发行版。{"\n"}
                <span className="text-sm">Mac 请下载 <strong>.dmg</strong> 结尾的文件，Windows 请下载 <strong>.exe</strong> 结尾的文件。</span>
              </p>
              <a
                href="https://github.com/LucisBaoshg/codex_auth_switch/releases"
                target="_blank"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-100 text-neutral-900 border border-neutral-200 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-white dark:border-white/10 px-5 py-3 text-sm font-medium transition active:scale-95 dark:hover:bg-neutral-700"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                访问 Github Releases
              </a>
            </div>
          </div>

          {/* Step 3 */}
          <div className="group relative overflow-hidden rounded-2xl border border-neutral-200 bg-white/60 p-8 shadow-xl dark:shadow-2xl backdrop-blur-xl transition-all hover:bg-white/90 hover:border-neutral-300 dark:border-white/10 dark:bg-white/[0.02] dark:hover:bg-white/[0.04] dark:hover:border-white/20">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent dark:from-purple-500/10 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            <div className="relative h-full flex flex-col">
              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 text-purple-700 ring-1 ring-inset ring-purple-200 dark:bg-purple-500/20 dark:text-purple-300 dark:ring-purple-500/30 shrink-0 transition-colors">
                <span className="text-xl font-bold">3</span>
              </div>
              <h3 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-white transition-colors">一键同步到桌面客户端</h3>
              <p className="mb-8 text-neutral-600 dark:text-neutral-400 flex-1 transition-colors">
                打开 Codex Auth Switch 客户端，进入「☁️ 网络共享库」页面，浏览团队配置并点击「一键下载并应用」，即可完成账号切换。
              </p>
              <Link
                href="/profiles"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 text-white hover:bg-purple-700 border border-purple-500/20 dark:bg-purple-600/90 dark:hover:bg-purple-500 px-5 py-3 text-sm font-medium transition active:scale-95"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
                进入 Profiles 分享区
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Detailed Instructions Section */}
      <section className="mx-auto max-w-5xl rounded-2xl border border-neutral-200 bg-white/50 p-8 shadow-sm dark:border-white/10 dark:bg-black/20 backdrop-blur-md transition-colors mt-8">
        <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-6 border-b border-neutral-200 dark:border-white/10 pb-4 transition-colors">
          💡 完整使用教程
        </h2>
        
        <div className="space-y-8">
          <div className="flex gap-4 sm:gap-6">
            <div className="flex-shrink-0 mt-1">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 font-bold dark:bg-indigo-500/20 dark:text-indigo-300 ring-1 ring-inset ring-indigo-200 dark:ring-indigo-500/30">
                1
              </div>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2 transition-colors">下载并安装 Codex 桌面版</h3>
              <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed transition-colors">
                前往 <a href="https://chatgpt.com/codex" target="_blank" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">chatgpt.com/codex</a> 下载并安装官方 ChatGPT Codex 桌面客户端。该客户端目前支持 macOS 和 Windows 系统。
              </p>
            </div>
          </div>

          <div className="flex gap-4 sm:gap-6">
            <div className="flex-shrink-0 mt-1">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 font-bold dark:bg-emerald-500/20 dark:text-emerald-300 ring-1 ring-inset ring-emerald-200 dark:ring-emerald-500/30">
                2
              </div>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2 transition-colors">安装 Codex Auth Switch 客户端</h3>
              <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed transition-colors">
                前往 <a href="https://github.com/LucisBaoshg/codex_auth_switch/releases" target="_blank" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">GitHub Releases</a> 下载最新版 Codex Auth Switch：
              </p>
              <ul className="mt-2 space-y-1 text-sm text-neutral-600 dark:text-neutral-400 list-disc list-inside">
                <li><strong>macOS</strong>：下载 <code className="bg-neutral-100 dark:bg-white/10 px-1 rounded">.dmg</code> 文件，打开后拖拽到「应用程序」文件夹即可安装。</li>
                <li><strong>Windows</strong>：下载 <code className="bg-neutral-100 dark:bg-white/10 px-1 rounded">.exe</code> 文件，双击运行安装程序，按提示完成安装。</li>
              </ul>
            </div>
          </div>

          <div className="flex gap-4 sm:gap-6">
            <div className="flex-shrink-0 mt-1">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 text-purple-700 font-bold dark:bg-purple-500/20 dark:text-purple-300 ring-1 ring-inset ring-purple-200 dark:ring-purple-500/30">
                3
              </div>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2 transition-colors">在客户端中同步网络共享配置</h3>
              <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed transition-colors">
                启动 Codex Auth Switch，点击顶部的「☁️ 网络共享库」标签页。客户端会自动拉取本平台发布的所有共享配置，找到您需要的配置条目，点击「一键下载并应用」按钮，确认提示后即可完成账号切换。<br className="hidden sm:block" />
                <span className="text-sm mt-1 block">无需手动复制粘贴任何文本，客户端会自动完成全部参数同步与写入。</span>
              </p>
            </div>
          </div>

          <div className="flex gap-4 sm:gap-6">
            <div className="flex-shrink-0 mt-1">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100 text-orange-700 font-bold dark:bg-orange-500/20 dark:text-orange-300 ring-1 ring-inset ring-orange-200 dark:ring-orange-500/30">
                4
              </div>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2 transition-colors">重启 Codex 使配置生效</h3>
              <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed transition-colors">
                配置应用完成后，完全关闭并重新启动 ChatGPT Codex 桌面端，新账号配置即刻生效，可直接投入使用。
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl rounded-2xl border border-amber-200 bg-amber-50/80 p-8 shadow-sm dark:border-amber-500/20 dark:bg-amber-500/10 backdrop-blur-md transition-colors">
        <div className="space-y-4">
          <div className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/20 dark:text-amber-200 dark:ring-amber-500/30">
            Linux CLI 安装
          </div>
          <h2 className="text-2xl font-bold text-neutral-900 dark:text-white transition-colors">
            服务器环境可直接安装 CLI
          </h2>
          <p className="text-neutral-700 dark:text-neutral-300 leading-relaxed transition-colors">
            如果您不是在桌面端操作，而是在 Linux 服务器上同步共享配置，可以直接从 GitHub Release 下载
            <code className="mx-1 rounded bg-black/5 px-1.5 py-0.5 text-sm dark:bg-white/10">codex-auth-switch-cli</code>
            。当前 Release 提供的是 Linux x64 版本。
          </p>
          <div className="overflow-x-auto rounded-2xl bg-neutral-950 p-5 text-sm text-neutral-100 shadow-inner">
            <pre className="whitespace-pre-wrap leading-6">{`VERSION=1.4.6
curl -L \\
  -o /tmp/codex-auth-switch-cli.tar.gz \\
  "https://github.com/LucisBaoshg/codex_auth_switch/releases/download/v\${VERSION}/codex-auth-switch-cli_\${VERSION}_linux_x64.tar.gz"

tar -xzf /tmp/codex-auth-switch-cli.tar.gz -C /tmp
mkdir -p ~/.local/bin
install /tmp/codex-auth-switch-cli ~/.local/bin/codex-auth-switch-cli

~/.local/bin/codex-auth-switch-cli help`}</pre>
          </div>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 transition-colors">
            常用命令包括
            <code className="mx-1 rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">list</code>
            、
            <code className="mx-1 rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">sync-remote</code>
            和
            <code className="mx-1 rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">switch &lt;profile-id-or-name&gt;</code>
            。更完整说明见仓库 README。
          </p>
        </div>
      </section>
    </main>
  );
}
