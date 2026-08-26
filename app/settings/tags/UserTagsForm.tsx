'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff, Loader2, Tag } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { tagColorClass } from '@/lib/user-tags';

interface OwnTag {
  key: string;
  name: string;
  description: string | null;
  color: string;
  kind: 'manual' | 'auto';
  hidden: boolean;
}

/** 我的标签 — the member decides which badges their 用户卡片 shows. */
export function UserTagsForm() {
  const t = useTranslations('settings');
  const [tags, setTags] = useState<OwnTag[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/me/tags');
        const data = await res.json().catch(() => null);
        setTags(Array.isArray(data?.tags) ? data.tags : []);
      } catch {
        setTags([]);
      }
    })();
  }, []);

  async function toggle(tag: OwnTag) {
    if (busy) return;
    setBusy(tag.key);
    const next = !tag.hidden;
    setTags((prev) => prev?.map((x) => (x.key === tag.key ? { ...x, hidden: next } : x)) ?? prev);
    try {
      const res = await fetch('/api/me/tags', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: tag.key, hidden: next }),
      });
      if (!res.ok) throw new Error('failed');
    } catch {
      setTags((prev) => prev?.map((x) => (x.key === tag.key ? { ...x, hidden: !next } : x)) ?? prev);
      pushToast('error', t('save_failed'));
    } finally {
      setBusy(null);
    }
  }

  if (tags === null) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (tags.length === 0) {
    return <p className="py-6 text-sm text-muted">{t('tags_empty')}</p>;
  }

  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
      {tags.map((tag) => (
        <li key={tag.key} className="flex items-start gap-3 py-3">
          <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${tagColorClass(tag.color)}`}>
            {tag.name}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">
              {tag.kind === 'auto' ? t('tag_kind_auto') : t('tag_kind_manual')}
            </p>
            {tag.description && (
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{tag.description}</p>
            )}
          </div>
          <button
            type="button"
            disabled={busy === tag.key}
            onClick={() => void toggle(tag)}
            aria-pressed={!tag.hidden}
            title={tag.hidden ? t('tag_show') : t('tag_hide')}
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition disabled:opacity-60 ${
              tag.hidden
                ? 'border-zinc-200 text-muted hover:border-zinc-400 dark:border-zinc-700'
                : 'border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-50'
            }`}
          >
            {tag.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {tag.hidden ? t('tag_hidden') : t('tag_shown')}
          </button>
        </li>
      ))}
    </ul>
  );
}
