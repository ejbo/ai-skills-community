'use client';

// 「聊天记录 → 报告」工具 — 报告详情（docs/contracts/reports.md §3）：
//   进度（3 s 轮询 GET /api/tools/chat-report/[id]）→ 预览（和帖子页 / 分享页同一个 ReportArticle）
//   → 导出 Word / PDF → 分享页（可见范围：公开 / 隐藏 / 指定成员，链接复制）
//   → 分享到技术专区（选版块 → 栏目 / 作者 / 可见范围 → 草稿或发布；已分享就显示帖子链接）→ 删除。
// 所有者（创建者 / 站级 zones 管理员）才看到设置与分享；别人（名单上的人、公开）只看预览与导出。

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Copy, Download, ExternalLink, FileText, Link2, Loader2, RotateCcw, Share2, Trash2, Users } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { pushToast } from '@/components/Toaster';
import { VisibilityBadge } from '@/components/audience/VisibilityBadge';
import { VisibilityField } from '@/components/audience/VisibilityField';
import type { AudiencePick, ContentVisibility } from '@/lib/audience-shared';
import { currentLoginHref } from '@/lib/auth/callback-path';
import { withBasePath } from '@/lib/base-path';
import type { ZoneReportDetailView } from '@/lib/zones/reports/queries';
import { zonePostEditHref, zonePostHref, type ZonePostVisibilityValue } from '@/lib/zones/shared';
import type { ZoneCardView, ZoneColumnView, ZonePostReportView } from '@/lib/zones/types';
import { RelTime } from '@/app/zones/_components/RelTime';
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, CARD_CLS, INPUT_CLS, LABEL_CLS, PILL_MONO, SECTION_TITLE_CLS, SELECT_CLS } from '@/app/zones/_components/ui';
import { VisibilityPicker } from '@/app/zones/_components/post/VisibilityPicker';
import { ReportArticle } from './ReportArticle';
import { ReportAssets } from './ReportAssets';
import { ReportCoauthors } from './ReportCoauthors';
import { ReportReader } from './report-view';

const POLL_MS = 3000;
const RUNNING = new Set(['queued', 'parsing', 'clustering', 'summarizing', 'assembling', 'ingesting']);

export function reportPageHref(r: { id: string; slug: string | null }): string {
  return `/reports/${encodeURIComponent(r.slug ?? r.id)}`;
}

