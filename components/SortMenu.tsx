'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronDown, TrendingUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type Sort = 'trending' | 'downloads' | 'newest' | 'top_rated';

export function SortMenu() {
  const t = useTranslations('browse');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const current = (params.get('sort') as Sort) ?? 'trending';
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const labels: Record<Sort, string> = {
    trending: t('sort_trending'),
    downloads: t('sort_downloads'),
    newest: t('sort_newest'),
    top_rated: t('sort_top_rated'),
  };

  function select(s: Sort) {
    const sp = new URLSearchParams(params.toString());
    if (s === 'trending') sp.delete('sort');
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
        {labels[current]}
        <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
      </button>
      {open && (
        <div className="surface absolute right-0 top-full z-30 mt-2 w-48 rounded-xl p-1 shadow-lg">
          {(Object.keys(labels) as Sort[]).map((key) => (
            <button
              key={key}
              onClick={() => select(key)}
              className={`block w-full rounded-lg px-3 py-1.5 text-left text-sm transition ${
                current === key
                  ? 'bg-accent-500/10 text-accent-700 dark:text-accent-300'
                  : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {labels[key]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
