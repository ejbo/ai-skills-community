'use client';

// 技术专区 — members directory: 全部 / 待审核 tabs (TabBar, URL-driven), role
// chips, search, 添加成员, StaggerGrid of MemberCard. The RSC loads the page
// for the current URL; mutations patch the local list and `router.refresh()`.

import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search, UserPlus, Users, X } from 'lucide-react';
import { StaggerGrid, TabBar } from '@/components/motion';
import { zoneHref } from '@/lib/zones/shared';
import type { ZoneAccess, ZoneMemberView, ZoneRoleView } from '@/lib/zones/types';
import { AddMemberDialog } from './AddMemberDialog';
import { MemberCard } from './MemberCard';
import { BTN_PRIMARY, INPUT_CLS, chipCls } from './ui';

export type MembersTab = 'all' | 'pending';

export function MembersDirectory({
  zone,
  access,
  roles,
  initialItems,
  total,
  tab,
  q,
  roleKey,
  pendingCount,
  currentUserId,
}: {
  zone: { id: string; slug: string; name: string; memberCount: number };
  access: ZoneAccess;
  roles: ZoneRoleView[];
  initialItems: ZoneMemberView[];
  total: number;
  tab: MembersTab;
  q: string;
  roleKey: string;
  pendingCount: number;
  currentUserId: string | null;
}) {
  const t = useTranslations('zones');
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();
  const [items, setItems] = useState(initialItems);
  const [query, setQuery] = useState(q);
  const [adding, setAdding] = useState(false);
  // Badge counts move with the local list so an approve / reject / remove is
  // visible immediately; `router.refresh()` then re-seeds them from the server,
  // which is also what keeps every other mutation path honest.
  const [counts, setCounts] = useState({ members: zone.memberCount, pending: pendingCount, listed: total });
  useEffect(() => {
    setCounts({ members: zone.memberCount, pending: pendingCount, listed: total });
  }, [zone.memberCount, pendingCount, total]);

  /** One row left this tab's list: keep the badges in step with what is on screen. */
  function dropped(becameMember: boolean) {
    setCounts((c) => ({
      members: becameMember ? c.members + 1 : tab === 'pending' ? c.members : Math.max(0, c.members - 1),
      pending: tab === 'pending' ? Math.max(0, c.pending - 1) : c.pending,
      listed: Math.max(0, c.listed - 1),
    }));
  }

  const base = `${zoneHref(zone.slug)}/members`;
  const tabs = [
    { key: 'all', label: t('members_tab_all'), href: base, count: counts.members },
    ...(access.canManageMembers
      ? [{ key: 'pending', label: t('members_tab_pending'), href: `${base}?tab=pending`, count: counts.pending }]
      : []),
  ];

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  const sortedRoles = [...roles].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TabBar tabs={tabs} active={tab} id={`zone-members-${zone.slug}`} />
        <div className="flex flex-wrap items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              update({ q: query.trim() || null });
            }}
            className="relative w-full sm:w-60"
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('members_search_placeholder')}
              className={`${INPUT_CLS} pl-9 pr-8`}
              aria-label={t('members_search_placeholder')}
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  update({ q: null });
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                aria-label={t('filters_clear')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </form>
          {access.canManageMembers && (
            <button type="button" onClick={() => setAdding(true)} className={BTN_PRIMARY}>
              <UserPlus className="h-4 w-4" />
              {t('members_add')}
            </button>
          )}
        </div>
      </div>

      {tab === 'all' && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label={t('members_role_filter')}>
          <button type="button" onClick={() => update({ role: null })} className={chipCls(!roleKey)} aria-pressed={!roleKey}>
            {t('members_role_all')}
          </button>
          {sortedRoles.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => update({ role: r.key })}
              className={`${chipCls(roleKey === r.key)} inline-flex items-center gap-1.5`}
              aria-pressed={roleKey === r.key}
            >
              {r.name}
              <span className="font-mono text-[10px] tabular-nums opacity-70">{r.memberCount}</span>
            </button>
          ))}
        </div>
      )}

      <p className="font-mono text-xs tabular-nums text-zinc-500">
        {tab === 'pending' ? t('members_pending_total', { count: counts.listed }) : t('members_total', { count: counts.listed })}
      </p>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 px-8 py-14 text-center dark:border-zinc-800">
          <Users className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
          <h3 className="mt-3 text-sm font-semibold">
            {tab === 'pending' ? t('members_pending_empty') : t('members_empty')}
          </h3>
        </div>
      ) : (
        <StaggerGrid
          items={items}
          keyOf={(m) => m.id}
          render={(m) => (
            <MemberCard
              member={m}
              roles={roles}
              access={access}
              zoneSlug={zone.slug}
              currentUserId={currentUserId}
              onChange={(next) => {
                // An approved join request is no longer pending — drop it from
                // the 待审核 list instead of leaving a stale row behind.
                if (tab === 'pending' && next.status === 'active') {
                  if (items.some((x) => x.id === next.id)) dropped(true);
                  setItems((list) => list.filter((x) => x.id !== next.id));
                } else {
                  setItems((list) => list.map((x) => (x.id === next.id ? next : x)));
                }
                router.refresh();
              }}
              onRemove={(userId) => {
                if (items.some((x) => x.userId === userId)) dropped(false);
                setItems((list) => list.filter((x) => x.userId !== userId));
                router.refresh();
              }}
            />
          )}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          itemClassName="min-w-0"
          stagger={0.04}
          cascade={9}
        />
      )}

      {adding && (
        <AddMemberDialog
          zoneSlug={zone.slug}
          roles={roles}
          access={access}
          onClose={() => setAdding(false)}
          onAdded={(member) => {
            setItems((list) => {
              const rest = list.filter((x) => x.userId !== member.userId);
              return tab === 'pending' ? rest : [member, ...rest];
            });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
