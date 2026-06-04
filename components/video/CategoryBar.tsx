'use client';

import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

interface CategoryBarProps {
  categories: { slug: string; name: string }[];
  active?: string;
}

export function CategoryBar({ categories, active }: CategoryBarProps) {
  const t = useTranslations('video');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const current = active ?? params.get('category') ?? '';

  function select(slug: string | null) {
    const sp = new URLSearchParams(params.toString());
    if (slug) sp.set('category', slug);
    else sp.delete('category');
    sp.delete('page');
    startTransition(() => router.push(`${pathname}?${sp.toString()}`, { scroll: false }));
  }

  return (
    <div
      className={`flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
        isPending ? 'opacity-70' : ''
      }`}
    >
      <Pill active={!current} onClick={() => select(null)}>
        {t('feed.all_categories')}
      </Pill>
      {categories.map((c) => (
        <Pill key={c.slug} active={current === c.slug} onClick={() => select(c.slug)}>
          {c.name}
        </Pill>
      ))}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
        active
          ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900'
          : 'surface text-muted hover:text-zinc-900 dark:hover:text-zinc-100'
      }`}
    >
      {children}
    </button>
  );
}
