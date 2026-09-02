'use client';

// 附件 panel (right rail on desktop, under the body on mobile). A click opens
// the preview panel; the row whose target is currently open is marked
// (`aria-current` + ink border, via `usePreview().current`), and every open
// carries the post's attachments as `siblings` so the panel's ↑/↓ can step
// through them. `via` comes from the card (`'keyboard'` for Enter/Space) so
// focus management in the panel matches how it was opened.

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Paperclip } from 'lucide-react';
import type { ZoneAttachmentView } from '@/lib/zones/types';
import { AttachmentList } from '@/components/zones/attachments/AttachmentList';
import { usePreview, type PreviewTarget } from '@/components/zones/preview/PreviewProvider';

/** Rows shown per group before the 「还有 N 个」 disclosure (a rail, not a gallery). */
const RAIL_LIMIT_PER_GROUP = 12;

export function PostAttachmentsPanel({ attachments, className = '' }: { attachments: ZoneAttachmentView[]; className?: string }) {
  const t = useTranslations('zones');
  const preview = usePreview();
  const siblings = useMemo<PreviewTarget[]>(() => attachments.map((a) => ({ kind: 'file', ref: a.id, title: a.name })), [attachments]);
  if (attachments.length === 0) return null;
  const activeRef = preview.current?.kind === 'file' ? preview.current.ref : null;
  return (
    <section className={className} aria-label={t('post_attachments')}>
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <Paperclip className="h-3 w-3" />
        {t('post_attachments')}
        <span className="font-mono tabular-nums">{attachments.length}</span>
      </h3>
      <AttachmentList
        compact
        items={attachments}
        activeRef={activeRef}
        onOpenItem={(a, _index, via) => preview.open({ kind: 'file', ref: a.id, title: a.name, siblings, via })}
        limitPerGroup={RAIL_LIMIT_PER_GROUP}
      />
    </section>
  );
}
