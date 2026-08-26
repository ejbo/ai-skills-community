// 创建版块 — gated by canUserCreateZone (site `zones` permission OR
// User.canCreateZones); everyone else bounces back to the hub.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft } from 'lucide-react';
import { auth } from '@/lib/auth';
import { canUserCreateZone } from '@/lib/zones/access';
import { zoneFacets } from '@/lib/zones/queries';
import { BlurText } from '@/components/motion';
import { CreateZoneWizard } from '../_components/CreateZoneWizard';
import { loginHref } from '../_components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getTranslations('zones');
  return { title: `${t('create_title')} · ${t('hub_title')}` };
}

export default async function NewZonePage() {
  const session = await auth();
  if (!session?.user) redirect(loginHref('/zones/new'));
  if (!(await canUserCreateZone(session.user))) redirect('/zones');
  const [t, facets] = await Promise.all([getTranslations('zones'), zoneFacets()]);

  return (
    <div className="container max-w-3xl py-8">
      <Link
        href="/zones"
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <ChevronLeft className="h-4 w-4" />
        {t('hub_title')}
      </Link>
      <div className="mt-4 mb-8">
        <BlurText text={t('create_title')} as="h1" by="chars" stagger={0.03} className="text-2xl font-semibold tracking-tight sm:text-3xl" />
        <p className="mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">{t('create_subtitle')}</p>
      </div>
      <CreateZoneWizard facets={facets} />
    </div>
  );
}
