import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowUpRight } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { loginHref } from '@/lib/auth/callback-path';
import { loadOwnProfileSettings } from '@/lib/profile/card-view';
import { SettingsPageHeader } from './_components/SettingsSection';
import { BTN_SECONDARY } from './_components/ui';
import { ProfileForm } from './ProfileForm';

export const dynamic = 'force-dynamic';

export default async function ProfileSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect(loginHref('/settings'));

  // NOT caught: if the profile row cannot be read, rendering an empty form would
  // let one 保存 overwrite the member's real 头衔 / 关于我 / 外链 with blanks.
  const [user, settings] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        handle: true,
        email: true,
        displayName: true,
        bio: true,
        avatarUrl: true,
        authMethod: true,
        huaweiW3Id: true,
        huaweiW3Name: true,
      },
    }),
    loadOwnProfileSettings(session.user.id),
  ]);
  if (!user) redirect(loginHref('/settings'));
  const t = await getTranslations('settings');

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t('profile_title')}
        description={t('pf_desc')}
        actions={
          <Link href={`/users/${encodeURIComponent(user.handle)}`} className={BTN_SECONDARY}>
            {t('pf_view_profile')}
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        }
      />
      <ProfileForm user={user} settings={settings} />
    </div>
  );
}
