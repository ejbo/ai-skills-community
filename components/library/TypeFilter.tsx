'use client';

// 类型 facet (书籍 / 论文 / 博客 / …) as a quiet dropdown next to 排序. It used to
// be the page's tab bar; the research brief (Readwise, Lobsters) is explicit
// that FORMAT is a facet that narrows the one list, never the top-level
// navigation — that is the 版块 rail now. Writes `?type=`; 全部 = delete the param.

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronDown, Shapes } from 'lucide-react';
import { DOC_TYPES, isDocType } from '@/lib/library/types';

export function TypeFilter() {
  const t = useTranslations('library');
  const tl = useTranslations('labels');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get('type');
  const current = isDocType(raw) ? raw : '';
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  function select(type: string) {
    const sp = new URLSearchParams(params.toString());
    if (!type) sp.delete('type');
    else sp.set('type', type);
    sp.delete('page');
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    setOpen(false);
  }

  const options = [{ key: '', label: t('type_all') }, ...DOC_TYPES.map((k) => ({ key: k as string, label: tl(`docType.${k}`) }))];
  const label = current ? tl(`docType.${current}`) : t('type_filter');

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex h-9 items-center gap-1.5 rounded-lg border bg-white px-3 text-sm transition dark:bg-zinc-900 ${
          current
            ? 'border-zinc-900 dark:border-zinc-100'
            : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800'
        }`}
      >
        <Shapes className="h-3.5 w-3.5 text-zinc-900 dark:text-zinc-50" />
        {label}
        <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
      </button>
      {open && (
        <div role="listbox" className="surface absolute right-0 top-full z-30 mt-2 w-36 rounded-xl p-1 shadow-lg">
          {options.map((o) => (
            <button
              key={o.key}
              role="option"
              aria-selected={current === o.key}
              onClick={() => select(o.key)}
              className={`block w-full rounded-lg px-3 py-1.5 text-left text-sm transition ${
                current === o.key
                  ? 'bg-zinc-900/[0.06] text-zinc-900 dark:bg-white/10 dark:text-zinc-50'
                  : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
