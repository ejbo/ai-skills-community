import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { FileBarChart2 } from 'lucide-react';
import { auth } from '@/lib/auth';
import { loginHref } from '@/lib/auth/callback-path';
import { can } from '@/lib/permissions';
import { listMyReports } from '@/lib/zones/reports/queries';
import { ReportList } from '@/components/reports/ReportList';
import { BTN_PRIMARY } from '@/app/zones/_components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('tools');
  return { title: t('chat_report_title') };
}

// /tools/chat-report — 我的报告 + 新建。
export default async function ChatReportToolPage() {
  const session = await auth();
  if (!session?.user) redirect(loginHref('/tools/chat-report'));
  const t = await getTranslations('tools');
  const items = await listMyReports(session.user.id, can(session.user, 'identity'));
  return (
    <div className="container py-8">
      <Link href="/tools" className="text-xs text-muted hover:text-zinc-900 dark:hover:text-zinc-50">
        ← {t('title')}
      </Link>
      <div className="mt-2 mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('chat_report_title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t('chat_report_desc')}</p>
        </div>
        <Link href="/tools/chat-report/new" className={BTN_PRIMARY}>
          <FileBarChart2 className="h-4 w-4" />
          {t('chat_report_new')}
        </Link>
      </div>
      <ReportList items={items} />
    </div>
  );
}
