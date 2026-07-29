import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { auth } from '@/lib/auth';
import { browseDocs, getFeaturedDocs } from '@/lib/library-queries';
import { SearchBar } from '@/components/SearchBar';
import { EmptyState } from '@/components/EmptyState';
import { DocCard } from '@/components/library/DocCard';
import { TypeTabs } from '@/components/library/TypeTabs';
import { LibrarySort } from '@/components/library/LibrarySort';
import { AddDocButton } from '@/components/library/AddDocButton';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  type?: string;
  sort?: string;
  page?: string;
}

export default async function LibraryPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth();
  const isDefaultView =
    !searchParams.q && !searchParams.type && !searchParams.sort && !searchParams.page;

  const [{ items, total, page, pageSize, hasMore }, featured] = await Promise.all([
    browseDocs({
      q: searchParams.q,
      type: searchParams.type,
      sort: searchParams.sort,
      page: Number(searchParams.page ?? 1),
    }),
    isDefaultView ? getFeaturedDocs() : Promise.resolve([]),
  ]);
  const showFeatured = isDefaultView && featured.length > 0;

  return (
    <div className="container py-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">知识库</h1>
            <p className="mt-1 text-sm text-muted">
              提交网页文章、PDF 或 EPUB，AI 精读一次，全员共享导读与问答
            </p>
          </div>
          <AddDocButton loggedIn={Boolean(session?.user)} />
        </div>
        <SearchBar />
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800">
          <TypeTabs />
          <div className="flex items-center gap-3 pb-2">
            <span className="text-xs text-muted">共 {total.toLocaleString()} 篇内容</span>
            <LibrarySort />
          </div>
        </div>
      </div>

      {showFeatured && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold tracking-tight">精选推荐</h2>
          <div className="mt-3 flex gap-4 overflow-x-auto pb-2">
            {featured.map((doc) => (
              <div key={doc.id} className="w-[320px] shrink-0">
                <DocCard {...doc} />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-6">
        {showFeatured && <h2 className="mb-3 text-lg font-semibold tracking-tight">全部文档</h2>}
        {items.length === 0 ? (
          <EmptyState
            title="还没有找到内容"
            description="换个筛选条件，或者提交一个网页链接 / 上传 PDF、EPUB"
            actionLabel={searchParams.q || searchParams.type ? '查看全部' : undefined}
            actionHref={searchParams.q || searchParams.type ? '/library' : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((doc) => (
              <DocCard key={doc.id} {...doc} />
            ))}
          </div>
        )}

        {(page > 1 || hasMore) && (
          <Pagination
            searchParams={searchParams}
            current={page}
            pageSize={pageSize}
            total={total}
            hasMore={hasMore}
          />
        )}
      </div>
    </div>
  );
}

function pageHref(searchParams: SearchParams, page: number) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (k === 'page' || v == null || v === '') continue;
    sp.set(k, String(v));
  }
  if (page > 1) sp.set('page', String(page));
  const qs = sp.toString();
  return qs ? `/library?${qs}` : '/library';
}

function Pagination({
  searchParams,
  current,
  pageSize,
  total,
  hasMore,
}: {
  searchParams: SearchParams;
  current: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const btn =
    'inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition hover:border-accent-500 hover:text-accent-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-accent-400 dark:hover:text-accent-300';
  const disabled =
    'inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-muted opacity-40 dark:border-zinc-800';

  return (
    <div className="mt-8 flex items-center justify-center gap-3 text-sm">
      {current > 1 ? (
        <Link href={pageHref(searchParams, current - 1)} rel="prev" className={btn}>
          <ChevronLeft className="h-4 w-4" />
          上一页
        </Link>
      ) : (
        <span aria-disabled className={disabled}>
          <ChevronLeft className="h-4 w-4" />
          上一页
        </span>
      )}

      <span className="text-muted tabular-nums">
        {current} / {totalPages}
      </span>

      {hasMore ? (
        <Link href={pageHref(searchParams, current + 1)} rel="next" className={btn}>
          下一页
          <ChevronRight className="h-4 w-4" />
        </Link>
      ) : (
        <span aria-disabled className={disabled}>
          下一页
          <ChevronRight className="h-4 w-4" />
        </span>
      )}
    </div>
  );
}
