"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";

interface Profile {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  files: string[];
}

export default function ProfileDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  // Edit states
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/profiles/${id}`)
      .then((res) => res.json())
      .then(async (data) => {
        setProfile(data);
        setEditName(data.name);
        setEditDesc(data.description);
        
        if (data.files && data.files.length > 0) {
          const contents: Record<string, string> = {};
          for (const file of data.files) {
            try {
              const fileRes = await fetch(`/api/profiles/${id}/${file}`);
              contents[file] = await fileRes.text();
            } catch (err) {
              contents[file] = "无法读取文件内容";
            }
          }
          setFileContents(contents);
        }
        setLoading(false);
      });
  }, [id]);

  const handleCopy = (fileName: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopied(fileName);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleSaveEdit = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/profiles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, description: editDesc }),
      });
      if (res.ok) {
        const updated = await res.json();
        setProfile(updated);
        setIsEditing(false);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="max-w-4xl mx-auto px-6 py-20 animate-pulse text-neutral-900 dark:text-white transition-colors">加载中...</div>;
  }

  if (!profile) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-20 text-center transition-colors">
        <h1 className="text-2xl text-neutral-900 dark:text-white mb-4">找不到 Profile</h1>
        <Link href="/profiles" className="text-indigo-600 dark:text-indigo-400 font-medium">返回列表</Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-16 space-y-10 relative z-10 transition-colors">
      <Link href="/profiles" className="inline-block text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 text-sm transition-colors">
        &larr; 返回列表
      </Link>
      
      <header className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-4 flex-1">
            {isEditing ? (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-lg bg-neutral-50 border border-neutral-300 px-4 py-2 text-2xl font-bold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-neutral-950 dark:border-neutral-800 dark:text-white transition-colors"
                  placeholder="Profile 名称"
                />
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full rounded-lg bg-neutral-50 border border-neutral-300 px-4 py-2 text-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-neutral-950 dark:border-neutral-800 dark:text-neutral-400 transition-colors resize-none"
                  placeholder="Profile 描述"
                  rows={2}
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setEditName(profile.name);
                      setEditDesc(profile.description);
                      setIsEditing(false);
                    }}
                    className="px-4 py-2 text-sm font-medium rounded-lg text-neutral-700 bg-neutral-100 hover:bg-neutral-200 dark:text-white dark:bg-neutral-800 dark:hover:bg-neutral-700 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={saving || !editName.trim()}
                    className="px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                  >
                    {saving ? "保存中..." : "保存修改"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="group">
                <div className="flex items-center gap-4">
                  <h1 className="text-4xl font-bold text-neutral-900 dark:text-white tracking-tight transition-colors">
                    {profile.name}
                  </h1>
                  <button
                    onClick={() => setIsEditing(true)}
                    className="opacity-0 group-hover:opacity-100 px-3 py-1.5 text-xs text-indigo-700 bg-indigo-100 hover:bg-indigo-200 dark:text-indigo-300 dark:bg-indigo-500/20 dark:hover:bg-indigo-500/30 rounded-md transition-all active:scale-95"
                  >
                    修改资料
                  </button>
                </div>
                <p className="text-neutral-600 dark:text-neutral-400 text-lg leading-relaxed transition-colors mt-4">
                  {profile.description || "无描述信息"}
                </p>
              </div>
            )}
          </div>
          
          <div className="text-xs text-neutral-500 font-mono transition-colors md:text-right pt-2">
            ID: {profile.id} <br className="hidden sm:block" />
            <span className="sm:hidden">|</span>
            创建时间: {new Date(profile.createdAt).toLocaleString()}
          </div>
        </div>
      </header>

      <div className="space-y-8">
        <h2 className="text-2xl font-semibold text-neutral-900 dark:text-white pt-4 border-t border-neutral-200 dark:border-white/10 transition-colors">授权文件对</h2>
        
        {profile.files?.map((fileName) => (
          <div key={fileName} className="rounded-2xl border border-neutral-200 bg-white/80 dark:border-white/10 dark:bg-white/[0.02] shadow-sm overflow-hidden transition-colors">
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 bg-neutral-100 dark:bg-black/40 dark:border-white/10 transition-colors">
              <span className="font-mono text-sm text-neutral-700 dark:text-neutral-300 transition-colors">{fileName}</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleCopy(fileName, fileContents[fileName] || "")}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-neutral-200 hover:bg-neutral-300 text-neutral-800 dark:bg-white/5 dark:hover:bg-white/10 dark:text-white transition-colors text-center min-w-[70px] active:scale-95"
                >
                  {copied === fileName ? "已复制!" : "复制"}
                </button>
                <a
                  href={`/api/profiles/${profile.id}/${fileName}`}
                  download={fileName}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-500/20 dark:text-indigo-300 dark:hover:bg-indigo-500/30 transition-colors text-center active:scale-95"
                >
                  下载
                </a>
              </div>
            </div>
            <div className="p-6 overflow-x-auto max-h-[400px] overflow-y-auto custom-scrollbar">
              <pre className="text-xs font-mono text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap break-words transition-colors">
                {fileContents[fileName] || "加载内容中..."}
              </pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
