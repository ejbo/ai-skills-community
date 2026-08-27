// 个人主页 (/users/[handle]) content queries.
//
// Contract (mirrors isPrivate in lib/user-identity.ts): every section is gated
// by the owner's showProfile* toggle SERVER-side. A hidden section is never even
// queried for other viewers, so its data never leaves the server; the owner and
// admins always see everything (with a 仅自己可见 badge in the UI).
import { prisma } from '@/lib/db';
import { discussionTagMap, excerptOf, tagViewsFrom } from '@/lib/discussion-queries';

export const PROFILE_SECTIONS = [
  'skills',
  'docs',
  'posts',
  'comments',
  'shelf',
  'events',
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/** Select fragment for the six User.showProfile* booleans. */
export const PROFILE_VISIBILITY_SELECT = {
  showProfileSkills: true,
  showProfileDocs: true,
  showProfilePosts: true,
  showProfileComments: true,
  showProfileShelf: true,
  showProfileEvents: true,
} as const;

export type ProfileVisibilityFlags = {
  [K in keyof typeof PROFILE_VISIBILITY_SELECT]: boolean;
};

export function profileSectionVisibility(
  u: ProfileVisibilityFlags,
): Record<ProfileSection, boolean> {
  return {
    skills: u.showProfileSkills,
    docs: u.showProfileDocs,
    posts: u.showProfilePosts,
    comments: u.showProfileComments,
    shelf: u.showProfileShelf,
    events: u.showProfileEvents,
  };
}

// Only ever surface publicly-readable library docs on a profile, regardless of
// whose profile it is — restricted/private docs stay off even for the owner's
// public page (the dashboard is the place to manage those).
const PUBLIC_READY_DOC = {
  status: 'ready',
  deletedAt: null,
  visibility: 'public',
} as const;

export async function getProfileDocs(userId: string) {
  return prisma.libraryDoc.findMany({
    where: { uploaderId: userId, ...PUBLIC_READY_DOC },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: {
      id: true,
      slug: true,
      title: true,
      docType: true,
      summary: true,
      shelfCount: true,
      viewCount: true,
      commentCount: true,
      ratingCount: true,
      avgRating: true,
      createdAt: true,
    },
  });
}

export async function getProfilePosts(userId: string) {
  const posts = await prisma.post.findMany({
    where: { authorId: userId },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, bodyMd: true, likeCount: true, commentCount: true, createdAt: true },
  });
  return posts.map((p) => ({ ...p, excerpt: excerptOf(p.bodyMd) }));
}

export async function getProfileTopics(userId: string) {
  const rows = await prisma.discussionTopic.findMany({
    where: { authorId: userId },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      title: true,
      categories: true,
      replyCount: true,
      upvoteCount: true,
      viewCount: true,
      createdAt: true,
    },
  });
  const tagMap = await discussionTagMap();
  return rows.map((r) => ({ ...r, tags: tagViewsFrom(r.categories, tagMap) }));
}

export interface ProfileComment {
  id: string;
  kind: 'post_comment' | 'topic_reply' | 'doc_comment';
  excerpt: string;
  contextTitle: string;
  href: string;
  createdAt: Date;
}

/** Recent comments across 动态评论 / 论坛回复 / 知识库评论, merged newest-first. */
export async function getProfileComments(userId: string, take = 8): Promise<ProfileComment[]> {
  const [postComments, topicReplies, docComments] = await Promise.all([
    prisma.postComment.findMany({
      where: { authorId: userId, status: 'visible' },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        bodyMd: true,
        createdAt: true,
        post: { select: { id: true, bodyMd: true } },
      },
    }),
    prisma.discussionReply.findMany({
      where: { authorId: userId, status: 'visible' },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        bodyMd: true,
        createdAt: true,
        topic: { select: { id: true, title: true } },
      },
    }),
    prisma.libraryComment.findMany({
      where: { authorId: userId, status: 'visible', doc: PUBLIC_READY_DOC },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        bodyMd: true,
        createdAt: true,
        doc: { select: { slug: true, title: true } },
      },
    }),
  ]);

  const merged: ProfileComment[] = [
    ...postComments.map((c) => ({
      id: c.id,
      kind: 'post_comment' as const,
      excerpt: excerptOf(c.bodyMd, 120),
      contextTitle: excerptOf(c.post.bodyMd, 40),
      href: `/discussion/posts/${c.post.id}?focus=${c.id}`,
      createdAt: c.createdAt,
    })),
    ...topicReplies.map((c) => ({
      id: c.id,
      kind: 'topic_reply' as const,
      excerpt: excerptOf(c.bodyMd, 120),
      contextTitle: c.topic.title,
      href: `/discussion/topics/${c.topic.id}?focus=${c.id}`,
      createdAt: c.createdAt,
    })),
    ...docComments.map((c) => ({
      id: c.id,
      kind: 'doc_comment' as const,
      excerpt: excerptOf(c.bodyMd, 120),
      contextTitle: c.doc.title,
      href: `/library/${c.doc.slug}?focus=${c.id}`,
      createdAt: c.createdAt,
    })),
  ];
  return merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take);
}

/** Shelved docs — public+ready only (a shelved restricted/private doc must not leak). */
export async function getProfileShelf(userId: string) {
  const items = await prisma.libraryShelfItem.findMany({
    where: { userId, doc: PUBLIC_READY_DOC },
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: {
      doc: {
        select: { id: true, slug: true, title: true, author: true, docType: true, coverUrl: true },
      },
    },
  });
  return items.map((i) => i.doc);
}

export async function getProfileEvents(userId: string) {
  return prisma.event.findMany({
    where: { authorId: userId, deletedAt: null },
    orderBy: { startAt: 'desc' },
    take: 5,
    select: {
      id: true,
      title: true,
      kind: true,
      mode: true,
      city: true,
      startAt: true,
      allDay: true,
      timezone: true,
      cancelledAt: true,
    },
  });
}
