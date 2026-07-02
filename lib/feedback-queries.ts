import { Prisma, FeedbackStatus } from '@prisma/client';
import { prisma } from '@/lib/db';

export const FEEDBACK_STATUSES = ['open', 'planned', 'in_progress', 'done', 'declined'] as const;

export function isFeedbackStatus(v: unknown): v is FeedbackStatus {
  return typeof v === 'string' && (FEEDBACK_STATUSES as readonly string[]).includes(v);
}

export type FeedbackSort = 'newest' | 'top';

const AUTHOR_SELECT = { select: { handle: true, displayName: true, avatarUrl: true } };

export interface ListFeedbackFilters {
  status?: FeedbackStatus;
  sort?: FeedbackSort;
  page?: number;
  pageSize?: number;
  /** When set, each row gets `upvotedByMe` for this user. */
  viewerId?: string | null;
}

export async function listFeedback(filters: ListFeedbackFilters) {
  const rawPage = Number(filters.page ?? 1);
  const requested = Number.isFinite(rawPage) ? Math.max(1, Math.trunc(rawPage)) : 1;
  const rawSize = Number(filters.pageSize ?? 20);
  const pageSize = Number.isFinite(rawSize) ? Math.min(50, Math.max(1, Math.trunc(rawSize))) : 20;

  const where: Prisma.FeedbackWhereInput = {};
  if (filters.status) where.status = filters.status;

  const orderBy: Prisma.FeedbackOrderByWithRelationInput[] =
    filters.sort === 'top'
      ? [{ upvoteCount: 'desc' }, { createdAt: 'desc' }]
      : [{ createdAt: 'desc' }];

  const total = await prisma.feedback.count({ where });
  const page = Math.min(requested, Math.max(1, Math.ceil(total / pageSize)));

  const rows = await prisma.feedback.findMany({
    where,
    orderBy,
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      title: true,
      category: true,
      status: true,
      upvoteCount: true,
      commentCount: true,
      createdAt: true,
      author: AUTHOR_SELECT,
    },
  });

  const upvoted = await viewerUpvoteSet(
    filters.viewerId,
    rows.map((r) => r.id),
  );
  const items = rows.map((r) => ({ ...r, upvotedByMe: upvoted.has(r.id) }));

  return { items, page, pageSize, total, hasMore: page * pageSize < total };
}

async function viewerUpvoteSet(viewerId: string | null | undefined, feedbackIds: string[]) {
  if (!viewerId || feedbackIds.length === 0) return new Set<string>();
  const rows = await prisma.feedbackUpvote.findMany({
    where: { userId: viewerId, feedbackId: { in: feedbackIds } },
    select: { feedbackId: true },
  });
  return new Set(rows.map((r) => r.feedbackId));
}

/**
 * Full detail: the post plus ALL comments as 2-level threads. Feedback volume
 * is low, so there is deliberately no pagination — one query, one render, and
 * `?focus=` highlighting is a simple scrollIntoView.
 */
export async function getFeedbackDetail(id: string, viewerId?: string | null) {
  const feedback = await prisma.feedback.findUnique({
    where: { id },
    include: {
      author: AUTHOR_SELECT,
      comments: {
        where: { parentId: null },
        orderBy: { createdAt: 'asc' },
        // Hard render caps — a stuffed thread must not unbound the RSC render.
        take: 300,
        select: {
          id: true,
          bodyMd: true,
          status: true,
          replyCount: true,
          createdAt: true,
          author: AUTHOR_SELECT,
          replies: {
            orderBy: { createdAt: 'asc' },
            take: 100,
            select: {
              id: true,
              bodyMd: true,
              status: true,
              replyCount: true,
              createdAt: true,
              author: AUTHOR_SELECT,
            },
          },
        },
      },
    },
  });
  if (!feedback) return null;

  const upvoted = await viewerUpvoteSet(viewerId, [feedback.id]);
  return { ...feedback, upvotedByMe: upvoted.has(feedback.id) };
}
