'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2, MessageSquarePlus, X } from 'lucide-react';
import type { FeedbackCategory } from '@prisma/client';
import { pushToast } from '@/components/Toaster';
import { RichTextEditor } from '@/components/RichTextEditor';
import { CATEGORY_META } from './badges';

const CATEGORIES = Object.entries(CATEGORY_META) as [
  FeedbackCategory,
  (typeof CATEGORY_META)[FeedbackCategory],
][];

/** Collapsed "提交反馈" button that expands into the inline new-feedback form. */
export function FeedbackComposer({ loggedIn }: { loggedIn: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<FeedbackCategory>('feature');
  const [bodyMd, setBodyMd] = useState('');
  const [busy, setBusy] = useState(false);

  function openForm() {
    if (!loggedIn) {
      pushToast('error', '请先登录再提交反馈');
      router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
      return;
    }
    setOpen(true);
  }

  async function submit() {
    if (title.trim().length < 4) {
      pushToast('error', '标题至少 4 个字');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), category, bodyMd }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        pushToast('error', '请先登录');
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      if (!res.ok) {
        pushToast('error', data.reason ?? '提交失败，请重试');
        return;
      }
      pushToast('success', '已提交，感谢反馈！');
      router.push(`/feedback/${data.feedback.id}`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={openForm}
        className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600"
      >
        <MessageSquarePlus className="h-4 w-4" />
        提交反馈
      </button>
    );
  }

  return (
    <div className="surface w-full space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">提交反馈</h3>
        <button
          onClick={() => setOpen(false)}
          aria-label="收起"
          className="rounded p-1 text-muted hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <input
        autoFocus
        placeholder="一句话说清楚问题或建议（必填）"
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
        className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
      />

      <div className="flex items-center gap-2">
        {CATEGORIES.map(([key, meta]) => (
          <button
            key={key}
            onClick={() => setCategory(key)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              category === key
                ? 'border-accent-500 bg-accent-500/10 font-medium text-accent-600 dark:text-accent-300'
                : `${meta.className} hover:border-accent-400`
            }`}
          >
            {meta.label}
          </button>
        ))}
      </div>

      <RichTextEditor
        value={bodyMd}
        onChange={setBodyMd}
        variant="compact"
        maxLength={10000}
        placeholder="补充细节：现状、期望、复现步骤…（可选）"
        ariaLabel="反馈正文"
      />

      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={busy}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          提交
        </button>
      </div>
    </div>
  );
}
