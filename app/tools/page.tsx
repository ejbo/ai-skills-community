import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { FileBarChart2 } from 'lucide-react';
import { auth } from '@/lib/auth';
import { loginHref } from '@/lib/auth/callback-path';
import { TOOLS } from '@/lib/tools/catalog';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('tools');
  return { title: t('title') };
}

const ICONS = { 'chat-report': FileBarChart2 } as const;

// /tools — 工具中心（导航「工具」）。目录在 lib/tools/catalog.ts，加工具只改那一处 + 这里的图标表。
export default async function ToolsPage() {
  const session = await auth();
  if (!session?.user) redirect(loginHref('/tools'));
  const t = await getTranslations('tools');
  return (
    <div className="container max-w-5xl py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">{t('subtitle')}</p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map((tool) => {
          const Icon = ICONS[tool.id];
          return (
            <li key={tool.id}>
              <Link href={tool.href} className="card-hover block h-full rounded-2xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
                  <Icon className="h-5 w-5" />
                </span>
                <h2 className="mt-3 text-base font-semibold">{t(tool.titleKey)}</h2>
                <p className="mt-1 text-sm text-muted">{t(tool.descKey)}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
