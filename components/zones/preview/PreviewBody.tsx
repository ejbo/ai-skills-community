'use client';

// Drawer content: resolves the target through `/api/zones/embed` (the same
// server gate the cards use) and dispatches to the per-kind preview. The
// reader stylesheet is imported HERE (once) because the library and office
// previews render stored chapter / slide HTML inside `.reader-root` +
// `.reader-prose` — the reader's own typography, not the markdown prose.

import '@/app/library/[slug]/read/reader.css';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import type { EmbedData } from '@/lib/zones/types';
import { describeEmbed, fetchEmbed } from '@/components/zones/embeds/EmbedCard';
import type { PreviewTarget } from './PreviewProvider';
import { LibraryPreview } from './kinds/LibraryPreview';
import { ShortPreview } from './kinds/ShortPreview';
import { VideoPreview } from './kinds/VideoPreview';
import { SkillPreview } from './kinds/SkillPreview';
import { PackPreview } from './kinds/PackPreview';
import { EventPreview } from './kinds/EventPreview';
import { PostPreview } from './kinds/PostPreview';
import { FilePreview } from './kinds/FilePreview';
import { LinkPreview } from './kinds/LinkPreview';

export interface PreviewResolvedInfo {
  title?: string;
  href?: string;
  external?: boolean;
}

export function PreviewBody({
  target,
  onResolved,
}: {
  target: PreviewTarget;
  onResolved: (info: PreviewResolvedInfo) => void;
}) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  const [embed, setEmbed] = useState<EmbedData | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEmbed(null);
    fetchEmbed(target.kind, target.ref).then((e) => {
      if (!cancelled) setEmbed(e);
    });
    return () => {
      cancelled = true;
    };
  }, [target.kind, target.ref]);

  const model = useMemo(() => (embed && embed.ok ? describeEmbed(embed, t, tl) : null), [embed, t, tl]);

  useEffect(() => {
    if (!model) return;
    onResolved({ title: model.title, href: model.href, external: model.external });
    // onResolved is stable per frame (provider closure) — re-running on identity churn is harmless but pointless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  if (!embed) {
    return (
      <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted" aria-busy>
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('preview_loading')}
      </div>
    );
  }

  if (!embed.ok) {
    const key =
      embed.reason === 'forbidden'
        ? 'embed_fail_forbidden'
        : embed.reason === 'not_found'
          ? 'embed_fail_not_found'
          : embed.reason === 'invalid'
            ? 'embed_fail_invalid'
            : 'embed_fail_error';
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-sm font-medium">{t(key)}</p>
        <p className="mt-1 break-all font-mono text-xs text-muted">{target.ref}</p>
      </div>
    );
  }

  return (
    <div className="px-5 py-5">
      {embed.kind === 'library' && <LibraryPreview data={embed.data} />}
      {embed.kind === 'short' && <ShortPreview data={embed.data} />}
      {embed.kind === 'video' && <VideoPreview data={embed.data} />}
      {embed.kind === 'skill' && <SkillPreview data={embed.data} />}
      {embed.kind === 'pack' && <PackPreview data={embed.data} />}
      {embed.kind === 'event' && <EventPreview data={embed.data} />}
      {embed.kind === 'post' && <PostPreview data={embed.data} />}
      {embed.kind === 'file' && <FilePreview data={embed.data} />}
      {embed.kind === 'link' && <LinkPreview data={embed.data} />}
    </div>
  );
}
