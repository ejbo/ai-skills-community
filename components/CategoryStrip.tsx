'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

export function CategoryStrip({ categories }: { categories: Array<{ slug: string; name: string }> }) {
  const t = useTranslations('browse');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const selected = params.get('category');

  function select(slug: string | null) {
    const sp = new URLSearchParams(params.toString());
    if (slug) sp.set('category', slug);
    else sp.delete('category');
    sp.delete('page');
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
  }

  return (
    <div className="relative -mx-2 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex gap-1.5 pb-1">
        <Pill active={!selected} onClick={() => select(null)} label={t('all')} />
        {categories.map((c) => (
          <Pill
            key={c.slug}
            active={selected === c.slug}
            onClick={() => select(c.slug)}
            label={c.name}
          />
        ))}
      </div>
    </div>
  );
}

function Pill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900/[0.06] dark:bg-white/10 text-zinc-900 dark:text-zinc-50'
          : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
      }`}
    >
      {label}
    </button>
  );
}
