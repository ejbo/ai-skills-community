'use client';

// 发帖时的分类选择器。两段结构，对应 lib/discussion-tags.ts 的两级模型：
//
//   1. 主题分类（official）—— 就是左侧栏那一组，服务端直接渲染进来，平铺成
//      chip。必选 1..MAX_OFFICIAL_TAGS 个。
//   2. 自定义分类 —— 默认只有一个「+ 添加」按钮，展开才搜索/新建。刻意不预先
//      铺开全站已有的自建分类：那正是「一拉出来一长串」的样子，而侧栏之所以
//      干净，就是因为自建分类从不参与导航。
//
// 新建走 find-or-create（POST /api/discussion/tags）：输入一个已存在的名字会
// 选中那一个而不是分叉出近似重复项 —— 与知识库分类同一套规则。

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Plus, Search, X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import {
  MAX_CUSTOM_TAGS,
  MAX_OFFICIAL_TAGS,
  TAG_NAME_MAX,
  TAG_NAME_MIN,
  normalizeTagName,
  type DiscussionTagOption,
} from '@/lib/discussion-tags';
import { useTagLabel } from './badges';

export function TopicTagPicker({
  officialTags,
  /** 已选 slug，官方在前（父组件持有，提交时原样发出去）。 */
  value,
  onChange,
  /** 编辑老帖时把已选分类的完整信息带进来，免得自建分类先显示成裸 slug。 */
  knownTags = [],
  disabled,
}: {
  officialTags: DiscussionTagOption[];
  value: string[];
  onChange: (next: string[]) => void;
  knownTags?: DiscussionTagOption[];
  disabled?: boolean;
}) {
  const t = useTranslations('discussion_ui');
  const tc = useTranslations('common');
  const label = useTagLabel();

  // slug → 分类信息。官方那组 + 传进来的已选 + 搜出来/新建的，都往这里塞。
  const [known, setKnown] = useState<Map<string, DiscussionTagOption>>(
    () => new Map([...officialTags, ...knownTags].map((tag) => [tag.slug, tag])),
  );
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [results, setResults] = useState<DiscussionTagOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const officialSlugs = new Set(officialTags.map((tag) => tag.slug));
  const selectedOfficial = value.filter((slug) => officialSlugs.has(slug));
  const selectedCustom = value.filter((slug) => !officialSlugs.has(slug));

  function remember(tags: DiscussionTagOption[]) {
    setKnown((prev) => {
      const next = new Map(prev);
      for (const tag of tags) next.set(tag.slug, tag);
      return next;
    });
  }

  function viewOf(slug: string): DiscussionTagOption {
    return known.get(slug) ?? { slug, name: slug, nameEn: slug, official: false };
  }

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // 输入框用 `autoFocus`（面板只在展开时挂载，React 在 commit 时聚焦）**再加**
  // 一帧后的补聚焦：刚插过引用时 tiptap 的 .chain().focus() 是异步落地的，会把
  // 焦点抢回正文 —— 只靠一个 setTimeout 就会出现"打开面板直接打字，字进了正文"。
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // 展开时才打网络：空词给最常用的几个，有词就搜。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/discussion/tags?q=${encodeURIComponent(draft.trim())}`)
        .then(async (res) => {
          if (cancelled) return;
          const data = (await res.json().catch(() => null)) as { tags?: DiscussionTagOption[] } | null;
          const tags = res.ok && Array.isArray(data?.tags) ? data.tags : [];
          setResults(tags);
          remember(tags);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft]);

  function toggleOfficial(slug: string) {
    if (disabled) return;
    if (value.includes(slug)) {
      onChange(value.filter((s) => s !== slug));
      return;
    }
    if (selectedOfficial.length >= MAX_OFFICIAL_TAGS) {
      pushToast('info', t('max_official_tags', { max: MAX_OFFICIAL_TAGS }));
      return;
    }
    // 官方分类始终排在自建之前 —— categories[0] 因此恒为 official。
    onChange([...selectedOfficial, slug, ...selectedCustom]);
  }

  function addCustom(tag: DiscussionTagOption) {
    if (disabled) return;
    remember([tag]);
    if (value.includes(tag.slug)) {
      setOpen(false);
      setDraft('');
      return;
    }
    if (selectedCustom.length >= MAX_CUSTOM_TAGS) {
      pushToast('info', t('max_custom_tags', { max: MAX_CUSTOM_TAGS }));
      return;
    }
    onChange([...value, tag.slug]);
    setDraft('');
    setOpen(false);
  }

  function removeCustom(slug: string) {
    if (disabled) return;
    onChange(value.filter((s) => s !== slug));
  }

  async function createTag() {
    const name = normalizeTagName(draft);
    if (creating || name.length < TAG_NAME_MIN) return;
    setCreating(true);
    try {
      const res = await fetch('/api/discussion/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        pushToast('error', t('login_required'));
        return;
      }
      if (!res.ok || !data?.tag) {
        pushToast('error', t('custom_tag_failed'));
        return;
      }
      pushToast('success', data.created ? t('custom_tag_created') : t('custom_tag_reused'));
      addCustom(data.tag as DiscussionTagOption);
    } catch {
      pushToast('error', t('custom_tag_failed'));
    } finally {
      setCreating(false);
    }
  }

  const draftName = normalizeTagName(draft);
  // 名字已经存在就不给「创建」——那条结果自己就在列表里。
  const canCreate =
    draftName.length >= TAG_NAME_MIN &&
    draftName.length <= TAG_NAME_MAX &&
    !results.some((tag) => tag.name.toLowerCase() === draftName.toLowerCase());

  return (
    <div className="space-y-3">
      {/* 1. 主题分类 —— 侧栏那一组，平铺 */}
      <div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-xs font-medium">{t('official_tags_label')}</span>
          <span className="text-[11px] text-muted">
            {t('official_tags_hint', { max: MAX_OFFICIAL_TAGS })}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {officialTags.map((tag) => {
            const on = value.includes(tag.slug);
            return (
              <button
                key={tag.slug}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => toggleOfficial(tag.slug)}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition disabled:opacity-60 ${
                  on
                    ? 'bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'border border-zinc-200 text-muted hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:hover:text-zinc-100'
                }`}
              >
                {on && <Check className="h-3 w-3" />}
                {label(tag)}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. 自定义分类 —— 默认折叠成一个按钮 */}
      <div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-xs font-medium">{t('custom_tags_label')}</span>
          <span className="text-[11px] text-muted">
            {t('custom_tags_hint', { max: MAX_CUSTOM_TAGS })}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {selectedCustom.map((slug) => (
            <span
              key={slug}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
            >
              #{label(viewOf(slug))}
              <button
                type="button"
                disabled={disabled}
                onClick={() => removeCustom(slug)}
                aria-label={tc('cancel')}
                className="text-muted transition hover:text-danger"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}

          <div ref={panelRef} className="relative">
            <button
              type="button"
              disabled={disabled || selectedCustom.length >= MAX_CUSTOM_TAGS}
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-zinc-300 px-2.5 py-1 text-xs text-muted transition hover:border-zinc-400 hover:text-zinc-900 disabled:opacity-50 dark:border-zinc-600 dark:hover:text-zinc-100"
            >
              <Plus className="h-3 w-3" />
              {t('add_custom_tag')}
            </button>

            {open && (
              <div className="surface absolute left-0 top-full z-30 mt-2 w-64 rounded-xl p-2 shadow-lg">
                <label className="flex h-8 items-center gap-2 rounded-lg border border-zinc-200 px-2 dark:border-zinc-800">
                  <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
                  <input
                    autoFocus
                    ref={inputRef}
                    value={draft}
                    maxLength={TAG_NAME_MAX}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (canCreate) void createTag();
                        else if (results[0]) addCustom(results[0]);
                      } else if (e.key === 'Escape') {
                        setOpen(false);
                      }
                    }}
                    placeholder={t('custom_tag_placeholder')}
                    className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted"
                  />
                  {(loading || creating) && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
                </label>

                <ul className="mt-1 max-h-52 overflow-y-auto scroll-thin">
                  {results.map((tag) => (
                    <li key={tag.slug}>
                      <button
                        type="button"
                        onClick={() => addCustom(tag)}
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <span className="truncate">#{label(tag)}</span>
                        {value.includes(tag.slug) && <Check className="h-3.5 w-3.5 shrink-0" />}
                      </button>
                    </li>
                  ))}
                  {!loading && results.length === 0 && !canCreate && (
                    <li className="px-2 py-4 text-center text-[11px] text-muted">
                      {draftName ? t('custom_tag_empty') : t('custom_tag_hint')}
                    </li>
                  )}
                </ul>

                {canCreate && (
                  <button
                    type="button"
                    disabled={creating}
                    onClick={() => void createTag()}
                    className="mt-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-medium transition hover:bg-zinc-100 disabled:opacity-60 dark:hover:bg-zinc-800"
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t('custom_tag_create', { name: draftName })}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
