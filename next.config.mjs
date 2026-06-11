import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

// Subpath deploy: set NEXT_BASE_PATH (e.g. "/community") at build time when the app is
// reverse-proxied under a path on a shared host (e.g. ai4news.rnd.huawei.com/community).
// Leave unset for root / local dev. Must start with "/" and have NO trailing slash, and
// stay in sync with AUTH_URL + the nginx location — see docs/huawei-sso-deploy.md.
const basePath = process.env.NEXT_BASE_PATH || '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(basePath ? { basePath } : {}),
  // Expose the base path to client code so render-time helpers (withBasePath in
  // lib/base-path.ts and lib/video/types.ts) prefix root-relative media URLs
  // correctly. Deriving it here means a single NEXT_BASE_PATH drives both Next's
  // routing basePath and client-side URL prefixing — no separate var to forget.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  experimental: {
    serverActions: {
      bodySizeLimit: '6mb',
    },
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
};

export default withNextIntl(nextConfig);
