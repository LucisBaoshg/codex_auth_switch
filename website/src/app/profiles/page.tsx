"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { withBasePath } from "@/lib/base-path";
import { buildLegacyProfileFiles } from "@/lib/shared-profile-config";

interface Profile {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt?: string;
  files: string[];
  ownerDingUserId?: string;
  ownerName?: string;
  ownerMobile?: string;
  visibility?: ShareVisibility;
  sharedWith?: string[];
}

type ShareVisibility = "private" | "selected" | "public";

interface CurrentUser {
  dingUserId: string;
  name?: string | null;
  mobile?: string | null;
  jobNumber?: string | null;
}

interface ShareUserOption {
  dingUserId: string;
  label: string;
  name?: string | null;
  mobile?: string | null;
  jobNumber?: string | null;
}

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [shareUsers, setShareUsers] = useState<ShareUserOption[]>([]);
  const [authChecked, setAuthChecked] = useState(false);
  const [desktopToken, setDesktopToken] = useState("");
  const [tokenLoading, setTokenLoading] = useState(false);
  const [error, setError] = useState("");

  // Form states
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [visibility, setVisibility] = useState<ShareVisibility>("private");
  const [selectedShareUsers, setSelectedShareUsers] = useState<string[]>([]);
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const loadProfiles = async () => {
    setLoading(true);
    setError("");
    const res = await fetch(withBasePath("/api/profiles"));
    if (res.status === 401) {
      setProfiles([]);
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setError("加载共享配置失败");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setProfiles(data);
    setLoading(false);
  };

  const loadShareUsers = async () => {
    const res = await fetch(withBasePath("/api/users"));
    if (!res.ok) return;
    const data = await res.json();
    setShareUsers(data.users || []);
  };

  useEffect(() => {
    fetch(withBasePath("/api/auth/me"))
      .then((res) => res.json())
      .then(async (data) => {
        setCurrentUser(data.user);
	        setAuthChecked(true);
        if (data.user) {
          await Promise.all([loadProfiles(), loadShareUsers()]);
        } else {
          setLoading(false);
        }
      })
      .catch(() => {
        setAuthChecked(true);
        setLoading(false);
      });
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !openAiApiKey.trim() || !baseUrl.trim()) return;
    
    setUploading(true);
    const formData = new FormData();
    formData.append("name", name);
    formData.append("description", desc);
    formData.append("visibility", visibility);
    formData.append("sharedWith", JSON.stringify(visibility === "selected" ? selectedShareUsers : []));
    
    const { authContent, configContent } = buildLegacyProfileFiles({
      openAiApiKey,
      baseUrl,
    });

    // Create legacy virtual files for older desktop app versions.
    const file1 = new File([authContent], "auth.json", { type: "application/json" });
    const file2 = new File([configContent], "config.toml", { type: "text/plain" });
    
    formData.append("file1", file1);
    formData.append("file2", file2);

    try {
      const res = await fetch(withBasePath("/api/profiles"), {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const newProfile = await res.json();
        setProfiles([newProfile, ...profiles]);
        setShowModal(false);
        setName("");
        setDesc("");
        setVisibility("private");
        setSelectedShareUsers([]);
        setOpenAiApiKey("");
        setBaseUrl("");
      } else if (res.status === 401) {
        setError("登录状态已失效，请重新登录");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const handleCreateDesktopToken = async () => {
    setTokenLoading(true);
    setDesktopToken("");
    setError("");
    try {
      const res = await fetch(withBasePath("/api/auth/desktop-token"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Codex Auth Switch Desktop" }),
      });
      if (!res.ok) {
        setError("生成桌面访问令牌失败，请重新登录后再试");
        return;
      }
      const data = await res.json();
      setDesktopToken(data.token);
    } finally {
      setTokenLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch(withBasePath("/api/auth/logout"), { method: "POST" });
    setCurrentUser(null);
    setProfiles([]);
    setDesktopToken("");
  };

  const toggleSelectedShareUser = (dingUserId: string) => {
    setSelectedShareUsers((current) =>
      current.includes(dingUserId)
        ? current.filter((id) => id !== dingUserId)
        : [...current, dingUserId],
    );
  };

  const shareTargetDisabled = visibility === "selected" && selectedShareUsers.length === 0;

  return (
    <div className="max-w-6xl mx-auto px-6 py-16 space-y-12 relative z-10 transition-colors">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-neutral-200 dark:border-white/10 pb-8 transition-colors">
        <div className="space-y-2">
          <Link href="/" className="inline-block text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 text-sm mb-4 transition-colors">
            &larr; 返回首页
          </Link>
          <h1 className="text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 transition-colors">Profiles 分享区</h1>
          <p className="text-neutral-500 dark:text-neutral-400 transition-colors">内部流转的授权凭证文件和配置文件集合</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          {currentUser ? (
            <>
              <div className="text-sm text-neutral-500 dark:text-neutral-400 sm:text-right">
                <div className="font-medium text-neutral-800 dark:text-neutral-200">{currentUser.name || "已登录员工"}</div>
                <div>{currentUser.mobile || currentUser.dingUserId}</div>
              </div>
              <button
                onClick={() => setShowModal(true)}
                className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 transition-colors active:scale-95 whitespace-nowrap"
              >
                + 添加分享
              </button>
              <button
                onClick={handleLogout}
                className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-200 dark:hover:bg-white/[0.08] transition-colors"
              >
                退出
              </button>
            </>
          ) : (
            <a
              href={withBasePath("/api/auth/login?returnTo=/profiles")}
              className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 transition-colors active:scale-95 whitespace-nowrap"
            >
              钉钉 SSO 登录
            </a>
          )}
        </div>
      </header>

      {currentUser && (
        <section className="rounded-2xl border border-neutral-200 bg-white/70 p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.03] transition-colors">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div>
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">桌面端访问令牌</h2>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                在桌面端「全局设置」中填入该令牌后，只会同步您有权限访问的共享配置。
              </p>
            </div>
            <button
              onClick={handleCreateDesktopToken}
              disabled={tokenLoading}
              className="rounded-xl bg-neutral-900 px-5 py-3 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 transition-colors"
            >
              {tokenLoading ? "生成中..." : "生成桌面令牌"}
            </button>
          </div>
          {desktopToken && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/10">
              <div className="text-sm font-medium text-emerald-800 dark:text-emerald-200">令牌只显示一次</div>
              <code className="mt-2 block break-all rounded-lg bg-white px-3 py-2 text-xs text-neutral-800 dark:bg-neutral-950 dark:text-neutral-100">
                {desktopToken}
              </code>
            </div>
          )}
        </section>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">
          {error}
        </div>
      )}

      {!currentUser && authChecked && (
        <div className="rounded-2xl border border-neutral-200 bg-white/70 p-10 text-center shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
          <h2 className="text-2xl font-semibold text-neutral-900 dark:text-white">需要先登录</h2>
          <p className="mx-auto mt-3 max-w-xl text-neutral-500 dark:text-neutral-400">
            企业共享配置已接入钉钉 SSO。登录后只能看到自己创建或明确分享给您的配置。
          </p>
          <a
            href={withBasePath("/api/auth/login?returnTo=/profiles")}
            className="mt-6 inline-flex rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
          >
            使用钉钉 SSO 登录
          </a>
        </div>
      )}

      {/* Profiles Grid */}
      {loading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {[1,2,3].map(i => <div key={i} className="h-48 rounded-2xl bg-neutral-200 dark:bg-white/5" />)}
        </div>
      ) : currentUser && profiles.length === 0 ? (
        <div className="text-center py-20 text-neutral-500 bg-white/60 dark:bg-white/[0.02] border border-neutral-200 dark:border-white/5 rounded-2xl transition-colors">
          目前还没有分享的 Profile。点击右上角添加。
        </div>
      ) : currentUser ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {profiles.map((p) => (
            <Link href={`/profiles/${p.id}`} key={p.id}>
              <div className="group h-full rounded-2xl border border-neutral-200 bg-white/60 p-6 shadow-xl dark:shadow-2xl backdrop-blur-md transition-all hover:-translate-y-1 hover:bg-neutral-50 dark:bg-white/[0.02] dark:hover:bg-white/[0.05] hover:border-indigo-400/50 dark:border-white/10 dark:hover:border-indigo-500/30 cursor-pointer flex flex-col relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl -mr-16 -mt-16 transition-opacity opacity-0 group-hover:opacity-100"></div>
                
                <h3 className="text-xl font-bold text-neutral-900 dark:text-neutral-100 mb-2 transition-colors">{p.name}</h3>
                <p className="text-neutral-500 dark:text-neutral-400 text-sm flex-1 line-clamp-3 mb-6 transition-colors">
                  {p.description || "没有添加描述..."}
                </p>
                <div className="flex items-center justify-between text-xs text-neutral-400 dark:text-neutral-500 pt-4 border-t border-neutral-200 dark:border-white/10 mt-auto transition-colors">
                  <span>{p.ownerName ? `创建人: ${p.ownerName}` : `文件数: ${p.files?.length || 0}`}</span>
                  <span>{new Date(p.createdAt).toLocaleDateString()}</span>
                </div>
                {p.sharedWith && p.sharedWith.length > 0 && (
                  <div className="mt-3 text-xs text-indigo-600 dark:text-indigo-300">
                    已指定分享给 {p.sharedWith.length} 人
                  </div>
                )}
                {p.visibility === "public" && (
                  <div className="mt-3 text-xs text-emerald-600 dark:text-emerald-300">
                    全部已登录员工可见
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : null}

      {/* Upload Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl shadow-2xl p-6 md:p-8 animate-in fade-in zoom-in duration-200 transition-colors max-h-[90vh] flex flex-col">
            <h2 className="text-2xl font-bold mb-6 text-neutral-900 dark:text-white transition-colors">添加新的 Profile 分享</h2>
            <form onSubmit={handleUpload} className="flex flex-col flex-1 min-h-0 space-y-5">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2 transition-colors">名称 / 用途</label>
                  <input
                    required
                    type="text"
                    placeholder="例如：开发服测试账密"
                    className="w-full rounded-lg bg-neutral-50 border border-neutral-300 px-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-neutral-950 dark:border-neutral-800 dark:text-neutral-100 transition-colors"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2 transition-colors">描述 (可选)</label>
                  <input
                    type="text"
                    placeholder="补充更多说明..."
                    className="w-full rounded-lg bg-neutral-50 border border-neutral-300 px-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-neutral-950 dark:border-neutral-800 dark:text-neutral-100 transition-colors"
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                  />
                </div>
              </div>

              <fieldset className="space-y-3">
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2 transition-colors">
                  共享范围
                </label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {([
                    ["private", "仅自己可见"],
                    ["selected", "指定员工"],
                    ["public", "全部员工"],
                  ] as const).map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700 dark:border-white/10 dark:bg-neutral-950 dark:text-neutral-200">
                      <input
                        type="radio"
                        name="visibility"
                        value={value}
                        checked={visibility === value}
                        onChange={() => setVisibility(value)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {visibility === "selected" && (
                  <div className="max-h-36 overflow-auto rounded-lg border border-neutral-200 bg-white p-2 dark:border-white/10 dark:bg-neutral-950">
                    {shareUsers.length === 0 ? (
                      <div className="px-2 py-3 text-sm text-neutral-500">还没有可选择的登录用户</div>
                    ) : (
                      shareUsers.map((user) => (
                        <label key={user.dingUserId} className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-white/[0.05]">
                          <span>
                            <span className="font-medium text-neutral-800 dark:text-neutral-100">{user.label}</span>
                            <span className="ml-2 text-xs text-neutral-400">{user.mobile || user.jobNumber || user.dingUserId}</span>
                          </span>
                          <input
                            type="checkbox"
                            checked={selectedShareUsers.includes(user.dingUserId)}
                            onChange={() => toggleSelectedShareUser(user.dingUserId)}
                          />
                        </label>
                      ))
                    )}
                  </div>
                )}
              </fieldset>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2 transition-colors">OPENAI_API_KEY</label>
                  <input
                    required
                    type="text"
                    placeholder="例如：yls-..."
                    className="w-full rounded-lg bg-neutral-50 border border-neutral-300 px-4 py-3 text-neutral-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-neutral-950 dark:border-neutral-800 dark:text-neutral-100 transition-colors"
                    value={openAiApiKey}
                    onChange={(e) => setOpenAiApiKey(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2 transition-colors">base_url</label>
                  <input
                    required
                    type="url"
                    placeholder="例如：https://code.ylsagi.com/codex"
                    className="w-full rounded-lg bg-neutral-50 border border-neutral-300 px-4 py-3 text-neutral-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-neutral-950 dark:border-neutral-800 dark:text-neutral-100 transition-colors"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-4 pt-4 mt-auto">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 rounded-lg bg-neutral-100 text-neutral-700 px-4 py-3 text-sm font-semibold hover:bg-neutral-200 dark:bg-neutral-800 dark:text-white dark:hover:bg-neutral-700 transition-colors"
                >
                  取消
                </button>
                <button
	                  type="submit"
                  disabled={uploading || !name || !openAiApiKey.trim() || !baseUrl.trim() || shareTargetDisabled}
                  className="flex-1 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading ? "正在保存..." : "确认分享"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
