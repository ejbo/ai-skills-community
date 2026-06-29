'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import { RichTextEditor } from '@/components/RichTextEditor';
import type { VideoCommentView } from '@/lib/video/queries';

interface Props {
  slug: string;
  parentId?: string;
  // The specific comment being answered (used when replying to a reply, so the
  // right person gets the "your reply was replied to" notification). DB threading
  // stays flat — parentId is always the thread root.
  replyToId?: string;
  onPosted: (comment: VideoCommentView) => void;
  autoFocus?: boolean;
}

export function CommentComposer({ slug, parentId, replyToId, onPosted, autoFocus }: Props) {
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
        body: JSON.stringify({
          bodyMd: trimmed,
          ...(parentId ? { parentId } : {}),
          ...(replyToId ? { replyToId } : {}),
        }),
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
      <div className="min-w-0 flex-1">
        <RichTextEditor
          value={body}
          onChange={setBody}
          variant="compact"
          maxLength={2000}
          autoFocus={autoFocus}
          placeholder={t('comments.placeholder')}
          ariaLabel={t('comments.placeholder')}
        />
      </div>
      <button
        onClick={submit}
        disabled={sending || !body.trim() || body.length > 2000}
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        {t('comments.post')}
      </button>
    </div>
  );
}
