import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PasswordForm } from './PasswordForm';

export const dynamic = 'force-dynamic';

export default async function SecuritySettingsPage() {
  const session = await auth();
  const user = await prisma.user.findUnique({
    where: { id: session!.user.id },
    select: { passwordHash: true, authMethod: true },
  });
  const t = await getTranslations('settings');

  // W3 accounts authenticate through the company IdP — they neither have nor
  // may set a local password (the /api/auth/me PATCH enforces this too).
  const ssoOnly = user?.authMethod === 'huawei_sso' && !user?.passwordHash;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold">{t('security_title')}</h2>
        {ssoOnly ? (
          <p className="mt-4 text-sm text-muted">{t('sso_no_password')}</p>
        ) : (
          <div className="mt-4">
            <PasswordForm hasPassword={Boolean(user?.passwordHash)} />
          </div>
        )}
      </section>
    </div>
  );
}
