'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BookOpen, Loader2 } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';

interface RelatedDoc {
  slug: string;
  title: string;
  author: string | null;
  docType: string;
  coverUrl: string | null;
  siteName: string | null;
  estReadMinutes: number;
}

/** 相似文档 tab: up to 6 public docs sharing this doc's type / categories. */
export function SimilarTab({ active, docId }: { active: boolean; docId: string }) {
  const t = useTranslations('reader');
  const tl = useTranslations('labels');
  const [docs, setDocs] = useState<RelatedDoc[] | null>(null);

  useEffect(() => {
    if (!active || docs !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/library/docs/${docId}/related`);
        const data = await res.json().catch(() => null);
        if (!cancelled) setDocs(res.ok && Array.isArray(data?.docs) ? data.docs : []);
      } catch {
        if (!cancelled) setDocs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, docId, docs]);

  if (docs === null) {
    return (
      <div className="r-muted flex items-center justify-center gap-2 py-10 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('loading_similar')}
      </div>
    );
  }
  if (docs.length === 0) {
    return (
      <div className="r-muted flex flex-col items-center gap-2 px-6 py-12 text-center text-sm">
        <BookOpen className="h-5 w-5" />
        {t('no_similar_docs')}
      </div>
    );
  }

  return (
    <ul className="space-y-2 p-3">
      {docs.map((d) => (
        <li key={d.slug}>
          <Link
            href={`/library/${d.slug}`}
            className="rborder flex gap-3 rounded-xl border p-2.5 transition hover:bg-[var(--reader-hover)]"
          >
            <div className="rborder grid h-16 w-12 shrink-0 place-items-center overflow-hidden rounded-md border bg-[var(--reader-hover)]">
              {d.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={withBasePath(d.coverUrl)}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <BookOpen className="r-muted h-5 w-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-medium leading-snug">{d.title}</p>
              <p className="r-muted mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="rounded bg-[var(--reader-hover)] px-1.5 py-0.5">
                  {tl(`docType.${d.docType}`)}
                </span>
                {d.siteName && <span className="truncate">{d.siteName}</span>}
                {d.estReadMinutes > 0 && (
                  <span className="shrink-0">{t('n_min_read', { count: d.estReadMinutes })}</span>
                )}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
