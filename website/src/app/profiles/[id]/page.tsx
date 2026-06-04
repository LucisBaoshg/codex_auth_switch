"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { withBasePath } from "@/lib/base-path";
import { formatSharedProfileConfig } from "@/lib/shared-profile-config";

interface Profile {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt?: string;
  files: string[];
  ownerDingUserId?: string;
  ownerName?: string | null;
  ownerMobile?: string | null;
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

export default function ProfileDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [shareUsers, setShareUsers] = useState<ShareUserOption[]>([]);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  // Edit states
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editVisibility, setEditVisibility] = useState<ShareVisibility>("private");
  const [editSelectedShareUsers, setEditSelectedShareUsers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(withBasePath("/api/auth/me"))
      .then((res) => res.json())
      .then((data) => {
        setCurrentUser(data.user);
        if (data.user) {
          fetch(withBasePath("/api/users"))
            .then((res) => (res.ok ? res.json() : { users: [] }))
            .then((usersData) => setShareUsers(usersData.users || []))
            .catch(() => setShareUsers([]));
        }
      })
      .catch(() => setCurrentUser(null));

    fetch(withBasePath(`/api/profiles/${id}`))
      .then((res) => {
        if (res.status === 401) {
          setError("需要先使用钉钉 SSO 登录");
          setLoading(false);
          return null;
        }
        if (!res.ok) {
          setLoading(false);
          return null;
        }
        return res.json();
      })
      .then(async (data) => {
        if (!data) return;
        setProfile(data);
        setEditName(data.name);
        setEditDesc(data.description);
        setEditVisibility(data.visibility || ((data.sharedWith || []).length > 0 ? "selected" : "private"));
        setEditSelectedShareUsers(data.sharedWith || []);
        
        if (data.files && data.files.length > 0) {
          const contents: Record<string, string> = {};
          for (const file of data.files) {
            try {
              const fileRes = await fetch(withBasePath(`/api/profiles/${id}/${file}`));
              contents[file] = fileRes.ok ? await fileRes.text() : "无法读取文件内容";
            } catch (err) {
              contents[file] = "无法读取文件内容";
            }
          }
          setFileContents(contents);
        }
        setLoading(false);
      });
  }, [id]);

  const handleCopy = (content: string) => {
    // navigator.clipboard requires HTTPS; fallback for HTTP/Mac
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(content).catch(() => fallbackCopy(content));
    } else {
      fallbackCopy(content);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fallbackCopy = (content: string) => {
    const textarea = document.createElement("textarea");
    textarea.value = content;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  };

  const handleSaveEdit = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(withBasePath(`/api/profiles/${id}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          description: editDesc,
          visibility: editVisibility,
          sharedWith: editVisibility === "selected" ? editSelectedShareUsers : [],
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setProfile(updated);
        setEditVisibility(updated.visibility || ((updated.sharedWith || []).length > 0 ? "selected" : "private"));
        setEditSelectedShareUsers(updated.sharedWith || []);
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
        <h1 className="text-2xl text-neutral-900 dark:text-white mb-4">{error || "找不到 Profile"}</h1>
        {!currentUser && (
          <a href={withBasePath(`/api/auth/login?returnTo=/profiles/${id}`)} className="inline-flex rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors mr-3">
            钉钉 SSO 登录
          </a>
        )}
        <Link href="/profiles" className="text-indigo-600 dark:text-indigo-400 font-medium">返回列表</Link>
      </div>
    );
  }

  const isOwner = Boolean(profile.ownerDingUserId && currentUser?.dingUserId === profile.ownerDingUserId);
  const sharedConfig = formatSharedProfileConfig(fileContents);
  const shareTargetDisabled = editVisibility === "selected" && editSelectedShareUsers.length === 0;
  const toggleSelectedShareUser = (dingUserId: string) => {
    setEditSelectedShareUsers((current) =>
      current.includes(dingUserId)
        ? current.filter((id) => id !== dingUserId)
        : [...current, dingUserId],
    );
  };
  const shareScopeLabel =
    profile.visibility === "public"
      ? "全部员工"
      : profile.sharedWith && profile.sharedWith.length > 0
        ? `指定 ${profile.sharedWith.length} 人`
        : "仅创建人";

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
                <fieldset className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-3">
                    {([
                      ["private", "仅自己可见"],
                      ["selected", "指定员工"],
                      ["public", "全部员工"],
                    ] as const).map(([value, label]) => (
                      <label key={value} className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700 dark:border-white/10 dark:bg-neutral-950 dark:text-neutral-200">
                        <input
                          type="radio"
                          name="editVisibility"
                          value={value}
                          checked={editVisibility === value}
                          onChange={() => setEditVisibility(value)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  {editVisibility === "selected" && (
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
                              checked={editSelectedShareUsers.includes(user.dingUserId)}
                              onChange={() => toggleSelectedShareUser(user.dingUserId)}
                            />
                          </label>
                        ))
                      )}
                    </div>
                  )}
                </fieldset>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setEditName(profile.name);
                      setEditDesc(profile.description);
                      setEditVisibility(profile.visibility || ((profile.sharedWith || []).length > 0 ? "selected" : "private"));
                      setEditSelectedShareUsers(profile.sharedWith || []);
                      setIsEditing(false);
                    }}
                    className="px-4 py-2 text-sm font-medium rounded-lg text-neutral-700 bg-neutral-100 hover:bg-neutral-200 dark:text-white dark:bg-neutral-800 dark:hover:bg-neutral-700 transition-colors"
                  >
                    取消
                  </button>
	                  <button
                    onClick={handleSaveEdit}
                    disabled={saving || !editName.trim() || shareTargetDisabled}
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
                  {isOwner && (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="opacity-0 group-hover:opacity-100 px-3 py-1.5 text-xs text-indigo-700 bg-indigo-100 hover:bg-indigo-200 dark:text-indigo-300 dark:bg-indigo-500/20 dark:hover:bg-indigo-500/30 rounded-md transition-all active:scale-95"
                    >
                      修改资料
                    </button>
                  )}
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
        <div className="grid gap-3 sm:grid-cols-3 rounded-2xl border border-neutral-200 bg-white/60 p-4 text-sm dark:border-white/10 dark:bg-white/[0.03]">
          <div>
            <div className="text-neutral-400">创建人</div>
            <div className="mt-1 text-neutral-800 dark:text-neutral-200">{profile.ownerName || "历史共享配置"}</div>
          </div>
          <div>
            <div className="text-neutral-400">共享范围</div>
            <div className="mt-1 text-neutral-800 dark:text-neutral-200">
              {shareScopeLabel}
            </div>
          </div>
          <div>
            <div className="text-neutral-400">您的权限</div>
            <div className="mt-1 text-neutral-800 dark:text-neutral-200">{isOwner ? "可编辑" : "只读"}</div>
          </div>
        </div>
      </header>

      <div className="space-y-8">
        <h2 className="text-2xl font-semibold text-neutral-900 dark:text-white pt-4 border-t border-neutral-200 dark:border-white/10 transition-colors">共享配置</h2>
        
        <div className="rounded-2xl border border-neutral-200 bg-white/80 dark:border-white/10 dark:bg-white/[0.02] shadow-sm overflow-hidden transition-colors">
          <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 bg-neutral-100 dark:bg-black/40 dark:border-white/10 transition-colors">
            <span className="font-mono text-sm text-neutral-700 dark:text-neutral-300 transition-colors">OPENAI API</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleCopy(sharedConfig)}
                disabled={!sharedConfig}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-neutral-200 hover:bg-neutral-300 text-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/5 dark:hover:bg-white/10 dark:text-white transition-colors text-center min-w-[70px] active:scale-95"
              >
                {copied ? "已复制!" : "复制"}
              </button>
            </div>
          </div>
          <div className="p-6 overflow-x-auto custom-scrollbar">
            <pre className="text-xs font-mono text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap break-words transition-colors">
              {sharedConfig || "加载内容中..."}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
