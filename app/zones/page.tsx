// 技术专区 hub — 贴吧-style landing (2026-09-11 redesign).
//
//   hero          — name, one sentence, ONE big search, three figures for the
//                   whole 专区, 创建版块, and the 版块墙 (ZoneWall3D) at lg+.
//   tabs          — the same three URL-driven tabs as before:
//     动态 (default) — the cross-zone post feed (最新 | 最热, filtered by
//                      研究所 → 实验室 / 栏目 / keyword) with a 热门版块 rail on xl.
//     版块           — every readable 版块, grouped under its 研究所.
//     我的版块        — the zones the viewer owns or belongs to.
//
// All state lives in the URL (?tab=&sort=&lab=a,b&department=x,y&column=&q=)
// so every view is linkable and back-button friendly. A stale `?type=` is
// ignored here (the feed API still parses it for old bookmarks).
//
// `listZones` filters by a SINGLE lab/department, so the 版块 tab loads the
// readable set (bounded, BOARD_MAX pages of 60) and applies the multi-select
// in memory — see the report note about pushing `labs[]`/`departments[]` down
// into lib/zones/queries.ts if a deployment ever grows past a few hundred 版块.
//
// ORG VOCABULARY (lib/org.ts): a 研究所 is the TOP level and is composed of
// 实验室. The columns read backwards and are NOT renamed — `Zone.lab` /
// `?lab=` is the 研究所, `Zone.department` / `?department=` is the 实验室 —
// because those params are already in bookmarks and notification links. The
// org chart is whatever the 版块 say it is (no configured list any more), so
// the rails only ever list a 研究所 that has at least one 版块.

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Star } from 'lucide-react';
import { auth } from '@/lib/auth';
import { canUserCreateZone, zoneSiteViewer, type ZoneSiteViewer } from '@/lib/zones/access';
import { withConfiguredInstitutes } from '@/lib/zones/labs';
import { getOrg } from '@/lib/zones/org-catalog';
import { getZoneSiteSetting } from '@/lib/zones/site-settings';
import { featuredZones, listMyZones, listZones, zoneHubTotals } from '@/lib/zones/queries';
import { listZoneFeed, zoneHubFacets } from '@/lib/zones/post-queries';
import {
  parseMultiParam,
  parseZoneFeedSort,
  parseZoneSort,
  serializeMultiParam,
  type OrgLabNode,
} from '@/lib/zones/shared';
import type { ZoneCardView } from '@/lib/zones/types';
import { TabBar } from '@/components/motion';
import { HubFeed } from './_components/HubFeed';
import { HubSideRail } from './_components/HubSideRail';
import { ZoneBoards, type EmptyInstitute, type ZoneBoardGroup } from './_components/ZoneBoards';
import { ZoneFeaturedStrip } from './_components/ZoneFeaturedStrip';
import { HubActiveChips, HubFilterRail, HubSortToggle } from './_components/ZoneFilters';
import { ZoneHubHero, hubCopy } from './_components/ZoneHubHero';
import { WALL_MAX } from './_components/ZoneWall3D';
import { SECTION_TITLE_CLS, hrefWith, loginHref } from './_components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const copy = await hubCopy();
  return { title: copy.title };
}

// Next 14 hands searchParams as string | string[] — take the first.
interface SearchParams {
  tab?: string | string[];
  q?: string | string[];
  lab?: string | string[];
  department?: string | string[];
  column?: string | string[];
  sort?: string | string[];
}

function firstParam(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : (v ?? '')).trim();
}

type HubTab = 'feed' | 'boards' | 'mine';

const FEED_PAGE_SIZE = 20;
const BOARD_PAGE_SIZE = 60;
const BOARD_MAX_PAGES = 5;
const HOT_RAIL = 6;

/**
 * The 版块 tab needs the whole readable set at once (the rail filters two
 * levels of a multi-select that SQL cannot express through `listZones`'s single
 * lab/department). Page 1 tells us the total; the rest are fetched in parallel
 * and the walk is capped so a runaway deployment can never fan out unbounded.
 */
