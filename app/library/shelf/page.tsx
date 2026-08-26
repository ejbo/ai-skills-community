import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BookOpen, CheckCircle2, LibraryBig } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { getShelfDocs, getShelfStats } from '@/lib/library-queries';
import { DOC_TYPES, isDocType } from '@/lib/library/types';
import { EmptyState } from '@/components/EmptyState';
import { ShelfGrid } from '@/components/library/ShelfGrid';
import { ListScrollRestore } from '@/components/library/ScrollMemory';

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

  const t = await getTranslations('shelf');
  const tl = await getTranslations('labels');

  const sort: 'recent' | 'added' = searchParams.sort === 'added' ? 'added' : 'recent';
  const activeType = isDocType(searchParams.type) ? searchParams.type : 'all';

  const [stats, docs] = await Promise.all([
    getShelfStats(session.user.id),
    getShelfDocs(session.user.id, { type: searchParams.type, sort }),
  ]);

  const serialized = docs.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }));

  const typeChips = [
    { key: 'all', label: t('all_types') },
    ...DOC_TYPES.map((dt) => ({ key: dt as string, label: tl(`docType.${dt}`) })),
  ];

  return (
    <div className="container py-8">
      <ListScrollRestore />
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </div>
        <Link
          href="/library"
          className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-4 text-sm font-medium transition hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700"
        >
          {t('go_library')}
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatBox icon={<LibraryBig className="h-4 w-4" />} label={t('stat_total')} value={stats.total} />
        <StatBox icon={<BookOpen className="h-4 w-4" />} label={t('stat_reading')} value={stats.reading} />
        <StatBox icon={<CheckCircle2 className="h-4 w-4" />} label={t('stat_finished')} value={stats.finished} />
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
                    ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900/[0.06] dark:bg-white/10 font-medium text-zinc-900 dark:text-zinc-50'
                    : 'border-zinc-200 text-muted hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700'
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
              { key: 'recent', label: t('sort_recent') },
              { key: 'added', label: t('sort_added') },
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
            title={
              activeType === 'all'
                ? t('empty_title')
                : t('empty_title_typed', { type: tl(`docType.${activeType}`) })
            }
            description={t('empty_desc')}
            actionLabel={t('empty_cta')}
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
