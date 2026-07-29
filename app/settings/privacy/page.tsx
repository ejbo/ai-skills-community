import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PrivacyForm } from './PrivacyForm';

export const dynamic = 'force-dynamic';

export default async function PrivacySettingsPage() {
  const session = await auth();
  if (!session?.user) redirect('/auth/login?callbackUrl=/settings/privacy');
  const t = await getTranslations('settings');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isPrivate: true, department: true, lab: true },
  });
  if (!user) redirect('/auth/login?callbackUrl=/settings/privacy');

  const dept = [user.department, user.lab].filter(Boolean).join(' · ');

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold tracking-tight">{t('privacy_title')}</h2>

      <div className="surface rounded-xl p-5">
        <PrivacyForm initialIsPrivate={user.isPrivate} />
      </div>

      <div className="surface rounded-xl p-5">
        <h3 className="text-sm font-medium">{t('privacy_current_dept')}</h3>
        <p className="mt-2 text-sm">
          {dept ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-500/10 px-2.5 py-1 text-[13px] font-medium text-accent-600">
              {dept}
            </span>
          ) : (
            <span className="text-muted">{t('privacy_dept_none')}</span>
          )}
        </p>
        <p className="mt-2 text-xs text-muted">
          {t('privacy_dept_hint')}
          {dept ? ` ${t('privacy_shown_publicly')}` : ''}
        </p>
      </div>
    </div>
  );
}
