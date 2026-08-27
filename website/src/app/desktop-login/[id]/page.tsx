"use client";

import { use, useEffect, useState } from "react";
import { withBasePath } from "@/lib/base-path";

type Confirmation = {
  userCode: string;
  expiresAt: string;
  completed: boolean;
};

export default function DesktopLoginConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ legacy?: string | string[] }>;
}) {
  const { id } = use(params);
  const legacy = use(searchParams).legacy === "1";
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(withBasePath(`/api/auth/desktop-login/${id}/confirm`), { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 401 ? "请先完成钉钉 SSO 登录。" : "登录请求不存在或已过期。");
        return response.json() as Promise<Confirmation>;
      })
      .then((result) => {
        setConfirmation(result);
        setApproved(result.completed);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  }, [id]);

  async function approve() {
    setApproving(true);
    setError("");
    try {
      const response = await fetch(withBasePath(`/api/auth/desktop-login/${id}/confirm`), {
        method: "POST",
      });
      if (!response.ok) throw new Error("确认失败，登录请求可能已经过期。");
      setApproved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setApproving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <section className="mx-auto max-w-lg rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-400">Codex Auth Switch</p>
        <h1 className="mt-3 text-3xl font-semibold">确认桌面端登录</h1>
        {loading ? <p className="mt-6 text-slate-300">正在读取登录请求…</p> : null}
        {confirmation ? (
          <>
            {legacy ? (
              <p className="mt-5 rounded-xl bg-amber-950 px-4 py-3 text-amber-200">
                检测到旧版桌面客户端，无法在应用内显示验证码。仅当你刚刚在自己的桌面应用中主动点击了“钉钉 SSO 登录”时才允许登录；建议尽快升级客户端。
              </p>
            ) : (
              <p className="mt-5 text-slate-300">请确认桌面应用中显示的是以下验证码。若你没有主动登录，请关闭本页。</p>
            )}
            <div className="mt-6 rounded-2xl bg-slate-950 px-6 py-5 text-center font-mono text-3xl font-bold tracking-[0.2em] text-indigo-300">
              {confirmation.userCode}
            </div>
            {legacy ? (
              <p className="mt-3 text-center text-xs text-amber-300">旧版客户端不能比对此验证码，本次授权需由你在网页中明确确认。</p>
            ) : null}
            <p className="mt-3 text-center text-xs text-slate-500">
              有效期至 {new Date(confirmation.expiresAt).toLocaleString("zh-CN")}
            </p>
            {approved ? (
              <p className="mt-6 rounded-xl bg-emerald-950 px-4 py-3 text-emerald-300">已授权，可以返回桌面应用。</p>
            ) : (
              <button
                type="button"
                onClick={approve}
                disabled={approving}
                className="mt-6 w-full rounded-xl bg-indigo-600 px-5 py-3 font-semibold hover:bg-indigo-500 disabled:opacity-60"
              >
                {approving ? "正在确认…" : legacy ? "这是我刚刚发起的登录，允许登录" : "验证码一致，允许登录"}
              </button>
            )}
          </>
        ) : null}
        {error ? <p className="mt-6 rounded-xl bg-rose-950 px-4 py-3 text-rose-300">{error}</p> : null}
      </section>
    </main>
  );
}
