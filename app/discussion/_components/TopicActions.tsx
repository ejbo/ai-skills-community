'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  isAdmin,
  isAuthor,
}: {
  topicId: string;
  pinned: boolean;
  locked: boolean;
  isAdmin: boolean;
  isAuthor: boolean;
}) {
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
        pushToast('error', '操作失败');
        return;
      }
      pushToast('success', okMsg);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('确定删除这个帖子？所有回复和 +1 会一并删除。')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/discussion/topics/${topicId}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', '删除失败');
        setBusy(false);
        return;
      }
      pushToast('success', '已删除');
      router.push('/discussion?tab=forum');
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  if (!isAdmin && !isAuthor) return null;

  const btn =
    'flex h-8 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 transition hover:border-accent-500 hover:text-accent-700 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200';

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {isAuthor && (
        <Link href={`/discussion/topics/${topicId}/edit`} className={btn}>
          <Pencil className="h-3.5 w-3.5" />
          编辑
        </Link>
      )}
      {isAdmin && (
        <>
          <button
            onClick={() => patch({ pinned: !pinned }, pinned ? '已取消置顶' : '已置顶')}
            disabled={busy}
            className={btn}
          >
            {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            {pinned ? '取消置顶' : '置顶'}
          </button>
          <button
            onClick={() => patch({ locked: !locked }, locked ? '已解锁' : '已锁定')}
            disabled={busy}
            className={btn}
          >
            {locked ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            {locked ? '解锁' : '锁定'}
          </button>
        </>
      )}
      <button onClick={remove} disabled={busy} className={`${btn} hover:!border-danger hover:!text-danger`}>
        <Trash2 className="h-3.5 w-3.5" />
        删除
      </button>
    </div>
  );
}
