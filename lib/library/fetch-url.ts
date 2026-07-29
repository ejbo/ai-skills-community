// Outbound page/asset fetching for 知识库 URL ingestion. undici request with an
// optional intranet ProxyAgent (USE_PROXY + HUAWEI_PROXY_HOST, same convention
// as lib/auth/huawei-fetch.ts), UA/timeout/size caps, non-utf8 charset
// fallback via TextDecoder, and a bounded meta-refresh / location.replace
// shell chase (common on WeChat / redirect interstitials).
//
// SSRF guard: user-submitted URLs (and page-controlled cover URLs) must never
// reach loopback / link-local / cloud-metadata targets, including via HTTP
// redirects — so redirects are followed MANUALLY and every hop re-validates
// its target. RFC1918 ranges are additionally blocked on the external deploy;
// the intranet deploy (ENABLE_SSO) legitimately imports 10.x intranet articles.

import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { request as undiciRequest, ProxyAgent, type Dispatcher } from 'undici';
import { env } from '@/lib/env';

export class FetchUrlError extends Error {
  code: 'fetch_failed' | 'too_large' | 'unsupported_content';

  constructor(code: 'fetch_failed' | 'too_large' | 'unsupported_content', message?: string) {
    super(message ?? code);
    this.name = 'FetchUrlError';
    this.code = code;
  }
}

const MAX_HTML_BYTES = 10 * 1024 * 1024; // 10 MB
const PAGE_TIMEOUT_MS = 30_000;
const BINARY_TIMEOUT_MS = 20_000;
const SHELL_BODY_MAX = 8 * 1024; // only tiny bodies get the meta-refresh chase
const MAX_REFRESH_HOPS = 2;
const MAX_HTTP_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

let dispatcher: ProxyAgent | null | undefined;

function getDispatcher(): ProxyAgent | null {
  if (dispatcher === undefined) {
    dispatcher =
      env.USE_PROXY && env.HUAWEI_PROXY_HOST
        ? new ProxyAgent(`http://${env.HUAWEI_PROXY_HOST}:${env.HUAWEI_PROXY_PORT ?? '8080'}`)
        : null;
  }
  return dispatcher;
}

// ── SSRF target validation ───────────────────────────────────────────────────

/** Always blocked: loopback, link-local (cloud metadata), unspecified, mapped. */
function isBlockedIp(ip: string, allowPrivate: boolean): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (!allowPrivate) {
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 100 && b >= 64 && b <= 127) return true;
    }
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    if (lower.startsWith('::ffff:')) return isBlockedIp(lower.slice('::ffff:'.length), allowPrivate);
    if (!allowPrivate && (lower.startsWith('fc') || lower.startsWith('fd'))) return true;
    return false;
  }
  return true;
}

/** Throw unless the URL is an http(s) target we are willing to fetch. */
async function assertFetchableUrl(raw: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchUrlError('fetch_failed', '链接格式不正确');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new FetchUrlError('fetch_failed', '仅支持 http/https 链接');
  }
  const blocked = () => new FetchUrlError('fetch_failed', '不支持抓取内网或本机地址');
  const allowPrivate = env.ENABLE_SSO;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) throw blocked();
  if (net.isIP(host)) {
    if (isBlockedIp(host, allowPrivate)) throw blocked();
    return;
  }
  // Resolve and validate every address. An unresolvable host is left to fail
  // at fetch time (with USE_PROXY the corporate proxy resolves external names
  // that this box cannot).
  let addrs: { address: string }[] = [];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    return;
  }
  if (addrs.some((a) => isBlockedIp(a.address, allowPrivate))) throw blocked();
}

function headerValue(h: string | string[] | undefined): string {
  return Array.isArray(h) ? (h[0] ?? '') : (h ?? '');
}

/**
 * GET with per-hop SSRF validation — redirects are followed manually so a
 * public URL can never 302 into loopback/metadata targets.
 */
async function guardedGet(
  url: string,
  opts: { accept: string; timeoutMs: number },
): Promise<{ res: Dispatcher.ResponseData; finalUrl: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_HTTP_REDIRECTS; hop++) {
    await assertFetchableUrl(current);
    let res: Dispatcher.ResponseData;
    try {
      res = await undiciRequest(current, {
        method: 'GET',
        headers: {
          'user-agent': USER_AGENT,
          accept: opts.accept,
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        // undici request never follows redirects itself — REDIRECT_STATUSES
        // below are handled manually with per-hop SSRF validation.
        signal: AbortSignal.timeout(opts.timeoutMs),
        ...(getDispatcher() ? { dispatcher: getDispatcher()! } : {}),
      });
    } catch (e) {
      const msg =
        (e as Error).name === 'TimeoutError' ? '抓取超时' : `网络请求失败：${(e as Error).message}`;
      throw new FetchUrlError('fetch_failed', msg);
    }
    if (REDIRECT_STATUSES.has(res.statusCode)) {
      const loc = headerValue(res.headers.location as string | string[] | undefined);
      void res.body.dump().catch(() => undefined);
      if (!loc) throw new FetchUrlError('fetch_failed', `目标站点返回 HTTP ${res.statusCode}`);
      try {
        current = new URL(loc, current).toString();
      } catch {
        throw new FetchUrlError('fetch_failed', '重定向地址无效');
      }
      continue;
    }
    return { res, finalUrl: current };
  }
  throw new FetchUrlError('fetch_failed', '重定向次数过多');
}

