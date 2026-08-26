'use client';

// 技术专区 — post list controls on the zone home: type chips, sort, in-zone
// search, active tag chip and the 发布 CTA (primary, Magnetic) when canPost.

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PenLine, Search, X } from 'lucide-react';
import { Magnetic } from '@/components/motion';
import { ZONE_POST_SORTS, ZONE_POST_TYPES, isZonePostType, parseZonePostSort, zoneHref } from '@/lib/zones/shared';
import { BTN_PRIMARY, INPUT_CLS, chipCls } from './ui';

export function PostFilters({ slug, canPost }: { slug: string; canPost: boolean }) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(sp.get('q') ?? '');
  useEffect(() => setQ(sp.get('q') ?? ''), [sp]);

  const typeRaw = sp.get('type');
  const type = isZonePostType(typeRaw) ? typeRaw : null;
  const sort = parseZonePostSort(sp.get('sort'));
  const tag = sp.get('tag') ?? '';

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('tab');
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button type="button" onClick={() => update({ type: null })} className={chipCls(!type)} aria-pressed={!type}>
            {t('filters_type_all')}
          </button>
          {ZONE_POST_TYPES.map((tp) => (
            <button
              key={tp}
              type="button"
              onClick={() => update({ type: tp })}
              className={chipCls(type === tp)}
              aria-pressed={type === tp}
            >
              {tl(`zonePostType.${tp}`)}
            </button>
          ))}
        </div>
        {canPost && (
          <Magnetic>
            <Link href={`${zoneHref(slug)}/posts/new`} className={BTN_PRIMARY}>
              <PenLine className="h-4 w-4" />
              {t('zone_publish')}
            </Link>
          </Magnetic>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: q.trim() || null });
          }}
          className="relative w-full sm:w-64"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('filters_post_search_placeholder')}
            className={`${INPUT_CLS} pl-9 pr-8`}
            aria-label={t('filters_post_search_placeholder')}
          />
          {q && (
            <button
              type="button"
              onClick={() => {
                setQ('');
                update({ q: null });
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              aria-label={t('filters_clear')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </form>
        <div className="flex items-center gap-1.5" role="group" aria-label={t('filters_sort')}>
          {ZONE_POST_SORTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => update({ sort: s === 'new' ? null : s })}
              className={chipCls(sort === s)}
              aria-pressed={sort === s}
            >
              {s === 'new' ? t('filters_post_sort_new') : t('filters_post_sort_hot')}
            </button>
          ))}
        </div>
        {tag && (
          <button
            type="button"
            onClick={() => update({ tag: null })}
            className={`${chipCls(true)} inline-flex items-center gap-1 font-mono normal-case`}
          >
            #{tag}
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
