'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronDown, TrendingUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

// 与 lib/library-queries.ts 的 LIBRARY_SORTS 保持一致（值模块含 Prisma，
// 客户端组件不能 runtime import，故在此复制枚举）。
const SORTS = ['newest', 'featured', 'shelved', 'views'] as const;
type Sort = (typeof SORTS)[number];

/** 排序下拉（SortMenu 式样）：写 `?sort=`，默认 newest 删参。 */
export function LibrarySort() {
  const t = useTranslations('library_cards');
  const tb = useTranslations('browse');
  const LABELS: Record<Sort, string> = {
    newest: tb('sort_newest'),
    featured: t('sort_featured'),
    shelved: t('sort_shelved'),
    views: t('sort_views'),
  };
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get('sort');
  const current: Sort = SORTS.includes(raw as Sort) ? (raw as Sort) : 'newest';
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  function select(s: Sort) {
    const sp = new URLSearchParams(params.toString());
    if (s === 'newest') sp.delete('sort');
    else sp.set('sort', s);
    sp.delete('page');
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-sm transition hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <TrendingUp className="h-3.5 w-3.5 text-accent-500" />
        {LABELS[current]}
        <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
      </button>
      {open && (
        <div className="surface absolute right-0 top-full z-30 mt-2 w-40 rounded-xl p-1 shadow-lg">
          {SORTS.map((key) => (
            <button
              key={key}
              onClick={() => select(key)}
              className={`block w-full rounded-lg px-3 py-1.5 text-left text-sm transition ${
                current === key
                  ? 'bg-accent-500/10 text-accent-700 dark:text-accent-300'
                  : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {LABELS[key]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
