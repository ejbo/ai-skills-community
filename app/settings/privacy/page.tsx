import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { loginHref } from '@/lib/auth/callback-path';
import { loadOwnProfileSettings } from '@/lib/profile/card-view';
import { SettingsPageHeader } from '../_components/SettingsSection';
import { CARD_CLS } from '../_components/ui';
import { PrivacyForm } from './PrivacyForm';
import { LibraryActivityForm } from './LibraryActivityForm';
import { ProfileLayoutEditor } from './ProfileLayoutEditor';

export const dynamic = 'force-dynamic';

export default async function PrivacySettingsPage() {
  const session = await auth();
  if (!session?.user) redirect(loginHref('/settings/privacy'));
  const t = await getTranslations('settings');

  const [user, settings] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { handle: true, isPrivate: true, showLibraryActivity: true, department: true, lab: true },
    }),
    // The layout comes through the profile contract (parseProfileLayout with the
    // legacy showProfile* fallback), never from the retired User flags directly.
    loadOwnProfileSettings(session.user.id),
  ]);
  if (!user) redirect(loginHref('/settings/privacy'));

  const dept = [user.department, user.lab].filter(Boolean).join(' · ');

  return (
    <div className="space-y-5">
      <SettingsPageHeader title={t('privacy_title')} description={t('layout_page_desc')} />

      <div className={`${CARD_CLS} p-5 sm:p-6`}>
        <PrivacyForm initialIsPrivate={user.isPrivate} handle={user.handle} />
      </div>

      <div className={`${CARD_CLS} p-5 sm:p-6`}>
        <ProfileLayoutEditor initial={settings.layout} handle={user.handle} />
      </div>

      <div className={`${CARD_CLS} p-5 sm:p-6`}>
        <LibraryActivityForm initialShow={user.showLibraryActivity} />
      </div>

      <div className={`${CARD_CLS} p-5 sm:p-6`}>
        <h3 className="text-sm font-semibold tracking-tight">{t('privacy_current_dept')}</h3>
        <p className="mt-2 text-sm">
          {dept ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-900/[0.06] px-2.5 py-1 text-[13px] font-medium text-zinc-900 dark:bg-white/10 dark:text-zinc-50">
              {dept}
            </span>
          ) : (
            <span className="text-muted">{t('privacy_dept_none')}</span>
          )}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {t('privacy_dept_hint')}
          {dept ? ` ${t('privacy_shown_publicly')}` : ''}
        </p>
      </div>
    </div>
  );
}
