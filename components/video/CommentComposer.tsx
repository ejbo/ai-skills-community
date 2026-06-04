'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import type { VideoCommentView } from '@/lib/video/queries';

interface Props {
  slug: string;
  parentId?: string;
  onPosted: (comment: VideoCommentView) => void;
  autoFocus?: boolean;
}

export function CommentComposer({ slug, parentId, onPosted, autoFocus }: Props) {
  const t = useTranslations('video');
  const router = useRouter();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/videos/${slug}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bodyMd: trimmed, ...(parentId ? { parentId } : {}) }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          pushToast('info', t('login_required'));
          router.push('/auth/login');
          return;
        }
        pushToast('error', '发表失败，请稍后再试');
        return;
      }
      const data = await res.json();
      if (data.comment) {
        onPosted(data.comment as VideoCommentView);
        setBody('');
      }
    } catch {
      pushToast('error', '发表失败，请稍后再试');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex items-end gap-2">
      <textarea
        value={body}
        autoFocus={autoFocus}
        onChange={(e) => setBody(e.target.value.slice(0, 2000))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={parentId ? 2 : 3}
        placeholder={t('comments.placeholder')}
        className="flex-1 resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
      />
      <button
        onClick={submit}
        disabled={sending || !body.trim()}
        className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        {t('comments.post')}
      </button>
    </div>
  );
}
