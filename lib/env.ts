import { z } from 'zod';

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
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  // Plaintext corporate relays (e.g. Huawei email-ca.huawei.com:25, which the
  // sibling `news` app uses) don't support STARTTLS. Set true to skip the TLS
  // upgrade entirely so the send doesn't hang/fail on a handshake.
  SMTP_IGNORE_TLS: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  STORAGE_DRIVER: z.enum(['local', 'blob']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./storage'),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  // When true, the video file route hands byte-serving to nginx via
  // X-Accel-Redirect (kernel sendfile) after auth — far better under concurrency.
  // Requires the internal `/_video/` nginx location (see deploy conf). Keep OFF
  // until that's wired, or videos return an empty body.
  VIDEO_X_ACCEL_REDIRECT: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  ENABLE_SSO: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  SSO_CLIENT_ID: z.string().optional(),
  SSO_CLIENT_SECRET: z.string().optional(),
  SSO_REDIRECT_URI: z.string().url().optional(),
  SSO_AUTHORIZE_URL: z.string().url().optional(),
  SSO_ACCESS_TOKEN_URL: z.string().url().optional(),
  SSO_USERINFO_URL: z.string().url().optional(),
  SSO_SCOPE: z.string().default('base.profile'),
  SSO_VERIFY_SSL: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  USE_PROXY: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  HUAWEI_PROXY_HOST: z.string().optional(),
  HUAWEI_PROXY_PORT: z.string().optional(),

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
