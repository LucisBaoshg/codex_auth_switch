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
              <h3 className="mb-3 text-xl font-semibold text-neutral-900 dark:text-white transition-colors">使用与分享 Profiles</h3>
              <p className="mb-8 text-neutral-600 dark:text-neutral-400 flex-1 transition-colors">
                进入分享区浏览团队内部配置，复制到您的客户端中无缝完成账号切换，或上传新配置。
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
              <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2 transition-colors">获取目标授权凭证</h3>
              <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed transition-colors">
                本资源分发中心收录了团队维护的各类环境配置。请点击上方进入<a href="/profiles" className="font-medium text-indigo-600 hover:text-indigo-500 hover:underline dark:text-indigo-400 dark:hover:text-indigo-300">Profiles 分享区</a>，选择您所需的业务环境卡片。<br className="hidden sm:block" />
                在详情页下方找到对应的配置文件（如 <code>auth.json</code> 或 <code>config.toml</code>），点击【复制】按钮，将配置参数保存至系统剪贴板。
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
              <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2 transition-colors">启动桌面客户端</h3>
              <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed transition-colors">
                在您的计算机上，找到并运行已安装好的 <strong>Codex Auth Switch</strong> 独立桌面应用程序。
              </p>
            </div>
          </div>

          <div className="flex gap-4 sm:gap-6">
            <div className="flex-shrink-0 mt-1">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 text-purple-700 font-bold dark:bg-purple-500/20 dark:text-purple-300 ring-1 ring-inset ring-purple-200 dark:ring-purple-500/30">
                3
              </div>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2 transition-colors">应用环境配置</h3>
              <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed transition-colors">
                在客户端主界面对应的输入框内，粘贴第 1 步中复制的相关配置文本，随后点击确认应用。<br className="hidden sm:block" />
                系统服务进程将在后台自动接管并完成底层的参数覆写工作。配置生效后，您即可直接进入该 AI 服务平台开展工作。
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
