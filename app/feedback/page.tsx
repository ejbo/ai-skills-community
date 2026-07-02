import Link from 'next/link';
import { ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { auth } from '@/lib/auth';
import { listFeedback, isFeedbackStatus, type FeedbackSort } from '@/lib/feedback-queries';
import { EmptyState } from '@/components/EmptyState';
import { FeedbackComposer } from './_components/FeedbackComposer';
import { UpvoteButton } from './_components/UpvoteButton';
import { StatusBadge, CategoryChip, STATUS_META } from './_components/badges';

export const dynamic = 'force-dynamic';

interface SearchParams {
  status?: string;
  sort?: string;
  page?: string;
}

function pageHref(sp: SearchParams, patch: Partial<SearchParams>) {
  const next = new URLSearchParams();
  const merged = { ...sp, ...patch };
  for (const [k, v] of Object.entries(merged)) {
    if (v == null || v === '' || v === 'all') continue;
    if (k === 'page' && v === '1') continue;
    next.set(k, String(v));
  }
  const qs = next.toString();
  return qs ? `/feedback?${qs}` : '/feedback';
}

export default async function FeedbackPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth();
  const status = isFeedbackStatus(searchParams.status) ? searchParams.status : undefined;
  const sort: FeedbackSort = searchParams.sort === 'top' ? 'top' : 'newest';

  const { items, page, pageSize, total, hasMore } = await listFeedback({
    status,
    sort,
    page: Number(searchParams.page ?? 1),
    viewerId: session?.user?.id ?? null,
  });

  const statusChips = [
    { key: 'all', label: '全部' },
    ...Object.entries(STATUS_META).map(([key, meta]) => ({ key, label: meta.label })),
  ];

  return (
    <div className="container max-w-4xl py-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">意见反馈</h1>
        <FeedbackComposer loggedIn={Boolean(session?.user)} />
      </div>

      {/* Same underline-tab pattern as the skills page (SourceTabs) — no filled pills. */}
      <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex overflow-x-auto">
          {statusChips.map((chip) => {
            const active = chip.key === (status ?? 'all');
            return (
              <Link
                key={chip.key}
                href={pageHref(searchParams, { status: chip.key, page: '1' })}
                className={`relative shrink-0 whitespace-nowrap px-3 py-2 text-sm font-medium transition ${
                  active
                    ? 'text-zinc-900 dark:text-white'
                    : 'text-muted hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
              >
                {chip.label}
                {active && (
                  <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent-500" />
                )}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-3 pb-2 text-xs">
          {(
            [
              { key: 'newest', label: '最新' },
              { key: 'top', label: '最热' },
            ] as const
          ).map((s) => {
            const active = sort === s.key;
            return (
              <Link
                key={s.key}
                href={pageHref(searchParams, { sort: s.key === 'newest' ? '' : s.key, page: '1' })}
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
            title={status ? `暂无「${STATUS_META[status].label}」的反馈` : '暂无反馈'}
            actionLabel={status ? '查看全部' : undefined}
            actionHref={status ? '/feedback' : undefined}
          />
        ) : (
          <ul className="surface divide-y divide-zinc-100 overflow-hidden rounded-2xl dark:divide-zinc-800/60">
            {items.map((f) => (
              // The vote button is a SIBLING of the row link (not nested inside
              // it) — interactive-in-interactive markup breaks a11y/aux-click.
              <li
                key={f.id}
                className="flex items-center gap-4 px-4 py-3.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
              >
                <UpvoteButton
                  feedbackId={f.id}
                  initialCount={f.upvoteCount}
                  initialUpvoted={f.upvotedByMe}
                />
                <Link href={`/feedback/${f.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{f.title}</span>
                      <CategoryChip category={f.category} />
                      <StatusBadge status={f.status} />
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                      <span className="truncate">{f.author.displayName}</span>
                      <span>·</span>
                      <span>{formatDistanceToNowStrict(f.createdAt, { addSuffix: true })}</span>
                    </div>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                    <MessageSquare className="h-3.5 w-3.5" />
                    {f.commentCount}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {(page > 1 || hasMore) && (
          <div className="mt-6 flex items-center justify-center gap-3 text-sm">
            {page > 1 ? (
              <Link
                href={pageHref(searchParams, { page: String(page - 1) })}
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
                href={pageHref(searchParams, { page: String(page + 1) })}
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