async function loadBoardZones(args: {
  viewer: ZoneSiteViewer;
  q: string;
  sort: ReturnType<typeof parseZoneSort>;
}): Promise<{ zones: ZoneCardView[]; truncated: boolean }> {
  const base = { viewer: args.viewer, q: args.q, sort: args.sort, pageSize: BOARD_PAGE_SIZE };
  const first = await listZones({ ...base, page: 1 });
  const pages = Math.max(1, Math.ceil(first.total / BOARD_PAGE_SIZE));
  const walk = Math.min(pages, BOARD_MAX_PAGES);
  if (walk <= 1) return { zones: first.items, truncated: pages > walk };
  const rest = await Promise.all(
    Array.from({ length: walk - 1 }, (_, i) => listZones({ ...base, page: i + 2 })),
  );
  return { zones: [...first.items, ...rest.flatMap((r) => r.items)], truncated: pages > walk };
}

function filterZonesByOrg(zones: ZoneCardView[], labs: string[], departments: string[]): ZoneCardView[] {
  if (labs.length === 0 && departments.length === 0) return zones;
  const labSet = new Set(labs);
  const deptSet = new Set(departments);
  return zones.filter(
    (z) =>
      (labSet.size === 0 || labSet.has(z.lab.trim())) &&
      (deptSet.size === 0 || deptSet.has(z.department.trim())),
  );
}

function matchesQuery(zone: ZoneCardView, needle: string): boolean {
  if (!needle) return true;
  const q = needle.toLowerCase();
  return (
    zone.name.toLowerCase().includes(q) ||
    zone.tagline.toLowerCase().includes(q) ||
    zone.slug.toLowerCase().includes(q)
  );
}

/**
 * The 版块 rail counts the zones this grid actually SHOWS. `zoneOrgTree` counts
 * only zones whose CONTENT the viewer may read, while the 版块 tab lists every
 * discoverable zone (a `members` zone is visible as a card you can ask to join),
 * so deriving the tree from the loaded set is what keeps the rail's numbers and
 * the grid in agreement — and it follows the search box for free.
 */
function orgTreeFromZones(zones: ZoneCardView[]): OrgLabNode[] {
  const labs = new Map<string, { zoneCount: number; departments: Map<string, number> }>();
  for (const zone of zones) {
    const lab = zone.lab.trim();
    if (!lab) continue;
    const entry = labs.get(lab) ?? { zoneCount: 0, departments: new Map<string, number>() };
    entry.zoneCount += 1;
    const department = zone.department.trim();
    if (department) entry.departments.set(department, (entry.departments.get(department) ?? 0) + 1);
    labs.set(lab, entry);
  }
  const collate = (a: string, b: string) => a.localeCompare(b, 'zh-CN');
  return [...labs.entries()]
    .map(([lab, entry]) => ({
      lab,
      zoneCount: entry.zoneCount,
      departments: [...entry.departments.entries()]
        .map(([department, zoneCount]) => ({ department, zoneCount }))
        .sort((a, b) => b.zoneCount - a.zoneCount || collate(a.department, b.department)),
    }))
    .sort((a, b) => b.zoneCount - a.zoneCount || collate(a.lab, b.lab));
}

/** Group by 研究所 (`Zone.lab`), biggest first; the unnamed bucket sinks to the bottom. */
function groupByLab(zones: ZoneCardView[]): ZoneBoardGroup[] {
  const map = new Map<string, ZoneCardView[]>();
  for (const zone of zones) {
    const lab = zone.lab.trim();
    const bucket = map.get(lab);
    if (bucket) bucket.push(zone);
    else map.set(lab, [zone]);
  }
  return [...map.entries()]
    .map(([lab, items]) => ({ lab, zones: items }))
    .sort((a, b) => {
      if (!a.lab) return 1;
      if (!b.lab) return -1;
      return b.zones.length - a.zones.length || a.lab.localeCompare(b.lab, 'zh-CN');
    });
}

