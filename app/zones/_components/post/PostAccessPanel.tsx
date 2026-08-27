'use client';

// 指定成员可见 的访问控制面板 (ask #4). Two halves, both only meaningful while
// the post's visibility is `restricted`:
//
//   1. 指定成员 — active zone members who may open the post directly. Held as
//      LOCAL composer state and sent as `designatedUserIds` on save (the server
//      replaces the list wholesale and validates membership).
//   2. 访问密码 — the 6-char code anyone may redeem at
//      POST /posts/<id>/unlock. It is generated SERVER-side; this panel never
//      invents one. 重新生成 works two ways on purpose:
//        • the saved post is already `restricted` ⇒ immediate
//          PUT /posts/<id>/access { regenerateAccessCode: true } (the code is a
//          live secret, not draft content — rotating it must take effect now),
//        • otherwise (new post, or a post that only becomes restricted on this
//          save) ⇒ ARM the flag and let the save generate it.
//
// Rotating a code evicts everyone who entered through the old one; designated
// members are a different relationship and survive it.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy, KeyRound, Loader2, RefreshCw, Search, UserPlus, X } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { pushToast } from '@/components/Toaster';
import type { PublicAuthor } from '@/lib/user-identity';
import type { ZoneMemberView } from '@/lib/zones/types';
import { readError } from '../ui';

export interface DesignatedPick {
  userId: string;
  user: PublicAuthor;
}

/** Mirrors MAX_DESIGNATED_VIEWERS in lib/zones/post-queries.ts (a server module — not importable here). */
export const MAX_DESIGNATED_VIEWERS_UI = 50;

interface GrantRow {
  userId: string;
  user: PublicAuthor;
  via: string;
  createdAt: string;
}

function grantsOf(data: unknown): GrantRow[] {
  const rows = (data as { grants?: unknown } | null)?.grants;
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (r): r is GrantRow =>
      !!r && typeof r === 'object' && typeof (r as GrantRow).userId === 'string' && !!(r as GrantRow).user,
  );
}

function codeOf(data: unknown): string | null {
  const d = data as { accessCode?: unknown; access?: { accessCode?: unknown } } | null;
  if (typeof d?.accessCode === 'string') return d.accessCode;
  if (typeof d?.access?.accessCode === 'string') return d.access.accessCode;
  return null;
}

