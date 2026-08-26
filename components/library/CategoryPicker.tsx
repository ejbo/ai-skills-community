'use client';

// 分类选择器 — official categories first, then whatever members have added,
// then a 新建 box.
//
// Creating is find-or-create on the server: typing a name that already exists
// (in either language, any case) selects THAT category instead of forking the
// taxonomy. Options are fetched once per mount rather than passed down, so
// every picker in the app stays current after someone adds one.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Plus, X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';

export interface CategoryOption {
  slug: string;
  name: string;
  nameEn: string;
  official: boolean;
}

/** Built-ins keep their translated labels; member categories show their name. */
export function categoryLabel(
  opt: CategoryOption,
  locale: string,
  tl: (key: string) => string,
): string {
  if (opt.official) {
    const key = `libCategory.${opt.slug}`;
    const translated = tl(key);
    // next-intl renders the raw key path when a message is missing.
    if (!translated.includes(key)) return translated;
  }
  return locale.startsWith('zh') ? opt.name : opt.nameEn || opt.name;
}

export function CategoryPicker({
  selected,
  onChange,
  disabled,
  max = 4,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  max?: number;
}) {
  const t = useTranslations('library');
  const tl = useTranslations('labels');
  const tc = useTranslations('common');
  const [options, setOptions] = useState<CategoryOption[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(withBasePath('/api/library/categories'));
        const data = await res.json().catch(() => null);
        if (!cancelled && Array.isArray(data?.categories)) setOptions(data.categories);
        else if (!cancelled) setOptions([]);
      } catch {
        if (!cancelled) setOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (slug: string) => {
    if (disabled) return;
    if (selected.includes(slug)) {
      onChange(selected.filter((s) => s !== slug));
    } else if (selected.length >= max) {
      pushToast('info', t('max_categories'));
    } else {
      onChange([...selected, slug]);
    }
  };

  async function create() {
    const name = draft.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const res = await fetch(withBasePath('/api/library/categories'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.category) {
        pushToast('error', t('category_create_failed'));
        return;
      }
      const cat = data.category as CategoryOption;
      setOptions((prev) => (prev?.some((c) => c.slug === cat.slug) ? prev : [...(prev ?? []), cat]));
      if (!selected.includes(cat.slug) && selected.length < max) onChange([...selected, cat.slug]);
      pushToast('success', data.created ? t('category_created') : t('category_reused'));
      setDraft('');
      setAdding(false);
    } catch {
      pushToast('error', t('network_error_retry'));
    } finally {
      setCreating(false);
    }
  }

  if (options === null) {
    return (
      <div className="flex h-8 items-center text-xs text-muted">
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        {tc('loading')}
      </div>
    );
  }

  const locale = typeof document !== 'undefined' ? document.documentElement.lang || 'zh' : 'zh';
  // Selected-but-unknown slugs still render, so a category deleted in 管理后台
  // never silently drops off a document the member is editing.
  const extra = selected
    .filter((s) => !options.some((o) => o.slug === s))
    .map((slug) => ({ slug, name: slug, nameEn: slug, official: false }));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {[...options, ...extra].map((c) => {
        const on = selected.includes(c.slug);
        return (
          <button
            key={c.slug}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => toggle(c.slug)}
            className={`rounded-full px-2.5 py-1 text-xs transition disabled:opacity-60 ${
              on
                ? 'bg-zinc-900 dark:bg-zinc-100 font-medium text-white dark:text-zinc-900'
                : c.official
                  ? 'border border-zinc-200 text-muted hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700'
                  : 'border border-dashed border-zinc-300 text-muted hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-600'
            }`}
          >
            {categoryLabel(c, locale, tl)}
          </button>
        );
      })}

      {adding ? (
        <span className="inline-flex items-center gap-1">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 24))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void create();
              } else if (e.key === 'Escape') {
                setAdding(false);
                setDraft('');
              }
            }}
            placeholder={t('category_new_placeholder')}
            className="h-7 w-32 rounded-full border border-zinc-900 dark:border-zinc-100 bg-transparent px-2.5 text-xs outline-none"
          />
          <button
            type="button"
            disabled={creating || draft.trim().length < 2}
            onClick={() => void create()}
            className="grid h-6 w-6 place-items-center rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 disabled:opacity-50"
            aria-label={tc('save')}
          >
            {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setDraft('');
            }}
            aria-label={tc('cancel')}
            className="grid h-6 w-6 place-items-center rounded-full text-muted hover:text-danger"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-zinc-300 px-2.5 py-1 text-xs text-muted transition hover:border-zinc-400 hover:text-zinc-900 disabled:opacity-60 dark:border-zinc-600"
        >
          <Plus className="h-3 w-3" />
          {t('category_new')}
        </button>
      )}
    </div>
  );
}
