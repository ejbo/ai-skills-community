/**
 * Huawei IDaaS (UniPortal / W3) custom fetch for Auth.js.
 *
 * Huawei's OAuth2 authorization-code flow does NOT follow the conventions
 * Auth.js / oauth4webapi assume, so the stock `token` / `userinfo` string
 * endpoints fail. Instead of fighting the provider machinery we hand Auth.js a
 * custom `fetch` (the `customFetch` escape hatch) that intercepts ONLY the token
 * and userinfo calls and reshapes them to Huawei's protocol. State/CSRF, the
 * browser redirect, and the session all stay with Auth.js.
 *
 * Huawei specifics handled here (each one breaks the default provider):
 *   - token exchange wants a JSON body, not application/x-www-form-urlencoded
 *   - the token response omits `token_type`; oauth4webapi requires "bearer"
 *   - `expires_in` may be a 13-digit epoch-ms absolute value, not relative seconds
 *   - userinfo is a POST with { client_id, access_token, scope } in a JSON body,
 *     NOT a GET with an `Authorization: Bearer` header
 *   - errors arrive as { errorCode, errorDesc }, sometimes with HTTP 200
 *
 * See ~/.claude/skills/huawei-sso (references/oauth2_integration_spec.md) for the
 * authoritative protocol this mirrors.
 *
 * This module is intentionally env-free and pure (config is injected) so it is
 * unit-testable without loading the app's env.
 */

export interface HuaweiFetchConfig {
  clientId: string;
  clientSecret: string;
  scope: string;
  tokenUrl: string;
  userinfoUrl: string;
  /** false ⇒ skip TLS cert verification (uniportal's internal chain often won't validate). */
  verifySsl: boolean;
  /** Route outbound calls through the Huawei corporate proxy (intranet egress). */
  useProxy?: boolean;
  proxyHost?: string;
  proxyPort?: string;
  /** Injectable for tests; defaults to global fetch (+ optional intranet dispatcher). */
  baseFetch?: typeof fetch;
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

export function createHuaweiFetch(cfg: HuaweiFetchConfig): typeof fetch {
  const base = cfg.baseFetch ?? buildBaseFetch(cfg);

  return (async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    const url = urlOf(input);
    if (sameEndpoint(url, cfg.tokenUrl)) return reshapeToken(input, init, cfg, base);
    if (sameEndpoint(url, cfg.userinfoUrl)) return reshapeUserinfo(input, init, cfg, base);
    // A type:"oauth" provider only fetches token + userinfo server-side; anything
    // else (shouldn't happen) passes straight through.
    return base(input, init);
  }) as typeof fetch;
}

function urlOf(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function sameEndpoint(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname;
  } catch {
    return a.split('?')[0] === b.split('?')[0];
  }
}

async function reshapeToken(
  input: FetchInput,
  init: FetchInit,
  cfg: HuaweiFetchConfig,
  base: typeof fetch,
): Promise<Response> {
  // Pull `code` + `redirect_uri` from whatever Auth.js sent (form body, then query).
  // client_id/secret come from config so we don't depend on the token-auth method.
  const sent = new Request(input as RequestInfo, init);
  const bodyText = await sent.text().catch(() => '');
  const form = new URLSearchParams(bodyText);
  const query = safeSearchParams(sent.url);
  const code = form.get('code') ?? query.get('code') ?? '';
  const redirectUri = form.get('redirect_uri') ?? query.get('redirect_uri') ?? '';

  const resp = await base(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code,
    }),
  });
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (data.errorCode || !data.access_token) {
    throw new Error(
      `Huawei token exchange failed: ${String(data.errorCode ?? resp.status)} ${String(data.errorDesc ?? '')}`.trim(),
    );
  }
  // oauth4webapi requires token_type === "bearer"; Huawei omits it. Drop a non-relative
  // (epoch-ms) expires_in so downstream expiry math can't go haywire.
  const expiresIn =
    typeof data.expires_in === 'number' && data.expires_in > 0 && data.expires_in < 1e12
      ? data.expires_in
      : undefined;
  return jsonResponse({
    access_token: data.access_token,
    token_type: 'bearer',
    ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
    ...(data.scope ? { scope: data.scope } : {}),
    ...(expiresIn ? { expires_in: expiresIn } : {}),
  });
}

async function reshapeUserinfo(
  input: FetchInput,
  init: FetchInit,
  cfg: HuaweiFetchConfig,
  base: typeof fetch,
): Promise<Response> {
  const sent = new Request(input as RequestInfo, init);
  const accessToken = (sent.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const resp = await base(cfg.userinfoUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: cfg.clientId, access_token: accessToken, scope: cfg.scope }),
  });
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (data.errorCode) {
    throw new Error(`Huawei userinfo failed: ${String(data.errorCode)} ${String(data.errorDesc ?? '')}`.trim());
  }
  return jsonResponse(data);
}

function safeSearchParams(url: string): URLSearchParams {
  try {
    return new URL(url).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function jsonResponse(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Global fetch, optionally wrapped with an undici dispatcher for the Huawei intranet:
 * a ProxyAgent (USE_PROXY) or a TLS-verify-off Agent (SSO_VERIFY_SSL=false). undici is
 * imported lazily and the whole thing degrades to plain fetch if it can't be resolved.
 */
function buildBaseFetch(cfg: HuaweiFetchConfig): typeof fetch {
  const needsDispatcher = cfg.useProxy || !cfg.verifySsl;
  if (!needsDispatcher) return fetch;

  let dispatcher: unknown | null | undefined;
  const ensureDispatcher = async (): Promise<unknown | null> => {
    if (dispatcher !== undefined) return dispatcher;
    dispatcher = null;
    try {
      // Indirect specifier so TS/bundlers don't statically resolve undici (it's an
      // optional transitive dep, not a direct one). The try/catch handles absence.
      const undiciSpecifier = 'undici';
      const undici = (await import(/* @vite-ignore */ /* webpackIgnore: true */ undiciSpecifier)) as {
        Agent: new (opts: unknown) => unknown;
        ProxyAgent: new (uri: string) => unknown;
      };
      if (cfg.useProxy && cfg.proxyHost) {
        dispatcher = new undici.ProxyAgent(`http://${cfg.proxyHost}:${cfg.proxyPort ?? '8080'}`);
      } else if (!cfg.verifySsl) {
        dispatcher = new undici.Agent({ connect: { rejectUnauthorized: false } });
      }
    } catch {
      // undici not resolvable — fall back to plain fetch. If uniportal's cert fails to
      // validate, set NODE_EXTRA_CA_CERTS (preferred) or NODE_TLS_REJECT_UNAUTHORIZED=0.
      // eslint-disable-next-line no-console
      console.warn('[huawei-sso] undici unavailable; outbound TLS/proxy options ignored.');
      dispatcher = null;
    }
    return dispatcher;
  };

  return (async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    const d = await ensureDispatcher();
    if (!d) return fetch(input, init);
    const opts: FetchInit & { dispatcher?: unknown } = { ...(init ?? {}) };
    opts.dispatcher = d;
    return fetch(input, opts as FetchInit);
  }) as typeof fetch;
}
