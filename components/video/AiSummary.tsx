'use client';

import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

export function AiSummary({ slug }: { slug: string }) {
  const t = useTranslations('video');
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
    <div className="surface rounded-2xl p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="h-4 w-4 text-accent-600" />
        {t('ai.summary_title')}
      </div>
      {loading ? (
        <div className="flex items-center gap-1.5 text-sm text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('ai.generating')}
        </div>
      ) : summary ? (
        <MarkdownRenderer content={summary} />
      ) : (
        <p className="text-sm text-muted">{t('ai.summary_empty')}</p>
      )}
    </div>
  );
}
