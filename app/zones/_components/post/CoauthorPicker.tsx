'use client';

// 合著者 picker — SITE-WIDE (owner ask 2026-09-02: 「添加合著者我希望是可以整个
// 平台的人都可以添加」). It used to search only the zone's active members
// (`/api/zones/<slug>/members`); it now searches everyone through the house
// people endpoint `GET /api/users/search?q=`, which already matches on 姓名 and
// 工号 (digit run, order-insensitive name tokens) and trims every row through
// `toPublicAuthor` — so a private account's 部门/研究所 never arrives here and
// the 工号 is matched but never returned.
//
// That endpoint answers NOTHING for an empty query (a site-wide roster dump is
// not a picker), so this is a type-to-search box with an explicit prompt rather
// than the old browse-the-members list. `userId` rides alongside the trimmed
// PublicAuthor because the save API wants ids while the chip shows the identity.
//
// The server keeps the rest of the contract: `maxCoauthors`, self-exclusion,
// dedupe, wholesale replacement on edit — and a co-author who is not a member of
// this 版块 gets the byline and can READ the post, but may not edit it
// (`canEditZonePostContent` in lib/zones/post-queries.ts). That is what the hint
// under the row says out loud.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Search, UserPlus, X } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import type { PublicAuthor } from '@/lib/user-identity';
import { ZONE_LIMITS } from '@/lib/zones/shared';

export interface CoauthorPick {
  userId: string;
  user: PublicAuthor;
}

/** `SearchPersonView` from app/api/users/search — restated so a client leaf never imports a route module. */
interface PersonResult extends PublicAuthor {
  userId: string;
}

const DEBOUNCE_MS = 200;

export function CoauthorPicker({
  value,
  onChange,
  selfHandle,
  disabled = false,
}: {
  /**
   * Kept for the call site's prop shape (ComposerSettingsSheet passes it) —
   * the search is site-wide now, so the zone plays no part in it.
   */
  zoneSlug?: string;
  value: CoauthorPick[];
  onChange: (next: CoauthorPick[]) => void;
  selfHandle: string;
  disabled?: boolean;
}) {
  const t = useTranslations('zones');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PersonResult[]>([]);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const full = value.length >= ZONE_LIMITS.maxCoauthors;
  const query = q.trim();

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    // An empty box asks for nothing: the endpoint answers `[]` anyway, and
    // firing it would only cost a request per open.
    if (!open || !query) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/users/search?q=${encodeURIComponent(query)}`)
        .then(async (res) => {
          if (cancelled) return;
          const data = (await res.json().catch(() => null)) as { items?: PersonResult[] } | null;
          setResults(res.ok && Array.isArray(data?.items) ? data.items : []);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const candidates = useMemo(() => {
    const picked = new Set(value.map((c) => c.userId));
    return results.filter((p) => p.handle !== selfHandle && !picked.has(p.userId));
  }, [results, value, selfHandle]);

  // The highlighted row must never point past the list (results change per keystroke).
  useEffect(() => {
    setActive(0);
  }, [candidates.length, query]);

  function pick(p: PersonResult) {
    if (full) return;
    onChange([...value, { userId: p.userId, user: { ...p } }]);
    setOpen(false);
    setQ('');
  }

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (candidates.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % candidates.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + candidates.length) % candidates.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(candidates[Math.min(active, candidates.length - 1)]);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((c) => (
          <span key={c.userId} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 py-0.5 pl-0.5 pr-2 text-xs dark:border-zinc-700">
            <Avatar name={c.user.displayName} src={c.user.avatarUrl} size="xs" handle={c.user.handle} />
            <span>{c.user.displayName}</span>
            <DeptTag department={c.user.department} lab={c.user.lab} />
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x.userId !== c.userId))}
                aria-label={t('composer_coauthor_remove', { name: c.user.displayName })}
                className="rounded-full text-muted transition hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        {!disabled && !full && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-zinc-300 px-2.5 text-xs text-muted transition hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
          >
            <UserPlus className="h-3.5 w-3.5" />
            {t('composer_coauthor_add')}
          </button>
        )}
        <span className="font-mono text-[11px] tabular-nums text-muted">
          {value.length}/{ZONE_LIMITS.maxCoauthors}
        </span>
      </div>

      {open && !disabled && (
        <div className="surface absolute left-0 top-full z-30 mt-2 w-full max-w-md rounded-xl p-2 shadow-lg">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 dark:border-zinc-800">
            <Search className="h-4 w-4 shrink-0 text-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder={t('composer_coauthor_search_site')}
              aria-label={t('composer_coauthor_search_site')}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            />
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
          </label>
          <ul className="mt-1 max-h-64 overflow-y-auto scroll-thin">
            {candidates.map((p, i) => (
              <li key={p.userId}>
                <button
                  type="button"
                  onClick={() => pick(p)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition ${
                    i === active ? 'bg-zinc-100 dark:bg-zinc-800' : ''
                  }`}
                >
                  <Avatar name={p.displayName} src={p.avatarUrl} size="sm" />
                  {/* The NAME owns the first line: in the 280px settings column a
                      full org path would otherwise squeeze it down to "Bob…". */}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.displayName}</span>
                    <span className="flex min-w-0 items-center gap-1.5">
                      {/* 隐私账号: the @handle TEXT is hidden (it is the W3 工号 for SSO accounts). */}
                      {!p.isPrivate && <span className="shrink-0 font-mono text-xs text-muted">@{p.handle}</span>}
                      <DeptTag department={p.department} lab={p.lab} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {!query && <li className="px-2 py-4 text-center text-xs text-muted">{t('composer_coauthor_prompt')}</li>}
            {query && !loading && candidates.length === 0 && (
              <li className="px-2 py-4 text-center text-xs text-muted">{t('composer_coauthor_no_match')}</li>
            )}
          </ul>
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-muted">{full ? t('composer_coauthor_full', { max: ZONE_LIMITS.maxCoauthors }) : t('composer_coauthor_hint')}</p>
    </div>
  );
}
