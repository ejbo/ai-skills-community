'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Star, Loader2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { RichTextEditor } from '@/components/RichTextEditor';

export function ReviewForm({
  slug,
  existingRating,
  existingBody,
}: {
  slug: string;
  existingRating?: number;
  existingBody?: string;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(existingRating ?? 0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState(existingBody ?? '');
  const [pending, startTransition] = useTransition();

  function submit() {
    if (rating < 1) {
      pushToast('error', '请先打分');
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/skills/${slug}/reviews`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rating, bodyMd: body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        pushToast('error', data.error ?? '保存失败');
        return;
      }
      pushToast('success', existingRating ? '评论已更新' : '评论已发布');
      router.refresh();
    });
  }

  function remove() {
    if (!confirm('删除你的评论？')) return;
    startTransition(async () => {
      const res = await fetch(`/api/skills/${slug}/reviews`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', '删除失败');
        return;
      }
      setRating(0);
      setBody('');
      pushToast('success', '已删除');
      router.refresh();
    });
  }

  return (
    <div className="surface space-y-3 rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{existingRating ? '更新你的评论' : '写一条评论'}</span>
      </div>
      <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((s) => {
          const filled = (hover || rating) >= s;
          return (
            <button
              key={s}
              type="button"
              onMouseEnter={() => setHover(s)}
              onClick={() => setRating(s)}
              className="h-7 w-7"
              aria-label={`${s} star`}
            >
              <Star
                className="h-5 w-5 transition-colors"
                fill={filled ? 'currentColor' : 'none'}
                color={filled ? '#FBBF24' : '#A1A1AA'}
              />
            </button>
          );
        })}
        <span className="ml-2 text-xs text-muted">{rating > 0 ? `${rating} 星` : '点击打分'}</span>
      </div>
      <RichTextEditor
        value={body}
        onChange={setBody}
        variant="compact"
        maxLength={2000}
        placeholder="说点什么（可选）"
        ariaLabel="评论内容"
      />
      <div className="flex items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          {existingRating && (
            <button
              onClick={remove}
              disabled={pending}
              className="h-8 rounded-lg border border-zinc-300 px-3 text-xs transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              删除
            </button>
          )}
          <button
            onClick={submit}
            disabled={pending || body.length > 2000}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-accent-500 px-3 text-xs font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
          >
            {pending && <Loader2 className="h-3 w-3 animate-spin" />}
            {existingRating ? '更新' : '提交'}
          </button>
        </div>
      </div>
    </div>
  );
}
