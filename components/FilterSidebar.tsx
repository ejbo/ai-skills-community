'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState, useTransition, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';

export interface Category {
  id: string;
  slug: string;
  name: string;
}

export function FilterSidebar({ categories }: { categories: Category[] }) {
  const t = useTranslations('browse');
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  const selectedCategory = params.get('category');
  const minRating = Number(params.get('minRating') ?? 0);
  const maxTokens = Number(params.get('maxTokens') ?? 10000);
  const [localTokens, setLocalTokens] = useState(maxTokens);

  useEffect(() => {
    setLocalTokens(maxTokens);
  }, [maxTokens]);

  function update(patch: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) sp.delete(k);
      else sp.set(k, v);
    }
    sp.delete('page');
    startTransition(() => {
      router.push(`${pathname}?${sp.toString()}`, { scroll: false });
    });
  }

  function reset() {
    startTransition(() => router.push(pathname));
  }

  return (
    <aside className="space-y-6">
      <Section title={t('category_label')}>
        <ul className="space-y-1">
          {categories.map((c) => {
            const active = selectedCategory === c.slug;
            return (
              <li key={c.id}>
                <button
                  onClick={() => update({ category: active ? null : c.slug })}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition ${
                    active
                      ? 'bg-accent-500/10 text-accent-700 dark:text-accent-300'
                      : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  <span>{c.name}</span>
                  {active && <X className="h-3.5 w-3.5" />}
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={t('token_cost_label')}>
        <input
          type="range"
          min={0}
          max={10000}
          step={500}
          value={localTokens}
          onChange={(e) => setLocalTokens(Number(e.target.value))}
          onMouseUp={() => update({ maxTokens: localTokens === 10000 ? null : String(localTokens) })}
          onTouchEnd={() => update({ maxTokens: localTokens === 10000 ? null : String(localTokens) })}
          className="w-full accent-accent-500"
        />
        <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums text-muted">
          <span>0</span>
          <span>{localTokens.toLocaleString()}</span>
        </div>
      </Section>

      <Section title={t('rating_label')}>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => update({ minRating: n === minRating ? null : String(n) })}
              className={`h-8 flex-1 rounded-md text-xs font-medium transition ${
                n <= minRating
                  ? 'bg-accent-500/15 text-accent-700 dark:text-accent-300'
                  : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700'
              }`}
            >
              {n}★
            </button>
          ))}
        </div>
      </Section>

      <button
        onClick={reset}
        className="text-xs font-medium text-accent-600 hover:text-accent-700"
      >
        {t('reset_filters')}
      </button>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {children}
    </div>
  );
}
