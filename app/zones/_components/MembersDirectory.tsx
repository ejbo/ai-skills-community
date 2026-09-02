'use client';

// 技术专区 — members directory: 全部 / 待审核 tabs (TabBar, URL-driven), role
// chips, search, 添加成员, then the ACTIVE list GROUPED BY ROLE (版主 first —
// owner leading — then every other role by sortOrder, 成员 last) as one
// StaggerGrid per group, so the page reads as "who runs this, who writes
// here, who reads here". The pending tab stays flat. The RSC renders page 1;
// 加载更多 appends via GET /api/zones/[slug]/members (skip/take) while the
// server offset (`loaded`, members-paging.ts — never `items.length`) is short
// of the total. Mutations patch the local list and `router.refresh()`. Only the
// server-rendered page 1 rises in through StaggerGrid; once a page has been
// appended the groups render as plain grids — page appends never animate.

import { useEffect, useMemo, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, Search, UserPlus, Users, X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { StaggerGrid, TabBar } from '@/components/motion';
import { ZONE_MEMBER_ROLE_KEY, ZONE_MODERATOR_ROLE_KEY } from '@/lib/zones/permissions';
import { zoneHref } from '@/lib/zones/shared';
import type { ZoneAccess, ZoneMemberView, ZoneRoleView } from '@/lib/zones/types';
import { AddMemberDialog } from './AddMemberDialog';
import { MemberCard } from './MemberCard';
import {
  appendMembersPage,
  canLoadMoreMembers,
  dropMember,
  initialMembersPage,
  prependMember,
  replaceMember,
} from './members-paging';
import { BTN_PRIMARY, BTN_SECONDARY, INPUT_CLS, SECTION_TITLE_CLS, chipCls, readError } from './ui';

export type MembersTab = 'all' | 'pending';

interface MemberGroup {
  key: string;
  label: string;
  members: ZoneMemberView[];
}

const GROUP_GRID_CLS = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3';

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
  pageTake = 60,
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
  /** Page size the RSC used — 加载更多 asks for the same. */
  pageTake?: number;
}) {
  const t = useTranslations('zones');
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();
  const [page, setPage] = useState(() => initialMembersPage(initialItems));
  const items = page.items;
  const [query, setQuery] = useState(q);
  const [adding, setAdding] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
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

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        status: tab === 'pending' ? 'pending' : 'active',
        skip: String(page.loaded),
        take: String(pageTake),
      });
      if (q) params.set('q', q);
      if (roleKey) params.set('role', roleKey);
      const res = await fetch(`/api/zones/${encodeURIComponent(zone.slug)}/members?${params.toString()}`);
      if (!res.ok) {
        const err = await readError(res);
        pushToast('error', err.reason ?? t('action_failed'));
        return;
      }
      const data = (await res.json()) as { items?: ZoneMemberView[]; total?: number };
      const rows = Array.isArray(data.items) ? data.items : [];
      setPage((s) => appendMembersPage(s, rows));
      if (typeof data.total === 'number') setCounts((c) => ({ ...c, listed: data.total as number }));
    } catch {
      pushToast('error', t('action_failed'));
    } finally {
      setLoadingMore(false);
    }
  }

  const sortedRoles = useMemo(() => [...roles].sort((a, b) => a.sortOrder - b.sortOrder), [roles]);

  // 版主 (owner first) → each other role by sortOrder → 成员. Empty groups vanish;
  // a role the catalogue no longer knows still lands in 成员 rather than nowhere.
  const groups = useMemo<MemberGroup[]>(() => {
    if (tab !== 'all') return [{ key: 'pending', label: '', members: items }];
    const leads = items.filter((m) => m.isOwner || m.roleKey === ZONE_MODERATOR_ROLE_KEY);
    leads.sort((a, b) => Number(b.isOwner) - Number(a.isOwner));
    const out: MemberGroup[] = [];
    if (leads.length > 0) out.push({ key: 'leads', label: t('mods_title'), members: leads });
    const known = new Set<string>([ZONE_MODERATOR_ROLE_KEY, ZONE_MEMBER_ROLE_KEY]);
    for (const role of sortedRoles) {
      if (known.has(role.key)) continue;
      known.add(role.key);
      const members = items.filter((m) => !m.isOwner && m.roleKey === role.key);
      if (members.length > 0) out.push({ key: role.key, label: t('members_group', { role: role.name }), members });
    }
    const rest = items.filter(
      (m) => !m.isOwner && m.roleKey !== ZONE_MODERATOR_ROLE_KEY && (m.roleKey === ZONE_MEMBER_ROLE_KEY || !known.has(m.roleKey)),
    );
    if (rest.length > 0) {
      const memberRole = sortedRoles.find((r) => r.key === ZONE_MEMBER_ROLE_KEY);
      out.push({ key: 'members', label: t('members_group', { role: memberRole?.name ?? rest[0].roleName }), members: rest });
    }
    return out;
  }, [items, sortedRoles, t, tab]);

  const canLoadMore = canLoadMoreMembers(page, counts.listed);

  const card = (m: ZoneMemberView) => (
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
          setPage((s) => dropMember(s, next.userId));
        } else {
          setPage((s) => replaceMember(s, next));
        }
        router.refresh();
      }}
      onRemove={(userId) => {
        if (items.some((x) => x.userId === userId)) dropped(false);
        setPage((s) => dropMember(s, userId));
        router.refresh();
      }}
    />
  );

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
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label || undefined}>
              {g.label && (
                <h3 className={`${SECTION_TITLE_CLS} mb-3 flex items-center gap-1.5`}>
                  {g.label}
                  <span className="font-mono tabular-nums">{g.members.length}</span>
                </h3>
              )}
              {page.appended ? (
                // Page appends do not animate (§11): once anything was loaded
                // on top of page 1 the group is a plain grid — the rows that
                // already rose in are long settled, the new ones simply exist.
                <ul className={GROUP_GRID_CLS}>
                  {g.members.map((m) => (
                    <li key={m.id} className="min-w-0">
                      {card(m)}
                    </li>
                  ))}
                </ul>
              ) : (
                <StaggerGrid
                  items={g.members}
                  keyOf={(m) => m.id}
                  render={card}
                  className={GROUP_GRID_CLS}
                  itemClassName="min-w-0"
                  stagger={0.04}
                  cascade={9}
                />
              )}
            </section>
          ))}
        </div>
      )}

      {canLoadMore && (
        <div className="flex justify-center">
          <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className={BTN_SECONDARY}>
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('members_load_more')}
          </button>
        </div>
      )}

      {adding && (
        <AddMemberDialog
          zoneSlug={zone.slug}
          roles={roles}
          access={access}
          onClose={() => setAdding(false)}
          onAdded={(member) => {
            // 待审核: the added user's join request (if listed) is resolved — the row leaves.
            setPage((s) => (tab === 'pending' ? dropMember(s, member.userId) : prependMember(s, member)));
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
