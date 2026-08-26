'use client';

// External link: an OG card and a "打开链接" button. NEVER an <iframe> — the
// intranet blocks embeds and third-party pages set X-Frame-Options anyway.

import { useTranslations } from 'next-intl';
import { ExternalLink, Link2 } from 'lucide-react';
import type { EmbedLinkData } from '@/lib/zones/types';
import { hostnameOf } from '@/lib/zones/shared';

export function LinkPreview({ data }: { data: EmbedLinkData }) {
  const t = useTranslations('zones');
  const host = data.hostname || hostnameOf(data.url);
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
        {data.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.imageUrl} alt="" referrerPolicy="no-referrer" className="aspect-[2/1] w-full bg-zinc-100 object-cover dark:bg-zinc-900" />
        ) : (
          <div className="flex aspect-[2/1] w-full items-center justify-center bg-zinc-50 text-zinc-300 dark:bg-zinc-900 dark:text-zinc-700">
            <Link2 className="h-10 w-10" />
          </div>
        )}
        <div className="p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted">{data.siteName || host}</p>
          <h2 className="mt-1 text-base font-semibold leading-snug tracking-tight">{data.title || host}</h2>
          {data.description && <p className="mt-1.5 line-clamp-4 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{data.description}</p>}
          <p className="mt-2 break-all font-mono text-[11px] text-muted">{data.url}</p>
        </div>
      </div>

      <p className="text-xs text-muted">{t('preview_link_note')}</p>

      <a
        href={data.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        <ExternalLink className="h-4 w-4" />
        {t('preview_open_link')}
      </a>
    </div>
  );
}
