import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowUpRight } from 'lucide-react';
import { auth } from '@/lib/auth';
import { loginHref } from '@/lib/auth/callback-path';
import { can } from '@/lib/permissions';
import { loadOwnProfileSettings, loadProfileCardView } from '@/lib/profile/card-view';
import { PREVIEW_VISITOR_ID } from '@/lib/profile/queries';
import { SettingsPageHeader } from '../_components/SettingsSection';
import { BTN_SECONDARY } from '../_components/ui';
import { CardEditor } from './CardEditor';

export const dynamic = 'force-dynamic';

export default async function CardSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect(loginHref('/settings/card'));
  const t = await getTranslations('settings');

  // Two server-trimmed views, because the two previews answer different questions:
  //   名片   — the hero of the member's own profile page: owner viewer + their REAL
  //            `identity` permission (what /users/[handle] builds for them).
  //   悬停时 — what an ordinary signed-in member gets from the hover card API: a
  //            non-owner viewer without `identity`, so 隐私账号 trimming applies and
  //            hidden sections' stats are not counted. PREVIEW_VISITOR_ID is the
  //            profile's own 访客视角 sentinel (never equals a real row).
  // Never `canSeeIdentity: true` here: a 隐私账号 would design against an @handle
  // and a 部门 line nobody else is shown.
  const [settings, cardView, hoverView] = await Promise.all([
    loadOwnProfileSettings(session.user.id),
    loadProfileCardView(session.user.handle, { id: session.user.id, canSeeIdentity: can(session.user, 'identity') }),
    loadProfileCardView(session.user.handle, { id: PREVIEW_VISITOR_ID, canSeeIdentity: false }),
  ]);
  if (!cardView || !hoverView) notFound();

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t('ce_title')}
        description={t('ce_desc')}
        actions={
          <Link href={`/users/${encodeURIComponent(cardView.handle)}`} className={BTN_SECONDARY}>
            {t('ce_view_on_profile')}
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        }
      />
      <CardEditor cardView={cardView} hoverView={hoverView} settings={settings} />
    </div>
  );
}
