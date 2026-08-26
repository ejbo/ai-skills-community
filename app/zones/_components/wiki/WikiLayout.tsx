'use client';

// 技术专区 Wiki — two-column shell: sticky page tree on the left (collapsible
// disclosure under lg), the page / welcome panel on the right. Client only for
// the mobile disclosure + the tree filter box; `children` is server-rendered.

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BookOpen, ChevronDown, Plus, Search } from 'lucide-react';
import type { WikiTreeNode } from '@/lib/zones/types';
import { WikiTree } from './WikiTree';

export interface WikiLayoutProps {
  zoneSlug: string;
  tree: WikiTreeNode[];
  activeId: string | null;
  canWiki: boolean;
  children: ReactNode;
}

function countNodes(nodes: WikiTreeNode[]): number {
  let n = 0;
  for (const node of nodes) n += 1 + countNodes(node.children);
  return n;
}

export function WikiLayout({ zoneSlug, tree, activeId, canWiki, children }: WikiLayoutProps) {
  const t = useTranslations('zones');
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const pageCount = countNodes(tree);

  return (
    <div className="grid gap-8 lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
        <div className="flex items-center justify-between gap-2">
          {/* Mobile: disclosure toggle. Desktop: the tree is always visible, so a plain heading. */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="wiki-tree-panel"
            className="flex min-w-0 items-center gap-2 text-sm font-semibold lg:hidden"
          >
            <BookOpen className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
            <span className="truncate">{t('wiki_title')}</span>
            <span className="font-mono text-xs font-normal tabular-nums text-muted">
              {t('wiki_pages_count', { count: pageCount })}
            </span>
            <ChevronDown
              className={`h-4 w-4 text-zinc-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
            />
          </button>
          <h2 className="hidden min-w-0 items-center gap-2 text-sm font-semibold lg:flex">
            <BookOpen className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
            <span className="truncate">{t('wiki_title')}</span>
            <span className="font-mono text-xs font-normal tabular-nums text-muted">
              {t('wiki_pages_count', { count: pageCount })}
            </span>
          </h2>
          {canWiki && (
            <Link
              href={`/zones/${zoneSlug}/wiki/new`}
              title={t('wiki_new_page')}
              aria-label={t('wiki_new_page')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 transition hover:bg-zinc-900 hover:text-white dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-50 dark:hover:text-zinc-900"
            >
              <Plus className="h-4 w-4" />
            </Link>
          )}
        </div>

        <div
          id="wiki-tree-panel"
          className={`${open ? 'block' : 'hidden'} mt-3 rounded-xl border border-zinc-200 p-2 dark:border-zinc-800 lg:block lg:border-0 lg:p-0`}
        >
          {pageCount > 0 && (
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t('wiki_search_placeholder')}
                aria-label={t('wiki_search_placeholder')}
                className="h-8 w-full rounded-md border border-zinc-200 bg-white pl-8 pr-2 text-sm placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-600"
              />
            </label>
          )}
          <nav
            aria-label={t('wiki_title')}
            className="scroll-thin mt-3 lg:max-h-[calc(100vh-11rem)] lg:overflow-y-auto lg:pr-1"
          >
            <WikiTree
              zoneSlug={zoneSlug}
              tree={tree}
              activeId={activeId}
              canWiki={canWiki}
              filter={filter}
            />
          </nav>
        </div>
      </aside>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
