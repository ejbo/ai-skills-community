'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Lock, LockOpen, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

/**
 * Inline moderation on the topic detail page (feedback-board pattern):
 * admin pin/lock toggles, author edit link, author/admin delete.
 */
export function TopicActions({
  topicId,
  pinned,
  locked,
  canModerate,
  isAuthor,
}: {
  topicId: string;
  pinned: boolean;
  locked: boolean;
  canModerate: boolean;
  isAuthor: boolean;
}) {
  const t = useTranslations('discussion_ui');
  const tc = useTranslations('common');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function patch(data: { pinned?: boolean; locked?: boolean }, okMsg: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/discussion/topics/${topicId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        pushToast('error', t('action_failed'));
        return;
      }
      pushToast('success', okMsg);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(t('delete_topic_confirm'))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/discussion/topics/${topicId}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', t('delete_failed'));
        setBusy(false);
        return;
      }
      pushToast('success', t('deleted'));
      router.push('/discussion?tab=forum');
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  if (!canModerate && !isAuthor) return null;

  const btn =
    'flex h-8 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 transition hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200';

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {isAuthor && (
        <Link href={`/discussion/topics/${topicId}/edit`} className={btn}>
          <Pencil className="h-3.5 w-3.5" />
          {tc('edit')}
        </Link>
      )}
      {canModerate && (
        <>
          <button
            onClick={() => patch({ pinned: !pinned }, pinned ? t('unpinned') : t('pinned_done'))}
            disabled={busy}
            className={btn}
          >
            {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            {pinned ? t('unpin') : t('pin')}
          </button>
          <button
            onClick={() => patch({ locked: !locked }, locked ? t('unlocked') : t('locked_done'))}
            disabled={busy}
            className={btn}
          >
            {locked ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            {locked ? t('unlock') : t('lock')}
          </button>
        </>
      )}
      <button onClick={remove} disabled={busy} className={`${btn} hover:!border-danger hover:!text-danger`}>
        <Trash2 className="h-3.5 w-3.5" />
        {tc('delete')}
      </button>
    </div>
  );
}
