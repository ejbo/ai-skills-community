/**
 * Per-host outbound egress routing.
 *
 * The intranet deploy has no direct route to the public internet — external
 * fetches (知识库 URL 导入, an external LLM) must go through the corporate proxy
 * (proxyca.huawei.com:8080), while intranet hosts (uniportal/w3/3ms, the 10.x
 * vLLM box, this app itself) must stay DIRECT: the proxy refuses internal
 * destinations, so pushing them through it turns a working call into
 * `Proxy response (403) !== 200 when HTTP Tunneling`.
 *
 * That is why routing is decided PER HOST here instead of by a global
 * `USE_PROXY` switch. Every server-side caller that leaves this box should go
 * through `egressFor()` (undici) or `egressFetch` (global fetch).
 *
 * Two non-obvious facts this module exists to encode:
 *   1. undici IGNORES HTTP_PROXY/HTTPS_PROXY/NO_PROXY. Setting them in systemd
 *      changes nothing for the app even though curl/git/pnpm on the same box do
 *      respect them. We read them explicitly.
 *   2. `new ProxyAgent('http://…')` (the STRING form) leaves `requestTls`
 *      undefined, so the tunnelled request is verified against Node's bundled
 *      Mozilla root store — which never contains the corporate CA that proxyca
 *      re-signs with. The OBJECT form below is what makes `requestTls` reach
 *      undici's connector.
 */

import { readFileSync } from 'node:fs';
import net from 'node:net';
import { Agent, ProxyAgent, type Dispatcher } from 'undici';
import { env } from '@/lib/env';

export type EgressVia = 'proxy' | 'direct' | 'direct-insecure';

export interface EgressDecision {
  /** Pass to undici `request({ dispatcher })` / `fetch(url, { dispatcher })`. */
  dispatcher: Dispatcher | undefined;
  via: EgressVia;
  /** Proxy URI with credentials redacted — safe to log or show an admin. */
  proxyUri: string | null;
}

/**
 * Hosts that are never proxied when PROXY_BYPASS is unset. Covers the whole
 * Huawei intranet plus RFC1918, so switching USE_PROXY on cannot break W3 SSO
 * (uniportal.huawei.com), the internal vLLM (10.x) or loopback health checks.
 */
export const DEFAULT_BYPASS = [
  'localhost',
  '127.0.0.1',
  '::1',
  '.huawei.com',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '100.64.0.0/10',
  '169.254.0.0/16',
];

/** Non-fatal misconfiguration, surfaced in logs and the admin diagnostic. */
let configError: string | null = null;

// ── proxy URI ────────────────────────────────────────────────────────────────

function normalizeProxyUri(raw: string, fallbackPort?: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  // Accept a bare host, `host:port`, or a full URI — operators write all three.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    configError = `代理地址无法解析：${value}（HUAWEI_PROXY_HOST 应为 proxyca.huawei.com 这样的主机名）`;
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    configError = `代理协议不支持：${u.protocol}（仅支持 http/https）`;
    return null;
  }
  if (!u.port && fallbackPort) u.port = fallbackPort;
  return u.toString().replace(/\/$/, '');
}

function resolveProxyUri(): string | null {
  if (env.USE_PROXY) {
    if (!env.HUAWEI_PROXY_HOST) {
      configError = 'USE_PROXY=true 但 HUAWEI_PROXY_HOST 为空 —— 出口仍是直连';
      return null;
    }
    return normalizeProxyUri(env.HUAWEI_PROXY_HOST, env.HUAWEI_PROXY_PORT ?? '8080');
  }
  // Standard vars as a fallback, so a box already exporting HTTPS_PROXY works
  // without a second, app-specific knob.
  const std = env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
  return std ? normalizeProxyUri(std) : null;
}

let proxyUriCache: string | null | undefined;
function proxyUri(): string | null {
  if (proxyUriCache === undefined) proxyUriCache = resolveProxyUri();
  return proxyUriCache;
}

/** Strip `user:pass@` so a proxy URI can be logged or shown to an admin. */
export function redactProxyUri(uri: string | null): string | null {
  if (!uri) return null;
  try {
    const u = new URL(uri);
    if (u.username || u.password) {
      u.username = u.username ? '***' : '';
      u.password = u.password ? '***' : '';
    }
    return u.toString().replace(/\/$/, '');
  } catch {
    return uri.replace(/\/\/[^@/]+@/, '//***@');
  }
}

// ── bypass matching ──────────────────────────────────────────────────────────

function bypassPatterns(): string[] {
  const raw = env.PROXY_BYPASS ?? env.NO_PROXY ?? env.no_proxy;
  if (!raw) return DEFAULT_BYPASS;
  const list = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : DEFAULT_BYPASS;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = out * 256 + n;
  }
  return out;
}

function matchesCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  if (a === null || b === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

/** True when `hostname` must be reached directly, never through the proxy. */
export function hostBypassesProxy(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return false;
  const isIpv4 = net.isIPv4(host);
  for (const pattern of bypassPatterns()) {
    if (pattern === '*') return true;
    if (pattern.includes('/')) {
      if (isIpv4 && matchesCidr(host, pattern)) return true;
      continue;
    }
    // `.huawei.com` and `huawei.com` both mean "this domain AND its subdomains" —
    // an apex-only match would leave `huawei.com` itself proxied.
    const apex = pattern.startsWith('.') ? pattern.slice(1) : pattern;
    if (host === apex) return true;
    if (host.endsWith(`.${apex}`)) return true;
  }
  return false;
}

// ── dispatchers ──────────────────────────────────────────────────────────────

let caCache: Buffer | null | undefined;
function caBundle(): Buffer | undefined {
  if (caCache === undefined) {
    caCache = null;
    if (env.PROXY_CA_FILE) {
      try {
        caCache = readFileSync(env.PROXY_CA_FILE);
      } catch (e) {
        configError = `PROXY_CA_FILE 读取失败：${(e as Error).message}`;
      }
    }
  }
  return caCache ?? undefined;
}

let proxyAgent: ProxyAgent | null | undefined;
function getProxyAgent(): ProxyAgent | undefined {
  if (proxyAgent === undefined) {
    proxyAgent = null;
    const uri = proxyUri();
    if (uri) {
      try {
        // OBJECT form — the string form silently drops requestTls (see header).
        proxyAgent = new ProxyAgent({
          uri,
          requestTls: {
            rejectUnauthorized: !env.PROXY_TLS_INSECURE,
            ...(caBundle() ? { ca: caBundle() } : {}),
          },
        });
      } catch (e) {
        configError = `代理初始化失败：${(e as Error).message}`;
        proxyAgent = null;
      }
    }
  }
  return proxyAgent ?? undefined;
}

let insecureAgent: Agent | undefined;
function getInsecureAgent(): Agent {
  if (!insecureAgent) insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });
  return insecureAgent;
}

// ── the decision ─────────────────────────────────────────────────────────────

function hostnameOf(target: string | URL): string | null {
  try {
    return (typeof target === 'string' ? new URL(target) : target).hostname;
  } catch {
    return null;
  }
}

/** How a request to `target` should leave this box. */
export function egressFor(target: string | URL): EgressDecision {
  const host = hostnameOf(target);
  const uri = proxyUri();
  const redacted = redactProxyUri(uri);
  if (!host) return { dispatcher: undefined, via: 'direct', proxyUri: redacted };

  const internal = hostBypassesProxy(host);
  if (uri && !internal) {
    const agent = getProxyAgent();
    if (agent) return { dispatcher: agent, via: 'proxy', proxyUri: redacted };
  }
  if (internal && env.INTERNAL_TLS_INSECURE) {
    return { dispatcher: getInsecureAgent(), via: 'direct-insecure', proxyUri: redacted };
  }
  return { dispatcher: undefined, via: 'direct', proxyUri: redacted };
}

/** True when `target` will be tunnelled through the corporate proxy. */
export function isProxied(target: string | URL): boolean {
  return egressFor(target).via === 'proxy';
}

/**
 * Drop-in `fetch` that applies the per-host egress decision. Node's global
 * fetch takes an undici `dispatcher` in its init bag, but the DOM typings
 * don't model it — hence the cast.
 */
export const egressFetch: typeof fetch = ((input, init) => {
  const url =
    typeof input === 'string' || input instanceof URL ? input : (input as Request).url;
  const { dispatcher } = egressFor(url);
  if (!dispatcher) return fetch(input, init);
  return fetch(input, { ...(init ?? {}), dispatcher } as RequestInit);
}) as typeof fetch;

// ── diagnostics ──────────────────────────────────────────────────────────────

/** Secret-free snapshot of the egress config, for logs and /manage 诊断. */
export function describeEgress() {
  const uri = proxyUri();
  return {
    useProxy: env.USE_PROXY,
    proxyUri: redactProxyUri(uri),
    proxyConfigured: Boolean(uri),
    hasProxyAuth: Boolean(uri && /\/\/[^@/]+@/.test(uri)),
    proxyHost: env.HUAWEI_PROXY_HOST ?? null,
    proxyPort: env.HUAWEI_PROXY_PORT ?? null,
    bypass: bypassPatterns(),
    bypassIsDefault: !(env.PROXY_BYPASS ?? env.NO_PROXY ?? env.no_proxy),
    proxyTlsInsecure: env.PROXY_TLS_INSECURE,
    internalTlsInsecure: env.INTERNAL_TLS_INSECURE,
    proxyCaFile: env.PROXY_CA_FILE ?? null,
    proxyCaLoaded: Boolean(env.PROXY_CA_FILE && caBundle()),
    // NODE_EXTRA_CA_CERTS is read by Node at process start, long BEFORE Next
    // loads .env — so it only takes effect as a systemd `Environment=` line.
    nodeExtraCaCerts: process.env.NODE_EXTRA_CA_CERTS ?? null,
    // Reported so an operator can see these are inert on their own.
    stdProxyEnv: {
      HTTPS_PROXY: env.HTTPS_PROXY ?? env.https_proxy ?? null,
      HTTP_PROXY: env.HTTP_PROXY ?? env.http_proxy ?? null,
      NO_PROXY: env.NO_PROXY ?? env.no_proxy ?? null,
    },
    configError,
    nodeVersion: process.version,
  };
}

let logged = false;
/** Log the resolved egress once per process — without it nothing confirms the flag took effect. */
export function logEgressOnce(): void {
  if (logged) return;
  logged = true;
  const d = describeEgress();
  console.info(
    `[egress] proxy=${d.proxyUri ?? 'none'} tlsInsecure=${d.proxyTlsInsecure} ` +
      `ca=${d.proxyCaLoaded ? d.proxyCaFile : (d.nodeExtraCaCerts ?? 'system')} ` +
      `bypass=${d.bypass.join('|')}${d.configError ? ` ⚠ ${d.configError}` : ''}`,
  );
}
