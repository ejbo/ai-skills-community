'use client';

// 报告阅读态（docs/contracts/reports.md §3a「阅读布局」）——三处渲染 ReportArticle 的页面（工具详情 / 分享页 / 版块帖子）
// 共用的三样东西：
//   ReportViewProvider  专题时间线的展开状态（默认全部收起：先看每个专题的定位 + 宏观总结 + 启示，再按需展开观点）；
//                       右栏的「全部展开 / 收起」和每个专题自己的按钮改的是同一份状态。没有 provider 时一律展开（兼容老调用）。
//   ReportMeta          标题下那行：日报 / 周报 / 月报 · 起止日期 · N 条消息 · N 位发言人 · N 个专题——
//                       owner 2026-10-21：「现在只显示一个月报，却不知道是几月的」。
//   ReportReader        正文 + 右栏（目录 / 展开收起 / 页面自己塞的段落 / 回到顶部）的网格；
//                       右栏在 lg 起出现，dock 打开（band narrow）时让位给正文。

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { useReducedMotion } from 'framer-motion';
import { ArrowUp, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { usePageBand } from '@/components/zones/preview/PreviewProvider';
import { reportHeadings } from '@/lib/zones/reports/sections';
import type { Report } from '@/lib/zones/reports/schema';
import { activeHeadingFor, TOP_OFFSET_PX } from '@/app/zones/_components/post/PostToc';

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

interface TocEntry {
  id: string;
  num: string | null;
  text: string;
}

/** reportHeadings 的「NN 标题」拆成 编号 + 标题；非专题条目没有编号。 */
export function reportTocEntries(report: Report): TocEntry[] {
  return reportHeadings(report).map((h) => {
    const m = /^t\d+$/.test(h.id) ? /^(\d{2}) (.*)$/.exec(h.text) : null;
    return { id: h.id, num: m ? m[1] : null, text: m ? m[2] : h.text };
  });
}

/**
 * 报告目录：编号单独一个等宽小块、标题完整显示（不截断，最多折两行），随阅读位置高亮。
 * owner 2026-10-21：「目录被夹断了，要显示完整；01、02 这些要和后面的标题区分开」。
 */
export function ReportToc({ report, className = '' }: { report: Report; className?: string }) {
  const t = useTranslations('zones');
  const reduce = useReducedMotion();
  const entries = useMemo(() => reportTocEntries(report), [report]);
  const [active, setActive] = useState(entries[0]?.id ?? '');

  useEffect(() => {
    if (!entries.length) return;
    let observer: IntersectionObserver | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;
    const recompute = (els: HTMLElement[]) => {
      const cur = activeHeadingFor(els.map((el) => ({ id: el.id, top: el.getBoundingClientRect().top })));
      setActive((prev) => (prev === cur ? prev : cur));
    };
    const bind = () => {
      observer?.disconnect();
      const els = entries.map((e) => document.getElementById(e.id)).filter((el): el is HTMLElement => el instanceof HTMLElement);
      if (!els.length) {
        if (retries++ < 12) retry = setTimeout(bind, 150);
        return;
      }
      observer = new IntersectionObserver(() => recompute(els), { rootMargin: `-${TOP_OFFSET_PX}px 0px -55% 0px`, threshold: [0, 1] });
      els.forEach((el) => observer?.observe(el));
      recompute(els);
    };
    bind();
    return () => {
      observer?.disconnect();
      if (retry) clearTimeout(retry);
    };
  }, [entries]);

  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    try {
      history.replaceState(null, '', `#${id}`);
    } catch {
      /* ignore */
    }
    setActive(id);
  };

  return (
    <nav className={className} aria-label={t('post_toc')}>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('post_toc')}</h3>
      <ol className="space-y-0.5 border-l border-zinc-200 dark:border-zinc-800">
        {entries.map((e) => {
          const on = e.id === active;
          return (
            <li key={e.id} className="-ml-px">
              <button
                type="button"
                onClick={() => go(e.id)}
                aria-current={on ? 'location' : undefined}
                className={`flex w-full items-start gap-2 border-l-2 py-1 pl-3 pr-1 text-left text-[13px] leading-snug transition ${
                  on ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-50' : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                }`}
              >
                {e.num ? (
                  <span className={`mt-px inline-flex h-4 shrink-0 items-center rounded border px-1 font-mono text-[10px] font-semibold tabular-nums ${on ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400'}`}>
                    {e.num}
                  </span>
                ) : null}
                <span className={`line-clamp-2 min-w-0 ${e.num ? '' : 'font-medium'} ${on ? 'font-semibold' : ''}`}>{e.text}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * 报告的右栏：目录（本期要点 → 各专题 → 活动 / Recap / 资料 / 数据，随阅读位置高亮）→ 全部展开 / 收起 →
 * 调用方塞进来的段落（作者、评论按钮…）→ 回到顶部。sticky，超过视口高度时栏内滚动（目录永远完整）；只在 lg 起渲染（调用方控制）。
 */
export function ReportRail({ report, children, className = '' }: { report: Report; articleRef?: RefObject<HTMLElement>; children?: ReactNode; className?: string }) {
  const t = useTranslations('zones');
  const toTop = useCallback(() => window.scrollTo({ top: 0, behavior: 'smooth' }), []);
  return (
    <div className={`sticky top-24 max-h-[calc(100vh-7rem)] space-y-6 overflow-y-auto pr-1 ${className}`}>
      <ReportToc report={report} />
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
      <div className={`grid grid-cols-1 gap-10 ${wide ? 'lg:grid-cols-[minmax(0,1fr)_260px]' : ''} ${className}`} data-report-band={band}>
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
