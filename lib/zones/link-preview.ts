// 技术专区 `[embed:link:<url>]` — Open Graph preview with a shared DB cache.
//
// One row per normalized URL (`ZoneLinkPreview.urlHash` = sha256): an `ok`
// row is served forever (previews of a fixed URL rarely change and a re-fetch
// costs an outbound request on the intranet's constrained egress), a failed
// row is retried after 24 h. The page is fetched through lib/library/fetch-url
// `fetchPage` — SSRF-guarded (loopback / link-local / metadata blocked on every
// redirect hop) and egress-aware (external → corporate proxy) — but with a hard
// 6 s wall-clock budget and a 1 MB parse cap so an unresponsive site can never
// hold a post render hostage. Always resolves: on any failure the fields are
// empty and only the hostname survives.

import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import { fetchPage } from '@/lib/library/fetch-url';
import { normalizePreviewUrl, parseOgMeta } from './og-parse';
import { hostnameOf } from './shared';
import type { EmbedLinkData } from './types';

const FETCH_BUDGET_MS = 6_000;
const MAX_PARSE_BYTES = 1024 * 1024; // 1 MB of HTML is more than any <head> needs
const FAILED_RETRY_MS = 24 * 60 * 60 * 1000;

export function linkPreviewHash(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl).digest('hex');
}

function emptyPreview(url: string): EmbedLinkData {
  return { url, hostname: hostnameOf(url), title: '', description: '', imageUrl: null, siteName: '' };
}

/** Race the (up to 90 s) page chase against our own budget; the loser is abandoned. */
function fetchWithBudget(url: string): Promise<{ html: string; finalUrl: string } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, FETCH_BUDGET_MS);
    fetchPage(url).then(
      (page) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(page);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

// One outbound fetch per URL at a time: a post with the same link rendered by
// several viewers during a cache miss shares the in-flight promise.
const inflight = new Map<string, Promise<EmbedLinkData>>();

async function fetchAndStore(normalized: string, urlHash: string): Promise<EmbedLinkData> {
  const base = emptyPreview(normalized);
  let data: EmbedLinkData = base;
  let ok = false;
  try {
    const page = await fetchWithBudget(normalized);
    if (page) {
      const html = page.html.length > MAX_PARSE_BYTES ? page.html.slice(0, MAX_PARSE_BYTES) : page.html;
      const parsed = parseOgMeta(html, page.finalUrl || normalized);
      data = { ...base, title: parsed.title, description: parsed.description, imageUrl: parsed.imageUrl, siteName: parsed.siteName };
      ok = Boolean(parsed.title || parsed.description || parsed.imageUrl);
    }
  } catch {
    // fall through — recorded as a failed row below
  }
  try {
    await prisma.zoneLinkPreview.upsert({
      where: { urlHash },
      create: {
        urlHash,
        url: normalized,
        title: data.title,
        description: data.description,
        imageUrl: data.imageUrl,
        siteName: data.siteName,
        ok,
        fetchedAt: new Date(),
      },
      update: {
        title: data.title,
        description: data.description,
        imageUrl: data.imageUrl,
        siteName: data.siteName,
        ok,
        fetchedAt: new Date(),
      },
    });
  } catch {
    // cache write is best-effort; the preview itself still resolves
  }
  return data;
}

/**
 * Resolve the preview card for a link. Never throws; an unfetchable or
 * non-http(s) URL yields empty fields (the UI then shows a plain link card).
 */
export async function getLinkPreview(url: string): Promise<EmbedLinkData> {
  const normalized = normalizePreviewUrl(url);
  if (!normalized) return emptyPreview(url);
  const urlHash = linkPreviewHash(normalized);

  try {
    const row = await prisma.zoneLinkPreview.findUnique({ where: { urlHash } });
    if (row) {
      const fresh = row.ok || Date.now() - row.fetchedAt.getTime() < FAILED_RETRY_MS;
      if (fresh) {
        return {
          url: row.url,
          hostname: hostnameOf(row.url),
          title: row.title,
          description: row.description,
          imageUrl: row.imageUrl,
          siteName: row.siteName,
        };
      }
    }
  } catch {
    // DB hiccup — fall through to a live fetch, still never throwing
  }

  const pending = inflight.get(urlHash);
  if (pending) return pending;
  const task = fetchAndStore(normalized, urlHash).finally(() => {
    inflight.delete(urlHash);
  });
  inflight.set(urlHash, task);
  return task;
}
