/**
 * github.com/trending, fetched and cached server-side.
 *
 * Server-only: it reaches the public internet, so every request goes through
 * `egressFetch` (lib/net/proxy.ts). On the intranet deploy github.com is an
 * EXTERNAL host, so it is tunnelled through the corporate proxy; on a box with
 * no proxy configured the same call goes direct. Never call fetch() here.
 *
 * Caching rules, in order of importance:
 *   1. The homepage is `force-dynamic`, so an uncached fetch would sit in the
 *      critical path of every render. A warm entry is therefore returned
 *      immediately, and a STALE entry is returned immediately too while a
 *      refresh runs in the background.
 *   2. A failed refresh never clears the cache. GitHub being unreachable (the
 *      normal state on a locked-down intranet) degrades to old data, then to an
 *      empty list the UI renders as an offline notice, never to an exception.
 *   3. Concurrent misses for the same period share one upstream request.
 */

import { env } from '@/lib/env';
import { egressFetch, egressFor } from '@/lib/net/proxy';
import {
  parseTrendingHtml,
  TRENDING_PERIODS,
  type TrendingPayload,
  type TrendingPeriod,
  type TrendingRepo,
} from '@/lib/github-trending-shared';

const HOUR_MS = 60 * 60 * 1000;

/**
 * How long a fetched list counts as fresh. GitHub recomputes trending slowly,
 * so the default is 12 h: about two upstream hits a day per window, six across
 * all three. Tune with GITHUB_TRENDING_TTL_HOURS (restart, no rebuild).
 */
const TTL_MS = env.GITHUB_TRENDING_TTL_HOURS * HOUR_MS;
/**
 * Past the TTL the cached list is still served instantly while a refresh runs
 * behind it; only past THIS does a request wait on github.com again. Kept at
 * two TTLs (min one day) so raising the TTL never reintroduces a blocking
 * fetch on the homepage's critical path.
 */
const MAX_STALE_MS = Math.max(24 * HOUR_MS, TTL_MS * 2);
const PAGE_TIMEOUT_MS = 15_000;
/**
 * Hard ceiling on the scraped body. A real trending page is ~650 KB. The
 * timeout does NOT cover this: 5 MB inside 15 s only needs 350 KB/s, and the
 * parse that follows is synchronous, so an oversized body would be read
 * happily and then chew the event loop. On the intranet deploy the corporate
 * proxy terminates TLS and can substitute any body, so this is a real bound,
 * not a formality.
 */
const MAX_PAGE_BYTES = 2_000_000;
const API_TIMEOUT_MS = 8_000;
/** Rows kept per period. GitHub renders 25; the panel scrolls through them all. */
const MAX_ROWS = 25;
const ENRICH_CONCURRENCY = 6;

const PAGE_HEADERS = {
  // GitHub serves a challenge page to obviously-scripted UAs.
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
} as const;

interface CacheEntry {
  items: TrendingRepo[];
  fetchedAt: number;
}

const cache = new Map<TrendingPeriod, CacheEntry>();
const inflight = new Map<TrendingPeriod, Promise<TrendingRepo[]>>();
/** Last upstream failure per period, surfaced to the client for the error state. */
const lastError = new Map<TrendingPeriod, string>();
/**
 * When the last attempt failed, epoch ms of that failure. Without this an
 * unreachable github.com would fire a fresh 15s request on EVERY homepage
 * render (the in-flight map only dedupes while a request is actually running).
 */
const failedAt = new Map<TrendingPeriod, number>();
const FAIL_BACKOFF_MS = 60 * 1000;

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    const code = cause?.code ? ` (${cause.code})` : '';
    return `${err.message}${code}`;
  }
  return String(err);
}

/** Read at most `maxBytes` of the body, then stop pulling from the stream. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, maxBytes);
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (total >= maxBytes) break;
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}

async function fetchPage(period: TrendingPeriod): Promise<TrendingRepo[]> {
  const url = `https://github.com/trending?since=${period}`;
  const res = await egressFetch(url, {
    headers: PAGE_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`github.com/trending responded ${res.status}`);
  const items = parseTrendingHtml(await readCapped(res, MAX_PAGE_BYTES)).slice(0, MAX_ROWS);
  if (items.length === 0) throw new Error('trending markup produced no rows');
  return items;
}

/**
 * Fill in topics/license/issues/last-push from the REST API. Opt-in via
 * GITHUB_TOKEN: unauthenticated the limit is 60 requests/hour, and one refresh
 * of all three periods costs up to 75, so running this without a token would
 * spend the budget and start failing. Every failure is swallowed: enrichment is
 * decoration on top of a complete row.
 */
