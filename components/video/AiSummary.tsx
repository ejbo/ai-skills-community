'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { linkifyStamps } from '@/lib/video/timestamps';
import { SeekLinks } from './player/SeekLinks';

// Content-only: the surrounding fixed-height container + title live in AiPanel.
// The summary is pre-generated (on upload, and again once subtitles produced a
// transcript), so this only fetches the cached value. `[12:34]` entries of its
// 时间线 become seek links.
export function AiSummary({ slug }: { slug: string }) {
  const t = useTranslations('video');
  const tc = useTranslations('common');
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/videos/${slug}/summary`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => {
        if (cancelled) return;
        setSummary(typeof data.summaryMd === 'string' && data.summaryMd.trim() ? data.summaryMd : null);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <div className="h-full overflow-auto p-4">
      {loading ? (
        <div className="flex items-center gap-1.5 text-sm text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {tc('loading')}
        </div>
      ) : summary ? (
        <SeekLinks>
          <MarkdownRenderer content={linkifyStamps(summary)} compact />
        </SeekLinks>
      ) : (
        <p className="text-sm text-muted">{t('ai.summary_empty')}</p>
      )}
    </div>
  );
}
