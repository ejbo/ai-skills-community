// Notification orchestration: for each event we (1) write an in-app Notification
// row when the recipient's preference allows, and (2) fire a best-effort email
// when their "also email" preference allows. Everything here is fire-and-forget —
// a notification failure must never break the comment/access/announcement write
// that triggered it, so every entry point swallows its own errors.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  appUrl,
  notifyAuthorOfRequest,
  notifyApplicantOfDecision,
  notifyCommentReplyEmail,
  notifyAnnouncementEmail,
} from '@/lib/email';

// Mirrors the @default(...) values on NotificationPreference. Used when a user
// has no preference row yet (the common case).
const DEFAULT_PREF = {
  inAppCommentReply: true,
  inAppAccessRequest: true,
  inAppAccessDecision: true,
  inAppAnnouncement: true,
  emailCommentReply: false,
  emailAccessRequest: true,
  emailAccessDecision: true,
  emailAnnouncement: false,
};
type Pref = typeof DEFAULT_PREF;

async function getPref(userId: string): Promise<Pref> {
  try {
    const row = await prisma.notificationPreference.findUnique({ where: { userId } });
    return row ? { ...DEFAULT_PREF, ...stripMeta(row) } : DEFAULT_PREF;
  } catch (e) {
    // e.g. the migration hasn't been applied yet — fall back to defaults so the
    // email side still fires instead of being skipped by a thrown query.
    console.error('[notify] getPref failed, using defaults:', e);
    return DEFAULT_PREF;
  }
}

// In-app creation is isolated so a missing/erroring Notification table can NEVER
// block the (independent) email send below it. Best-effort by design.
async function createInApp(data: Prisma.NotificationUncheckedCreateInput): Promise<void> {
  try {
    await prisma.notification.create({ data });
  } catch (e) {
    console.error('[notify] in-app create failed (is the migration applied?):', e);
  }
}

// Keep only the boolean toggle fields (drop id/userId/timestamps) when merging.
function stripMeta(row: Record<string, unknown>): Partial<Pref> {
  const out: Record<string, boolean> = {};
  for (const k of Object.keys(DEFAULT_PREF)) {
    if (typeof row[k] === 'boolean') out[k] = row[k] as boolean;
  }
  return out as Partial<Pref>;
}

function truncate(s: string, n = 140): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

// ─── Comment / reply ───────────────────────────────────────────────────────

export async function notifyCommentReply(opts: {
  recipientId: string;
  recipientEmail: string;
  actorId: string;
  actorName: string;
  videoTitle: string;
  videoSlug: string;
  focusId: string; // the new reply's id (deep-link target)
  bodyMd: string;
  isReplyToReply: boolean;
}): Promise<void> {
  if (opts.recipientId === opts.actorId) return; // never notify yourself
  try {
    const pref = await getPref(opts.recipientId);
    const snippet = truncate(opts.bodyMd);
    const what = opts.isReplyToReply ? '回复' : '评论';
    const link = `/videos/${opts.videoSlug}?focus=${opts.focusId}`;
    if (pref.inAppCommentReply) {
      await createInApp({
        recipientId: opts.recipientId,
        actorId: opts.actorId,
        type: opts.isReplyToReply ? 'reply_reply' : 'comment_reply',
        title: `${opts.actorName} 回复了你的${what}`,
        body: snippet,
        link,
      });
    }
    if (pref.emailCommentReply) {
      notifyCommentReplyEmail({
        to: opts.recipientEmail,
        actorName: opts.actorName,
        videoTitle: opts.videoTitle,
        link: appUrl(link),
        snippet,
        isReplyToReply: opts.isReplyToReply,
      });
    }
  } catch (e) {
    console.error('[notify] comment reply failed:', e);
  }
}

// ─── Access request → author ────────────────────────────────────────────────

export async function notifyAccessRequest(opts: {
  authorId: string;
  authorEmail: string;
  actorId: string;
  applicantName: string;
  applicantEmail: string;
  skillName: string;
  slug: string;
  message?: string | null;
}): Promise<void> {
  try {
    const pref = await getPref(opts.authorId);
    if (pref.inAppAccessRequest) {
      await createInApp({
        recipientId: opts.authorId,
        actorId: opts.actorId,
        type: 'access_request',
        title: `${opts.applicantName} 申请下载你的 Skill`,
        body: `「${opts.skillName}」${opts.message ? `：${truncate(opts.message)}` : ''}`,
        link: `/skills/${opts.slug}?tab=manage&section=access`,
      });
    }
    if (pref.emailAccessRequest) {
      notifyAuthorOfRequest({
        authorEmail: opts.authorEmail,
        skillName: opts.skillName,
        slug: opts.slug,
        applicantName: opts.applicantName,
        applicantEmail: opts.applicantEmail,
        message: opts.message,
      });
    }
  } catch (e) {
    console.error('[notify] access request failed:', e);
  }
}

// ─── Access decision → applicant ────────────────────────────────────────────

export async function notifyAccessDecision(opts: {
  applicantId: string;
  applicantEmail: string;
  actorId: string;
  skillName: string;
  slug: string;
  action: 'approve' | 'reject' | 'revoke';
  note?: string | null;
}): Promise<void> {
  try {
    const pref = await getPref(opts.applicantId);
    const label = opts.action === 'approve' ? '已通过' : opts.action === 'reject' ? '未通过' : '已被撤销';
    if (pref.inAppAccessDecision) {
      await createInApp({
        recipientId: opts.applicantId,
        actorId: opts.actorId,
        type: 'access_decision',
        title: `你对「${opts.skillName}」的下载申请${label}`,
        body: opts.note ? truncate(opts.note) : null,
        link: `/skills/${opts.slug}`,
      });
    }
    if (pref.emailAccessDecision) {
      notifyApplicantOfDecision({
        applicantEmail: opts.applicantEmail,
        skillName: opts.skillName,
        slug: opts.slug,
        action: opts.action,
        note: opts.note,
      });
    }
  } catch (e) {
    console.error('[notify] access decision failed:', e);
  }
}

// ─── Announcement → fan out to all active users ─────────────────────────────

export async function fanoutAnnouncement(opts: {
  announcementId: string;
  actorId: string;
  title: string;
  summary: string;
}): Promise<{ inApp: number; email: number }> {
  const link = `/announcements/${opts.announcementId}`;
  let inApp = 0;
  let email = 0;
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, email: true, notificationPreference: true },
    });
    const rows: { recipientId: string; actorId: string; type: 'announcement'; title: string; body: string; link: string }[] = [];
    for (const u of users) {
      const pref = u.notificationPreference
        ? { ...DEFAULT_PREF, ...stripMeta(u.notificationPreference as unknown as Record<string, unknown>) }
        : DEFAULT_PREF;
      if (pref.inAppAnnouncement) {
        rows.push({
          recipientId: u.id,
          actorId: opts.actorId,
          type: 'announcement',
          title: opts.title,
          body: opts.summary,
          link,
        });
      }
      if (pref.emailAnnouncement && u.email) {
        notifyAnnouncementEmail({ to: u.email, title: opts.title, summary: opts.summary, link: appUrl(link) });
        email++;
      }
    }
    if (rows.length) {
      const res = await prisma.notification.createMany({ data: rows });
      inApp = res.count;
    }
  } catch (e) {
    console.error('[notify] announcement fanout failed:', e);
  }
  return { inApp, email };
}
