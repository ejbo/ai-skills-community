import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ProfileForm } from './ProfileForm';

export const dynamic = 'force-dynamic';

export default async function ProfileSettingsPage() {
  const session = await auth();
  const user = await prisma.user.findUnique({
    where: { id: session!.user.id },
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
  });
  if (!user) return null;
  const t = await getTranslations('settings');
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold">{t('profile_title')}</h2>
        <div className="mt-4">
          <ProfileForm user={user} />
        </div>
      </section>
    </div>
  );
}
