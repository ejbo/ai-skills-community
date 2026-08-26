'use client';

import { useTranslations } from 'next-intl';
import { Paperclip } from 'lucide-react';
import type { ZoneAttachmentView } from '@/lib/zones/types';
import { AttachmentList } from '@/components/zones/attachments/AttachmentList';

/** 附件 panel (right rail on desktop, under the body on mobile) — click opens the preview drawer. */
export function PostAttachmentsPanel({ attachments, className = '' }: { attachments: ZoneAttachmentView[]; className?: string }) {
  const t = useTranslations('zones');
  if (attachments.length === 0) return null;
  return (
    <section className={className} aria-label={t('post_attachments')}>
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <Paperclip className="h-3 w-3" />
        {t('post_attachments')}
        <span className="font-mono tabular-nums">{attachments.length}</span>
      </h3>
      <AttachmentList items={attachments} compact />
    </section>
  );
}
