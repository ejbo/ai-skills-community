'use client';

import {
  Search,
  X,
  FileCode2,
  User as UserIcon,
  FolderTree,
  Tag as TagIcon,
  Video as VideoIcon,
  Loader2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDistanceToNowStrict } from 'date-fns';

type GroupKey = 'skills' | 'users' | 'categories' | 'tags' | 'videos';

interface Results {
  skills: { slug: string; name: string; author: string; date: string }[];
  users: { handle: string; displayName: string }[];
  categories: { slug: string; name: string }[];
  tags: { slug: string; name: string; usageCount: number }[];
  videos: { slug: string; title: string; author: string; date: string }[];
}

const EMPTY: Results = { skills: [], users: [], categories: [], tags: [], videos: [] };

interface FlatItem {
  group: GroupKey;
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
};
const GROUP_LABEL_KEY: Record<GroupKey, string> = {
  skills: 'search_skills',
  users: 'search_users',
  categories: 'search_categories',
  tags: 'search_tags',
  videos: 'search_videos',
};

function reldate(iso: string): string {
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
}

// Global ⌘K command palette: searches skills, users, categories, tags and videos
// site-wide and shows grouped, keyboard-navigable results with author + date.
export function SearchTrigger() {
  const router = useRouter();
  const t = useTranslations('nav');
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
      return;
    }
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
  const flat: FlatItem[] = useMemo(() => {
    const items: FlatItem[] = [];
    results.skills.forEach((s) =>
      items.push({
        group: 'skills',
        key: `s:${s.slug}`,
        href: `/skills/${s.slug}`,
        label: s.name,
        meta: `${s.author} · ${reldate(s.date)}`,
      }),
    );
    results.users.forEach((u) =>
      items.push({ group: 'users', key: `u:${u.handle}`, href: `/users/${u.handle}`, label: u.displayName, meta: `@${u.handle}` }),
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
        meta: `${v.author} · ${reldate(v.date)}`,
      }),
    );
    return items;
  }, [results]);

  const go = useCallback(
    (item?: FlatItem) => {
      if (!item) return;
      setOpen(false);
      router.push(item.href);
    },
    [router],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(flat[active]);
    }
  }

  const showEmpty = Boolean(query.trim()) && !loading && flat.length === 0;
  const hasResults = flat.length > 0;
  let lastGroup: GroupKey | '' = '';

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
                    aria-label="Clear"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>

              {(showEmpty || hasResults) && (
                <div className="max-h-[58vh] overflow-auto px-2 pb-2 pt-1">
                  {showEmpty ? (
                    <div className="px-3 py-8 text-center text-sm text-muted">{t('search_empty')}</div>
                  ) : (
                    flat.map((item, i) => {
                      const header =
                        item.group !== lastGroup ? ((lastGroup = item.group), item.group) : null;
                      const Icon = GROUP_ICON[item.group];
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
                            }`}
                          >
                            <span className="truncate font-medium">{item.label}</span>
                            {item.meta && (
                              <span className="ml-auto shrink-0 pl-3 text-xs text-muted">{item.meta}</span>
                            )}
                          </button>
                        </div>
                      );
                    })
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
