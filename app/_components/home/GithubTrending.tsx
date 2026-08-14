'use client';

// GitHub 热榜 panel for the homepage hero. The scrape, the cache and the proxy
// egress all live on the server (lib/github-trending.ts); this leaf owns the
// day/week/month switch, a per-period client cache and the scroll container.
//
// Deliberately monochrome: the ONLY colour on the panel is GitHub's own
// language dot, which is real data. Everything else is ink, paper and
// hairlines, so the panel reads as an instrument next to the video player
// rather than as another tinted card.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowUpRight, GitFork, Github, RefreshCw, Star } from 'lucide-react';
import { relativeTime } from '@/lib/i18n-date';
import {
  TRENDING_PERIODS,
  type TrendingPayload,
  type TrendingPeriod,
  type TrendingRepo,
} from '@/lib/github-trending-shared';

const PERIOD_LABEL_KEY: Record<TrendingPeriod, string> = {
  daily: 'period_daily',
  weekly: 'period_weekly',
  monthly: 'period_monthly',
};

const GAINED_KEY: Record<TrendingPeriod, string> = {
  daily: 'gained_daily',
  weekly: 'gained_weekly',
  monthly: 'gained_monthly',
};

/**
 * Star and fork totals are formatted en-US on purpose. A zh viewer reading
 * "1.2万" next to a repo name has to translate it back to compare with
 * github.com, where the same number is "12.4k". The period delta below uses the
 * viewer's locale because it is a plain, small integer.
 */
const COMPACT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

interface Props {
  /** SSR payload for the first tab. Null when the server could not get it in time. */
  initial: TrendingPayload | null;
  className?: string;
}

