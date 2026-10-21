'use client';

// 版块报告 — 进度 / 预览 / 发布（docs/contracts/reports.md §2–§3）。
// 生成中：每 3 s 轮询 GET /reports/[id]，进度条 + 阶段文字；失败可重试。
// 完成：预览（一句话、要点、判断、主题、活动）+ 工号匹配结果（勾选合著者）+ 栏目 / 可见性 →
// 「保存为草稿并编辑」或「直接发布」。已发布：去帖子 / 打开编辑器。

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, BookOpen, CheckCircle2, ExternalLink, Loader2, RotateCcw, Users } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { pushToast } from '@/components/Toaster';
import { usePreview } from '@/components/zones/preview/PreviewProvider';
import { currentLoginHref } from '@/lib/auth/callback-path';
import type { ZoneReportDetailView } from '@/lib/zones/reports/queries';
import { zoneHref, zonePostEditHref, zonePostHref, type ZonePostVisibilityValue } from '@/lib/zones/shared';
import type { ZoneColumnView, ZonePostReportView } from '@/lib/zones/types';
import { ReportArticle } from './ReportArticle';
import { RelTime } from '../RelTime';
import { BTN_PRIMARY, BTN_SECONDARY, CARD_CLS, LABEL_CLS, PILL_MONO, SECTION_TITLE_CLS, SELECT_CLS } from '../ui';
import { VisibilityPicker } from '../post/VisibilityPicker';

const POLL_MS = 3000;
const RUNNING = new Set(['queued', 'parsing', 'clustering', 'summarizing', 'assembling', 'ingesting']);

