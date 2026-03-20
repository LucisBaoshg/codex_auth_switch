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

  useEffect(() => {
    fetch(`/api/profiles/${id}`)
      .then((res) => res.json())
      .then(async (data) => {
        setProfile(data);
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
        <h1 className="text-4xl font-bold text-neutral-900 dark:text-white tracking-tight transition-colors">{profile.name}</h1>
        <p className="text-neutral-600 dark:text-neutral-400 text-lg leading-relaxed transition-colors">{profile.description || "无描述信息"}</p>
        <div className="text-xs text-neutral-500 font-mono transition-colors">
          ID: {profile.id} | 创建时间: {new Date(profile.createdAt).toLocaleString()}
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
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-neutral-200 hover:bg-neutral-300 text-neutral-700 dark:bg-white/5 dark:hover:bg-white/10 dark:text-white transition-colors text-center min-w-[70px]"
                >
                  {copied === fileName ? "已复制!" : "复制"}
                </button>
                <a
                  href={`/api/profiles/${profile.id}/${fileName}`}
                  download={fileName}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-500/20 dark:text-indigo-300 dark:hover:bg-indigo-500/30 transition-colors text-center"
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
