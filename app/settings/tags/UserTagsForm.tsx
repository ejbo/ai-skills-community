'use client';

// 我的标签 — the member decides which badges their 名片 shows.
//
// Each row renders the REAL <BadgeChip/> (hover it: the same detail popover
// everyone else gets), so the member judges a badge by what it will look like
// and say, not by its name. The strip on top is the card's own badge row —
// glass chips on ink, capped like the profile hero card (CARD_BADGE_MAX.lg; the
// hint names the smaller hover-card cap too) — and it updates as the switches flip. Toggles save immediately (PATCH /api/me/tags) and roll back on
// failure; hiding never removes the assignment.
//
// In-flight saves are tracked PER KEY: the PATCH is per tag, so flipping a
// second badge while the first saves is two independent requests — a single
// shared busy flag used to swallow the second click without a word. A saved
// flip forgets this tab's cached hover card of the member (invalidateUserCard),
// so the next hover shows the new badge row instead of the old one.

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowUpRight, Lock } from 'lucide-react';
import { CARD_BADGE_MAX } from '@/components/profile-card/card-shared';
import { BadgeChip, BadgeList } from '@/components/user/BadgeChip';
import { invalidateUserCard } from '@/components/user/UserHoverCard';
import { pushToast } from '@/components/Toaster';
import type { ProfileBadge } from '@/lib/profile/types';
import { Switch } from '../_components/Switch';

export interface OwnBadgeRow {
  badge: ProfileBadge;
  hidden: boolean;
  /** "3 个月前" — formatted on the server in the viewer's locale. */
  grantedLabel: string;
}

export function UserTagsForm({
  initial,
  role,
  handle,
}: {
  initial: OwnBadgeRow[];
  role: ProfileBadge | null;
  /** The member's own handle — whose cached hover card a saved flip invalidates. */
  handle: string;
}) {
  const t = useTranslations('settings');
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());

  const visible: ProfileBadge[] = [...(role ? [role] : []), ...rows.filter((r) => !r.hidden).map((r) => r.badge)];

  async function toggle(row: OwnBadgeRow, show: boolean) {
    const key = row.badge.key;
    if (busy.has(key)) return;
    setBusy((prev) => new Set(prev).add(key));
    setRows((prev) => prev.map((r) => (r.badge.key === key ? { ...r, hidden: !show } : r)));
    try {
      const res = await fetch('/api/me/tags', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, hidden: !show }),
      });
      if (!res.ok) throw new Error('failed');
      invalidateUserCard(handle);
    } catch {
      setRows((prev) => prev.map((r) => (r.badge.key === key ? { ...r, hidden: show } : r)));
      pushToast('error', t('save_failed'));
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  if (rows.length === 0 && !role) {
    return (
      <div className="flex flex-col items-center py-10 text-center">
        <p className="text-sm text-muted">{t('tags_empty')}</p>
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">{t('tags_empty_hint')}</p>
      </div>
    );
  }

  return (
    <div>
      {/* 名片上的样子 */}
      <div className="rounded-xl bg-zinc-950 p-4 ring-1 ring-inset ring-white/10 dark:bg-black">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{t('tags_preview_title')}</span>
          <Link
            href="/settings/card"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 transition hover:text-white"
          >
            {t('tags_preview_card_link')}
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="mt-3 min-h-[1.75rem]">
          {visible.length > 0 ? (
            <BadgeList badges={visible} max={CARD_BADGE_MAX.lg} size="sm" tone="glass" />
          ) : (
            <span className="text-xs text-zinc-500">{t('tags_preview_none')}</span>
          )}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">{t('tags_preview_hint', { lg: CARD_BADGE_MAX.lg, sm: CARD_BADGE_MAX.sm })}</p>
      </div>

      <ul className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800/70">
        {role && (
          <li className="flex items-start gap-4 py-4">
            <div className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-4">
              <div className="shrink-0 pt-0.5 sm:w-40">
                <BadgeChip badge={role} size="md" />
              </div>
              <div className="mt-2 min-w-0 flex-1 sm:mt-0">
                <p className="text-xs text-muted">{t('tags_kind_role')}</p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {role.description || t('tags_no_description')}
                </p>
              </div>
            </div>
            <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[11px] text-muted" title={t('tags_role_locked')}>
              <Lock className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('tags_role_locked')}</span>
            </span>
          </li>
        )}
        {rows.map((row) => {
          return (
            <li key={row.badge.key} className="flex items-start gap-4 py-4">
              <div className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-4">
                <div className={`shrink-0 pt-0.5 transition-opacity sm:w-40 ${row.hidden ? 'opacity-50' : ''}`}>
                  <BadgeChip badge={row.badge} size="md" />
                </div>
                <div className="mt-2 min-w-0 flex-1 sm:mt-0">
                  <p className="text-xs text-muted">
                    {row.badge.kind === 'auto' ? t('tag_kind_auto') : t('tag_kind_manual')}
                    <span aria-hidden> · </span>
                    {t('tags_granted', { time: row.grantedLabel })}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                    {row.badge.description || t('tags_no_description')}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Switch
                  checked={!row.hidden}
                  onChange={(show) => void toggle(row, show)}
                  busy={busy.has(row.badge.key)}
                  label={t('tags_toggle', { name: row.badge.name })}
                />
                <span className="text-[11px] text-muted">{row.hidden ? t('tag_hidden') : t('tag_shown')}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