export function ReportDetail({
  zoneSlug,
  initial,
  columns,
  currentUserId,
  canPublish,
  canModerate,
}: {
  zoneSlug: string;
  initial: ZoneReportDetailView;
  columns: ZoneColumnView[];
  currentUserId: string;
  canPublish: boolean;
  canModerate: boolean;
}) {
  const t = useTranslations('zones');
  const router = useRouter();
  const preview = usePreview();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<'retry' | 'draft' | 'published' | null>(null);
  const [columnId, setColumnId] = useState<string>('');
  const [visibility, setVisibility] = useState<ZonePostVisibilityValue>('zone');
  const [includeStats, setIncludeStats] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial.authorMatches.filter((m) => m.userId && m.userId !== currentUserId).map((m) => m.userId!)));
  const running = RUNNING.has(view.status);
  const url = `/api/zones/${encodeURIComponent(zoneSlug)}/reports/${encodeURIComponent(view.id)}`;

  useEffect(() => {
    if (!running) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const data = (await res.json().catch(() => ({}))) as { report?: ZoneReportDetailView };
        if (!stopped && data.report) {
          setView(data.report);
          if (data.report.status === 'ready') {
            setPicked(new Set(data.report.authorMatches.filter((m) => m.userId && m.userId !== currentUserId).map((m) => m.userId!)));
          }
        }
      } catch {
        /* 下一次轮询再试 */
      }
    };
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [running, url, currentUserId]);

  const matched = useMemo(() => view.authorMatches.filter((m) => m.userId), [view.authorMatches]);
  const unmatched = useMemo(() => view.authorMatches.filter((m) => !m.userId), [view.authorMatches]);

  async function retry() {
    if (busy) return;
    setBusy('retry');
    try {
      const res = await fetch(`${url}/retry`, { method: 'POST' });
      if (res.status === 401) return router.push(currentLoginHref());
      const data = (await res.json().catch(() => ({}))) as { reason?: string };
      if (!res.ok) return pushToast('error', data.reason ?? t('report_retry_failed'));
      setView((v) => ({ ...v, status: 'queued', error: null, progress: 0, stage: '' }));
    } finally {
      setBusy(null);
    }
  }

  async function publish(status: 'draft' | 'published') {
    if (busy) return;
    setBusy(status);
    try {
      const res = await fetch(`${url}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ coauthorUserIds: [...picked], columnId: columnId || null, visibility, status, includeStats }),
      });
      if (res.status === 401) return router.push(currentLoginHref());
      const data = (await res.json().catch(() => ({}))) as { id?: string; slug?: string | null; reason?: string };
      if (!res.ok || !data.id) return pushToast('error', data.reason ?? t('report_publish_failed'));
      pushToast('success', status === 'published' ? t('composer_published') : t('composer_draft_saved'));
      router.push(status === 'published' ? zonePostHref(zoneSlug, { id: data.id, slug: data.slug ?? null }) : zonePostEditHref(zoneSlug, data.id));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const r = view.report;
  // 预览用的就是帖子页那一套原生视图（ReportArticle），发布前后看到的是同一个东西。
  const nativeView = useMemo<ZonePostReportView | null>(() => {
    if (!r) return null;
    const speakers: ZonePostReportView['speakers'] = {};
    for (const m of view.authorMatches) if (m.user) speakers[m.account.toLowerCase()] = m.user;
    const librarySlugs: Record<string, string> = {};
    const urlByKey = new Map(view.assets.map((a) => [a.key, a.url]));
    for (const a of view.assets) if (a.libraryDoc) librarySlugs[a.name] = a.libraryDoc.slug;
    const assetUrls: Record<string, string> = {};
    for (const a of r.attachments) if (a.assetKey && urlByKey.has(a.assetKey)) assetUrls[a.id] = urlByKey.get(a.assetKey)!;
    return { id: view.id, report: r, speakers, librarySlugs, assetUrls };
  }, [r, view.id, view.authorMatches, view.assets]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`${zoneHref(zoneSlug)}/reports`} className="text-xs text-muted hover:text-zinc-900 dark:hover:text-zinc-50">
            ← {t('reports_title')}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{view.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className={PILL_MONO}>{t(`report_kind_${view.kind}`)}</span>
            {view.periodStart && view.periodEnd && (
              <span className="font-mono tabular-nums">
                {view.periodStart} ~ {view.periodEnd}
              </span>
            )}
            <span>·</span>
            <Avatar name={view.createdBy.displayName} src={view.createdBy.avatarUrl} size="xs" handle={view.createdBy.handle} />
            <span>{view.createdBy.displayName}</span>
            <span>·</span>
            <RelTime at={view.createdAt} />
            {view.model && <span className="font-mono text-xs">{view.model}</span>}
          </p>
        </div>
        {view.post && (
          <Link href={zonePostHref(zoneSlug, view.post)} className={BTN_PRIMARY}>
            <ExternalLink className="h-4 w-4" />
            {t('report_open_post')}
          </Link>
        )}
      </header>

      {/* 进度 */}
      <section className={`${CARD_CLS} p-5`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            {running ? <Loader2 className="h-4 w-4 animate-spin text-muted" /> : view.status === 'ready' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            <span className="font-medium">{t(`report_status_${view.status}`)}</span>
            {view.stage && <span className="text-muted">· {view.stage}</span>}
          </div>
          <span className="font-mono text-xs tabular-nums text-muted">{view.progress}%</span>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div className="h-full rounded-full bg-zinc-900 transition-[width] duration-700 dark:bg-zinc-100" style={{ width: `${Math.max(2, view.progress)}%` }} />
        </div>
        {view.status === 'failed' && (
          <div className="mt-4 flex flex-wrap items-start justify-between gap-3 text-sm">
            <p className="min-w-0 whitespace-pre-wrap break-words text-danger">{view.error ?? t('report_failed_generic')}</p>
            {canPublish && (
              <button type="button" onClick={retry} disabled={!!busy} className={BTN_SECONDARY}>
                {busy === 'retry' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                {t('report_retry')}
              </button>
            )}
          </div>
        )}
        {running && <p className="mt-3 text-xs text-muted">{t('report_running_hint')}</p>}
      </section>

      {r && nativeView && (
        <section className={`${CARD_CLS} p-5 sm:p-7`}>
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className={SECTION_TITLE_CLS}>{t('report_preview')}</h2>
            <p className="text-xs text-muted">
              {t('report_preview_counts', { events: r.events.length, recap: r.recap?.items.length ?? 0, attachments: r.attachments.filter((a) => a.assetKey).length, unassigned: r.unassigned.length })}
            </p>
          </div>
          <ReportArticle zoneSlug={zoneSlug} view={nativeView} embeds={{}} />
          {view.warnings.length > 0 && (
            <details className="mt-6 text-xs text-muted">
              <summary className="cursor-pointer">{t('report_warnings', { count: view.warnings.length })}</summary>
              <ul className="mt-2 list-disc space-y-0.5 pl-5">
                {view.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {view.assets.some((a) => a.libraryDoc) && (
        <section className={`${CARD_CLS} p-5`}>
          <h2 className={`${SECTION_TITLE_CLS} flex items-center gap-1.5`}>
            <BookOpen className="h-3.5 w-3.5" />
            {t('report_library_docs')}
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {view.assets
              .filter((a) => a.libraryDoc)
              .map((a) => (
                <li key={a.id}>
                  <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => preview.open({ kind: 'library', ref: a.libraryDoc!.slug, title: a.libraryDoc!.title, via: 'pointer' })}>
                    {a.libraryDoc!.title}
                  </button>
                  <span className="ml-2 font-mono text-xs text-muted">{a.name}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {view.authorMatches.length > 0 && (
        <section className={`${CARD_CLS} p-5`}>
          <h2 className={`${SECTION_TITLE_CLS} flex items-center gap-1.5`}>
            <Users className="h-3.5 w-3.5" />
            {t('report_authors')}
          </h2>
          <p className="mt-1 text-xs text-muted">{t('report_authors_hint')}</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {matched.map((m) => {
              const on = picked.has(m.userId!);
              const self = m.userId === currentUserId;
              return (
                <li key={m.account}>
                  <label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm ${on ? 'border-zinc-900 dark:border-zinc-100' : 'border-zinc-200 dark:border-zinc-800'} ${self ? 'opacity-60' : ''}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={self || !!view.post}
                      onChange={(e) =>
                        setPicked((p) => {
                          const next = new Set(p);
                          if (e.target.checked) next.add(m.userId!);
                          else next.delete(m.userId!);
                          return next;
                        })
                      }
                      className="h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
                    />
                    {m.user && <Avatar name={m.user.displayName} src={m.user.avatarUrl} size="xs" handle={m.user.handle} />}
                    <span className="min-w-0 flex-1 truncate">
                      {m.user?.displayName ?? m.name}
                      {m.user && <DeptTag department={m.user.department} lab={m.user.lab} />}
                    </span>
                    <span className="font-mono text-xs text-muted">
                      {m.account} · {m.count}
                    </span>
                    {self && <span className={PILL_MONO}>{t('report_author_self')}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
          {unmatched.length > 0 && (
            <p className="mt-3 text-xs text-muted">
              {t('report_authors_unmatched')}
              {unmatched.map((m) => `${m.name}（${m.account}）`).join('、')}
            </p>
          )}
        </section>
      )}

      {r && !view.post && canPublish && (
        <section className={`${CARD_CLS} p-5`}>
          <h2 className={SECTION_TITLE_CLS}>{t('report_publish')}</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLS} htmlFor="report-column">
                {t('hub_filter_columns')}
              </label>
              <select id="report-column" value={columnId} onChange={(e) => setColumnId(e.target.value)} className={`${SELECT_CLS} w-full`}>
                <option value="">{t('composer_column_none')}</option>
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>{t('visibility_label')}</label>
              <VisibilityPicker value={visibility} onChange={setVisibility} />
            </div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeStats} onChange={(e) => setIncludeStats(e.target.checked)} className="h-4 w-4 accent-zinc-900 dark:accent-zinc-100" />
            {t('report_include_stats')}
          </label>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => publish('draft')} disabled={!!busy} className={BTN_SECONDARY}>
              {busy === 'draft' && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('report_publish_draft')}
            </button>
            <button type="button" onClick={() => publish('published')} disabled={!!busy || (!canPublish && !canModerate)} className={BTN_PRIMARY}>
              {busy === 'published' && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('report_publish_now')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
