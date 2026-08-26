'use client';

// 技术专区 — user picker. `source: 'search'` hits the members-manager-only
// /members/search (site users → add member); `source: 'members'` lists ACTIVE
// members through GET /members (transfer ownership). Debounced, dedupes replies
// by request sequence so a slow earlier query never overwrites a newer one.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Search } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import type { PublicAuthor } from '@/lib/user-identity';
import type { ZoneMemberView } from '@/lib/zones/types';
import { INPUT_CLS, PILL_INK, PILL_MONO } from './ui';

export interface PickedUser {
  userId: string;
  user: PublicAuthor;
  membership: 'owner' | 'active' | 'pending' | null;
}

export function MemberPicker({
  zoneSlug,
  source,
  onPick,
  excludeUserIds = [],
  placeholder,
  autoFocus = false,
}: {
  zoneSlug: string;
  source: 'search' | 'members';
  onPick: (user: PickedUser) => void;
  excludeUserIds?: string[];
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<PickedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (source === 'search' && !query) {
      setItems([]);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const url =
          source === 'search'
            ? `/api/zones/${zoneSlug}/members/search?q=${encodeURIComponent(query)}`
            : `/api/zones/${zoneSlug}/members?status=active&take=20${query ? `&q=${encodeURIComponent(query)}` : ''}`;
        const res = await fetch(url);
        if (mine !== seq.current) return;
        if (!res.ok) {
          setItems([]);
          return;
        }
        const data = (await res.json()) as { items: unknown[] };
        const list: PickedUser[] =
          source === 'search'
            ? (data.items as PickedUser[])
            : (data.items as ZoneMemberView[]).map((m) => ({
                userId: m.userId,
                user: m.user,
                membership: m.isOwner ? 'owner' : m.status,
              }));
        setItems(list.filter((u) => !excludeUserIds.includes(u.userId)));
      } catch {
        if (mine === seq.current) setItems([]);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
    // excludeUserIds is a fresh array per render — compare by content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, source, zoneSlug, excludeUserIds.join('|')]);

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          type="search"
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setTouched(true);
          }}
          placeholder={placeholder ?? t('picker_placeholder')}
          className={`${INPUT_CLS} pl-9`}
          aria-label={placeholder ?? t('picker_placeholder')}
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" />}
      </div>
      <ul className="scroll-thin mt-2 max-h-64 divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {items.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-muted">
            {source === 'search' && !q.trim() ? t('picker_hint') : touched || source === 'members' ? t('picker_empty') : t('picker_hint')}
          </li>
        )}
        {items.map((u) => {
          const taken = u.membership === 'owner' || u.membership === 'active';
          const disabled = source === 'search' && taken;
          return (
            <li key={u.userId}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(u)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-900"
              >
                <Avatar name={u.user.displayName} src={u.user.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{u.user.displayName}</span>
                    {!u.user.isPrivate && <span className="truncate font-mono text-xs text-zinc-400">@{u.user.handle}</span>}
                  </span>
                  <DeptTag department={u.user.department} lab={u.user.lab} className="mt-0.5" />
                </span>
                {u.membership === 'owner' && <span className={PILL_INK}>{tl('zoneRole.owner')}</span>}
                {u.membership === 'active' && <span className={PILL_MONO}>{t('picker_already_member')}</span>}
                {u.membership === 'pending' && <span className={PILL_MONO}>{t('picker_pending')}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
