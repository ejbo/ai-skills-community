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
  notifyFeedbackReplyEmail,
  notifyPostReplyEmail,
  notifyTopicReplyEmail,
  notifyAnnouncementEmail,
  notifyEventReminderEmail,
  notifyZoneReplyEmail,
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

/**
 * Reply landed on someone's feedback post or feedback comment. Reuses the
 * comment_reply/reply_reply types + preference pair — semantically identical
 * ("someone replied to you"), so no enum/preference migration is needed.
 */
export async function notifyFeedbackReply(opts: {
  recipientId: string;
  recipientEmail: string;
  actorId: string;
  actorName: string;
  feedbackId: string;
  feedbackTitle: string;
  focusId: string; // the new comment's id (deep-link target)
  bodyMd: string;
  isReplyToComment: boolean; // false = top-level comment on the feedback post
}): Promise<void> {
  if (opts.recipientId === opts.actorId) return; // never notify yourself
  try {
    const pref = await getPref(opts.recipientId);
    const snippet = truncate(opts.bodyMd);
    const what = opts.isReplyToComment ? '评论' : '反馈';
    const link = `/feedback/${opts.feedbackId}?focus=${opts.focusId}`;
    if (pref.inAppCommentReply) {
      await createInApp({
        recipientId: opts.recipientId,
        actorId: opts.actorId,
        type: opts.isReplyToComment ? 'reply_reply' : 'comment_reply',
        title: `${opts.actorName} 回复了你的${what}`,
        body: snippet,
        link,
      });
    }
    if (pref.emailCommentReply) {
      notifyFeedbackReplyEmail({
        to: opts.recipientEmail,
        actorName: opts.actorName,
        feedbackTitle: opts.feedbackTitle,
        link: appUrl(link),
        snippet,
        isReplyToComment: opts.isReplyToComment,
      });
    }
  } catch (e) {
    console.error('[notify] feedback reply failed:', e);
  }
}

/**
 * Reply landed on someone's discussion-feed post or post comment. Reuses the
 * comment_reply/reply_reply types + preference pair — semantically identical
 * ("someone replied to you"), so no enum/preference migration is needed.
 */
export async function notifyPostReply(opts: {
  recipientId: string;
  recipientEmail: string;
  actorId: string;
  actorName: string;
  postId: string;
  postExcerpt: string; // first words of the post body (posts have no title)
  focusId: string; // the new comment's id (deep-link target)
  bodyMd: string;
  isReplyToComment: boolean; // false = top-level comment on the post
}): Promise<void> {
  if (opts.recipientId === opts.actorId) return; // never notify yourself
  try {
    const pref = await getPref(opts.recipientId);
    const snippet = truncate(opts.bodyMd);
    const what = opts.isReplyToComment ? '评论' : '动态';
    const link = `/discussion/posts/${opts.postId}?focus=${opts.focusId}`;
    if (pref.inAppCommentReply) {
      await createInApp({
        recipientId: opts.recipientId,
        actorId: opts.actorId,
        type: opts.isReplyToComment ? 'reply_reply' : 'comment_reply',
        title: `${opts.actorName} 回复了你的${what}`,
        body: snippet,
        link,
      });
    }
    if (pref.emailCommentReply) {
      notifyPostReplyEmail({
        to: opts.recipientEmail,
        actorName: opts.actorName,
        postExcerpt: opts.postExcerpt,
        link: appUrl(link),
        snippet,
        isReplyToComment: opts.isReplyToComment,
      });
    }
  } catch (e) {
    console.error('[notify] post reply failed:', e);
  }
}

/**
 * Reply landed on someone's forum topic or forum reply. Same reuse of the
 * comment_reply/reply_reply types + preference pair as the feedback board.
 */
