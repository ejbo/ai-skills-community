import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(16),
  AUTH_URL: z.string().url().default('http://localhost:3000'),

  STORAGE_DRIVER: z.enum(['local', 'blob']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./storage'),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),

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
});

function loadEnv() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment variables');
  }
  return parsed.data;
}

export const env = loadEnv();
export type Env = z.infer<typeof schema>;
