'use client';

// 技术专区 Wiki — index panel: intro + 最近更新 + 顶层页面 cards. Empty tree ⇒ a
// neutral (monochrome) empty block with 创建第一页 for editors. Recent list is
// derived from the tree client-side (updatedAt desc) — no extra query.

import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, BookOpen, FileText, Plus } from 'lucide-react';
import { StaggerGrid, SpotlightCard } from '@/components/motion';
import { zoneWikiHref } from '@/lib/zones/shared';
import type { WikiTreeNode } from '@/lib/zones/types';
import { RelTime } from '../RelTime';

export interface WikiWelcomeProps {
  zoneSlug: string;
  tree: WikiTreeNode[];
  canWiki: boolean;
}

interface RecentRow {
  id: string;
  slug: string;
  title: string;
  updatedAt: string;
  path: string[];
}

function flatten(nodes: WikiTreeNode[], path: string[] = [], out: RecentRow[] = []): RecentRow[] {
  for (const n of nodes) {
    out.push({ id: n.id, slug: n.slug, title: n.title, updatedAt: n.updatedAt, path });
    flatten(n.children, [...path, n.title], out);
  }
  return out;
}

function countNodes(nodes: WikiTreeNode[]): number {
  let n = 0;
  for (const node of nodes) n += 1 + countNodes(node.children);
  return n;
}

const PRIMARY_BTN =
  'inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200';

export function WikiWelcome({ zoneSlug, tree, canWiki }: WikiWelcomeProps) {
  const t = useTranslations('zones');
  const all = useMemo(() => flatten(tree), [tree]);
  const recent = useMemo(
    () => [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8),
    [all],
  );
  const pageCount = all.length;
  const newHref = `/zones/${zoneSlug}/wiki/new`;

  if (tree.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 px-8 py-20 text-center dark:border-zinc-700">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <BookOpen className="h-5 w-5" />
        </div>
        <h2 className="text-base font-semibold">{t('wiki_empty_title')}</h2>
        <p className="mt-1 max-w-sm text-sm text-muted">
          {canWiki ? t('wiki_empty_desc') : t('wiki_empty_desc_readonly')}
        </p>
        {canWiki && (
          <Link href={newHref} className={`${PRIMARY_BTN} mt-5`}>
            <Plus className="h-4 w-4" />
            {t('wiki_create_first')}
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header className="border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <BookOpen className="h-3.5 w-3.5" />
          {t('wiki_title')}
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{t('wiki_welcome_title')}</h1>
            <p className="mt-1 max-w-xl text-sm text-muted">{t('wiki_welcome_desc')}</p>
            <p className="mt-3 font-mono text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
              {t('wiki_pages_count', { count: pageCount })}
            </p>
          </div>
          {canWiki && (
            <Link href={newHref} className={PRIMARY_BTN}>
              <Plus className="h-4 w-4" />
              {t('wiki_new_page')}
            </Link>
          )}
        </div>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-semibold">{t('wiki_recent_updates')}</h2>
        <StaggerGrid
          items={recent}
          keyOf={(r) => r.id}
          render={(r) => (
            <Link
              href={zoneWikiHref(zoneSlug, r.slug)}
              className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <FileText className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-zinc-900 group-hover:underline dark:text-zinc-50">
                  {r.title}
                </span>
                {r.path.length > 0 && (
                  <span className="block truncate text-[11px] text-muted">{r.path.join(' / ')}</span>
                )}
              </span>
              <RelTime at={r.updatedAt} className="shrink-0 font-mono text-xs tabular-nums text-muted" />
            </Link>
          )}
          className="divide-y divide-zinc-100 dark:divide-zinc-800/70"
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">{t('wiki_top_pages')}</h2>
        <StaggerGrid
          items={tree}
          keyOf={(n) => n.id}
          render={(n) => (
            <SpotlightCard className="surface h-full rounded-xl">
              <Link
                href={zoneWikiHref(zoneSlug, n.slug)}
                className="group flex h-full flex-col justify-between gap-4 p-4"
              >
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    {n.title}
                  </h3>
                  {n.children.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {n.children.slice(0, 3).map((c) => (
                        <li key={c.id} className="truncate text-xs text-muted">
                          {c.title}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs text-muted">
                  <span className="font-mono tabular-nums">
                    {t('wiki_child_count', { count: countNodes(n.children) })}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                </div>
              </Link>
            </SpotlightCard>
          )}
          className="grid gap-3 sm:grid-cols-2"
        />
      </section>
    </div>
  );
}
