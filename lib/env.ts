import { z } from 'zod';

/**
 * Lenient boolean flag. Accepts true/1/yes/on in any case with surrounding
 * whitespace — an operator typing `USE_PROXY=True` on the deploy box used to
 * get a silent `false`, which is indistinguishable from "the proxy is broken".
 */
const bool = (def: 'true' | 'false' = 'false') =>
  z
    .string()
    .default(def)
    .transform((v) => ['true', '1', 'yes', 'on'].includes(v.trim().toLowerCase()));

/**
 * Optional string where present-but-blank means unset. `FOO=` used to survive as
 * `''`, which defeats `??` fallbacks (e.g. an empty HUAWEI_PROXY_PORT silently
 * produced `http://proxyca.huawei.com:` ⇒ port 80 ⇒ ECONNREFUSED).
 */
const optStr = () =>
  z
    .string()
    .optional()
    .transform((v) => {
      const t = v?.trim();
      return t ? t : undefined;
    });

const schema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(16),
  AUTH_URL: z.string().url().default('http://localhost:3000'),
  // Public base URL used to build links inside notification emails.
  APP_URL: z.string().url().optional(),

  // SMTP (optional). When unset, email notifications are silently skipped.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_SECURE: bool(),
  // Plaintext corporate relays (e.g. Huawei email-ca.huawei.com:25, which the
  // sibling `news` app uses) don't support STARTTLS. Set true to skip the TLS
  // upgrade entirely so the send doesn't hang/fail on a handshake.
  SMTP_IGNORE_TLS: bool(),

  STORAGE_DRIVER: z.enum(['local', 'blob']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./storage'),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  // When true, the video file route hands byte-serving to nginx via
  // X-Accel-Redirect (kernel sendfile) after auth — far better under concurrency.
  // Requires the internal `/_video/` nginx location (see deploy conf). Keep OFF
  // until that's wired, or videos return an empty body.
  VIDEO_X_ACCEL_REDIRECT: bool(),

  ENABLE_SSO: bool(),
  SSO_CLIENT_ID: z.string().optional(),
  SSO_CLIENT_SECRET: z.string().optional(),
  SSO_REDIRECT_URI: z.string().url().optional(),
  SSO_AUTHORIZE_URL: z.string().url().optional(),
  SSO_ACCESS_TOKEN_URL: z.string().url().optional(),
  SSO_USERINFO_URL: z.string().url().optional(),
  SSO_SCOPE: z.string().default('base.profile'),
  SSO_VERIFY_SSL: bool(),

  // ── Outbound egress (lib/net/proxy.ts) ─────────────────────────────────────
  // The intranet box has NO direct route to the public internet: 知识库 URL
  // ingestion and an external LLM must go through the corporate proxy, while
  // intranet hosts (uniportal/w3/3ms, 10.x vLLM) must stay DIRECT. Routing is
  // per-host, not a global switch — see PROXY_BYPASS.
  USE_PROXY: bool(),
  /** Host only (`proxyca.huawei.com`); a `host:port` or full URI is tolerated. */
  HUAWEI_PROXY_HOST: optStr(),
  HUAWEI_PROXY_PORT: optStr(),
  /**
   * Comma-separated hosts that must NOT be proxied. Entries may be an exact
   * host, a suffix (`.huawei.com`), or an IPv4 CIDR. Defaults to the intranet
   * set (see DEFAULT_BYPASS in lib/net/proxy.ts) so W3 SSO keeps working the
   * moment USE_PROXY is switched on.
   */
  PROXY_BYPASS: optStr(),
  /**
   * Skip TLS verification for requests tunnelled through the proxy. proxyca
   * re-signs certificates with an internal CA, so without this (or a CA bundle)
   * every https fetch dies with `unable to verify the first certificate`.
   * Prefer PROXY_CA_FILE / NODE_EXTRA_CA_CERTS; this is the blunt fallback.
   */
  PROXY_TLS_INSECURE: bool(),
  /**
   * PEM bundle trusted for proxied requests. Unlike NODE_EXTRA_CA_CERTS (which
   * Node reads at process start, BEFORE Next loads .env, so it only works as a
   * systemd `Environment=` line) this one may live in .env.
   */
  PROXY_CA_FILE: optStr(),
  /** Skip TLS verification for DIRECT requests to bypass-listed intranet hosts. */
  INTERNAL_TLS_INSECURE: bool(),
  // Standard proxy vars, honoured as a fallback when USE_PROXY is not set.
  // undici ignores these on its own — lib/net/proxy.ts is what makes them work.
  HTTPS_PROXY: optStr(),
  https_proxy: optStr(),
  HTTP_PROXY: optStr(),
  http_proxy: optStr(),
  NO_PROXY: optStr(),
  no_proxy: optStr(),

  INITIAL_ADMIN_EMAIL: z.string().email().default('admin@example.com'),
  INITIAL_ADMIN_PASSWORD: z.string().min(6).default('changeme'),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_SKILLS_REPO: z
    .string()
    .url()
    .default('https://github.com/anthropics/skills'),

  // LLM provider config for Chat + Comparison generation. Switch model/provider
  // purely via env (see lib/llm). When unset, falls back to Anthropic using
  // ANTHROPIC_API_KEY for backwards compatibility.
  LLM_PROVIDER: z.string().optional(), // 'anthropic' | 'openai-compatible'
  LLM_BASE_URL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
});

function loadEnv() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const details = Object.entries(fieldErrors)
      .map(([k, v]) => `  - ${k}: ${(v ?? []).join(', ')}`)
      .join('\n');
    console.error('Invalid environment variables:\n' + details);
    throw new Error('Invalid environment variables:\n' + details);
  }
  return parsed.data;
}

export const env = loadEnv();
export type Env = z.infer<typeof schema>;
