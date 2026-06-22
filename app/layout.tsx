import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';

const geistSans = Inter({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
});
const geistMono = JetBrains_Mono({
  subsets: ['latin'],
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
  icons: { icon: '/favicon.ico' },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
