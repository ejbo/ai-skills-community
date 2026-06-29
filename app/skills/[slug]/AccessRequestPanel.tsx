'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Clock, Send } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

export type RequestState = 'none' | 'pending' | 'rejected' | 'revoked';

/**
 * Shown in place of the install/download area on a RESTRICTED skill when the
 * viewer can't yet access content. Drives the apply-for-download flow.
 */
export function AccessRequestPanel({
  slug,
  state,
  loggedIn,
}: {
  slug: string;
  state: RequestState;
  loggedIn: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);

  async function apply() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/skills/${slug}/access-request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: message.trim() || undefined }),
      });
      if (res.ok) {
        pushToast('success', '申请已提交，请等待作者审批');
        startTransition(() => router.refresh());
      } else if (res.status === 401) {
        router.push(`/auth/login?callbackUrl=/skills/${slug}`);
      } else {
        const j = await res.json().catch(() => ({}));
        pushToast('error', j.message || '提交失败，请稍后再试');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const shell = 'surface rounded-2xl border border-warn/30 p-4';

  if (!loggedIn) {
    return (
      <div className={shell}>
        <div className="flex items-center gap-2 text-sm font-medium">
          <Lock className="h-4 w-4 text-warn" />
          此 Skill 为「受限下载」
        </div>
        <p className="mt-1.5 text-sm text-muted">
          查看文件、手动下载与 <code className="rounded bg-zinc-100 px-1 font-mono text-[12px] dark:bg-zinc-800">skills install</code> 安装都需要作者批准，请先登录后申请。
        </p>
        <button
          onClick={() => router.push(`/auth/login?callbackUrl=/skills/${slug}`)}
          className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-3 text-sm font-medium text-white transition hover:bg-accent-600"
        >
          登录后申请
        </button>
      </div>
    );
  }

  if (state === 'pending') {
    return (
      <div className={shell}>
        <div className="flex items-center gap-2 text-sm font-medium text-warn">
          <Clock className="h-4 w-4" />
          申请审核中…
        </div>
        <p className="mt-1.5 text-sm text-muted">你的下载申请已提交，作者批准后即可下载安装。</p>
      </div>
    );
  }

  return (
    <div className={shell}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <Lock className="h-4 w-4 text-warn" />
        此 Skill 为「受限下载」
      </div>
      <p className="mt-1.5 text-sm text-muted">
        查看文件、手动下载与 <code className="rounded bg-zinc-100 px-1 font-mono text-[12px] dark:bg-zinc-800">skills install</code> 安装都需要作者批准。
        {state === 'rejected' && '上次申请未通过，你可以重新申请。'}
        {state === 'revoked' && '你的访问权限已被撤销，你可以重新申请。'}
      </p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="（可选）申请理由，便于作者了解你的用途"
        maxLength={500}
        rows={2}
        className="mt-3 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-accent-500 dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        onClick={apply}
        disabled={submitting || pending}
        className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-3 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
      >
        <Send className="h-3.5 w-3.5" />
        申请下载
      </button>
    </div>
  );
}
