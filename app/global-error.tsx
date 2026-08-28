'use client';

import { useEffect, useState } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/locales';
import './globals.css';

/**
 * Last-ditch boundary — it only fires when the ROOT LAYOUT itself throws, which
 * is a live scenario here and not a theoretical one: `app/layout.tsx` calls
 * `auth()`, so a Prisma P2024 pool timeout under load takes the whole document
 * down before any page renders.
 *
 * Next REPLACES the layout when that happens, so ThemeProvider and
 * NextIntlClientProvider are both gone. That rules out `useTranslations` — with
 * no provider it throws, and a throw inside the last boundary leaves the raw
 * "Application error" screen we are here to avoid — and it rules out building a
 * provider by importing the catalogs, which are 238–289 KB EACH. Hence the
 * inline copy below: it is a deliberate duplicate of `common.error_title` /
 * `_desc` / `_retry` in messages/*.json and must be kept in step with them.
 * Anything richer belongs in app/error.tsx, which renders inside the layout and
 * is fully translated.
 */
const COPY: Record<Locale, { title: string; desc: string; retry: string }> = {
  'zh-CN': {
    title: '页面出错了',
    desc: '这个页面暂时没能加载出来，多半是服务器一时繁忙。稍等片刻再试通常就好了。',
    retry: '重试',
  },
  en: {
    title: 'Something went wrong',
    desc: 'This page failed to load — the server is most likely busy. Waiting a moment and retrying usually fixes it.',
    retry: 'Retry',
  },
  fr: {
    title: 'Une erreur est survenue',
    desc: "Cette page n'a pas pu se charger — le serveur est probablement surchargé. Réessayez dans un instant.",
    retry: 'Réessayer',
  },
};

/** The same cookie `lib/locales.ts` writes and `i18n/request.ts` reads. */
function readLocale(): Locale {
  const raw = /(?:^|;\s*)locale=([^;]*)/.exec(document.cookie)?.[1];
  const code = raw ? decodeURIComponent(raw) : '';
  return SUPPORTED_LOCALES.includes(code as Locale) ? (code as Locale) : 'zh-CN';
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Start on the source-of-truth locale and the light ground so the server
  // fallback and the first client render agree, then adopt the viewer's own
  // choices in an effect — the same shape ThemeProvider uses, for the same reason.
  const [locale, setLocale] = useState<Locale>('zh-CN');

  useEffect(() => {
    setLocale(readLocale());
    // ThemeProvider is gone with the layout, so re-apply its data-theme here or
    // a dark-mode reader gets a full-screen white flash on top of the failure.
    const stored = window.localStorage.getItem('theme');
    document.documentElement.dataset.theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    console.error('[global error]', error.digest ?? error.message);
  }, [error]);

  const copy = COPY[locale];

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <div className="container flex min-h-screen items-center justify-center py-12">
          <div className="w-full max-w-md">
            <div className="surface rounded-2xl p-6 text-center">
              <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-danger/10 text-danger">
                <TriangleAlert className="h-5 w-5" />
              </div>
              <h1 className="text-xl font-semibold tracking-tight">{copy.title}</h1>
              <p className="mt-3 text-sm text-muted">{copy.desc}</p>
              {error.digest ? (
                <p className="surface mt-4 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-xs text-muted">
                  {error.digest}
                </p>
              ) : null}
              <div className="mt-6 flex items-center justify-center">
                <button
                  type="button"
                  onClick={reset}
                  className="flex h-10 items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  <RotateCw className="h-4 w-4" />
                  {copy.retry}
                </button>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
