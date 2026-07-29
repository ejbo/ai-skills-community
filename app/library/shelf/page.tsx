import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BookOpen, CheckCircle2, LibraryBig } from 'lucide-react';
import { auth } from '@/lib/auth';
import { getShelfDocs, getShelfStats } from '@/lib/library-queries';
import { DOC_TYPES, DOC_TYPE_LABELS, isDocType } from '@/lib/library/types';
import { EmptyState } from '@/components/EmptyState';
import { ShelfGrid } from '@/components/library/ShelfGrid';

export const dynamic = 'force-dynamic';

interface SearchParams {
  type?: string;
  sort?: string;
}

function shelfHref(current: SearchParams, patch: Partial<SearchParams>) {
  const merged = { ...current, ...patch };
  const sp = new URLSearchParams();
  if (merged.type && merged.type !== 'all') sp.set('type', merged.type);
  if (merged.sort === 'added') sp.set('sort', 'added');
  const qs = sp.toString();
  return qs ? `/library/shelf?${qs}` : '/library/shelf';
}

export default async function ShelfPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth();
  if (!session?.user) redirect('/auth/login?callbackUrl=/library/shelf');

  const sort: 'recent' | 'added' = searchParams.sort === 'added' ? 'added' : 'recent';
  const activeType = isDocType(searchParams.type) ? searchParams.type : 'all';

  const [stats, docs] = await Promise.all([
    getShelfStats(session.user.id),
    getShelfDocs(session.user.id, { type: searchParams.type, sort }),
  ]);

  const serialized = docs.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }));

  const typeChips = [
    { key: 'all', label: '全部' },
    ...DOC_TYPES.map((t) => ({ key: t as string, label: DOC_TYPE_LABELS[t] })),
  ];

  return (
    <div className="container py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">我的书架</h1>
          <p className="mt-1 text-sm text-muted">收藏的内容与阅读进度</p>
        </div>
        <Link
          href="/library"
          className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-4 text-sm font-medium transition hover:border-accent-500 hover:text-accent-600 dark:border-zinc-700"
        >
          去知识库
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatBox icon={<LibraryBig className="h-4 w-4" />} label="全部" value={stats.total} />
        <StatBox icon={<BookOpen className="h-4 w-4" />} label="在读" value={stats.reading} />
        <StatBox icon={<CheckCircle2 className="h-4 w-4" />} label="已读完" value={stats.finished} />
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {typeChips.map((chip) => {
            const active = chip.key === activeType;
            return (
              <Link
                key={chip.key}
                href={shelfHref(searchParams, { type: chip.key })}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  active
                    ? 'border-accent-500 bg-accent-500/10 font-medium text-accent-600 dark:text-accent-300'
                    : 'border-zinc-200 text-muted hover:border-accent-400 hover:text-accent-600 dark:border-zinc-700'
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
              { key: 'recent', label: '最近阅读' },
              { key: 'added', label: '最近加入' },
            ] as const
          ).map((s) => {
            const active = sort === s.key;
            return (
              <Link
                key={s.key}
                href={shelfHref(searchParams, { sort: s.key === 'recent' ? '' : s.key })}
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
        {docs.length === 0 ? (
          <EmptyState
            title={activeType === 'all' ? '书架还是空的' : `书架上还没有${DOC_TYPE_LABELS[activeType as keyof typeof DOC_TYPE_LABELS]}`}
            description="把感兴趣的内容加入书架，随时继续阅读"
            actionLabel="去知识库看看"
            actionHref="/library"
          />
        ) : (
          <ShelfGrid docs={serialized} />
        )}
      </div>
    </div>
  );
}

function StatBox({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="surface rounded-xl p-4">
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 font-mono text-3xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