async function enrich(items: TrendingRepo[], token: string): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      const repo = items[index];
      try {
        const res = await egressFetch(`https://api.github.com/repos/${repo.fullName}`, {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'User-Agent': 'ai-community-trending/1.0',
          },
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as {
          topics?: string[];
          license?: { spdx_id?: string; key?: string } | null;
          open_issues_count?: number;
          pushed_at?: string;
          description?: string | null;
        };
        repo.topics = (data.topics ?? []).slice(0, 4);
        repo.license = data.license?.spdx_id || data.license?.key || '';
        repo.openIssues = data.open_issues_count ?? 0;
        repo.pushedAt = data.pushed_at ?? '';
        if (!repo.description && data.description) repo.description = data.description;
      } catch {
        // Enrichment is best effort; the scraped row already renders.
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(ENRICH_CONCURRENCY, items.length) }, worker),
  );
}

function refresh(period: TrendingPeriod, force = false): Promise<TrendingRepo[]> {
  const existing = inflight.get(period);
  if (existing) return existing;

  const failed = failedAt.get(period);
  if (!force && failed !== undefined && Date.now() - failed < FAIL_BACKOFF_MS) {
    return Promise.reject(new Error(lastError.get(period) ?? 'github unreachable'));
  }

  const run = (async () => {
    const items = await fetchPage(period);
    const token = env.GITHUB_TOKEN;
    if (token) await enrich(items, token);
    cache.set(period, { items, fetchedAt: Date.now() });
    lastError.delete(period);
    failedAt.delete(period);
    return items;
  })()
    .catch((err) => {
      lastError.set(period, describeError(err));
      failedAt.set(period, Date.now());
      console.warn(
        `[github-trending] ${period} refresh failed via ${egressFor('https://github.com').via}:`,
        describeError(err),
      );
      throw err;
    })
    .finally(() => {
      inflight.delete(period);
    });

  inflight.set(period, run);
  return run;
}

/**
 * Cached trending list for one period. Never throws and never blocks on a
 * refresh when usable data is already cached.
 */
export async function getTrending(period: TrendingPeriod): Promise<TrendingPayload> {
  const entry = cache.get(period);
  const age = entry ? Date.now() - entry.fetchedAt : Infinity;

  if (entry && age < TTL_MS) {
    return { period, items: entry.items, fetchedAt: entry.fetchedAt, stale: false };
  }

  if (entry && age < MAX_STALE_MS) {
    // Serve the old list now, warm the cache for the next visitor.
    void refresh(period).catch(() => {});
    return { period, items: entry.items, fetchedAt: entry.fetchedAt, stale: true };
  }

  try {
    const items = await refresh(period);
    return { period, items, fetchedAt: cache.get(period)?.fetchedAt ?? Date.now(), stale: false };
  } catch {
    return { period, items: [], fetchedAt: 0, stale: false };
  }
}

/**
 * Same as `getTrending`, but gives up after `budgetMs` and returns null instead
 * of holding the render. The homepage is `force-dynamic`, so the very first
 * request after a restart would otherwise wait out the full page timeout; the
 * refresh keeps running in the background and the client component picks the
 * data up from the API route a moment later.
 */
export async function getTrendingWithin(
  period: TrendingPeriod,
  budgetMs: number,
): Promise<TrendingPayload | null> {
  const entry = cache.get(period);
  if (entry && Date.now() - entry.fetchedAt < TTL_MS) {
    return { period, items: entry.items, fetchedAt: entry.fetchedAt, stale: false };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
  });
  try {
    const payload = await Promise.race([getTrending(period), deadline]);
    return payload && payload.items.length > 0 ? payload : null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Last upstream error for a period, for the panel's offline notice. */
export function trendingError(period: TrendingPeriod): string | null {
  return lastError.get(period) ?? null;
}

/**
 * Warm the periods the user has not opened yet, so switching tabs is instant.
 * Fire and forget; the failure backoff in `refresh` keeps an unreachable
 * github.com from being retried on every render.
 */
export function warmTrending(): void {
  for (const period of TRENDING_PERIODS) {
    const entry = cache.get(period);
    if (!entry || Date.now() - entry.fetchedAt >= TTL_MS) {
      void refresh(period).catch(() => {});
    }
  }
}
