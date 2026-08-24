import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { withBasePath } from '@/lib/base-path';
import { canonicalRedirectTarget } from '@/lib/auth/cookies';
import { env } from '@/lib/env';

// Self-hosted variable fonts (committed woff2, latin subset — CJK falls back to
// system fonts as before). next/font/google fetches from Google AT BUILD TIME,
// which fails on the intranet box (corporate TLS-intercepting proxy → "self-signed
// certificate in certificate chain"). Local files make builds fully offline.
const geistSans = localFont({
  src: './fonts/inter-var-latin.woff2',
  weight: '100 900',
  variable: '--font-geist-sans',
  display: 'swap',
});
const geistMono = localFont({
  src: './fonts/jetbrains-mono-var-latin.woff2',
  weight: '100 800',
  variable: '--font-geist-mono',
  display: 'swap',
});
import { getLocale, getMessages } from 'next-intl/server';
import { ThemeProvider } from '@/components/ThemeProvider';
import { AuthProvider } from '@/components/AuthProvider';
import { NavBar } from '@/components/NavBar';
import { Toaster } from '@/components/Toaster';
import { VisitTracker } from '@/components/VisitTracker';
import { auth } from '@/lib/auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Community',
  description: 'Share, discover and install AI agent skills. Watch geek videos.',
  // withBasePath so the tab icon resolves under the /ai-community subpath deploy.
  icons: { icon: withBasePath('/CARI_tab_Logo.png') },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Canonical-host backstop (SSO deploys only): the shared server block still
  // answers on its pre-2026-07 hostname alias, but auth cookies are HOST-scoped
  // while AUTH_URL pins the OAuth callback to the canonical host — a login
  // started on the alias dies at the callback ("InvalidCheck: state value could
  // not be parsed"). Bounce alias-served documents to the canonical origin
  // BEFORE a login can start. nginx does this too (with full-path fidelity);
  // this survives nginx drift. Loopback/IP hosts are exempt (smoke tests).
  const canonicalTarget = canonicalRedirectTarget({
    enableSso: env.ENABLE_SSO,
    authUrl: env.AUTH_URL,
    requestHost: headers().get('host'),
    basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  });
  if (canonicalTarget) redirect(canonicalTarget);

  const [locale, messages, session] = await Promise.all([
    getLocale(),
    getMessages(),
    auth(),
  ]);

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>
          <AuthProvider session={session}>
            <NextIntlClientProvider locale={locale} messages={messages}>
              <NavBar session={session} />
              <main className="min-h-[calc(100vh-64px)]">{children}</main>
              <Toaster />
              <VisitTracker enabled={Boolean(session?.user)} />
            </NextIntlClientProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
