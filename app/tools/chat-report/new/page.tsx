import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { loginHref } from '@/lib/auth/callback-path';
import { ReportWizard } from '@/components/reports/ReportWizard';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('tools');
  return { title: t('chat_report_new') };
}

// 新建报告向导：上传整个目录 / zip → 补充要求 → 建任务 → 详情页。
export default async function NewChatReportPage() {
  const session = await auth();
  if (!session?.user) redirect(loginHref('/tools/chat-report/new'));
  const t = await getTranslations('tools');
  const tz = await getTranslations('zones');
  return (
    <div className="container py-8">
      <Link href="/tools/chat-report" className="text-xs text-muted hover:text-zinc-900 dark:hover:text-zinc-50">
        ← {t('chat_report_title')}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t('chat_report_new')}</h1>
      <p className="mt-1 mb-6 max-w-2xl text-sm text-muted">{tz('reports_new_subtitle')}</p>
      <ReportWizard />
    </div>
  );
}