export function GithubTrending({ initial, className = '' }: Props) {
  const t = useTranslations('github_trending');
  const locale = useLocale();

  const [period, setPeriod] = useState<TrendingPeriod>(initial?.period ?? 'daily');
  const [cache, setCache] = useState<Partial<Record<TrendingPeriod, TrendingPayload>>>(() =>
    initial ? { [initial.period]: initial } : {},
  );
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [atEnd, setAtEnd] = useState(false);
  // Relative times only render after mount: the server and the browser format
  // "5 分钟前" at different instants, and React 18 does not patch text
  // mismatches, so an SSR'd relative time can stay wrong until the next nav.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Guards against a slow tab's response landing after the user moved on.
  const requestId = useRef(0);
  // `load` reads the cache through a ref so its identity stays stable; putting
  // `cache` in its dependency list would re-fire the effect on every fetch.
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  const load = useCallback(async (target: TrendingPeriod, force = false) => {
    if (!force && cacheRef.current[target]) {
      setLoading(false);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/github-trending?period=${target}`, { cache: 'no-store' });
      const data = (await res.json()) as
        | (TrendingPayload & { ok: true; error: string | null })
        | { error: string };
      if (id !== requestId.current) return;
      if (!res.ok || !('ok' in data)) {
        setError('error' in data ? data.error : 'request_failed');
        return;
      }
      setCache((prev) => ({
        ...prev,
        [target]: {
          period: target,
          items: data.items,
          fetchedAt: data.fetchedAt,
          stale: data.stale,
        },
      }));
      if (data.items.length === 0) setError(data.error ?? 'empty');
    } catch {
      if (id === requestId.current) setError('network');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [period, load]);

  // A different window is a different list: start it at the top and drop the
  // previous list's end-of-scroll state, which would otherwise hide the fade.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setAtEnd(false);
  }, [period]);

  const payload = cache[period];
  const items = payload?.items ?? [];
  const showSkeleton = loading && items.length === 0;
  const showError = !loading && items.length === 0 && error !== null;

  // Roving tabindex: arrow keys must move DOM FOCUS, not just the selection.
  // Selection alone leaves focus on a button that has just been given
  // tabIndex={-1}, so a screen reader announces nothing and the next Tab out
  // and back lands somewhere else.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKey = (e: React.KeyboardEvent) => {
    const last = TRENDING_PERIODS.length - 1;
    const i = TRENDING_PERIODS.indexOf(period);
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
        next = i === last ? 0 : i + 1;
        break;
      case 'ArrowLeft':
        next = i === 0 ? last : i - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    e.preventDefault();
    setPeriod(TRENDING_PERIODS[next]);
    tabRefs.current[next]?.focus();
  };

  return (
    <section
      className={`surface flex flex-col overflow-hidden rounded-xl ${className}`}
      aria-label={t('title')}
    >
      {/* Wraps to two lines on a narrow phone: "This week"/"This month" are long
          in en/fr and would otherwise squeeze the title to three characters. */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-zinc-200/90 px-3.5 py-2.5 dark:border-zinc-800 sm:h-11 sm:flex-nowrap sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <Github className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden />
          <h2 className="truncate text-sm font-semibold tracking-tight">{t('title')}</h2>
        </div>
        <div
          role="tablist"
          aria-label={t('title')}
          onKeyDown={onTabKey}
          className="flex shrink-0 items-center gap-0.5 rounded-full bg-zinc-100 p-0.5 dark:bg-white/[0.06]"
        >
          {TRENDING_PERIODS.map((p, i) => {
            const active = p === period;
            return (
              <button
                key={p}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                role="tab"
                type="button"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => setPeriod(p)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50'
                }`}
              >
                {t(PERIOD_LABEL_KEY[p])}
              </button>
            );
          })}
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            setAtEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 4);
          }}
          className="scroll-thin h-full overflow-y-auto"
        >
          {showSkeleton ? (
            <RowSkeletons />
          ) : showError ? (
            <ErrorState onRetry={() => void load(period, true)} />
          ) : items.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-muted">{t('empty')}</p>
          ) : (
            <ol className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {items.map((repo) => (
                <RepoRow key={repo.fullName} repo={repo} period={period} locale={locale} />
              ))}
            </ol>
          )}
        </div>
        {/* Bottom fade: the scroll affordance. Matches the panel fill exactly in
            both themes because both read the same --surface token. */}
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[rgb(var(--surface))] to-transparent transition-opacity duration-200 ${
            atEnd || items.length === 0 ? 'opacity-0' : 'opacity-100'
          }`}
        />
      </div>

      <footer className="flex h-[34px] shrink-0 items-center justify-between gap-3 border-t border-zinc-200/90 px-3.5 text-[11px] dark:border-zinc-800">
        <span className="min-w-0 truncate text-zinc-400 dark:text-zinc-500">
          {items.length > 0 ? t('count', { count: items.length }) : ''}
          {mounted && payload && payload.fetchedAt > 0
            ? ` · ${t('updated', { time: relativeTime(payload.fetchedAt, locale) })}`
            : ''}
          {payload?.stale ? ` · ${t('cached')}` : ''}
        </span>
        <a
          href="https://github.com/trending"
          target="_blank"
          rel="noreferrer noopener"
          className="flex shrink-0 items-center gap-1 font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          {t('view_all')}
          <ArrowUpRight className="h-3 w-3" aria-hidden />
        </a>
      </footer>
    </section>
  );
}

function RepoRow({
  repo,
  period,
  locale,
}: {
  repo: TrendingRepo;
  period: TrendingPeriod;
  locale: string;
}) {
  const t = useTranslations('github_trending');
  const plain = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  return (
    <li>
      <a
        href={repo.url}
        target="_blank"
        rel="noreferrer noopener"
        className="group grid grid-cols-[1.5rem,minmax(0,1fr),auto] gap-x-3 px-3.5 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-white/[0.03]"
      >
        <span
          aria-label={t('rank_sr', { rank: repo.rank })}
          className="pt-[3px] text-right font-mono text-[11px] tabular-nums text-zinc-400 dark:text-zinc-600"
        >
          {String(repo.rank).padStart(2, '0')}
        </span>

        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-1 text-[13px] leading-5">
            <span className="min-w-0 truncate">
              <span className="text-zinc-500 dark:text-zinc-400">{repo.owner}/</span>
              <span className="font-semibold text-zinc-900 decoration-zinc-300 underline-offset-2 group-hover:underline dark:text-zinc-50 dark:decoration-zinc-600">
                {repo.name}
              </span>
            </span>
            <ArrowUpRight
              aria-hidden
              className="h-3 w-3 shrink-0 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100"
            />
          </p>

          {repo.description && (
            <p className="mt-1 line-clamp-2 text-xs leading-[1.45] text-muted">
              {repo.description}
            </p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-500">
            {repo.language && (
              <span className="flex items-center gap-1.5">
                {/* The one spot of colour on the panel, and it is real data:
                    GitHub's own per-language hex. */}
                <span
                  aria-hidden
                  className="h-[7px] w-[7px] shrink-0 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15 dark:[filter:saturate(0.9)_brightness(1.15)]"
                  style={{ backgroundColor: repo.languageColor || 'rgb(161 161 170)' }}
                />
                {repo.language}
              </span>
            )}
            <span className="flex items-center gap-1" title={t('stars_sr', { count: repo.stars })}>
              <Star className="h-3 w-3 text-zinc-400" aria-hidden />
              {COMPACT.format(repo.stars)}
            </span>
            <span className="flex items-center gap-1" title={t('forks_sr', { count: repo.forks })}>
              <GitFork className="h-3 w-3 text-zinc-400" aria-hidden />
              {COMPACT.format(repo.forks)}
            </span>
            {/* Only present when a GITHUB_TOKEN unlocked the REST enrichment. */}
            {repo.topics.slice(0, 2).map((topic) => (
              <span key={topic} className="truncate text-zinc-400 dark:text-zinc-600">
                #{topic}
              </span>
            ))}
          </div>
        </div>

        <div
          className="pt-[2px] text-right"
          title={t(GAINED_KEY[period], { count: repo.periodStars })}
        >
          <div className="font-mono text-xs font-semibold leading-none tabular-nums text-zinc-900 dark:text-zinc-50">
            +{plain.format(repo.periodStars)}
          </div>
          <div className="mt-1 text-[10px] leading-none text-zinc-400 dark:text-zinc-600">
            {t(PERIOD_LABEL_KEY[period])}
          </div>
        </div>
      </a>
    </li>
  );
}

function RowSkeletons() {
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <li key={i} className="grid grid-cols-[1.5rem,minmax(0,1fr)] gap-x-3 px-3.5 py-3">
          <div className="shimmer mt-1 h-3 w-4 rounded" />
          <div className="space-y-2">
            <div className="shimmer h-3.5 rounded" style={{ width: `${58 + (i % 3) * 9}%` }} />
            <div className="shimmer h-3 rounded" style={{ width: `${74 - (i % 4) * 6}%` }} />
            <div className="shimmer h-2.5 w-24 rounded" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('github_trending');
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <p className="text-sm font-medium">{t('error_title')}</p>
      <p className="max-w-xs text-xs text-muted">{t('error_hint')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium transition-colors hover:bg-zinc-100 active:translate-y-px dark:border-zinc-700 dark:hover:bg-white/[0.06]"
      >
        <RefreshCw className="h-3 w-3" aria-hidden />
        {t('retry')}
      </button>
    </div>
  );
}
