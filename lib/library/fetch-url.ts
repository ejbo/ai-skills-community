// Outbound page/asset fetching for 知识库 URL ingestion. undici request routed
// PER HOST by lib/net/proxy (external → corporate proxy, intranet → direct),
// UA/timeout/size caps, non-utf8 charset fallback via TextDecoder, and a
// bounded meta-refresh / location.replace shell chase (common on WeChat /
// redirect interstitials).
//
// SSRF guard: user-submitted URLs (and page-controlled cover URLs) must never
// reach loopback / link-local / cloud-metadata targets, including via HTTP
// redirects — so redirects are followed MANUALLY and every hop re-validates
// its target. RFC1918 ranges are additionally blocked on the external deploy;
// the intranet deploy (ENABLE_SSO) legitimately imports 10.x intranet articles.
//
// Every hop's error is logged with its egress mode and the underlying errno —
// on the intranet box "网络不通" is almost always one of exactly four things
// (no proxy configured, proxy can't see an intranet host, the MITM CA isn't
// trusted, or DNS has no public resolver), and the toast now says which.

import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { request as undiciRequest, type Dispatcher } from 'undici';
import { env } from '@/lib/env';
import { egressFor, isProxied, logEgressOnce, type EgressVia } from '@/lib/net/proxy';

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
// Per-hop budgets multiply (6 redirects × 3 refresh hops), which used to let a
// single submit run past nginx's proxy_read_timeout 300s — the browser then
// showed a bare "网络错误，请重试" with nothing in the server log. Cap the whole
// page chase well under that so a real error always reaches the user.
const PAGE_TOTAL_BUDGET_MS = 90_000;
const DNS_TIMEOUT_MS = 3_000;
const SHELL_BODY_MAX = 8 * 1024; // only tiny bodies get the meta-refresh chase
const MAX_REFRESH_HOPS = 2;
const MAX_HTTP_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

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

/**
 * DNS with a hard ceiling. `dns.lookup` has no timeout option and runs on the
 * 4-thread libuv pool, so a resolver that cannot answer for public names (the
 * normal state of an intranet box) used to stall every hop — outside the
 * request's AbortSignal budget — and starve file I/O along the way.
 */
async function lookupWithTimeout(host: string): Promise<{ address: string }[] | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      lookup(host, { all: true }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), DNS_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  const blocked = (detail?: string) =>
    new FetchUrlError(
      'fetch_failed',
      detail ? `不支持抓取内网或本机地址（${detail}）` : '不支持抓取内网或本机地址',
    );
  const allowPrivate = env.ENABLE_SSO;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) throw blocked();
  if (net.isIP(host)) {
    if (isBlockedIp(host, allowPrivate)) throw blocked(host);
    return;
  }
  // When the request is tunnelled through the corporate proxy the PROXY does the
  // resolving — our own resolver's answer is irrelevant (and usually absent), so
  // asking it is pure latency. Literal-IP targets are still checked above.
  if (isProxied(u)) return;
  // Resolve and validate every address. An unresolvable host is left to fail at
  // fetch time, where the error mapping can explain the egress mode.
  const addrs = await lookupWithTimeout(host);
  if (!addrs) return;
  const bad = addrs.find((a) => isBlockedIp(a.address, allowPrivate));
  // A public hostname resolving into a blocked range is still refused (DNS
  // rebinding), but say which address so a sinkholing resolver is diagnosable.
  if (bad) throw blocked(`${host} → ${bad.address}`);
}

// ── error explanation ────────────────────────────────────────────────────────

interface ErrorContext {
  url: string;
  via: EgressVia;
  proxyUri: string | null;
  timeoutMs: number;
}

const TLS_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNRESET',
]);

/**
 * Turn a raw undici/Node error into something an operator can act on. The old
 * code kept only `.message`, which for a proxy failure is the constant
 * "Proxy Connection failed" — the actual reason lives in `.cause`/`.code`.
 */
