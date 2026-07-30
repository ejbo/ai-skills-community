import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  Lock,
  MessageSquare,
  MessageSquarePlus,
  Pin,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { relativeTime } from '@/lib/i18n-date';
import { auth } from '@/lib/auth';
import {
  countTopicsByCategory,
  isDiscussionCategory,
  listPosts,
  listTopics,
  type TopicSort,
} from '@/lib/discussion-queries';
import { EmptyState } from '@/components/EmptyState';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { toPublicAuthor } from '@/lib/user-identity';
import { SearchBar } from '@/components/SearchBar';
import { DiscussionTabs } from './_components/DiscussionTabs';
import { PostFeed } from './_components/PostFeed';
import { TopicUpvoteButton } from './_components/TopicUpvoteButton';
import { CATEGORY_META, CategoryChip, VISIBLE_CATEGORIES } from './_components/badges';
import type { CurrentUser } from './_components/types';

export const dynamic = 'force-dynamic';

// Next 14 delivers repeated query keys as string[] — every read below must go
// through firstParam() before string methods.
interface SearchParams {
  tab?: string | string[];
  category?: string | string[];
  sort?: string | string[];
  page?: string | string[];
  q?: string | string[];
}

function forumHref(sp: SearchParams, patch: Partial<SearchParams>) {
  const next = new URLSearchParams();
  const merged = { ...sp, ...patch, tab: 'forum' };
  for (const [k, raw] of Object.entries(merged)) {
    // Next 14 可能把重复的 query key 交成 string[]（?q=a&q=b）——取第一个。
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (v == null || v === '') continue;
    // 'all' 只是分类 chip 的哨兵值 — 对其它 key（比如用户搜索词 q="all"）要保留。
    if (k === 'category' && v === 'all') continue;
    if (k === 'page' && v === '1') continue;
    next.set(k, String(v));
  }
  return `/discussion?${next.toString()}`;
}

