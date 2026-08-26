// 版块设置 (canManage | canManageRoles | owner | site admin): TabBar-driven
// ZoneSettingsForm — 基本信息 / 权限与加入 / 角色 / 危险操作.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft } from 'lucide-react';
import { auth } from '@/lib/auth';
import { zoneContext } from '@/lib/zones/access';
import { getZoneDetail, zoneFacets } from '@/lib/zones/queries';
import { zoneHref } from '@/lib/zones/shared';
import { ZoneSettingsForm } from '../../_components/ZoneSettingsForm';
import { settingsTabsFor, type SettingsTab } from '../../_components/settings-tabs';
import { PILL_MONO, loginHref } from '../../_components/ui';

export const dynamic = 'force-dynamic';

interface SearchParams {
  tab?: string | string[];
}

function firstParam(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : (v ?? '')).trim();
}

const TABS: readonly SettingsTab[] = ['basic', 'access', 'roles', 'danger'];

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const [t, session] = await Promise.all([getTranslations('zones'), auth()]);
  const ctx = await zoneContext(params.slug, session);
  return { title: ctx ? `${t('settings_title')} · ${ctx.zone.name}` : t('hub_title') };
}

export default async function ZoneSettingsPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: SearchParams;
}) {
  const session = await auth();
  const base = zoneHref(params.slug);
  if (!session?.user) redirect(loginHref(`${base}/settings`));
  const ctx = await zoneContext(params.slug, session);
  if (!ctx) notFound();
  const { access, viewer } = ctx;
  if (!(access.canManage || access.canManageRoles || access.isOwner || access.siteAdmin)) redirect(base);

  const [t, zone, facets] = await Promise.all([getTranslations('zones'), getZoneDetail(params.slug, viewer), zoneFacets()]);
  if (!zone) notFound();

  const allowed = settingsTabsFor(zone);
  if (allowed.length === 0) redirect(base);
  const wanted = firstParam(searchParams.tab);
  const tab: SettingsTab = (TABS as readonly string[]).includes(wanted) && allowed.includes(wanted as SettingsTab)
    ? (wanted as SettingsTab)
    : allowed[0];

  return (
    <div className="container max-w-4xl py-8">
      <Link
        href={base}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <ChevronLeft className="h-4 w-4" />
        {zone.name}
      </Link>
      <div className="mt-4 mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('settings_title')}</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t('settings_subtitle', { name: zone.name })}</p>
        </div>
        <span className={`${PILL_MONO} normal-case tracking-normal`}>/zones/{zone.slug}</span>
      </div>
      <ZoneSettingsForm zone={zone} facets={facets} tab={tab} />
    </div>
  );
}
