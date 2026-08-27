'use client';

// 合著者 picker: searches the zone's ACTIVE members through
// GET /api/zones/<slug>/members?status=active&q= (readable by anyone who can
// read the zone — /members/search is managers-only) and keeps `userId`
// alongside the trimmed PublicAuthor (the API wants ids; the chip shows the
// identity). Self and already-picked members are filtered out.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Search, UserPlus, X } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import type { PublicAuthor } from '@/lib/user-identity';
import { ZONE_LIMITS } from '@/lib/zones/shared';
import type { ZoneMemberView } from '@/lib/zones/types';

export interface CoauthorPick {
  userId: string;
  user: PublicAuthor;
}

export function CoauthorPicker({
  zoneSlug,
  value,
  onChange,
  selfHandle,
  disabled = false,
}: {
  zoneSlug: string;
  value: CoauthorPick[];
  onChange: (next: CoauthorPick[]) => void;
  selfHandle: string;
  disabled?: boolean;
}) {
  const t = useTranslations('zones');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ZoneMemberView[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const full = value.length >= ZONE_LIMITS.maxCoauthors;

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/zones/${encodeURIComponent(zoneSlug)}/members?status=active&q=${encodeURIComponent(q.trim())}&take=8`)
        .then(async (res) => {
          if (cancelled) return;
          const data = (await res.json().catch(() => null)) as { items?: ZoneMemberView[] } | null;
          setResults(res.ok && Array.isArray(data?.items) ? data.items : []);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, q, zoneSlug]);

  const picked = new Set(value.map((c) => c.userId));
  const candidates = results.filter((m) => m.status === 'active' && m.user.handle !== selfHandle && !picked.has(m.userId));

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
              placeholder={t('composer_coauthor_search')}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            />
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
          </label>
          <ul className="mt-1 max-h-64 overflow-y-auto scroll-thin">
            {candidates.map((m) => (
              <li key={m.userId}>
                <button
                  type="button"
                  onClick={() => {
                    onChange([...value, { userId: m.userId, user: m.user }]);
                    setOpen(false);
                    setQ('');
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Avatar name={m.user.displayName} src={m.user.avatarUrl} size="sm" handle={m.user.handle} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{m.user.displayName}</span>
                      <DeptTag department={m.user.department} lab={m.user.lab} />
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {m.roleName}
                      {m.title ? ` · ${m.title}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {!loading && candidates.length === 0 && <li className="px-2 py-4 text-center text-xs text-muted">{t('composer_coauthor_empty')}</li>}
          </ul>
          <p className="mt-1 px-2 text-[11px] text-muted">{t('composer_coauthor_hint')}</p>
        </div>
      )}
    </div>
  );
}
