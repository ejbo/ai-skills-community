'use client';

// 评论 overlay for the shorts players, on the shared HostPanel shell:
// transparent click-catcher (video keeps playing, never grays out), slides
// from inside the player. 'sheet' = mobile bottom sheet in the fullscreen
// feed; 'panel' = right-side panel inside an embedded player.
// Host wraps the conditional render in <AnimatePresence> for the exit slide.

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CommentSection } from '@/components/video/CommentSection';
import type { VideoCommentView } from '@/lib/video/queries';
import { HostPanel, PANEL_SCROLL_CLS } from './HostPanel';
import type { ShortsCurrentUser, ShortView } from './types';

interface Props {
  short: ShortView;
  currentUser: ShortsCurrentUser | null;
  /** Deep-linked comment to scroll/highlight (notification ?focus=), else null. */
  focusCommentId: string | null;
  variant?: 'sheet' | 'panel';
  onClose: () => void;
}

export function ShortsCommentsDrawer({
  short,
  currentUser,
  focusCommentId,
  variant = 'sheet',
  onClose,
}: Props) {
  const t = useTranslations('shorts');
  const [data, setData] = useState<{
    comments: VideoCommentView[];
    nextCursor: string | null;
  } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    (async () => {
      try {
        const res = await fetch(`/api/videos/${short.slug}/comments?sort=top`);
        if (!res.ok) throw new Error('failed');
        const d = await res.json();
        if (cancelled) return;
        setData({ comments: d.comments ?? [], nextCursor: d.nextCursor ?? null });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [short.slug]);

  return (
    <HostPanel variant={variant} title={t('comments')} closeLabel={t('close')} onClose={onClose}>
      <div className={`${PANEL_SCROLL_CLS} px-4 py-4`}>
        {data ? (
          <CommentSection
            key={short.slug}
            slug={short.slug}
            initialComments={data.comments}
            initialCursor={data.nextCursor}
            focusCommentId={focusCommentId}
            currentUser={
              currentUser
                ? {
                    id: currentUser.id,
                    isAdmin: currentUser.isAdmin,
                    handle: currentUser.handle,
                  }
                : null
            }
          />
        ) : failed ? (
          <p className="py-10 text-center text-sm text-zinc-400">{t('load_failed')}</p>
        ) : (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          </div>
        )}
      </div>
    </HostPanel>
  );
}
