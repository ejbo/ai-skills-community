// 站内翻译 — the KIND REGISTRY (server-only). One loader per key of
// TRANSLATE_KINDS (lib/translate/shared.ts); tests/translate-sources.test.ts
// asserts the two stay in step and that no loader can skip its gate.
//
// THE RULE (docs/translation-design.md §3.5, lib/translate/source-types.ts): the
// route never accepts text from the client — it accepts `{kind, id}`, and the
// loader reads the row ITSELF and re-runs the surface's OWN read gate, by calling
// the same helper (or replicating the exact same condition) that surface's
// list / detail route uses. "Translatable exactly when readable": null ⇒ 404,
// indistinguishable from a missing row. A translation is the content, in another
// language — a gate that is looser than the page would be a read bypass, and one
// that is stricter would render a 翻译 link that can only fail.
//
// Each loader names the route it mirrors. When that route changes, change the
// loader with it (the comment-like routes carry the same obligation).
//
// Parents: a comment is translatable only under a live, readable parent.
//  · 动态 / 讨论 / 意见反馈 rows are HARD-deleted and their comments cascade
//    (`onDelete: Cascade`), so a comment that exists has a live parent, and those
//    boards are publicly readable — existence + `status: 'visible'` IS the gate.
//  · Everywhere else the parent is soft-deleted and/or access-controlled, so the
//    loader selects the parent's gate columns in the same query and checks them.
//
// Selects are minimal on purpose: bodies can be large, and nothing but the
// translatable text and the gate columns is ever needed here.

import { prisma } from '@/lib/db';
import { can, domainViewer } from '@/lib/permissions';
import { canReadDoc, libraryViewerFromSession } from '@/lib/library-queries';
import { canViewVideo, videoActorFrom } from '@/lib/video/access';
import { ZONE_ACCESS_SELECT, resolveZoneAccess, zoneSiteViewer } from '@/lib/zones/access';
import { ZONE_POST_ACCESS_SELECT, canSeeZonePost } from '@/lib/zones/post-queries';
import { VOTE_GATE_SELECT, canSeeVoteActivity } from '@/lib/votes/visibility';
import { TRANSLATE_KINDS, type FieldName, type TranslateKind } from './shared';
import type { SourceFields, TranslateLoader, TranslateViewer } from './source-types';

type SignedIn = NonNullable<TranslateViewer>;
/** What a loader hands back before the registry trims it: the kind's fields, possibly empty / null. */
type RawFields = Partial<Record<FieldName, string | null | undefined>>;
type PublicLoader = (id: string, viewer: TranslateViewer) => Promise<RawFields | null>;
type PrivateLoader = (id: string, viewer: SignedIn) => Promise<RawFields | null>;

/**
 * Wrap a loader with the three rules that must hold for EVERY kind, so no single
 * loader can forget them:
 *  1. an anonymous viewer never reaches a non-public kind's loader;
 *  2. only the field names the kind DECLARES leave the registry;
 *  3. fields are trimmed, empty ones dropped, and "nothing left" is null.
 */
function register<K extends TranslateKind>(
  kind: K,
  load: (typeof TRANSLATE_KINDS)[K]['public'] extends true ? PublicLoader : PrivateLoader,
): TranslateLoader {
  const spec = TRANSLATE_KINDS[kind];
  const declared = Object.keys(spec.fields) as FieldName[];
  return async (id, viewer) => {
    if (typeof id !== 'string' || id === '') return null;
    if (!spec.public && !viewer) return null;
    const raw = await (load as PublicLoader)(id, viewer);
    if (!raw) return null;
    const out: SourceFields = {};
    for (const name of declared) {
      const value = raw[name];
      if (typeof value === 'string' && value.trim() !== '') out[name] = value.trim();
    }
    return Object.keys(out).length > 0 ? out : null;
  };
}

// ── 知识库 ───────────────────────────────────────────────────────────────────

const DOC_GATE_SELECT = { id: true, uploaderId: true, visibility: true, status: true, deletedAt: true } as const;
type DocGateRow = { id: string; uploaderId: string; visibility: string; status: string; deletedAt: Date | null };

/** Every library route answers 404 for a doc that is deleted or not `ready` — before any visibility question. */
function docIsLive(doc: DocGateRow): boolean {
  return !doc.deletedAt && doc.status === 'ready';
}

/**
 * 批注 (and everything under one): the reader's gate — the doc must be READABLE
 * (`canReadDoc`), and an annotation that is not the viewer's own must be shared
 * by its owner (`LibraryProgress.shareNotes`). Mirrors
 * app/api/library/notes/[highlightId]/like/route.ts and `getSharedNotes`.
 */
