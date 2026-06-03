import Link from 'next/link';
import { Clapperboard } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/admin';

export default async function VideosLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const t = await getTranslations('video');

  return (
    <div>
      <div className="border-b border-zinc-100 dark:border-zinc-800/60">
        <div className="container flex h-12 items-center">
          <Link
            href="/videos"
            className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight transition-colors hover:text-accent-600"
          >
            <Clapperboard className="h-4 w-4 text-accent-500" />
            {t('nav')}
          </Link>
        </div>
      </div>
      {children}
    </div>
  );
}
