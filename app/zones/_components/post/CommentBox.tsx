'use client';

// Comment composer (root reply, threaded reply, or in-place edit) — compact
// RichTextEditor, the site's 2-level flat thread contract: `parentId` is the
// thread ROOT, `replyToId` only routes the notification.

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { RichTextEditor } from '@/components/RichTextEditor';
import { pushToast } from '@/components/Toaster';
import { ZONE_LIMITS } from '@/lib/zones/shared';
import type { ZoneCommentView, ZoneCurrentUser } from '@/lib/zones/types';

export function CommentBox({
  zoneSlug,
  postId,
  currentUser,
  parentId,
  replyToId,
  editing,
  placeholder,
  autoFocus,
  onPosted,
  onCancel,
}: {
  zoneSlug: string;
  postId: string;
  currentUser: ZoneCurrentUser;
  parentId?: string;
  replyToId?: string;
  /** Edit mode: PATCH this comment instead of creating one. */
  editing?: { commentId: string; initialBody: string };
  placeholder?: string;
  autoFocus?: boolean;
  onPosted: (c: ZoneCommentView) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations('zones');
  const tc = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const [bodyMd, setBodyMd] = useState(editing?.initialBody ?? '');
  const [busy, setBusy] = useState(false);
  const tooLong = bodyMd.trim().length > ZONE_LIMITS.commentMax;

  async function submit() {
    const trimmed = bodyMd.trim();
    if (!trimmed || tooLong || busy) return;
    setBusy(true);
    try {
      const res = editing
        ? await fetch(`/api/zones/comments/${encodeURIComponent(editing.commentId)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ bodyMd: trimmed }),
          })
        : await fetch(`/api/zones/${encodeURIComponent(zoneSlug)}/posts/${encodeURIComponent(postId)}/comments`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ bodyMd: trimmed, ...(parentId ? { parentId } : {}), ...(replyToId ? { replyToId } : {}) }),
          });
      if (res.status === 401) {
        pushToast('error', t('post_login_required'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { comment?: ZoneCommentView; reason?: string; error?: string };
      if (!res.ok) {
        pushToast('error', data.reason ?? (data.error === 'locked' ? t('comment_locked') : t('comment_send_failed')));
        return;
      }
      if (!editing) setBodyMd('');
      onPosted(data.comment ?? ({} as ZoneCommentView));
    } catch {
      pushToast('error', t('comment_send_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start gap-2.5">
      {!editing && <Avatar name={currentUser.displayName} src={currentUser.avatarUrl} size="sm" tone="neutral" className="mt-1" />}
      <div className="min-w-0 flex-1 space-y-2">
        <RichTextEditor
          value={bodyMd}
          onChange={setBodyMd}
          variant="compact"
          maxLength={ZONE_LIMITS.commentMax}
          placeholder={placeholder ?? t('comment_placeholder')}
          ariaLabel={t('comment_aria')}
          autoFocus={autoFocus}
        />
        <div className="flex items-center justify-end gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} className="h-8 rounded-lg px-3 text-xs font-medium text-muted transition hover:bg-zinc-100 dark:hover:bg-zinc-800">
              {tc('cancel')}
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={busy || !bodyMd.trim() || tooLong}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            {editing ? tc('save') : t('comment_send')}
          </button>
        </div>
      </div>
    </div>
  );
}