async function canReadAnnotation(doc: DocGateRow, ownerId: string, viewer: SignedIn): Promise<boolean> {
  if (!docIsLive(doc)) return false;
  if (!(await canReadDoc(doc, libraryViewerFromSession({ user: viewer })))) return false;
  if (ownerId === viewer.id) return true;
  const progress = await prisma.libraryProgress.findUnique({
    where: { userId_docId: { userId: ownerId, docId: doc.id } },
    select: { shareNotes: true },
  });
  return progress?.shareNotes === true;
}

// ── the registry ─────────────────────────────────────────────────────────────

export const TRANSLATE_SOURCES: Record<TranslateKind, TranslateLoader> = {
  // 动态 — lib/discussion-queries.ts#getPostDetail: the row exists. Publicly readable, hard-deleted.
  post: register('post', async (id) => {
    const row = await prisma.post.findUnique({ where: { id }, select: { bodyMd: true } });
    return row ? { body: row.bodyMd } : null;
  }),

  // 动态评论 — listPostComments / app/api/discussion/comments/[id]/like: a tombstone
  // (`status: 'deleted'`, body wiped) is not content. The post cascades (see header).
  post_comment: register('post_comment', async (id) => {
    const row = await prisma.postComment.findUnique({ where: { id }, select: { bodyMd: true, status: true } });
    if (!row || row.status !== 'visible') return null;
    return { body: row.bodyMd };
  }),

  // 讨论主题 — lib/discussion-queries.ts#getTopicDetail: the row exists. A LOCKED topic
  // stops new replies, not reading.
  topic: register('topic', async (id) => {
    const row = await prisma.discussionTopic.findUnique({ where: { id }, select: { title: true, bodyMd: true } });
    return row ? { title: row.title, body: row.bodyMd } : null;
  }),

  // 讨论回复 — app/api/discussion/topics/[id]/replies/[replyId]/like: not a tombstone.
  topic_reply: register('topic_reply', async (id) => {
    const row = await prisma.discussionReply.findUnique({ where: { id }, select: { bodyMd: true, status: true } });
    if (!row || row.status !== 'visible') return null;
    return { body: row.bodyMd };
  }),

  // 意见反馈 — lib/feedback-queries.ts#getFeedbackDetail: the row exists (no login wall on /feedback).
  feedback: register('feedback', async (id) => {
    const row = await prisma.feedback.findUnique({ where: { id }, select: { title: true, bodyMd: true } });
    return row ? { title: row.title, body: row.bodyMd } : null;
  }),

  // 反馈评论 — app/api/feedback/[id]/comments/[commentId]/like: not a tombstone.
  feedback_comment: register('feedback_comment', async (id) => {
    const row = await prisma.feedbackComment.findUnique({ where: { id }, select: { bodyMd: true, status: true } });
    if (!row || row.status !== 'visible') return null;
    return { body: row.bodyMd };
  }),

  // 视频评论 (long videos AND shorts share VideoComment; the comment's own video decides) —
  // app/api/videos/[slug]/comments: login + the video is not deleted; the list queries drop
  // `hidden`, the like route drops `deleted`. ON TOP of that, `canViewVideo` — the detail
  // page's gate — because the list route never asks whether the video is a draft / private
  // (the same hole the AI chat route had), and a translation is a content read.
  video_comment: register('video_comment', async (id, viewer) => {
    const row = await prisma.videoComment.findUnique({
      where: { id },
      select: {
        bodyMd: true,
        status: true,
        video: { select: { status: true, visibility: true, uploaderId: true, deletedAt: true, isShort: true } },
      },
    });
    if (!row || row.status !== 'visible' || row.video.deletedAt) return null;
    if (!canViewVideo(row.video, videoActorFrom(viewer))) return null;
    return { body: row.bodyMd };
  }),

  // 技术帖 — lib/zones/post-queries.ts#getZonePostDetail (the detail page's read), without the
  // slug: a deleted zone / a soft-deleted post exist only for site staff (restore path), then
  // `canSeeZonePost` = decideZonePostAccess + the restricted-grant lookup. It answers false for
  // `hidden` AND for `locked`: a viewer who only gets the stub of a 指定成员可见 post must never
  // get its title/summary/body through here. Drafts: (co-)authors and moderators, like the page.
  zone_post: register('zone_post', async (id, viewer) => {
    const row = await prisma.zonePost.findUnique({
      where: { id },
      select: {
        ...ZONE_POST_ACCESS_SELECT,
        title: true,
        summary: true,
        bodyMd: true,
        zone: { select: ZONE_ACCESS_SELECT },
      },
    });
    if (!row) return null;
    const site = zoneSiteViewer(viewer);
    if ((row.zone.deletedAt || row.deletedAt) && !site.siteAdmin) return null;
    const access = await resolveZoneAccess(row.zone, site);
    if (!(await canSeeZonePost(row, access, site))) return null;
    return { title: row.title, summary: row.summary, body: row.bodyMd };
  }),

  // 技术帖评论 — app/api/zones/[slug]/posts/[postId]/comments GET (the LIST route, which is
  // stricter than the older comment-like route): zone visible, `access.canRead`, the post not
  // deleted FOR ANYONE, then `canSeeZonePost`. Plus: not a tombstone.
  zone_comment: register('zone_comment', async (id, viewer) => {
    const row = await prisma.zonePostComment.findUnique({
      where: { id },
      select: {
        bodyMd: true,
        status: true,
        post: { select: { ...ZONE_POST_ACCESS_SELECT, zone: { select: ZONE_ACCESS_SELECT } } },
      },
    });
    if (!row || row.status !== 'visible' || row.post.deletedAt) return null;
    const site = zoneSiteViewer(viewer);
    if (row.post.zone.deletedAt && !site.siteAdmin) return null;
    const access = await resolveZoneAccess(row.post.zone, site);
    if (!access.canRead) return null;
    if (!(await canSeeZonePost(row.post, access, site))) return null;
    return { body: row.bodyMd };
  }),

  // 知识库评论 — they are rendered on the doc's DETAIL page, not in the reader, so the gate is
  // that page's, not `canReadDoc`: app/api/library/docs/[id]/comments GET (login, doc ready and
  // not deleted) + lib/library-queries.ts#getDocBySlug (a `private` doc's page exists only for
  // its uploader and `library` managers; a `restricted` doc shows its page — comments included —
  // to every signed-in member). `canReadDoc` here would put a dead 翻译 link under every comment
  // of a restricted doc for the members who can read those comments today.
  library_comment: register('library_comment', async (id, viewer) => {
    const row = await prisma.libraryComment.findUnique({
      where: { id },
      select: { bodyMd: true, status: true, doc: { select: DOC_GATE_SELECT } },
    });
    if (!row || row.status !== 'visible' || !docIsLive(row.doc)) return null;
    const lib = libraryViewerFromSession({ user: viewer });
    const privileged = !!lib && (lib.canManage || lib.id === row.doc.uploaderId);
    if (row.doc.visibility === 'private' && !privileged) return null;
    return { body: row.bodyMd };
  }),

  // 批注 — app/api/library/docs/[id]/notes GET + …/notes/[highlightId]/like: see canReadAnnotation.
  library_note: register('library_note', async (id, viewer) => {
    const row = await prisma.libraryHighlight.findUnique({
      where: { id },
      select: { noteText: true, userId: true, doc: { select: DOC_GATE_SELECT } },
    });
    if (!row || !row.noteText) return null;
    if (!(await canReadAnnotation(row.doc, row.userId, viewer))) return null;
    return { body: row.noteText };
  }),

  // 批注回复 — app/api/library/notes/[highlightId]/replies/[replyId]/like: not a tombstone, and
  // readable only while its annotation is (an unshared 批注 is invisible, so are its replies).
  library_note_reply: register('library_note_reply', async (id, viewer) => {
    const row = await prisma.libraryNoteReply.findUnique({
      where: { id },
      select: {
        bodyMd: true,
        status: true,
        highlight: { select: { userId: true, doc: { select: DOC_GATE_SELECT } } },
      },
    });
    if (!row || row.status !== 'visible') return null;
    if (!(await canReadAnnotation(row.highlight.doc, row.highlight.userId, viewer))) return null;
    return { body: row.bodyMd };
  }),

  // 作品评论 — app/api/votes/[id]/entries/[entryId]/comments GET: the activity passes the
  // detail page's own gate (`canSeeVoteActivity`: not deleted, draft ⇒ owner only, 可见范围 —
  // 隐藏 ⇒ owner only, 指定成员可见 ⇒ owner + the list), comment ∈ entry ∈ activity, and the
  // comments of a hidden / unapproved entry are manager-only (`votes` permission or the
  // creator). NOT `allowComments`: turning comments off hides the composer, existing comments
  // stay readable (VoteGallery `commentsAvailable`).
  vote_comment: register('vote_comment', async (id, viewer) => {
    const row = await prisma.voteComment.findUnique({
      where: { id },
      select: {
        body: true,
        activityId: true,
        activity: { select: VOTE_GATE_SELECT },
        entry: { select: { activityId: true, hidden: true, status: true } },
      },
    });
    if (!row || row.entry.activityId !== row.activityId) return null;
    if (!(await canSeeVoteActivity(row.activity, domainViewer(viewer, 'votes')))) return null;
    const isManager = can(viewer, 'votes') || row.activity.creatorId === viewer.id;
    if ((row.entry.hidden || row.entry.status !== 'approved') && !isManager) return null;
    return { body: row.body };
  }),
};