export default async function ZonesHubPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth();
  if (!session?.user) redirect(loginHref('/zones'));
  const viewer = zoneSiteViewer(session.user);
  const t = await getTranslations('zones');

  const rawTab = firstParam(searchParams.tab);
  const tab: HubTab = rawTab === 'mine' ? 'mine' : rawTab === 'boards' || rawTab === 'all' ? 'boards' : 'feed';
  const q = firstParam(searchParams.q).slice(0, 100);
  const labs = parseMultiParam(firstParam(searchParams.lab));
  const departments = parseMultiParam(firstParam(searchParams.department));
  const columns = parseMultiParam(firstParam(searchParams.column));
  const rawSort = firstParam(searchParams.sort);
  const feedSort = parseZoneFeedSort(rawSort);
  const zoneSort = parseZoneSort(rawSort);

  const orgFiltered = labs.length > 0 || departments.length > 0;
  const feedFiltered = orgFiltered || columns.length > 0 || Boolean(q);
  const boardsFiltered = orgFiltered || Boolean(q);

  // ── Data ───────────────────────────────────────────────────────────────────
  // The hero (totals + wall) renders on every tab; the tab bodies are queried
  // only for the active tab. (The 我的版块 strip that sat between hero and tabs
  // was removed 2026-09-11 — it duplicated the 我的版块 tab.)
  // 管理后台 → 首页设置 switches the 精选 strip and the 热门版块 rail off.
  const setting = await getZoneSiteSetting();
  const showFeatured = tab === 'boards' && !boardsFiltered && setting.showFeatured;
  const showHotRail = tab === 'feed' && setting.showHotRail;
  const [canCreate, totals, wallPage, mine, facets, feed, board, featured, org] = await Promise.all([
    canUserCreateZone(session.user),
    zoneHubTotals(),
    listZones({ viewer, sort: 'active', page: 1, pageSize: WALL_MAX }),
    listMyZones(viewer),
    // The 栏目 facet only narrows the feed; the 版块 rail is built from its own set.
    tab === 'feed' ? zoneHubFacets(viewer) : Promise.resolve({ org: [], columns: [] }),
    tab === 'feed'
      ? listZoneFeed({ viewer, sort: feedSort, labs, departments, columns, q, limit: FEED_PAGE_SIZE })
      : Promise.resolve(null),
    tab === 'boards' ? loadBoardZones({ viewer, q, sort: zoneSort }) : Promise.resolve(null),
    showFeatured ? featuredZones(viewer, 6) : Promise.resolve([]),
    getOrg(),
  ]);
  const wall = wallPage.items;

  let groups: ZoneBoardGroup[] = [];
  let visibleZones = 0;
  // Both rails go through the same merge, and it is idempotent: whichever half
  // of the tree the query already returned, every configured 研究所 ends up in
  // the rail exactly once, in configured order, live extras after them.
  let railOrg: OrgLabNode[] = withConfiguredInstitutes(facets.org, org);
  if (tab === 'boards' && board) {
    railOrg = withConfiguredInstitutes(orgTreeFromZones(board.zones), org);
    const filtered = filterZonesByOrg(board.zones, labs, departments);
    visibleZones = filtered.length;
    groups = groupByLab(filtered);
  } else if (tab === 'mine') {
    const filtered = filterZonesByOrg(mine, labs, departments).filter((z) => matchesQuery(z, q));
    visibleZones = filtered.length;
    groups = filtered.length > 0 ? [{ lab: '', zones: filtered }] : [];
  }

  // A navbar tile for a 研究所 with no 版块 lands here. Only when the view is
  // narrowed to exactly that one 研究所 (no 实验室, no keyword) is "this 研究所 is
  // empty" the true answer — with anything else in play the generic
  // 「没有符合当前筛选条件的版块」 is the honest one.
  const emptyInstitute: EmptyInstitute | null =
    tab === 'boards' && visibleZones === 0 && labs.length === 1 && departments.length === 0 && !q
      ? { name: labs[0], labs: org.labsOf(labs[0]) }
      : null;

  // ── Chrome ─────────────────────────────────────────────────────────────────
  // `sort` is shared but means different things per tab, so each href carries it
  // in that tab's own vocabulary (and the default is dropped from the URL).
  const carry = {
    q,
    lab: serializeMultiParam(labs),
    department: serializeMultiParam(departments),
    sort: zoneSort === 'active' ? '' : zoneSort,
  };
  const feedCarry = {
    ...carry,
    sort: feedSort === 'new' ? '' : feedSort,
    column: serializeMultiParam(columns),
  };
  const tabs = [
    { key: 'feed', label: t('hub_tab_feed'), href: hrefWith('/zones', { ...feedCarry, tab: '' }) },
    { key: 'boards', label: t('hub_tab_boards'), href: hrefWith('/zones', { ...carry, tab: 'boards' }) },
    { key: 'mine', label: t('hub_tab_mine'), href: hrefWith('/zones', { ...carry, tab: 'mine' }), count: mine.length },
  ];

  const railMode = tab === 'feed' ? 'feed' : 'boards';
  // ONE result count on the page, and only when it answers something: how much
  // did my filter find. Unfiltered, the list is its own answer.
  const narrowed = tab === 'feed' ? feedFiltered : boardsFiltered;
  const resultLabel = narrowed
    ? tab === 'feed'
      ? t('hub_feed_count', { count: feed?.total ?? 0 })
      : t('hub_result_count', { count: visibleZones })
    : null;
  const resultLine = resultLabel ? (
    <p className="shrink-0 font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{resultLabel}</p>
  ) : null;

  return (
    <div className="container py-6">
      <ZoneHubHero canCreate={canCreate} searchMode={railMode} totals={totals} wall={wall} />

      {/*
        The tab bar is the PAGE's control, so it spans the page: a block-level
        TabBar draws its hairline edge to edge, and every column below starts on
        that rule. Nothing else is allowed on this row.
      */}
      <div className="mt-6">
        <TabBar tabs={tabs} active={tab} id="zones-hub-tabs" ariaLabel={t('hub_title')} />
      </div>

      {showFeatured && featured.length > 0 && (
        <section className="mt-8">
          <div className="mb-4 flex items-end justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              {/* 精选 is an editorial mark on the content, not a control: the
                  gold star is the same one 热榜 keeps (配色契约). */}
              <Star className="h-4 w-4 fill-amber-400 text-amber-500" />
              {t('hub_featured')}
            </h2>
          </div>
          <ZoneFeaturedStrip zones={featured} />
        </section>
      )}

      {tab === 'mine' ? (
        <div className="mt-6">
          {(resultLine || boardsFiltered) && (
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              {resultLine}
              <HubActiveChips mode="boards" />
            </div>
          )}
          <ZoneBoards groups={groups} filtered={boardsFiltered} mine />
        </div>
      ) : (
        <div
          className={`mt-6 grid gap-x-8 gap-y-6 lg:grid-cols-[232px_minmax(0,1fr)] ${
            showHotRail ? 'xl:grid-cols-[232px_minmax(0,1fr)_272px]' : ''
          }`}
        >
          <aside>
            <HubFilterRail org={railOrg} columns={facets.columns} mode={railMode} />
          </aside>

          <div className="min-w-0">
            {/* Everything that describes or orders THIS list lives in THIS
                column and starts on its left edge: sort, then the count, then
                the removable chips. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <HubSortToggle mode={railMode} />
              {resultLine}
            </div>

            <HubActiveChips mode={railMode} className="mt-3" />

            {tab === 'boards' && board?.truncated && (
              <p className={`${SECTION_TITLE_CLS} mt-3`}>{t('hub_boards_truncated')}</p>
            )}

            <div className="mt-4">
              {tab === 'feed' && feed ? (
                <HubFeed
                  key={`${feedSort}|${q}|${carry.lab}|${carry.department}|${feedCarry.column}`}
                  initialItems={feed.items}
                  initialHasMore={feed.hasMore}
                  initialCursor={feed.nextCursor}
                  query={{ sort: feedSort, q, labs, departments, columns }}
                  filtered={feedFiltered}
                />
              ) : (
                <ZoneBoards groups={groups} filtered={boardsFiltered} emptyInstitute={emptyInstitute} />
              )}
            </div>
          </div>

          {showHotRail && (
            <div className="hidden min-w-0 xl:block">
              <div className="sticky top-24">
                <HubSideRail hot={wall.slice(0, HOT_RAIL)} canCreate={canCreate} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
