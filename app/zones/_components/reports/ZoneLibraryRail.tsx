'use client';

// 版块的「资料」：本版块报告收录进知识库的文档，点开在右侧并排阅读面板里打开（zones 已有的 dock）。

import { useTranslations } from 'next-intl';
import { BookOpen } from 'lucide-react';
import { usePreview } from '@/components/zones/preview/PreviewProvider';
import type { ZoneLibraryDocCard } from '@/lib/zones/reports/library';
import { CARD_CLS, PILL_MONO, SECTION_TITLE_CLS } from '../ui';

export function ZoneLibraryRail({ docs }: { docs: ZoneLibraryDocCard[] }) {
  const t = useTranslations('zones');
  const preview = usePreview();
  return (
    <section className={`${CARD_CLS} p-4`}>
      <h2 className={`${SECTION_TITLE_CLS} flex items-center gap-1.5`}>
        <BookOpen className="h-3.5 w-3.5" />
        {t('reports_library_title')}
      </h2>
      {docs.length === 0 ? (
        <p className="mt-2 text-xs text-muted">{t('reports_library_empty')}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {docs.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => preview.open({ kind: 'library', ref: d.slug, title: d.title, via: 'pointer' })} className="w-full text-left">
                <span className="line-clamp-2 text-sm font-medium underline-offset-2 hover:underline">{d.title}</span>
                <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                  <span className={PILL_MONO}>{d.format}</span>
                  <span className="truncate">{d.reportTitle}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
