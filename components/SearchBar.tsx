'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { useState, useTransition, useEffect } from 'react';
import { useTranslations } from 'next-intl';

// Per-tab in-page search: submits ?q= to the CURRENT pathname, so it always
// searches the section it sits in (library, videos, skills, discussion, /search).
export function SearchBar({ placeholder }: { placeholder?: string }) {
  const t = useTranslations('nav');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(params.get('q') ?? '');
  const [, startTransition] = useTransition();

  useEffect(() => setValue(params.get('q') ?? ''), [params]);

  function submit(q: string) {
    const sp = new URLSearchParams(params.toString());
    if (q.trim()) sp.set('q', q.trim());
    else sp.delete('q');
    sp.delete('page');
    startTransition(() => router.push(`${pathname}?${sp.toString()}`, { scroll: false }));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
      className="relative w-full"
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? t('search_in_page')}
        className="h-11 w-full rounded-xl border border-zinc-200 bg-white pl-10 pr-9 text-sm transition focus:border-zinc-900 dark:focus:border-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue('');
            submit('');
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          aria-label="Clear"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </form>
  );
}
