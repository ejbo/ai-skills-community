// 成员目录: ZoneHeader (成员 tab) + MembersDirectory. `?tab=pending` (members-
// managers only) lists join requests; `?role=` and `?q=` filter the active list.

import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { zoneContext } from '@/lib/zones/access';
import { getZoneDetail, listZoneMembers, listZoneRoles } from '@/lib/zones/queries';
import { zoneHref } from '@/lib/zones/shared';
import { MembersDirectory, type MembersTab } from '../../_components/MembersDirectory';
import { ZoneHeader } from '../../_components/ZoneHeader';
import { loginHref } from '../../_components/ui';

export const dynamic = 'force-dynamic';

interface SearchParams {
  tab?: string | string[];
  q?: string | string[];
  role?: string | string[];
}

function firstParam(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : (v ?? '')).trim();
}

const PAGE_TAKE = 200;

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const [t, session] = await Promise.all([getTranslations('zones'), auth()]);
  const ctx = await zoneContext(params.slug, session);
  return { title: ctx ? `${t('zone_tab_members')} · ${ctx.zone.name}` : t('hub_title') };
}

export default async function ZoneMembersPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: SearchParams;
}) {
  const session = await auth();
  const base = `${zoneHref(params.slug)}/members`;
  if (!session?.user) redirect(loginHref(base));
  const ctx = await zoneContext(params.slug, session);
  if (!ctx) notFound();
  const { zone: row, access, viewer } = ctx;
  if (!access.canRead) redirect(zoneHref(params.slug));

  const tab: MembersTab = firstParam(searchParams.tab) === 'pending' && access.canManageMembers ? 'pending' : 'all';
  const q = firstParam(searchParams.q);
  const roleKey = tab === 'all' ? firstParam(searchParams.role) : '';

  const [zone, list, roles] = await Promise.all([
    getZoneDetail(params.slug, viewer),
    listZoneMembers(row.id, {
      status: tab === 'pending' ? 'pending' : 'active',
      q: q || undefined,
      roleKey: roleKey || undefined,
      take: PAGE_TAKE,
      includeMessage: access.canManageMembers,
      canSeeIdentity: access.canSeeIdentity,
    }),
    listZoneRoles(row.id),
  ]);
  if (!zone) notFound();

  return (
    <div className="container max-w-6xl py-6">
      <ZoneHeader zone={zone} activeTab="members" />
      <div className="mt-6">
        <MembersDirectory
          key={`${tab}|${q}|${roleKey}`}
          zone={{ id: zone.id, slug: zone.slug, name: zone.name, memberCount: zone.memberCount }}
          access={access}
          roles={roles}
          initialItems={list.items}
          total={list.total}
          tab={tab}
          q={q}
          roleKey={roleKey}
          pendingCount={zone.pendingCount}
          currentUserId={viewer.id}
        />
      </div>
    </div>
  );
}
