import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  Lock,
  MessageSquare,
  MessageSquarePlus,
  Pin,
} from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { auth } from '@/lib/auth';
import {
  isDiscussionCategory,
  listPosts,
  listTopics,
  type TopicSort,
} from '@/lib/discussion-queries';
import { EmptyState } from '@/components/EmptyState';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { toPublicAuthor } from '@/lib/user-identity';
import { DiscussionTabs } from './_components/DiscussionTabs';
import { PostFeed } from './_components/PostFeed';
import { TopicUpvoteButton } from './_components/TopicUpvoteButton';
import { CATEGORY_META, CategoryChip } from './_components/badges';
import type { CurrentUser } from './_components/types';

export const dynamic = 'force-dynamic';

interface SearchParams {
  tab?: string;
  category?: string;
  sort?: string;
  page?: string;
}

function forumHref(sp: SearchParams, patch: Partial<SearchParams>) {
  const next = new URLSearchParams();
  const merged = { ...sp, ...patch, tab: 'forum' };
  for (const [k, v] of Object.entries(merged)) {
    if (v == null || v === '' || v === 'all') continue;
    if (k === 'page' && v === '1') continue;
    next.set(k, String(v));
  }
  return `/discussion?${next.toString()}`;
}

export default async function DiscussionPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth();
  const currentUser: CurrentUser | null = session?.user
    ? {
        handle: session.user.handle,
        displayName: session.user.displayName,
        avatarUrl: session.user.avatarUrl,
        isAdmin: session.user.isAdmin,
      }
    : null;
  const tab = searchParams.tab === 'forum' ? 'forum' : 'posts';

  return (
    <div className="container max-w-5xl py-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">社区讨论</h1>
        {tab === 'forum' && (
          <Link
            href="/discussion/topics/new"
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600"
          >
            <MessageSquarePlus className="h-4 w-4" />
            发起讨论
          </Link>
        )}
      </div>

      <div className="mt-5">
        <DiscussionTabs />
      </div>

      <div className="mt-6">
        {tab === 'posts' ? (
          <PostsTab
            currentUser={currentUser}
            viewerId={session?.user?.id ?? null}
            viewerIsAdmin={Boolean(session?.user?.isAdmin)}
          />
        ) : (
          <ForumTab
            searchParams={searchParams}
            viewerId={session?.user?.id ?? null}
            viewerIsAdmin={Boolean(session?.user?.isAdmin)}
          />
        )}
      </div>
    </div>
  );
}

async function PostsTab({
  currentUser,
  viewerId,
  viewerIsAdmin,
}: {
  currentUser: CurrentUser | null;
  viewerId: string | null;
  viewerIsAdmin: boolean;
}) {
  const { items, hasMore, nextCursor } = await listPosts({ limit: 10, viewerId });

  return (
    <PostFeed
      initialPosts={items.map((p) => ({ ...p, author: toPublicAuthor(p.author, viewerIsAdmin) }))}
      initialHasMore={hasMore}
      initialCursor={nextCursor}
      currentUser={currentUser}
    />
  );
}

