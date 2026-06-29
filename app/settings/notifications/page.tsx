import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { NotificationPreferenceForm, type PrefValues } from '../NotificationPreferenceForm';

export const dynamic = 'force-dynamic';

// Mirrors the @default(...) values on NotificationPreference (used when no row yet).
const DEFAULTS: PrefValues = {
  inAppCommentReply: true,
  inAppAccessRequest: true,
  inAppAccessDecision: true,
  inAppAnnouncement: true,
  emailCommentReply: false,
  emailAccessRequest: true,
  emailAccessDecision: true,
  emailAnnouncement: false,
};

export default async function NotificationSettingsPage() {
  const session = await auth();
  if (!session?.user) return null;

  const pref = await prisma.notificationPreference.findUnique({ where: { userId: session.user.id } });
  const values: PrefValues = pref
    ? {
        inAppCommentReply: pref.inAppCommentReply,
        inAppAccessRequest: pref.inAppAccessRequest,
        inAppAccessDecision: pref.inAppAccessDecision,
        inAppAnnouncement: pref.inAppAnnouncement,
        emailCommentReply: pref.emailCommentReply,
        emailAccessRequest: pref.emailAccessRequest,
        emailAccessDecision: pref.emailAccessDecision,
        emailAnnouncement: pref.emailAnnouncement,
      }
    : DEFAULTS;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">通知</h2>
        <p className="mt-1 text-sm text-muted">选择你想接收哪些通知，以及是否同时发送邮件。</p>
      </div>
      <NotificationPreferenceForm initial={values} />
    </div>
  );
}
