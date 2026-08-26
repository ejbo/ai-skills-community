'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Package, Puzzle } from 'lucide-react';
import type { EmbedPackData } from '@/lib/zones/types';
import { fmtCount } from '@/components/zones/embeds/EmbedCard';
import { InstallSnippet } from './SkillPreview';

export function PackPreview({ data }: { data: EmbedPackData }) {
  const t = useTranslations('zones');
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-xl dark:border-zinc-800 dark:bg-zinc-900">
          {data.icon ? <span aria-hidden>{data.icon}</span> : <Package className="h-5 w-5 text-muted" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight">{data.name}</h2>
          {data.summary && <p className="mt-1 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{data.summary}</p>}
          <p className="mt-1.5 flex gap-3 font-mono text-[11px] tabular-nums text-muted">
            <span>{t('embed_meta_skills', { count: data.skills.length })}</span>
            <span>{t('embed_meta_installs', { count: fmtCount(data.installCount) })}</span>
          </p>
        </div>
      </div>

      <InstallSnippet cmd={data.installCmd} />

      {data.skills.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t('preview_pack_members')}</h3>
          <ul className="mt-2 divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {data.skills.map((s) => (
              <li key={s.slug}>
                <Link
                  href={`/skills/${s.slug}`}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <Puzzle className="h-3.5 w-3.5 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted">{s.slug}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link
        href={data.href}
        className="inline-flex h-9 items-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {t('preview_open_pack')}
      </Link>
    </div>
  );
}