async function ForumTab({
  searchParams,
  viewerId,
  viewerIsAdmin,
}: {
  searchParams: SearchParams;
  viewerId: string | null;
  viewerIsAdmin: boolean;
}) {
  const category = isDiscussionCategory(searchParams.category) ? searchParams.category : undefined;
  const sort: TopicSort =
    searchParams.sort === 'top' ? 'top' : searchParams.sort === 'new' ? 'new' : 'latest';

  const { items, page, pageSize, total, hasMore } = await listTopics({
    category,
    sort,
    page: Number(searchParams.page ?? 1),
    viewerId,
  });

  const categoryChips = [
    { key: 'all', label: '全部' },
    ...Object.entries(CATEGORY_META).map(([key, meta]) => ({ key, label: meta.label })),
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {categoryChips.map((chip) => {
            const active = chip.key === (category ?? 'all');
            return (
              <Link
                key={chip.key}
                href={forumHref(searchParams, { category: chip.key, page: '1' })}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  active
                    ? 'border-accent-500 bg-accent-500/10 font-medium text-accent-600 dark:text-accent-300'
                    : 'border-zinc-200 text-zinc-600 hover:border-accent-400 dark:border-zinc-800 dark:text-zinc-300'
                }`}
              >
                {chip.label}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-3 text-xs">
          {(
            [
              { key: 'latest', label: '最新回复' },
              { key: 'top', label: '最热' },
              { key: 'new', label: '最新发布' },
            ] as const
          ).map((s) => {
            const active = sort === s.key;
            return (
              <Link
                key={s.key}
                href={forumHref(searchParams, { sort: s.key === 'latest' ? '' : s.key, page: '1' })}
                className={
                  active
                    ? 'font-medium text-zinc-900 dark:text-white'
                    : 'text-muted transition hover:text-zinc-700 dark:hover:text-zinc-200'
                }
              >
                {s.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        {items.length === 0 ? (
          <EmptyState
            title={category ? `暂无「${CATEGORY_META[category].label}」的讨论` : '还没有讨论帖'}
            description="发起第一个讨论吧"
            actionLabel="发起讨论"
            actionHref="/discussion/topics/new"
          />
        ) : (
          <ul className="surface divide-y divide-zinc-100 overflow-hidden rounded-2xl dark:divide-zinc-800/60">
            {items.map((t) => {
              const author = toPublicAuthor(t.author, viewerIsAdmin);
              return (
                // The vote button is a SIBLING of the row link (not nested inside
                // it) — interactive-in-interactive markup breaks a11y/aux-click.
                <li
                  key={t.id}
                  className="flex items-center gap-4 px-4 py-3.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                >
                  <TopicUpvoteButton
                    topicId={t.id}
                    initialCount={t.upvoteCount}
                    initialUpvoted={t.upvotedByMe}
                  />
                  <Link
                    href={`/discussion/topics/${t.id}`}
                    className="flex min-w-0 flex-1 items-center gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {t.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-accent-500" />}
                        {t.locked && <Lock className="h-3.5 w-3.5 shrink-0 text-muted" />}
                        <span className="truncate text-sm font-medium">{t.title}</span>
                        <CategoryChip category={t.category} />
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                        <Avatar
                          name={author.displayName}
                          src={author.avatarUrl}
                          size="xs"
                          tone="subtle"
                        />
                        <span className="truncate">{author.displayName}</span>
                        <DeptTag department={author.department} lab={author.lab} />
                        <span>·</span>
                        <span>
                          {formatDistanceToNowStrict(t.lastActivityAt, { addSuffix: true })}活跃
                        </span>
                      </div>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                      <MessageSquare className="h-3.5 w-3.5" />
                      {t.replyCount}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {(page > 1 || hasMore) && (
          <div className="mt-6 flex items-center justify-center gap-3 text-sm">
            {page > 1 ? (
              <Link
                href={forumHref(searchParams, { page: String(page - 1) })}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 font-medium text-zinc-700 transition hover:border-accent-500 hover:text-accent-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
              >
                <ChevronLeft className="h-4 w-4" />
                上一页
              </Link>
            ) : (
              <span className="inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-200 px-3 font-medium text-muted opacity-40 dark:border-zinc-800">
                <ChevronLeft className="h-4 w-4" />
                上一页
              </span>
            )}
            <span className="text-muted tabular-nums">
              {page} / {Math.max(1, Math.ceil(total / pageSize))}
            </span>
            {hasMore ? (
              <Link
                href={forumHref(searchParams, { page: String(page + 1) })}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 font-medium text-zinc-700 transition hover:border-accent-500 hover:text-accent-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
              >
                下一页
                <ChevronRight className="h-4 w-4" />
              </Link>
            ) : (
              <span className="inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-200 px-3 font-medium text-muted opacity-40 dark:border-zinc-800">
                下一页
                <ChevronRight className="h-4 w-4" />
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
