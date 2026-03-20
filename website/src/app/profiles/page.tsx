"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Profile {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  files: string[];
}

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);

  // Form states
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [authContent, setAuthContent] = useState("");
  const [configContent, setConfigContent] = useState("");

  useEffect(() => {
    fetch("/api/profiles")
      .then((res) => res.json())
      .then((data) => {
        setProfiles(data);
        setLoading(false);
      });
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !authContent || !configContent) return;
    
    setUploading(true);
    const formData = new FormData();
    formData.append("name", name);
    formData.append("description", desc);
    
    // Create virtual files from text content
    const file1 = new File([authContent], "auth.json", { type: "application/json" });
    const file2 = new File([configContent], "config.toml", { type: "text/plain" });
    
    formData.append("file1", file1);
    formData.append("file2", file2);

    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const newProfile = await res.json();
        setProfiles([newProfile, ...profiles]);
        setShowModal(false);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

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
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 transition-colors active:scale-95 whitespace-nowrap"
        >
          + 添加分享 (上传新 Profile)
        </button>
      </header>

      {/* Profiles Grid */}
      {loading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {[1,2,3].map(i => <div key={i} className="h-48 rounded-2xl bg-neutral-200 dark:bg-white/5" />)}
        </div>
      ) : profiles.length === 0 ? (
        <div className="text-center py-20 text-neutral-500 bg-white/60 dark:bg-white/[0.02] border border-neutral-200 dark:border-white/5 rounded-2xl transition-colors">
          目前还没有分享的 Profile。点击右上角添加。
        </div>
      ) : (
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
                  <span>文件数: {p.files?.length || 0}</span>
                  <span>{new Date(p.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

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

              {/* Text Editors */}
              <div className="grid md:grid-cols-2 gap-4 flex-1 min-h-0">
                <div className="flex flex-col h-full">
                  <label className="block text-sm font-mono font-medium text-indigo-600 dark:text-indigo-400 mb-2 transition-colors">codex/auth.json</label>
                  <textarea
                    required
                    placeholder="在此粘贴 auth.json 的内容..."
                    className="w-full flex-1 rounded-lg bg-neutral-50 border border-neutral-300 px-4 py-3 text-neutral-900 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none dark:bg-neutral-950 dark:border-neutral-800 dark:text-neutral-100 transition-colors custom-scrollbar"
                    value={authContent}
                    onChange={(e) => setAuthContent(e.target.value)}
                  />
                </div>
                <div className="flex flex-col h-full">
                  <label className="block text-sm font-mono font-medium text-emerald-600 dark:text-emerald-400 mb-2 transition-colors">.codex/config.toml</label>
                  <textarea
                    required
                    placeholder="在此粘贴 config.toml 的内容..."
                    className="w-full flex-1 rounded-lg bg-neutral-50 border border-neutral-300 px-4 py-3 text-neutral-900 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none dark:bg-neutral-950 dark:border-neutral-800 dark:text-neutral-100 transition-colors custom-scrollbar"
                    value={configContent}
                    onChange={(e) => setConfigContent(e.target.value)}
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
                  disabled={uploading || !name || !authContent || !configContent}
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