function explainNetworkError(e: unknown, ctx: ErrorContext): string {
  const err = e as NodeJS.ErrnoException & { cause?: unknown };
  const cause = err?.cause instanceof Error ? (err.cause as NodeJS.ErrnoException) : undefined;
  const code = err?.code ?? cause?.code ?? '';
  const detail = [err?.message, cause?.message].filter(Boolean).join(' ← ');
  const host = (() => {
    try {
      return new URL(ctx.url).hostname;
    } catch {
      return ctx.url;
    }
  })();
  const viaLabel =
    ctx.via === 'proxy' ? `经代理 ${ctx.proxyUri}` : ctx.via === 'direct-insecure' ? '直连(免校验)' : '直连';

  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return `抓取超时（${viaLabel}，${ctx.timeoutMs}ms）`;
  }
  if (TLS_CODES.has(code)) {
    return ctx.via === 'proxy'
      ? `代理证书未被信任（${viaLabel}）：${detail}。请配置 PROXY_CA_FILE，或在 systemd 里加 Environment=NODE_EXTRA_CA_CERTS（写在 .env 里无效），临时可设 PROXY_TLS_INSECURE=true`
      : `目标站点证书未被信任（${viaLabel}）：${detail}。内网站点可设 INTERNAL_TLS_INSECURE=true`;
  }
  if (code === 'EAI_AGAIN' || code === 'ENOTFOUND') {
    return ctx.via === 'proxy'
      ? `代理无法解析域名 ${host}（${viaLabel}）：${detail}`
      : `无法解析域名 ${host}（当前为直连出口）。内网机器没有公网 DNS，请设置 USE_PROXY=true + HUAWEI_PROXY_HOST`;
  }
  if (/\b407\b/.test(detail)) {
    return `代理要求认证 (407)。请把凭据写进 HUAWEI_PROXY_HOST，形如 user:pass@proxyca.huawei.com`;
  }
  if (/Proxy response \((\d{3})\)/.test(detail)) {
    const status = detail.match(/Proxy response \((\d{3})\)/)?.[1];
    return `代理拒绝了该目标（HTTP ${status}，${viaLabel}）。如果 ${host} 是内网地址，请加入 PROXY_BYPASS 走直连`;
  }
  if (UNREACHABLE_CODES.has(code)) {
    return ctx.via === 'proxy'
      ? `无法连接代理 ${ctx.proxyUri}：${detail}（检查 HUAWEI_PROXY_HOST / HUAWEI_PROXY_PORT）`
      : `无法连接 ${host}（当前为直连出口）：${detail}。内网机器访问外网需设置 USE_PROXY=true`;
  }
  return `网络请求失败（${viaLabel}）：${detail || String(e)}`;
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
  opts: { accept: string; timeoutMs: number; deadlineAt?: number },
): Promise<{ res: Dispatcher.ResponseData; finalUrl: string }> {
  logEgressOnce();
  let current = url;
  for (let hop = 0; hop <= MAX_HTTP_REDIRECTS; hop++) {
    await assertFetchableUrl(current);
    // Redirect targets can cross the proxy/direct boundary (a public shortener
    // landing on an intranet host, and vice versa), so decide per hop.
    const eg = egressFor(current);
    const remaining = opts.deadlineAt ? opts.deadlineAt - Date.now() : opts.timeoutMs;
    const timeoutMs = Math.min(opts.timeoutMs, Math.max(0, remaining));
    const ctx: ErrorContext = { url: current, via: eg.via, proxyUri: eg.proxyUri, timeoutMs };
    if (timeoutMs <= 0) {
      throw new FetchUrlError('fetch_failed', `抓取超时（总耗时超过 ${PAGE_TOTAL_BUDGET_MS}ms）`);
    }
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
        signal: AbortSignal.timeout(timeoutMs),
        ...(eg.dispatcher ? { dispatcher: eg.dispatcher } : {}),
      });
    } catch (e) {
      const message = explainNetworkError(e, ctx);
      const err = e as NodeJS.ErrnoException & { cause?: unknown };
      console.error('[library/fetch] hop failed', {
        url: current,
        hop,
        via: eg.via,
        proxy: eg.proxyUri,
        code: err?.code ?? (err?.cause as NodeJS.ErrnoException | undefined)?.code ?? null,
        name: err?.name,
        message: err?.message,
        cause: err?.cause instanceof Error ? err.cause.message : undefined,
      });
      throw new FetchUrlError('fetch_failed', message);
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

async function fetchHtmlOnce(
  url: string,
  deadlineAt: number,
): Promise<{ html: string; finalUrl: string }> {
  const { res, finalUrl } = await guardedGet(url, {
    accept: 'text/html,*/*',
    timeoutMs: PAGE_TIMEOUT_MS,
    deadlineAt,
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

/**
 * Fetch an article page, chasing small meta-refresh shells (max 2 hops).
 * All hops share one budget so the ingest can't outlive nginx's read timeout.
 */
export async function fetchPage(url: string): Promise<{ html: string; finalUrl: string }> {
  const deadlineAt = Date.now() + PAGE_TOTAL_BUDGET_MS;
  let current = url;
  for (let hop = 0; ; hop++) {
    const { html, finalUrl } = await fetchHtmlOnce(current, deadlineAt);
    const next = html.length < SHELL_BODY_MAX ? findRefreshTarget(html, finalUrl) : null;
    if (!next || hop >= MAX_REFRESH_HOPS) return { html, finalUrl };
    current = next;
  }
}

/**
 * Best-effort binary fetch (covers, re-hosted article images) — null on any
 * failure or over-cap. Callers rely on the null, but the reason is logged:
 * silently dropping 24 images reads to the user as "the article has no
 * pictures", which is indistinguishable from a successful import.
 */
export async function fetchBinary(
  url: string,
  maxBytes: number,
  opts?: { deadlineAt?: number },
): Promise<{ buf: Buffer; contentType: string } | null> {
  try {
    const { res } = await guardedGet(url, {
      accept: '*/*',
      timeoutMs: BINARY_TIMEOUT_MS,
      deadlineAt: opts?.deadlineAt,
    });
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
  } catch (e) {
    console.warn(
      '[library/fetch] binary failed',
      url,
      e instanceof FetchUrlError ? e.message : (e as Error)?.message,
    );
    return null;
  }
}
