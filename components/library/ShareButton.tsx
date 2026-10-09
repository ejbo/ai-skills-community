'use client';

// 分享 — one click copies the fixed share block (lib/library/share.ts) to the
// clipboard. `icon` is the list-row form (sits above the row's click overlay),
// `button` the detail page's full-width action. `copyText` falls back to
// execCommand so it also works on the plain-HTTP intranet deploy.

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Share2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { copyText } from '@/lib/clipboard';
import { withBasePath } from '@/lib/base-path';
import { librarySourceKind, sourceDetail } from '@/lib/library/source';
import { buildShareText } from '@/lib/library/share';
import { pickText } from '@/lib/library/i18n-content';
import { FORMAT_LABELS } from './SourceLine';

export interface ShareButtonProps {
  slug: string;
  title: string;
  sourceUrl: string | null;
  siteName: string | null;
  author: string | null;
  format: string;
  /** 中文 / English AI 导读 summaries; the viewer's language is picked here. */
  summary: string;
  summaryEn?: string;
  variant?: 'icon' | 'button';
  className?: string;
}

export function ShareButton({
  slug,
  title,
  sourceUrl,
  siteName,
  author,
  format,
  summary,
  summaryEn = '',
  variant = 'icon',
  className = '',
}: ShareButtonProps) {
  const t = useTranslations('library');
  const tl = useTranslations('labels');
  const locale = useLocale();
  const [done, setDone] = useState(false);

  async function share() {
    const kind = librarySourceKind({ sourceUrl, format });
    const detail = sourceDetail({ sourceUrl, siteName, format });
    const source =
      kind === 'file'
        ? (FORMAT_LABELS[format] ?? null)
        : kind === 'web'
          ? detail
          : [tl(`libSource.${kind}`), detail].filter(Boolean).join(' · ');
    const url = `${window.location.origin}${withBasePath(`/library/${encodeURIComponent(slug)}`)}`;
    const text = buildShareText(
      { title, source, author, summary: pickText(locale, summary, summaryEn) || null, url },
      { source: t('share_source'), author: t('share_author'), digest: t('share_digest') },
    );
    const ok = await copyText(text);
    if (ok) {
      setDone(true);
      window.setTimeout(() => setDone(false), 1600);
      pushToast('success', t('share_copied'));
    } else {
      pushToast('error', t('share_copy_failed'));
    }
  }

  if (variant === 'button') {
    return (
      <button
        type="button"
        onClick={() => void share()}
        title={t('share_hint')}
        className={`flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-4 text-sm font-medium transition hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:hover:border-zinc-500 ${className}`}
      >
        {done ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
        {t('share')}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void share()}
      aria-label={t('share')}
      title={t('share_hint')}
      className={`relative z-10 grid h-6 w-6 place-items-center rounded-md text-muted transition hover:bg-zinc-200/70 hover:text-zinc-900 dark:hover:bg-zinc-700/70 dark:hover:text-zinc-50 ${className}`}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
    </button>
  );
}
