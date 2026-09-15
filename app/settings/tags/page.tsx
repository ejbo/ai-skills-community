import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { loginHref } from '@/lib/auth/callback-path';
import { relativeTime } from '@/lib/i18n-date';
import { ownTagBadge, roleBadge } from '@/lib/profile/badges';
import { loadOwnTags } from '@/lib/user-tags';
import { SettingsPageHeader } from '../_components/SettingsSection';
import { CARD_CLS } from '../_components/ui';
import { UserTagsForm, type OwnBadgeRow } from './UserTagsForm';

export const dynamic = 'force-dynamic';

export default async function SettingsTagsPage() {
  const session = await auth();
  if (!session?.user) redirect(loginHref('/settings/tags'));
  const [t, locale] = await Promise.all([getTranslations('settings'), getLocale()]);

  // Server-loaded so each row can render the REAL badge (icon, description,
  // 获得于) — the /api/me/tags GET predates those fields. loadOwnTags also runs
  // the 版主 auto-tag reconcile, same as before.
  const [rows, user] = await Promise.all([
    loadOwnTags(session.user.id),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: { select: { key: true, name: true, description: true, permissions: true } } },
    }),
  ]);

  const tags: OwnBadgeRow[] = rows.map((r) => ({
    badge: ownTagBadge(r),
    hidden: r.hidden,
    grantedLabel: relativeTime(r.createdAt, locale),
  }));
  // An honorific role (专家) shows on the card too, but it is not the member's
  // to hide — it is listed read-only so the preview matches the real card.
  const role = roleBadge(user?.role ?? null);

  return (
    <div className="space-y-5">
      <SettingsPageHeader title={t('tags_title')} description={t('tags_desc')} />
      <section className={`${CARD_CLS} p-5 sm:p-6`}>
        <UserTagsForm initial={tags} role={role} handle={session.user.handle} />
      </section>
    </div>
  );
}