/** Read a response body into a Buffer, enforcing a byte cap while streaming. */
async function readCapped(body: AsyncIterable<Uint8Array>, maxBytes: number): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const value of body) {
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      throw new FetchUrlError('too_large', '页面内容超出大小限制');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function charsetFromContentType(contentType: string): string | null {
  const m = contentType.match(/charset\s*=\s*"?([\w-]+)"?/i);
  return m ? m[1].toLowerCase() : null;
}

function decodeWith(bytes: Buffer, charset: string | null): string | null {
  if (!charset) return null;
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return null;
  }
}

/** Decode fetched bytes honouring header charset, then in-document meta charset. */
function decodeHtml(bytes: Buffer, contentType: string): string {
  const headerCharset = charsetFromContentType(contentType);
  if (headerCharset && headerCharset !== 'utf-8' && headerCharset !== 'utf8') {
    const decoded = decodeWith(bytes, headerCharset);
    if (decoded !== null) return decoded;
  }
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (!headerCharset) {
    const head = utf8.slice(0, 4096);
    const meta =
      head.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i) ??
      head.match(/<meta[^>]+content\s*=\s*["'][^"']*charset=([\w-]+)/i);
    const declared = meta ? meta[1].toLowerCase() : null;
    if (declared && declared !== 'utf-8' && declared !== 'utf8') {
      const decoded = decodeWith(bytes, declared);
      if (decoded !== null) return decoded;
    }
  }
  return utf8;
}

/** Meta-refresh / location.replace target in a tiny shell page, else null. */
function findRefreshTarget(html: string, currentUrl: string): string | null {
  const meta = html.match(
    /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*url\s*=\s*([^"'>\s]+)/i,
  );
  const script = html.match(/(?:location\.replace\s*\(\s*|location\.href\s*=\s*)["']([^"']+)["']/i);
  const raw = (meta?.[1] ?? script?.[1] ?? '').trim();
  if (!raw) return null;
  try {
    const next = new URL(raw, currentUrl);
    if (next.protocol !== 'http:' && next.protocol !== 'https:') return null;
    if (next.toString() === currentUrl) return null;
    return next.toString();
  } catch {
    return null;
  }
}

async function fetchHtmlOnce(url: string): Promise<{ html: string; finalUrl: string }> {
  const { res, finalUrl } = await guardedGet(url, {
    accept: 'text/html,*/*',
    timeoutMs: PAGE_TIMEOUT_MS,
  });
  const discard = () => void res.body.dump().catch(() => undefined);

  if (res.statusCode < 200 || res.statusCode >= 300) {
    discard();
    throw new FetchUrlError('fetch_failed', `目标站点返回 HTTP ${res.statusCode}`);
  }

  const contentType = headerValue(res.headers['content-type']).toLowerCase();
  if (contentType.startsWith('application/pdf')) {
    discard();
    throw new FetchUrlError('unsupported_content', '该链接指向 PDF 文件，请下载后通过「上传文件」导入');
  }
  if (/^(image|video|audio)\//.test(contentType) || contentType.startsWith('application/zip')) {
    discard();
    throw new FetchUrlError('unsupported_content', '该链接不是网页文章，无法提取内容');
  }

  const declared = Number(headerValue(res.headers['content-length']));
  if (Number.isFinite(declared) && declared > MAX_HTML_BYTES) {
    discard();
    throw new FetchUrlError('too_large', '页面内容超出大小限制');
  }

  let bytes: Buffer;
  try {
    bytes = await readCapped(res.body, MAX_HTML_BYTES);
  } catch (e) {
    if (e instanceof FetchUrlError) throw e;
    throw new FetchUrlError('fetch_failed', '读取页面内容失败');
  }
  return { html: decodeHtml(bytes, contentType), finalUrl };
}

/** Fetch an article page, chasing small meta-refresh shells (max 2 hops). */
export async function fetchPage(url: string): Promise<{ html: string; finalUrl: string }> {
  let current = url;
  for (let hop = 0; ; hop++) {
    const { html, finalUrl } = await fetchHtmlOnce(current);
    const next = html.length < SHELL_BODY_MAX ? findRefreshTarget(html, finalUrl) : null;
    if (!next || hop >= MAX_REFRESH_HOPS) return { html, finalUrl };
    current = next;
  }
}

/** Best-effort binary fetch (covers) — null on any failure or over-cap. */
export async function fetchBinary(
  url: string,
  maxBytes: number,
): Promise<{ buf: Buffer; contentType: string } | null> {
  try {
    const { res } = await guardedGet(url, { accept: '*/*', timeoutMs: BINARY_TIMEOUT_MS });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      void res.body.dump().catch(() => undefined);
      return null;
    }
    const declared = Number(headerValue(res.headers['content-length']));
    if (Number.isFinite(declared) && declared > maxBytes) {
      void res.body.dump().catch(() => undefined);
      return null;
    }
    const buf = await readCapped(res.body, maxBytes);
    if (buf.length === 0) return null;
    return { buf, contentType: headerValue(res.headers['content-type']).split(';')[0].trim() };
  } catch {
    return null;
  }
}