export async function notifyTopicReply(opts: {
  recipientId: string;
  recipientEmail: string;
  actorId: string;
  actorName: string;
  topicId: string;
  topicTitle: string;
  focusId: string; // the new reply's id (deep-link target)
  bodyMd: string;
  isReplyToComment: boolean; // false = top-level reply on the topic
}): Promise<void> {
  if (opts.recipientId === opts.actorId) return; // never notify yourself
  try {
    const pref = await getPref(opts.recipientId);
    const snippet = truncate(opts.bodyMd);
    const what = opts.isReplyToComment ? '回复' : '帖子';
    const link = `/discussion/topics/${opts.topicId}?focus=${opts.focusId}`;
    if (pref.inAppCommentReply) {
      await createInApp({
        recipientId: opts.recipientId,
        actorId: opts.actorId,
        type: opts.isReplyToComment ? 'reply_reply' : 'comment_reply',
        title: `${opts.actorName} 回复了你的${what}`,
        body: snippet,
        link,
      });
    }
    if (pref.emailCommentReply) {
      notifyTopicReplyEmail({
        to: opts.recipientEmail,
        actorName: opts.actorName,
        topicTitle: opts.topicTitle,
        link: appUrl(link),
        snippet,
        isReplyToComment: opts.isReplyToComment,
      });
    }
  } catch (e) {
    console.error('[notify] topic reply failed:', e);
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

/**
 * Reply landed on someone's 知识库 doc comment (or a top-level comment on
 * their doc). Reuses comment_reply/reply_reply — no enum/preference migration.
 * In-app only (library replies have no dedicated email template yet).
 */
export async function notifyLibraryReply(opts: {
  recipientId: string;
  actorId: string;
  actorName: string;
  docSlug: string;
  docTitle: string;
  focusId: string;
  bodyMd: string;
  isReplyToComment: boolean;
}): Promise<void> {
  if (opts.recipientId === opts.actorId) return;
  try {
    const pref = await getPref(opts.recipientId);
    if (!pref.inAppCommentReply) return;
    await createInApp({
      recipientId: opts.recipientId,
      actorId: opts.actorId,
      type: opts.isReplyToComment ? 'reply_reply' : 'comment_reply',
      title: `${opts.actorName} ${opts.isReplyToComment ? '回复了你的评论' : `评论了《${truncate(opts.docTitle, 40)}》`}`,
      body: truncate(opts.bodyMd),
      link: `/library/${opts.docSlug}?focus=${opts.focusId}`,
    });
  } catch (e) {
    console.error('[notify] library reply failed:', e);
  }
}

/** Someone replied to the recipient's shared reading note. */
export async function notifyLibraryNoteReply(opts: {
  recipientId: string;
  actorId: string;
  actorName: string;
  docSlug: string;
  chapterIndex: number;
  highlightId: string;
  bodyMd: string;
}): Promise<void> {
  if (opts.recipientId === opts.actorId) return;
  try {
    const pref = await getPref(opts.recipientId);
    if (!pref.inAppCommentReply) return;
    await createInApp({
      recipientId: opts.recipientId,
      actorId: opts.actorId,
      type: 'reply_reply',
      title: `${opts.actorName} 回复了你的阅读笔记`,
      body: truncate(opts.bodyMd),
      link: `/library/${opts.docSlug}/read?ch=${opts.chapterIndex}&hl=${opts.highlightId}`,
    });
  } catch (e) {
    console.error('[notify] library note reply failed:', e);
  }
}

/** Reader asked for access to a restricted 知识库 doc → notify the uploader. */
export async function notifyLibraryAccessRequest(opts: {
  recipientId: string;
  actorId: string;
  actorName: string;
  docSlug: string;
  docTitle: string;
  message?: string | null;
}): Promise<void> {
  if (opts.recipientId === opts.actorId) return;
  try {
    const pref = await getPref(opts.recipientId);
    if (!pref.inAppAccessRequest) return;
    await createInApp({
      recipientId: opts.recipientId,
      actorId: opts.actorId,
      type: 'access_request',
      title: `${opts.actorName} 申请阅读《${truncate(opts.docTitle, 40)}》`,
      body: opts.message ? truncate(opts.message) : null,
      link: `/library/${opts.docSlug}`,
    });
  } catch (e) {
    console.error('[notify] library access request failed:', e);
  }
}

/** The uploader/admin decided an access request → notify the requester. */
export async function notifyLibraryAccessDecision(opts: {
  recipientId: string;
  actorId: string;
  docSlug: string;
  docTitle: string;
  approved: boolean;
}): Promise<void> {
  if (opts.recipientId === opts.actorId) return;
  try {
    const pref = await getPref(opts.recipientId);
    if (!pref.inAppAccessDecision) return;
    await createInApp({
      recipientId: opts.recipientId,
      actorId: opts.actorId,
      type: 'access_decision',
      title: `你对《${truncate(opts.docTitle, 40)}》的阅读申请${opts.approved ? '已通过' : '未通过'}`,
      body: null,
      link: `/library/${opts.docSlug}`,
    });
  } catch (e) {
    console.error('[notify] library access decision failed:', e);
  }
}

// ─── 活动提醒 ──────────────────────────────────────────────────────────────

/**
 * An event the user joined (我要参加) starts in ~`minutesLeft` minutes.
 * Deliberately NOT gated by NotificationPreference: clicking 我要参加 on that
 * specific event IS the opt-in (leaving the event revokes it). In-app + email
 * both best-effort; the caller has already claimed the attendee row.
 */
export async function notifyEventReminder(opts: {
  recipientId: string;
  recipientEmail: string;
  eventId: string;
  eventTitle: string;
  minutesLeft: number;
  timeLabel: string; // e.g. '14:00（北京时间）'
  location: string; // venue/city or 线上
  meetingUrl: string | null;
}): Promise<void> {
  const link = `/events/${opts.eventId}`;
  try {
    await createInApp({
      recipientId: opts.recipientId,
      type: 'event_reminder',
      title: `「${truncate(opts.eventTitle, 40)}」${opts.minutesLeft} 分钟后开始`,
      body: `${opts.timeLabel} · ${opts.location}`,
      link,
    });
    notifyEventReminderEmail({
      to: opts.recipientEmail,
      eventTitle: opts.eventTitle,
      minutesLeft: opts.minutesLeft,
      timeLabel: opts.timeLabel,
      location: opts.location,
      meetingUrl: opts.meetingUrl,
      link: appUrl(link),
    });
  } catch (e) {
    console.error('[notify] event reminder failed:', e);
  }
}

// ─── 技术专区 ──────────────────────────────────────────────────────────────

/**
 * Reply landed on someone's zone post or on their comment under one. Same
 * reuse of the comment_reply/reply_reply types + preference pair as the
 * discussion board; deep link `/zones/<slug>/posts/<id>?focus=<commentId>`.
 */
export async function notifyZoneReply(opts: {
  recipientId: string;
  recipientEmail: string;
  actorId: string;
  actorName: string;
  zoneSlug: string;
  postId: string;
  postTitle: string;
  focusId: string; // the new comment's id (deep-link target)
  bodyMd: string;
  isReplyToComment: boolean; // false = top-level comment on the post
}): Promise<void> {
  if (opts.recipientId === opts.actorId) return; // never notify yourself
  try {
    const pref = await getPref(opts.recipientId);
    const snippet = truncate(opts.bodyMd);
    const what = opts.isReplyToComment ? '评论' : '帖子';
    const link = `/zones/${opts.zoneSlug}/posts/${opts.postId}?focus=${opts.focusId}`;
    if (pref.inAppCommentReply) {
      await createInApp({
        recipientId: opts.recipientId,
        actorId: opts.actorId,
        type: opts.isReplyToComment ? 'reply_reply' : 'comment_reply',
        title: `${opts.actorName} 回复了你的${what}`,
        body: snippet,
        link,
      });
    }
    if (pref.emailCommentReply) {
      notifyZoneReplyEmail({
        to: opts.recipientEmail,
        actorName: opts.actorName,
        postTitle: opts.postTitle,
        link: appUrl(link),
        snippet,
        isReplyToComment: opts.isReplyToComment,
      });
    }
  } catch (e) {
    console.error('[notify] zone reply failed:', e);
  }
}

export type ZoneMemberEvent = 'added' | 'approved' | 'rejected' | 'role_changed' | 'removed' | 'ownership';

/**
 * Membership changes inside a zone (you were added / approved / rejected /
 * re-roled / removed / made 主版主). In-app ONLY and deliberately NOT gated by
 * NotificationPreference — these are account-level facts a member must learn
 * about, like an access decision. `actorId` null = system / self-service.
 */
export async function notifyZoneMember(opts: {
  recipientId: string;
  actorId: string | null;
  zoneSlug: string;
  zoneName: string;
  event: ZoneMemberEvent;
  roleName?: string | null;
}): Promise<void> {
  if (opts.actorId && opts.recipientId === opts.actorId) return; // never notify yourself
  const zone = `「${truncate(opts.zoneName, 40)}」`;
  const roleSuffix = opts.roleName ? `：${truncate(opts.roleName, 24)}` : '';
  const titles: Record<ZoneMemberEvent, string> = {
    added: `你已被加入版块${zone}${roleSuffix}`,
    approved: `你加入${zone}的申请已通过`,
    rejected: `你加入${zone}的申请未通过`,
    role_changed: `你在${zone}的角色已更新${roleSuffix}`,
    removed: `你已被移出版块${zone}`,
    ownership: `你已成为${zone}的主版主`,
  };
  try {
    await createInApp({
      recipientId: opts.recipientId,
      actorId: opts.actorId,
      type: 'zone_member',
      title: titles[opts.event],
      body: null,
      link: `/zones/${opts.zoneSlug}`,
      payload: { event: opts.event, roleName: opts.roleName ?? null },
    });
  } catch (e) {
    console.error('[notify] zone member failed:', e);
  }
}

/**
 * Someone applied to join a zone → every members-manager (owner + holders of
 * the zone `members` permission, see lib/zones/notify.ts#managerIdsFor) gets
 * one in-app row. Deep link opens the 待审核 tab. Not preference-gated:
 * managing a zone is the opt-in.
 */
export async function notifyZoneJoinRequest(opts: {
  recipientIds: string[];
  actorId: string;
  actorName: string;
  zoneSlug: string;
  zoneName: string;
  message: string;
}): Promise<void> {
  const recipients = [...new Set(opts.recipientIds)].filter((id) => id && id !== opts.actorId);
  if (recipients.length === 0) return;
  const link = `/zones/${opts.zoneSlug}/members?tab=pending`;
  const title = `${opts.actorName} 申请加入「${truncate(opts.zoneName, 40)}」`;
  const body = opts.message.trim() ? truncate(opts.message) : null;
  try {
    await prisma.notification.createMany({
      data: recipients.map((recipientId) => ({
        recipientId,
        actorId: opts.actorId,
        type: 'zone_request' as const,
        title,
        body,
        link,
      })),
    });
  } catch (e) {
    console.error('[notify] zone join request failed (is the migration applied?):', e);
  }
}

// ── @人 / 合著者 ─────────────────────────────────────────────────────────────

/** Where a mention happened, for the notification copy and the deep link. */
export interface MentionSite {
  /** 帖子 / 评论 / 回复 / 动态 …, already localized to the house Chinese copy. */
  what: string;
  /** Title of the thing that contains the mention ('' when it has none). */
  title?: string | null;
  /** In-app link, root-relative; `appUrl()` prefixes it for email. */
  link: string;
}

/**
 * Someone @-ed people in a body. In-app ONLY and deliberately NOT gated by
 * NotificationPreference: a mention is addressed to you personally, like a
 * membership decision — the comment-reply preference is about threads you
 * happen to be in, which is a different question.
 *
 * The caller resolves handles to ids (lib/mentions.ts extracts the handles);
 * this fans out one row per recipient, skipping the actor. Failures are
 * swallowed per recipient so one bad row never costs the others their ping,
 * and never fails the write that triggered it.
 */
export async function notifyMention(opts: {
  recipientIds: readonly string[];
  actorId: string;
  actorName: string;
  site: MentionSite;
  bodyMd: string;
}): Promise<void> {
  const recipients = [...new Set(opts.recipientIds)].filter((id) => id && id !== opts.actorId);
  if (recipients.length === 0) return;
  const snippet = truncate(opts.bodyMd);
  const where = opts.site.title ? `${opts.site.what}「${truncate(opts.site.title, 40)}」` : opts.site.what;
  await Promise.all(
    recipients.map(async (recipientId) => {
      try {
        await createInApp({
          recipientId,
          actorId: opts.actorId,
          type: 'mention',
          title: `${opts.actorName} 在${where}中提到了你`,
          body: snippet,
          link: opts.site.link,
        });
      } catch (e) {
        console.error('[notify] mention failed:', e);
      }
    }),
  );
}

/**
 * You were added as a 合著者 and the content just went LIVE. Deliberately fired
 * on publish, not on save: a draft's co-author list churns while the author is
 * still writing, and being told about a draft you cannot see yet is noise.
 * In-app only, not preference-gated (it is a fact about your own byline).
 */
export async function notifyCoauthor(opts: {
  recipientIds: readonly string[];
  actorId: string;
  actorName: string;
  title: string;
  link: string;
}): Promise<void> {
  const recipients = [...new Set(opts.recipientIds)].filter((id) => id && id !== opts.actorId);
  if (recipients.length === 0) return;
  await Promise.all(
    recipients.map(async (recipientId) => {
      try {
        await createInApp({
          recipientId,
          actorId: opts.actorId,
          type: 'coauthor',
          title: `${opts.actorName} 把你列为合著者`,
          body: truncate(opts.title, 80),
          link: opts.link,
        });
      } catch (e) {
        console.error('[notify] coauthor failed:', e);
      }
    }),
  );
}
