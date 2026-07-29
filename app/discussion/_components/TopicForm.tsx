'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { DiscussionCategory } from '@prisma/client';
import { RichTextEditor } from '@/components/RichTextEditor';
import { pushToast } from '@/components/Toaster';
import { CATEGORY_META } from './badges';

const CATEGORIES = Object.entries(CATEGORY_META) as [
  DiscussionCategory,
  (typeof CATEGORY_META)[DiscussionCategory],
][];

/**
 * Shared forum-topic form: creates a topic (POST) or edits an existing one
 * (PATCH) depending on whether `topicId` is given.
 */
export function TopicForm({
  topicId,
  initialTitle = '',
  initialBodyMd = '',
  initialCategory = 'general',
}: {
  topicId?: string;
  initialTitle?: string;
  initialBodyMd?: string;
  initialCategory?: DiscussionCategory;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [title, setTitle] = useState(initialTitle);
  const [category, setCategory] = useState<DiscussionCategory>(initialCategory);
  const [bodyMd, setBodyMd] = useState(initialBodyMd);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (title.trim().length < 4) {
      pushToast('error', '标题至少 4 个字');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(topicId ? `/api/discussion/topics/${topicId}` : '/api/discussion/topics', {
        method: topicId ? 'PATCH' : 'POST',
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
        pushToast('error', data.reason ?? (topicId ? '保存失败，请重试' : '发布失败，请重试'));
        return;
      }
      pushToast('success', topicId ? '已保存' : '已发布');
      const id = topicId ?? (data.topic?.id as string);
      router.push(`/discussion/topics/${id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface space-y-4 rounded-2xl p-5">
      <input
        autoFocus={!topicId}
        placeholder="一句话说清楚讨论主题（必填）"
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
        className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
      />

      <div className="flex flex-wrap items-center gap-2">
        {CATEGORIES.map(([key, meta]) => (
          <button
            key={key}
            onClick={() => setCategory(key)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              category === key
                ? 'border-accent-500 bg-accent-500/10 font-medium text-accent-600 dark:text-accent-300'
                : `border-transparent ${meta.className} hover:border-accent-400`
            }`}
          >
            {meta.label}
          </button>
        ))}
      </div>

      <RichTextEditor
        value={bodyMd}
        onChange={setBodyMd}
        variant="full"
        maxLength={20000}
        placeholder="展开说说：背景、想讨论的问题、你的看法…（支持 Markdown，可粘贴图片）"
        ariaLabel="帖子正文"
      />

      <div className="flex justify-end gap-2">
        <button
          onClick={() => router.back()}
          className="h-9 rounded-lg px-4 text-sm font-medium text-muted transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          取消
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-5 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {topicId ? '保存' : '发布'}
        </button>
      </div>
    </div>
  );
}
