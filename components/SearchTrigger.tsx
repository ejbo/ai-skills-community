'use client';

import {
  Search,
  X,
  FileCode2,
  User as UserIcon,
  FolderTree,
  Tag as TagIcon,
  Video as VideoIcon,
  BookOpen,
  MessagesSquare,
  Boxes,
  Lightbulb,
  CalendarDays,
  Loader2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import { relativeTime } from '@/lib/i18n-date';

type GroupKey =
  | 'skills'
  | 'users'
  | 'categories'
  | 'tags'
  | 'videos'
  | 'library'
  | 'discussions'
  | 'events'
  | 'packs'
  | 'feedback';

interface Results {
  skills: { slug: string; name: string; author: string; date: string }[];
  // meta is server-computed: '@handle', or '' for a 隐私账号 (non-admin viewer).
  users: { handle: string; displayName: string; meta?: string }[];
  categories: { slug: string; name: string }[];
  tags: { slug: string; name: string; usageCount: number }[];
  videos: { slug: string; title: string; author: string; date: string }[];
  library: { slug: string; title: string; author: string; date: string }[];
  discussions: { kind: 'topic' | 'post'; id: string; title: string; author: string; date: string }[];
  events: { id: string; title: string; author: string; date: string }[];
  packs: { slug: string; name: string; date: string }[];
  feedback: { id: string; title: string; author: string; date: string }[];
}

const EMPTY: Results = {
  skills: [],
  users: [],
  categories: [],
  tags: [],
  videos: [],
  library: [],
  discussions: [],
  events: [],
  packs: [],
  feedback: [],
};

interface FlatItem {
  /** null = the synthetic "查看全部搜索结果" row (always first, default-active). */
  group: GroupKey | null;
  key: string;
  href: string;
  label: string;
  /** Secondary, right-aligned locator line — author · date, @handle, etc. */
  meta?: string;
}

const GROUP_ICON: Record<GroupKey, typeof FileCode2> = {
  skills: FileCode2,
  users: UserIcon,
  categories: FolderTree,
  tags: TagIcon,
  videos: VideoIcon,
  library: BookOpen,
  discussions: MessagesSquare,
  events: CalendarDays,
  packs: Boxes,
  feedback: Lightbulb,
};
const GROUP_LABEL_KEY: Record<GroupKey, string> = {
  skills: 'search_skills',
  users: 'search_users',
  categories: 'search_categories',
  tags: 'search_tags',
  videos: 'search_videos',
  library: 'search_library',
  discussions: 'search_discussion',
  events: 'search_events',
  packs: 'search_packs',
  feedback: 'search_feedback',
};

function reldate(iso: string, locale: string): string {
  try {
    return relativeTime(new Date(iso), locale);
  } catch {
    return '';
  }
}

// Global ⌘K command palette: searches ALL site content — skills, users,
// categories, tags, videos, 书籍 (library), 讨论 (topics + posts), packs and
// feedback — and shows grouped, keyboard-navigable results with author + date.
// Per-tab in-page searches stay scoped to their own tab; this is the global one.
export function SearchTrigger() {
  const router = useRouter();
  const t = useTranslations('nav');
  const tu = useTranslations('ui');
  const locale = useLocale();
  const [isMac, setIsMac] = useState(true);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Results>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsMac(navigator.platform.toLowerCase().includes('mac'));
    setMounted(true);
  }, []);

  // ⌘K / Ctrl+K toggles the palette.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const meta = isMac ? e.metaKey : e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isMac]);

  // Focus on open; clear on close.
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(id);
    }
    setQuery('');
    setResults(EMPTY);
    setActive(0);
  }, [open]);

  // Debounced site-wide fetch.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults(EMPTY);
      setLoading(false);
      setActive(0);
      return;
    }
    // 清空重打时立刻回到合成行（flat 收缩后旧 active 会越界，Enter 变成静默 no-op）。
    setActive(0);
    setLoading(true);
    const ctrl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((data) => {
          setResults({
            skills: data.skills ?? [],
            users: data.users ?? [],
            categories: data.categories ?? [],
            tags: data.tags ?? [],
            videos: data.videos ?? [],
            library: data.library ?? [],
            discussions: data.discussions ?? [],
            events: data.events ?? [],
            packs: data.packs ?? [],
            feedback: data.feedback ?? [],
          });
          setActive(0);
        })
        .catch(() => {
          /* aborted or network error — ignore */
        })
        .finally(() => setLoading(false));
    }, 160);
    return () => {
      ctrl.abort();
      clearTimeout(id);
    };
  }, [query, open]);

  // One flat, ordered list drives both rendering and keyboard navigation.
  // Row 0 is the synthetic "查看全部搜索结果" entry — it is the default-active
  // item, so a plain Enter opens the full /search page; arrow keys still jump
  // straight to an individual match.
  const flat: FlatItem[] = useMemo(() => {
    const items: FlatItem[] = [];
    const q = query.trim();
    if (q) {
      items.push({
        group: null,
        key: '__all__',
        href: `/search?q=${encodeURIComponent(q)}`,
        label: t('search_all_results', { q }),
      });
    }
    results.skills.forEach((s) =>
      items.push({
        group: 'skills',
        key: `s:${s.slug}`,
        href: `/skills/${s.slug}`,
        label: s.name,
        meta: `${s.author} · ${reldate(s.date, locale)}`,
      }),
    );
    results.users.forEach((u) =>
      items.push({ group: 'users', key: `u:${u.handle}`, href: `/users/${u.handle}`, label: u.displayName, meta: u.meta }),
    );
    results.categories.forEach((c) =>
      items.push({ group: 'categories', key: `c:${c.slug}`, href: `/skills?category=${c.slug}`, label: c.name }),
    );
    results.tags.forEach((tg) =>
      items.push({ group: 'tags', key: `t:${tg.slug}`, href: `/skills?tag=${tg.slug}`, label: `#${tg.name}` }),
    );
    results.videos.forEach((v) =>
      items.push({
        group: 'videos',
        key: `v:${v.slug}`,
        href: `/videos/${v.slug}`,
        label: v.title,
        meta: `${v.author} · ${reldate(v.date, locale)}`,
      }),
    );
    results.library.forEach((d) =>
      items.push({
        group: 'library',
        key: `l:${d.slug}`,
        href: `/library/${d.slug}`,
        label: d.title,
        meta: [d.author, reldate(d.date, locale)].filter(Boolean).join(' · '),
      }),
    );
    results.discussions.forEach((d) =>
      items.push({
        group: 'discussions',
        key: `d:${d.kind}:${d.id}`,
        href: d.kind === 'topic' ? `/discussion/topics/${d.id}` : `/discussion/posts/${d.id}`,
        label: d.title || t('search_post_media'),
        meta: `${d.author} · ${reldate(d.date, locale)}`,
      }),
    );
    results.events.forEach((e) =>
      items.push({
        group: 'events',
        key: `e:${e.id}`,
        href: `/events/${e.id}`,
        label: e.title,
        meta: `${e.author} · ${reldate(e.date, locale)}`,
      }),
    );
    results.packs.forEach((p) =>
      items.push({
        group: 'packs',
        key: `p:${p.slug}`,
        href: `/packs/${p.slug}`,
        label: p.name,
        meta: reldate(p.date, locale),
      }),
    );
    results.feedback.forEach((f) =>
      items.push({
        group: 'feedback',
        key: `f:${f.id}`,
        href: `/feedback/${f.id}`,
        label: f.title,
        meta: `${f.author} · ${reldate(f.date, locale)}`,
      }),
    );
    return items;
  }, [results, query, t, locale]);

  const go = useCallback(
    (item?: FlatItem) => {
      if (!item) return;
      setOpen(false);
      router.push(item.href);
    },
    [router],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    // 输入法组合中（拼音上屏的 Enter）不当作确认 — 否则会带着未上屏的拼音跳转。
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // flat 收缩后 active 可能短暂越界 — 钳到范围内，Enter 永远有目标。
      go(flat[Math.min(active, flat.length - 1)]);
    }
  }

  // flat[0] is the synthetic all-results row whenever a query exists, so
  // "no matches" means the synthetic row is the ONLY item.
  const showEmpty = Boolean(query.trim()) && !loading && flat.length <= 1;
  const hasResults = flat.length > 0;
  let lastGroup: GroupKey | null | '' = '';

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-200 md:min-w-[200px]"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden md:inline">{t('search_placeholder')}</span>
        <kbd className="ml-auto hidden rounded border border-zinc-200 px-1.5 text-[10px] font-mono text-zinc-500 dark:border-zinc-700 md:inline">
          {isMac ? '⌘' : 'Ctrl'} K
        </kbd>
      </button>

      {mounted &&
        createPortal(
          <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]"
          >
            {/* Mild dim behind the panel so it clearly reads as a search region
                against the light page — enough contrast without going too dark. */}
            <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: -8 }}
              transition={{ duration: 0.14 }}
              className="relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-200/70 bg-white/90 shadow-2xl ring-1 ring-black/5 backdrop-blur-2xl dark:border-white/10 dark:bg-zinc-900/90 dark:ring-white/5"
            >
              {/* Just the search box — no divider lines. */}
              <div className="flex items-center gap-2 px-4">
                <Search className="h-4 w-4 shrink-0 text-zinc-400" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={t('search_hint')}
                  className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-zinc-400"
                />
                {loading ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />
                ) : query ? (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="shrink-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    aria-label={tu('search_clear')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>

              {hasResults && (
                <div className="max-h-[58vh] overflow-auto px-2 pb-2 pt-1">
                  {flat.map((item, i) => {
                    const header =
                      item.group && item.group !== lastGroup
                        ? ((lastGroup = item.group), item.group)
                        : null;
                    const Icon = item.group ? GROUP_ICON[item.group] : Search;
                    return (
                      <div key={item.key}>
                        {header && (
                          <div className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted">
                            <Icon className="h-3 w-3" />
                            {t(GROUP_LABEL_KEY[header])}
                          </div>
                        )}
                        <button
                          onMouseEnter={() => setActive(i)}
                          onClick={() => go(item)}
                          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                            i === active
                              ? 'bg-accent-500/10 text-accent-700 dark:text-accent-300'
                              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                          } ${item.group === null ? 'mt-1' : ''}`}
                        >
                          {item.group === null && <Search className="h-3.5 w-3.5 shrink-0 text-muted" />}
                          <span className="truncate font-medium">{item.label}</span>
                          {item.group === null && (
                            <kbd className="ml-auto shrink-0 rounded border border-zinc-200 px-1.5 text-[10px] font-mono text-zinc-500 dark:border-zinc-700">
                              ⏎
                            </kbd>
                          )}
                          {item.meta && (
                            <span className="ml-auto shrink-0 pl-3 text-xs text-muted">{item.meta}</span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                  {showEmpty && (
                    <div className="px-3 py-6 text-center text-sm text-muted">{t('search_empty')}</div>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
