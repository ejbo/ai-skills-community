'use client';

// 报告阅读态（docs/contracts/reports.md §3a「阅读布局」）——三处渲染 ReportArticle 的页面（工具详情 / 分享页 / 版块帖子）
// 共用的三样东西：
//   ReportViewProvider  专题时间线的展开状态（默认全部收起：先看每个专题的定位 + 宏观总结 + 启示，再按需展开观点）；
//                       右栏的「全部展开 / 收起」和每个专题自己的按钮改的是同一份状态。没有 provider 时一律展开（兼容老调用）。
//   ReportMeta          标题下那行：日报 / 周报 / 月报 · 起止日期 · N 条消息 · N 位发言人 · N 个专题——
//                       owner 2026-10-21：「现在只显示一个月报，却不知道是几月的」。
//   ReportReader        正文 + 右栏（目录 / 展开收起 / 页面自己塞的段落 / 回到顶部）的网格；
//                       右栏在 lg 起出现，dock 打开（band narrow）时让位给正文。

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUp, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { usePageBand } from '@/components/zones/preview/PreviewProvider';
import { reportHeadings } from '@/lib/zones/reports/sections';
import type { Report } from '@/lib/zones/reports/schema';
import { PostToc } from '@/app/zones/_components/post/PostToc';

interface ReportViewState {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  setAll: (open: boolean) => void;
  /** 有没有一个是收起的（右栏按钮用来决定显示「全部展开」还是「全部收起」）。 */
  anyClosed: boolean;
}

const Ctx = createContext<ReportViewState | null>(null);

export function ReportViewProvider({ themeIds, defaultOpen = false, children }: { themeIds: string[]; defaultOpen?: boolean; children: ReactNode }) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set(defaultOpen ? [] : themeIds));
  const value = useMemo<ReportViewState>(
    () => ({
      isOpen: (id) => !closed.has(id),
      toggle: (id) =>
        setClosed((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      setAll: (open) => setClosed(new Set(open ? [] : themeIds)),
      anyClosed: themeIds.some((id) => closed.has(id)),
    }),
    [closed, themeIds],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const ALL_OPEN: ReportViewState = { isOpen: () => true, toggle: () => {}, setAll: () => {}, anyClosed: false };

export function useReportView(): ReportViewState & { provided: boolean } {
  const ctx = useContext(Ctx);
  return { ...(ctx ?? ALL_OPEN), provided: !!ctx };
}

/** 标题下的一行：类型 · 起止 · 消息 / 发言人 / 专题。`className` 给调用方定字号。 */
export function ReportMeta({ report, className = '' }: { report: Report; className?: string }) {
  const t = useTranslations('zones');
  const st = report.stats;
  return (
    <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted ${className}`}>
      <span className="rounded-md border border-zinc-900 px-1.5 py-px font-semibold text-zinc-900 dark:border-zinc-100 dark:text-zinc-100">{t(`report_kind_tag_${report.kind}`)}</span>
      <span className="text-zinc-900 dark:text-zinc-100">
        {report.period.start} ~ {report.period.end}
      </span>
      {report.period.label && <span>（{report.period.label}）</span>}
      <span aria-hidden>·</span>
      <span>
        {t('report_stat_messages')} {st.messages}
      </span>
      <span aria-hidden>·</span>
      <span>
        {t('report_stat_speakers')} {st.speakers}
      </span>
      <span aria-hidden>·</span>
      <span>
        {t('report_col_theme')} {report.themes.length}
      </span>
    </p>
  );
}

/** 右栏的「全部展开 / 全部收起」。 */
export function ExpandAllButton({ className = '' }: { className?: string }) {
  const t = useTranslations('zones');
  const view = useReportView();
  if (!view.provided) return null;
  const open = view.anyClosed;
  return (
    <button
      type="button"
      onClick={() => view.setAll(open)}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 transition hover:border-zinc-900 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-100 dark:hover:text-zinc-100 ${className}`}
    >
      {open ? <ChevronsUpDown className="h-3.5 w-3.5" /> : <ChevronsDownUp className="h-3.5 w-3.5" />}
      {open ? t('report_expand_all') : t('report_collapse_all')}
    </button>
  );
}

/**
 * 报告的右栏：目录（本期要点 → 各专题 → 活动 / Recap / 资料 / 数据，随阅读位置高亮）→ 全部展开 / 收起 →
 * 调用方塞进来的段落（作者、评论按钮…）→ 回到顶部。sticky；只在 lg 起渲染（调用方控制）。
 */
export function ReportRail({ report, articleRef, children, className = '' }: { report: Report; articleRef?: RefObject<HTMLElement>; children?: ReactNode; className?: string }) {
  const t = useTranslations('zones');
  const headings = useMemo(() => reportHeadings(report), [report]);
  const toTop = useCallback(() => window.scrollTo({ top: 0, behavior: 'smooth' }), []);
  return (
    <div className={`sticky top-24 space-y-6 ${className}`}>
      <PostToc headings={headings} articleRef={articleRef} />
      <div className="flex flex-wrap items-center gap-2">
        <ExpandAllButton />
        <button
          type="button"
          onClick={toTop}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 transition hover:border-zinc-900 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-100 dark:hover:text-zinc-100"
        >
          <ArrowUp className="h-3.5 w-3.5" />
          {t('report_back_to_top')}
        </button>
      </div>
      {children}
    </div>
  );
}

/**
 * 正文 + 右栏的网格。`rail` 是右栏里目录之后的段落；`railHidden` 时（dock 打开）右栏整个不渲染、正文占满。
 * 调用方把 ReportViewProvider 包在外面（或由这里包：`themeIds` 给了就包）。
 */
export function ReportReader({ report, children, rail, articleRef, className = '' }: { report: Report; children: ReactNode; rail?: ReactNode; articleRef?: RefObject<HTMLElement>; className?: string }) {
  const band = usePageBand();
  const innerRef = useRef<HTMLElement>(null);
  const ref = articleRef ?? innerRef;
  const themeIds = useMemo(() => report.themes.map((t) => t.id), [report.themes]);
  const wide = band === 'wide';
  return (
    <ReportViewProvider themeIds={themeIds}>
      <div className={`grid grid-cols-1 gap-10 ${wide ? 'lg:grid-cols-[minmax(0,1fr)_240px]' : ''} ${className}`} data-report-band={band}>
        <article ref={ref} className="min-w-0">
          {children}
        </article>
        {wide && (
          <aside className="hidden lg:block">
            <ReportRail report={report} articleRef={ref}>
              {rail}
            </ReportRail>
          </aside>
        )}
      </div>
    </ReportViewProvider>
  );
}
