'use client';

// 报告的附件（工具详情页）：列出上传进来的图片 / 文件，知识库状态，以及所有者的「分享到知识库」。
// 附件默认只留在报告里（owner 2026-10-21：「月报里的内容直接发到 library 会变得很乱」）；点一下才收录。

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BookOpen, FileText, ImageIcon, Loader2, Paperclip } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import type { ZoneReportAssetView } from '@/lib/zones/reports/queries';
import { isLibraryIngestible } from '@/lib/zones/reports/library-shared';
import { BTN_SECONDARY, CARD_CLS, SECTION_TITLE_CLS } from '@/app/zones/_components/ui';

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function ReportAssets({ reportId, assets, isOwner, onChange }: { reportId: string; assets: ZoneReportAssetView[]; isOwner: boolean; onChange: (next: ZoneReportAssetView[]) => void }) {
  const t = useTranslations('tools');
  const [busy, setBusy] = useState<string | null>(null);
  if (!assets.length) return null;
  const files = assets.filter((a) => a.kind !== 'image');
  const images = assets.filter((a) => a.kind === 'image');

  const share = async (a: ZoneReportAssetView) => {
    setBusy(a.id);
    try {
      const res = await fetch(`/api/tools/chat-report/${reportId}/assets/${a.id}/library`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { docId?: string; slug?: string; existing?: boolean; reason?: string };
      if (!res.ok || !data.docId || !data.slug) return pushToast('error', data.reason ?? t('report_asset_share_failed'));
      pushToast('success', data.existing ? t('report_asset_share_existing') : t('report_asset_shared'));
      onChange(assets.map((x) => (x.id === a.id ? { ...x, libraryDoc: { id: data.docId!, slug: data.slug!, title: x.name } } : x)));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={`${CARD_CLS} p-5`}>
      <h2 className={`${SECTION_TITLE_CLS} flex items-center gap-2`}>
        <Paperclip className="h-4 w-4 text-muted" />
        {t('report_assets_title', { count: assets.length })}
      </h2>
      <p className="mt-1 text-xs text-muted">{t('report_assets_hint')}</p>
      {files.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
          {files.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-muted" />
              <a href={withBasePath(a.url)} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate hover:underline" title={a.name}>
                {a.name}
              </a>
              <span className="font-mono text-xs text-muted">{fmtSize(a.sizeBytes)}</span>
              {a.libraryDoc ? (
                <Link href={`/library/${encodeURIComponent(a.libraryDoc.slug)}`} className="inline-flex items-center gap-1 rounded-md border border-zinc-900 px-1.5 py-0.5 text-xs font-medium text-zinc-900 dark:border-zinc-100 dark:text-zinc-100">
                  <BookOpen className="h-3 w-3" />
                  {t('report_asset_in_library')}
                </Link>
              ) : isOwner && isLibraryIngestible(a.name, '') ? (
                <button type="button" onClick={() => share(a)} disabled={busy === a.id} className={`${BTN_SECONDARY} h-7 px-2 text-xs`}>
                  {busy === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
                  {t('report_asset_share')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {images.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
          <ImageIcon className="h-3.5 w-3.5" />
          {t('report_assets_images', { count: images.length })}
        </p>
      )}
    </section>
  );
}