export function ReportDetail({
  initial,
  currentUser,
  isOwner,
}: {
  initial: ZoneReportDetailView;
  currentUser: { id: string; handle: string | null };
  /** 创建者或站级 zones 管理员：设置 / 分享 / 删除。 */
  isOwner: boolean;
}) {
  const t = useTranslations('zones');
  const tt = useTranslations('tools');
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const running = RUNNING.has(view.status);
  const url = `/api/tools/chat-report/${encodeURIComponent(view.id)}`;

  // 分享页
  const [visibility, setVisibility] = useState<ContentVisibility>(initial.visibility);
  const [audience, setAudience] = useState<AudiencePick[]>(initial.audience);
  const [title, setTitle] = useState(initial.title);
  // 分享页链接地址（/reports/<slug>）：所有者可改；空着保存 = 按标题重新生成拼音 slug
  const [slugInput, setSlugInput] = useState(initial.slug ?? '');
  const [slugDirty, setSlugDirty] = useState(false);

  // 分享到技术专区
  const [zones, setZones] = useState<ZoneCardView[] | null>(null);
  const [zoneSlug, setZoneSlug] = useState('');
  const [columns, setColumns] = useState<ZoneColumnView[]>([]);
  const [columnId, setColumnId] = useState('');
  const [postVisibility, setPostVisibility] = useState<ZonePostVisibilityValue>('zone');
  const [includeStats, setIncludeStats] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial.authorMatches.filter((m) => m.userId && m.userId !== currentUser.id).map((m) => m.userId!)));

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
            setPicked(new Set(data.report.authorMatches.filter((m) => m.userId && m.userId !== currentUser.id).map((m) => m.userId!)));
            setTitle(data.report.title);
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
  }, [running, url, currentUser.id]);

  // 我的版块（分享用）
  useEffect(() => {
    if (!isOwner || view.post || zones !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/zones?mine=1&pageSize=100');
        const data = (await res.json().catch(() => ({}))) as { items?: ZoneCardView[] };
        if (!cancelled) setZones(data.items ?? []);
      } catch {
        if (!cancelled) setZones([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner, view.post, zones]);

  useEffect(() => {
    setColumns([]);
    setColumnId('');
    if (!zoneSlug) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/zones/${encodeURIComponent(zoneSlug)}/columns`);
        const data = (await res.json().catch(() => ({}))) as { items?: ZoneColumnView[] };
        if (!cancelled) setColumns(data.items ?? []);
      } catch {
        /* 没栏目也能发 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [zoneSlug]);

  const matched = useMemo(() => view.authorMatches.filter((m) => m.userId), [view.authorMatches]);
  const unmatched = useMemo(() => view.authorMatches.filter((m) => !m.userId), [view.authorMatches]);
  const r = view.report;
  const nativeView = useMemo<ZonePostReportView | null>(() => {
    if (!r) return null;
    const speakers: ZonePostReportView['speakers'] = {};
    for (const m of view.authorMatches) if (m.user) speakers[m.account.toLowerCase()] = m.user;
    const librarySlugs: Record<string, string> = {};
    const urlByKey = new Map(view.assets.map((a) => [a.key, a.url]));
    for (const a of view.assets) if (a.libraryDoc) librarySlugs[a.name] = a.libraryDoc.slug;
    const assetUrls: Record<string, string> = {};
    for (const a of r.attachments) if (a.assetKey && urlByKey.has(a.assetKey)) assetUrls[a.id] = urlByKey.get(a.assetKey)!;
    return { id: view.id, slug: view.slug, report: r, speakers, librarySlugs, assetUrls };
  }, [r, view.id, view.slug, view.authorMatches, view.assets]);
  const pageHref = reportPageHref(view);

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

  async function saveSettings() {
    if (busy) return;
    setBusy('settings');
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim() || undefined, visibility, audienceUserIds: audience.map((a) => a.userId), ...(slugDirty ? { slug: slugInput.trim() } : {}) }),
      });
      if (res.status === 401) return router.push(currentLoginHref());
      const data = (await res.json().catch(() => ({}))) as { reason?: string };
      if (!res.ok) return pushToast('error', data.reason ?? tt('report_settings_failed'));
      pushToast('success', tt('report_settings_saved'));
      const fresh = await fetch(url).then((x) => x.json()).catch(() => null);
      if (fresh?.report) {
        setView(fresh.report);
        setSlugInput(fresh.report.slug ?? '');
        setSlugDirty(false);
      }
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(withBasePath(pageHref), window.location.origin).toString());
      pushToast('success', tt('report_link_copied'));
    } catch {
      pushToast('error', tt('report_link_copy_failed'));
    }
  }

  async function exportAs(format: 'docx' | 'pdf') {
    if (busy) return;
    setBusy(`export-${format}`);
    try {
      const res = await fetch(`${url}/export?format=${format}`);
      if (res.status === 501) return pushToast('error', tt('report_export_pdf_unavailable'));
      if (!res.ok) return pushToast('error', tt('report_export_failed'));
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') ?? '';
      const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
      const name = m ? decodeURIComponent(m[1]) : `report.${format}`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch {
      pushToast('error', tt('report_export_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function publish(status: 'draft' | 'published') {
    if (busy || !zoneSlug) return;
    setBusy(status);
    try {
      const res = await fetch(`${url}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ zoneSlug, coauthorUserIds: [...picked], columnId: columnId || null, visibility: postVisibility, status, includeStats }),
      });
      if (res.status === 401) return router.push(currentLoginHref());
      const data = (await res.json().catch(() => ({}))) as { id?: string; slug?: string | null; zoneSlug?: string; reason?: string };
      if (!res.ok || !data.id) return pushToast('error', data.reason ?? t('report_publish_failed'));
      pushToast('success', status === 'published' ? t('composer_published') : t('composer_draft_saved'));
      const zs = data.zoneSlug ?? zoneSlug;
      router.push(status === 'published' ? zonePostHref(zs, { id: data.id, slug: data.slug ?? null }) : zonePostEditHref(zs, data.id));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (busy) return;
    if (!window.confirm(tt('report_delete_confirm'))) return;
    setBusy('delete');
    try {
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) return pushToast('error', tt('report_delete_failed'));
      router.push('/tools/chat-report');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/tools/chat-report" className="text-xs text-muted hover:text-zinc-900 dark:hover:text-zinc-50">
            ← {tt('chat_report_title')}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{view.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className={PILL_MONO}>{t(`report_kind_${view.kind}`)}</span>
            <VisibilityBadge visibility={view.visibility} />
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
        <div className="flex flex-wrap gap-2">
          {view.status === 'ready' && (
            <Link href={pageHref} className={BTN_SECONDARY}>
              <Link2 className="h-4 w-4" />
              {tt('report_open_page')}
            </Link>
          )}
          {view.post && (
            <Link href={zonePostHref(view.post.zoneSlug, view.post)} className={BTN_PRIMARY}>
              <ExternalLink className="h-4 w-4" />
              {t('report_open_post')}
            </Link>
          )}
        </div>
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
          <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm">
            <p className="min-w-0 flex-1 break-words text-danger">{view.error ?? t('report_failed_generic')}</p>
            {isOwner && (
              <button type="button" onClick={retry} disabled={!!busy} className={BTN_SECONDARY}>
                {busy === 'retry' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                {t('report_retry')}
              </button>
            )}
          </div>
        )}
        {running && <p className="mt-3 text-xs text-muted">{t('report_running_hint')}</p>}
        {view.instructions && (
          <details className="mt-3 text-xs text-muted">
            <summary className="cursor-pointer">{tt('report_instructions_used', { mode: view.instructionMode === 'override' ? t('report_instructions_override') : t('report_instructions_append') })}</summary>
            <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">{view.instructions}</pre>
          </details>
        )}
      </section>

      {/* 导出 */}
      {r && (
        <section className={`${CARD_CLS} flex flex-wrap items-center gap-3 p-5`}>
          <h2 className={`${SECTION_TITLE_CLS} mr-auto`}>{tt('report_export')}</h2>
          <button type="button" onClick={() => exportAs('docx')} disabled={!!busy} className={BTN_SECONDARY}>
            {busy === 'export-docx' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Word
          </button>
          <button type="button" onClick={() => exportAs('pdf')} disabled={!!busy} className={BTN_SECONDARY}>
            {busy === 'export-pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            PDF
          </button>
        </section>
      )}

      {/* 预览 */}
      {r && nativeView && (
        <section className={`${CARD_CLS} p-5 sm:p-7`}>
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className={SECTION_TITLE_CLS}>{t('report_preview')}</h2>
            <p className="text-xs text-muted">
              {t('report_preview_counts', { events: r.events.length, recap: r.recap?.items.length ?? 0, attachments: r.attachments.filter((a) => a.assetKey).length, unassigned: r.unassigned.length })}
            </p>
          </div>
          <ReportReader report={r} speakers={nativeView.speakers}>
            <ReportArticle view={nativeView} embeds={{}} />
          </ReportReader>
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

      {/* 附件：留在报告里；所有者按需分享到知识库 */}
      {r && <ReportAssets reportId={view.id} assets={view.assets} isOwner={isOwner} onChange={(assets) => setView((v) => ({ ...v, assets }))} />}

      {/* 合著者：分享到版块之后随时改 */}
      {isOwner && view.post && (
        <ReportCoauthors
          key={view.post.id}
          reportId={view.id}
          matched={matched}
          initial={view.post.coauthors}
          currentUser={currentUser}
          onSaved={(next) => setView((v) => (v.post ? { ...v, post: { ...v.post, coauthors: next } } : v))}
        />
      )}

      {/* 分享页设置 */}
      {isOwner && (
        <section className={`${CARD_CLS} p-5`}>
          <h2 className={`${SECTION_TITLE_CLS} flex items-center gap-1.5`}>
            <Link2 className="h-3.5 w-3.5" />
            {tt('report_share_page')}
          </h2>
          <p className="mt-1 text-xs text-muted">{tt('report_share_page_hint')}</p>
          <div className="mt-3">
            <label className={LABEL_CLS} htmlFor="report-title">
              {t('report_title')}
            </label>
            <input id="report-title" value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT_CLS} maxLength={120} />
          </div>
          <div className="mt-4">
            <VisibilityField visibility={visibility} onVisibilityChange={setVisibility} audience={audience} onAudienceChange={setAudience} selfHandle={currentUser.handle} />
          </div>
          <div className="mt-4">
            <label className={LABEL_CLS} htmlFor="report-slug">
              {tt('report_slug_label')}
            </label>
            <div className="flex items-center gap-0 overflow-hidden rounded-lg border border-zinc-300 focus-within:border-zinc-900 dark:border-zinc-700 dark:focus-within:border-zinc-100">
              <span className="shrink-0 border-r border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs text-muted dark:border-zinc-800 dark:bg-zinc-900">/reports/</span>
              <input
                id="report-slug"
                value={slugInput}
                onChange={(e) => {
                  setSlugInput(e.target.value);
                  setSlugDirty(true);
                }}
                className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-xs outline-none"
                maxLength={120}
                placeholder={tt('report_slug_placeholder')}
                spellCheck={false}
              />
            </div>
            <p className="mt-1 text-[11px] text-muted">{tt('report_slug_hint')}</p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-zinc-50 px-3 py-2 font-mono text-xs dark:bg-zinc-900">{pageHref}</code>
            <button type="button" onClick={copyLink} className={BTN_SECONDARY}>
              <Copy className="h-4 w-4" />
              {tt('report_copy_link')}
            </button>
            <button type="button" onClick={saveSettings} disabled={!!busy} className={BTN_PRIMARY}>
              {busy === 'settings' && <Loader2 className="h-4 w-4 animate-spin" />}
              {tt('report_save_settings')}
            </button>
          </div>
        </section>
      )}

      {/* 分享到技术专区 */}
      {isOwner && r && !view.post && (
        <section className={`${CARD_CLS} p-5`}>
          <h2 className={`${SECTION_TITLE_CLS} flex items-center gap-1.5`}>
            <Share2 className="h-3.5 w-3.5" />
            {tt('report_share_zone')}
          </h2>
          <p className="mt-1 text-xs text-muted">{tt('report_share_zone_hint')}</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLS} htmlFor="report-zone">
                {tt('report_target_zone')}
              </label>
              <select id="report-zone" value={zoneSlug} onChange={(e) => setZoneSlug(e.target.value)} className={`${SELECT_CLS} w-full`}>
                <option value="">{zones === null ? '…' : tt('report_pick_zone')}</option>
                {(zones ?? []).map((z) => (
                  <option key={z.id} value={z.slug}>
                    {z.name}
                  </option>
                ))}
              </select>
              {zones !== null && zones.length === 0 && <p className="mt-1 text-xs text-muted">{tt('report_no_zones')}</p>}
            </div>
            <div>
              <label className={LABEL_CLS} htmlFor="report-column">
                {t('hub_filter_columns')}
              </label>
              <select id="report-column" value={columnId} onChange={(e) => setColumnId(e.target.value)} className={`${SELECT_CLS} w-full`} disabled={!zoneSlug}>
                <option value="">{t('composer_column_none')}</option>
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL_CLS}>{t('visibility_label')}</label>
              <VisibilityPicker value={postVisibility} onChange={setPostVisibility} />
            </div>
          </div>

          {matched.length > 0 && (
            <div className="mt-4">
              <h3 className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                <Users className="h-3.5 w-3.5" />
                {t('report_authors')}
              </h3>
              <p className="mt-1 text-xs text-muted">{t('report_authors_hint')}</p>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {matched.map((m) => {
                  const on = picked.has(m.userId!);
                  const self = m.userId === currentUser.id;
                  return (
                    <li key={m.account}>
                      <label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm ${on ? 'border-zinc-900 dark:border-zinc-100' : 'border-zinc-200 dark:border-zinc-800'} ${self ? 'opacity-60' : ''}`}>
                        <input
                          type="checkbox"
                          checked={on || self}
                          disabled={self}
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
                <p className="mt-2 text-xs text-muted">
                  {t('report_authors_unmatched')}
                  {unmatched.map((m) => `${m.name}（${m.account}）`).join('、')}
                </p>
              )}
            </div>
          )}

          <label className="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeStats} onChange={(e) => setIncludeStats(e.target.checked)} className="h-4 w-4 accent-zinc-900 dark:accent-zinc-100" />
            {t('report_include_stats')}
          </label>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => publish('draft')} disabled={!!busy || !zoneSlug} className={BTN_SECONDARY}>
              {busy === 'draft' && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('report_publish_draft')}
            </button>
            <button type="button" onClick={() => publish('published')} disabled={!!busy || !zoneSlug} className={BTN_PRIMARY}>
              {busy === 'published' && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('report_publish_now')}
            </button>
          </div>
        </section>
      )}

      {isOwner && (
        <div className="flex justify-end">
          <button type="button" onClick={remove} disabled={!!busy} className={BTN_DANGER}>
            {busy === 'delete' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {tt('report_delete')}
          </button>
        </div>
      )}
    </div>
  );
}