// Next 14 交给 page 的 searchParams 运行时可能是 string[]（?q=a&q=b）——取第一个。
function firstParam(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? '').trim();
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
  const tab = firstParam(searchParams.tab) === 'forum' ? 'forum' : 'posts';
  const q = firstParam(searchParams.q);
  const t = await getTranslations('discussion_pages');

  return (
    <div className="container max-w-5xl py-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        {tab === 'forum' && (
          <Link
            href="/discussion/topics/new"
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600"
          >
            <MessageSquarePlus className="h-4 w-4" />
            {t('start_topic')}
          </Link>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <DiscussionTabs />
        <div className="w-full sm:w-72">
          <SearchBar />
        </div>
      </div>

      <div className="mt-6">
        {tab === 'posts' ? (
          <PostsTab
            q={q}
            sort={firstParam(searchParams.sort) === 'hot' ? 'hot' : 'new'}
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
  q,
  sort,
  currentUser,
  viewerId,
  viewerIsAdmin,
}: {
  q: string;
  sort: 'new' | 'hot';
  currentUser: CurrentUser | null;
  viewerId: string | null;
  viewerIsAdmin: boolean;
}) {
  const t = await getTranslations('discussion_pages');
  const tp = await getTranslations('profile');
  // 搜索模式：一次取前 20 条命中，不再游标翻页（PostFeed 的 load-more 请求不带 q）。
  const [{ items, hasMore, nextCursor }, hotTopics] = await Promise.all([
    q ? listPosts({ limit: 20, viewerId, q }) : listPosts({ limit: 10, viewerId, sort }),
    // Right-rail 热门讨论 (xl only) — LinkedIn-style context beside the feed.
    q
      ? Promise.resolve(null)
      : listTopics({ sort: 'top', pageSize: 5, viewerId: null }).then((r) => r.items),
  ]);

  return (
    // Two columns (the left profile rail was dropped on purpose — 帖子内容优先).
    // Explicit rows: the 最新/热门 row lives in row 1 of the LEFT column only,
    // so the 热门讨论 rail (row 2) top-aligns with the composer card, not with
    // the sort links.
    <div className="grid grid-cols-1 gap-x-6 gap-y-3 xl:grid-cols-[minmax(0,1fr)_300px] xl:grid-rows-[auto_minmax(0,1fr)]">
      <div className="mx-auto w-full max-w-3xl xl:col-start-1 xl:row-start-1">
        {q ? (
          <p className="text-xs text-muted">
            {hasMore
              ? t('posts_search_capped', { q })
              : t('posts_search_matches', { q, count: items.length })}
          </p>
        ) : (
          <div className="flex items-center gap-3 text-xs">
            {(
              [
                { key: 'new', label: t('sort_new') },
                { key: 'hot', label: t('sort_hot') },
              ] as const
            ).map((s) => {
              const active = sort === s.key;
              return (
                <Link
                  key={s.key}
                  href={s.key === 'new' ? '/discussion' : '/discussion?sort=hot'}
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
        )}
      </div>

      <div className="xl:col-start-1 xl:row-start-2">
        <PostFeed
          // Keyed per stream — a soft nav (sort toggle / search) must remount
          // the feed, not keep the previous stream's state and cursor.
          key={q ? `q:${q}` : `sort:${sort}`}
          initialPosts={items.map((p) => ({ ...p, author: toPublicAuthor(p.author, viewerIsAdmin) }))}
          initialHasMore={q ? false : hasMore}
          initialCursor={q ? null : nextCursor}
          currentUser={currentUser}
          sort={sort}
          showComposer={!q}
          emptyTitle={q ? t('empty_search_posts', { q }) : undefined}
          emptyDescription={q ? t('try_other_keywords') : undefined}
        />
      </div>

      <aside className="hidden xl:col-start-2 xl:row-start-2 xl:block">
        {hotTopics && hotTopics.length > 0 && (
          <div className="surface sticky top-20 rounded-2xl p-4">
            <h3 className="text-sm font-semibold">{t('hot_topics_title')}</h3>
            <ul className="mt-3 space-y-3">
              {hotTopics.map((topic) => (
                <li key={topic.id}>
                  <Link href={`/discussion/topics/${topic.id}`} className="group block">
                    <span className="line-clamp-2 text-sm text-zinc-700 transition group-hover:text-accent-600 dark:text-zinc-200 dark:group-hover:text-accent-300">
                      {topic.title}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                      <CategoryChip category={topic.categories[0]} />
                      <span>{tp('n_replies', { count: topic.replyCount })}</span>
                      <span>{t('views_compact', { count: formatViews(topic.viewCount) })}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href="/discussion?tab=forum&sort=top"
              className="mt-3 inline-block text-xs font-medium text-accent-600 hover:underline dark:text-accent-300"
            >
              {t('view_all_arrow')}
            </Link>
          </div>
        )}
      </aside>
    </div>
  );
}

/** 2.4k-style compact number for 浏览量 columns. */
function formatViews(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
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
  const t = await getTranslations('discussion_pages');
  const tp = await getTranslations('profile');
  const tl = await getTranslations('labels');
  const tb = await getTranslations('browse');
  const tn = await getTranslations('nav');
  const locale = await getLocale();
  const categoryRaw = firstParam(searchParams.category);
  const category = isDiscussionCategory(categoryRaw) ? categoryRaw : undefined;
  const sortRaw = firstParam(searchParams.sort);
  const sort: TopicSort = sortRaw === 'top' ? 'top' : sortRaw === 'new' ? 'new' : 'latest';
  const q = firstParam(searchParams.q);

  const [{ items, page, pageSize, total, hasMore }, catStats] = await Promise.all([
    listTopics({
      category,
      sort,
      page: Number(firstParam(searchParams.page) || 1),
      viewerId,
      q: q || undefined,
    }),
    countTopicsByCategory(),
  ]);

  // Discourse-style sidebar set: the AI-focused categories, plus the legacy
  // 综合讨论 row only while old topics still live there.
  const categoryCounts = catStats.counts;
  const sidebarCategories = [
    ...VISIBLE_CATEGORIES,
    ...((categoryCounts.general ?? 0) > 0 ? (['general'] as const) : []),
  ];
  // Distinct topics — summing per-category membership would double-count
  // multi-主题 topics.
  const allCount = catStats.total;

  const chips = [
    { key: 'all', label: tb('all') },
    ...sidebarCategories.map((key) => ({ key, label: tl(`discussionCategory.${key}`) })),
  ];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      {/* Category sidebar (Discourse-style) */}
      <aside className="hidden lg:block">
        <nav className="sticky top-20 space-y-0.5">
          <Link
            // 分类点击重置搜索词 — 侧栏计数是全局的，带着 q 会货不对板。
            href={forumHref(searchParams, { category: 'all', page: '1', q: '' })}
            className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm transition ${
              !category
                ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-white'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            <span>{t('all_topics')}</span>
            <span className="text-xs text-muted tabular-nums">{allCount}</span>
          </Link>
          <div className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-muted">
            {tn('categories')}
          </div>
          {sidebarCategories.map((key) => {
            const meta = CATEGORY_META[key];
            const active = category === key;
            return (
              <Link
                key={key}
                href={forumHref(searchParams, { category: key, page: '1', q: '' })}
                className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm transition ${
                  active
                    ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-white'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-sm ${meta.dot}`} />
                  {tl(`discussionCategory.${key}`)}
                </span>
                <span className="text-xs text-muted tabular-nums">
                  {categoryCounts[key] ?? 0}
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div>
        {/* Mobile fallback: category chips */}
        <div className="flex flex-wrap items-center gap-2 lg:hidden">
          {chips.map((chip) => {
            const active = chip.key === (category ?? 'all');
            return (
              <Link
                key={chip.key}
                href={forumHref(searchParams, { category: chip.key, page: '1', q: '' })}
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

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 lg:mt-0">
          <span className="text-xs text-muted">
            {q
              ? t('topics_search_matches', { q, count: total })
              : t('topics_total', { count: total })}
          </span>
          <div className="flex items-center gap-3 text-xs">
            {(
              [
                { key: 'latest', label: t('sort_latest_reply') },
                { key: 'top', label: t('sort_top') },
                { key: 'new', label: t('sort_new_created') },
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

        <div className="mt-3">
          {items.length === 0 ? (
            <EmptyState
              title={
                q
                  ? t('empty_search_topics', { q })
                  : category
                    ? t('empty_category_topics', { category: tl(`discussionCategory.${category}`) })
                    : t('empty_topics')
              }
              description={q ? t('try_other_keywords') : t('start_first_topic')}
              actionLabel={t('start_topic')}
              actionHref="/discussion/topics/new"
            />
          ) : (
            <ul className="surface divide-y divide-zinc-100 overflow-hidden rounded-2xl dark:divide-zinc-800/60">
              {items.map((topic) => {
                const author = toPublicAuthor(topic.author, viewerIsAdmin);
                const participants = topic.participants.map((p) =>
                  toPublicAuthor(p, viewerIsAdmin),
                );
                return (
                  // The vote button is a SIBLING of the row link (not nested inside
                  // it) — interactive-in-interactive markup breaks a11y/aux-click.
                  <li
                    key={topic.id}
                    className="flex items-start gap-4 px-4 py-4 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                  >
                    <TopicUpvoteButton
                      topicId={topic.id}
                      initialCount={topic.upvoteCount}
                      initialUpvoted={topic.upvotedByMe}
                    />
                    <Link
                      href={`/discussion/topics/${topic.id}`}
                      className="flex min-w-0 flex-1 items-start gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {topic.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-accent-500" />}
                          {topic.locked && <Lock className="h-3.5 w-3.5 shrink-0 text-muted" />}
                          <span className="truncate text-sm font-medium">{topic.title}</span>
                          {topic.categories.map((c) => (
                            <CategoryChip key={c} category={c} />
                          ))}
                        </div>
                        {topic.excerpt && (
                          <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted">
                            {topic.excerpt}
                          </p>
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
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
                            {t('active_ago', { time: relativeTime(topic.lastActivityAt, locale) })}
                          </span>
                          <span className="flex items-center gap-2 sm:hidden">
                            <span>· {tp('n_replies', { count: topic.replyCount })}</span>
                            <span>{t('views_compact', { count: formatViews(topic.viewCount) })}</span>
                          </span>
                        </div>
                      </div>

                      {/* Discourse-style numeric columns (participants / 回复 / 浏览) */}
                      <span className="hidden shrink-0 items-center gap-4 self-center sm:flex">
                        {participants.length > 0 && (
                          <span className="flex items-center -space-x-2">
                            {participants.map((p) => (
                              <Avatar
                                key={p.handle}
                                name={p.displayName}
                                src={p.avatarUrl}
                                size="xs"
                                tone="subtle"
                                className="ring-2 ring-white dark:ring-zinc-900"
                              />
                            ))}
                          </span>
                        )}
                        <span className="w-12 text-center">
                          <span className="block text-sm font-medium tabular-nums">
                            {topic.replyCount}
                          </span>
                          <span className="block text-[10px] text-muted">{t('replies_col')}</span>
                        </span>
                        <span className="w-12 text-center">
                          <span className="block text-sm font-medium tabular-nums">
                            {formatViews(topic.viewCount)}
                          </span>
                          <span className="block text-[10px] text-muted">{t('views_col')}</span>
                        </span>
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
                  {tb('prev_page')}
                </Link>
              ) : (
                <span className="inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-200 px-3 font-medium text-muted opacity-40 dark:border-zinc-800">
                  <ChevronLeft className="h-4 w-4" />
                  {tb('prev_page')}
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
                  {tb('next_page')}
                  <ChevronRight className="h-4 w-4" />
                </Link>
              ) : (
                <span className="inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-200 px-3 font-medium text-muted opacity-40 dark:border-zinc-800">
                  {tb('next_page')}
                  <ChevronRight className="h-4 w-4" />
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
