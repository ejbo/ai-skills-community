'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, X } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { RichTextEditor } from '@/components/RichTextEditor';
import { pushToast } from '@/components/Toaster';
import { currentLoginHref } from '@/lib/auth/callback-path';
import { EMPTY_MEDIA, MediaPicker, mediaCount, mediaPayload, type MediaDraft } from './MediaPicker';
import type { CurrentUser, PostView } from './types';

/**
 * The feed composer: a collapsed "分享你的想法…" trigger that expands into a
 * markdown editor with LinkedIn-style attachments (shared MediaPicker).
 */
export function PostComposer({
  currentUser,
  onPosted,
}: {
  currentUser: CurrentUser | null;
  onPosted: (post: PostView) => void;
}) {
  const t = useTranslations('discussion_ui');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bodyMd, setBodyMd] = useState('');
  const [media, setMedia] = useState<MediaDraft>(EMPTY_MEDIA);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);

  function requireLogin(): boolean {
    if (currentUser) return true;
    pushToast('error', t('login_required'));
    router.push(currentLoginHref());
    return false;
  }

  async function submit() {
    const trimmed = bodyMd.trim();
    if (!trimmed && mediaCount(media) === 0) {
      pushToast('error', t('compose_empty'));
      return;
    }
    if (busy || uploading > 0) return;
    setBusy(true);
    try {
      const res = await fetch('/api/discussion/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bodyMd: trimmed, media: mediaPayload(media) }),
      });
      if (res.status === 401) {
        pushToast('error', t('login_required'));
        router.push(currentLoginHref());
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.reason ?? t('publish_failed_retry'));
        return;
      }
      pushToast('success', t('published'));
      onPosted(data.post as PostView);
      setBodyMd('');
      setMedia(EMPTY_MEDIA);
      setOpen(false);
    } catch {
      pushToast('error', t('publish_failed_retry'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="surface flex items-center gap-3 rounded-2xl p-4">
        <Avatar
          name={currentUser?.displayName ?? t('guest')}
          src={currentUser?.avatarUrl}
          size="md"
        />
        <button
          onClick={() => {
            if (requireLogin()) setOpen(true);
          }}
          className="h-11 flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-4 text-left text-sm text-muted transition hover:border-zinc-400 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-900/60"
        >
          {t('composer_placeholder')}
        </button>
      </div>
    );
  }

  return (
    <div className="surface space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Avatar
            name={currentUser?.displayName ?? ''}
            src={currentUser?.avatarUrl}
            size="sm"
          />
          <span className="text-sm font-medium">{currentUser?.displayName}</span>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label={t('collapse')}
          className="rounded p-1 text-muted hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <RichTextEditor
        value={bodyMd}
        onChange={setBodyMd}
        variant="compact"
        maxLength={8000}
        placeholder={t('composer_placeholder')}
        ariaLabel={t('post_body_aria')}
        autoFocus
      />

      <div className="flex flex-col gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800/60 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <MediaPicker value={media} onChange={setMedia} onUploadingChange={setUploading} />
        </div>
        <button
          onClick={submit}
          disabled={busy || uploading > 0}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-5 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-60"
        >
          {(busy || uploading > 0) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('publish')}
        </button>
      </div>
    </div>
  );
}