export function PostAccessPanel({
  zoneSlug,
  postId = null,
  serverRestricted = false,
  designated,
  onDesignatedChange,
  accessCode,
  onAccessCodeChange,
  regenerate,
  onRegenerateChange,
  selfUserId,
  disabled = false,
}: {
  zoneSlug: string;
  /** Absent for a post that has not been saved yet. */
  postId?: string | null;
  /** The SAVED post is already `restricted` — only then may the code be rotated live. */
  serverRestricted?: boolean;
  designated: DesignatedPick[];
  onDesignatedChange: (next: DesignatedPick[]) => void;
  accessCode: string | null;
  onAccessCodeChange: (code: string) => void;
  regenerate: boolean;
  onRegenerateChange: (next: boolean) => void;
  selfUserId: string;
  disabled?: boolean;
}) {
  const t = useTranslations('zones');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ZoneMemberView[]>([]);
  const [busy, setBusy] = useState(false);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const pickerRef = useRef<HTMLDivElement>(null);

  const live = Boolean(postId && serverRestricted);
  const full = designated.length >= MAX_DESIGNATED_VIEWERS_UI;

  // Outside click / Escape close the member popover.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Debounced member search (active members only — the API filters and trims identity).
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

  // Who came in through the code (read-only; silently absent if the route is unavailable).
  useEffect(() => {
    if (!live || !postId) return;
    let cancelled = false;
    fetch(`/api/zones/${encodeURIComponent(zoneSlug)}/posts/${encodeURIComponent(postId)}/access`)
      .then(async (res) => {
        if (cancelled || !res.ok) return;
        const data = await res.json().catch(() => null);
        setGrants(grantsOf(data).filter((g) => g.via === 'code'));
      })
      .catch(() => {
        /* the panel works without it */
      });
    return () => {
      cancelled = true;
    };
  }, [live, postId, zoneSlug]);

  async function copyCode() {
    if (!accessCode) return;
    try {
      await navigator.clipboard.writeText(accessCode);
      pushToast('success', t('composer_access_code_copied'));
    } catch {
      pushToast('error', t('composer_access_code_copy_failed'));
    }
  }

  async function rotateNow() {
    if (!postId || busy) return;
    if (accessCode && !confirm(t('composer_access_code_armed'))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/zones/${encodeURIComponent(zoneSlug)}/posts/${encodeURIComponent(postId)}/access`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ regenerateAccessCode: true }),
      });
      if (!res.ok) {
        const err = await readError(res);
        pushToast('error', err.reason ?? t('composer_access_code_failed'));
        return;
      }
      const next = codeOf(await res.json().catch(() => null));
      if (!next) {
        pushToast('error', t('composer_access_code_failed'));
        return;
      }
      onAccessCodeChange(next);
      onRegenerateChange(false);
      setGrants([]);
      pushToast('success', t('composer_access_code_regenerated'));
    } catch {
      pushToast('error', t('composer_access_code_failed'));
    } finally {
      setBusy(false);
    }
  }

  const picked = new Set(designated.map((d) => d.userId));
  const candidates = results.filter((m) => m.status === 'active' && m.userId !== selfUserId && !picked.has(m.userId));

  return (
    <div className="space-y-5 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">{t('composer_access_title')}</h3>

      <section ref={pickerRef} className="relative">
        <div className="mb-1.5 flex items-baseline justify-between text-xs font-medium text-zinc-700 dark:text-zinc-300">
          <span>{t('composer_access_designated_label')}</span>
          <span className="font-mono tabular-nums text-muted">
            {designated.length}/{MAX_DESIGNATED_VIEWERS_UI}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {designated.map((d) => (
            <span
              key={d.userId}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 py-0.5 pl-0.5 pr-2 text-xs dark:border-zinc-700"
            >
              <Avatar name={d.user.displayName} src={d.user.avatarUrl} size="xs" handle={d.user.handle} />
              <span>{d.user.displayName}</span>
              <DeptTag department={d.user.department} lab={d.user.lab} />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onDesignatedChange(designated.filter((x) => x.userId !== d.userId))}
                  aria-label={t('composer_access_designated_remove', { name: d.user.displayName })}
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
              {t('composer_access_designated_add')}
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-muted">
          {full ? t('composer_access_designated_full', { max: MAX_DESIGNATED_VIEWERS_UI }) : t('composer_access_designated_hint')}
        </p>

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
                      onDesignatedChange([...designated, { userId: m.userId, user: m.user }]);
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
          </div>
        )}
      </section>

      <section>
        <div className="mb-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">{t('composer_access_code_label')}</div>
        {accessCode ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-900">
              <KeyRound className="h-3.5 w-3.5 text-muted" aria-hidden />
              <code className="font-mono text-sm tracking-[0.3em] tabular-nums">{accessCode}</code>
            </span>
            <button
              type="button"
              onClick={copyCode}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-xs font-medium transition hover:border-zinc-500 dark:border-zinc-700 dark:hover:border-zinc-500"
            >
              <Copy className="h-3.5 w-3.5" />
              {t('composer_access_code_copy')}
            </button>
            {!disabled &&
              (live ? (
                <button
                  type="button"
                  onClick={rotateNow}
                  disabled={busy}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-xs font-medium transition hover:border-zinc-500 disabled:opacity-60 dark:border-zinc-700 dark:hover:border-zinc-500"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {t('composer_access_code_regenerate')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onRegenerateChange(!regenerate)}
                  aria-pressed={regenerate}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-xs font-medium transition hover:border-zinc-500 dark:border-zinc-700 dark:hover:border-zinc-500"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {regenerate ? t('composer_access_code_armed_cancel') : t('composer_access_code_regenerate')}
                </button>
              ))}
          </div>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-xs text-muted">
            <KeyRound className="h-3.5 w-3.5" aria-hidden />
            {t('composer_access_code_pending')}
          </p>
        )}
        <p className="mt-1.5 text-[11px] text-muted">{regenerate && !live ? t('composer_access_code_armed') : t('composer_access_code_hint')}</p>
      </section>

      {grants.length > 0 && (
        <section>
          <div className="mb-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {t('composer_access_redeemed')} <span className="font-mono tabular-nums text-muted">{grants.length}</span>
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {grants.map((g) => (
              <li key={g.userId} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 py-0.5 pl-0.5 pr-2 text-xs dark:border-zinc-800">
                <Avatar name={g.user.displayName} src={g.user.avatarUrl} size="xs" handle={g.user.handle} />
                <span className="max-w-[8rem] truncate">{g.user.displayName}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
