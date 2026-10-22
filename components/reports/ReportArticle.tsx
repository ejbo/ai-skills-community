'use client';

// 报告帖子的原生正文（docs/contracts/reports.md §3a）。Markdown 做不到的都在这里：
//   - 要点卡：主线判断 + 编号要点 + 关键判断（置信度）+ 待办表
//   - 专题：宏观总结面板 → 观点时间线（头像 / 悬停名片 / 角色色标 / 高亮关键词 / 原话 / 配图灯箱 /
//     来源 chips → 右侧 dock / 「看原文」→ dock 里装原始消息页）→ 待验证 → 资料 → 启示框
//   - 活动表、Recap、资源索引、数据概览（横条）、未随文附件
// section 的 id 必须与 lib/zones/reports/post-view.ts reportHeadings 一致（右栏目录靠它滚动）。
// 配色遵守 ui.md：chrome 全墨；颜色只出现在内容语义上（角色色标、高亮、头像身份色）。

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarDays, ChevronDown, ChevronUp, Hash, MessageSquareQuote, Quote } from 'lucide-react';
import { REPORT_SECTION_IDS } from '@/lib/zones/reports/sections';
import type { Report, ReportAttachment, ReportTheme, ReportViewpoint } from '@/lib/zones/reports/schema';
import type { PublicAuthor } from '@/lib/user-identity';
import type { EmbedData, ZonePostReportView } from '@/lib/zones/types';
import { BTN_GHOST } from '@/app/zones/_components/ui';
import { withBasePath } from '@/lib/base-path';
import { BodyImageLightbox, type BodyImage, type LightboxRect } from '@/app/zones/_components/post/BodyImageLightbox';
import { ReportGalleryContext, RichText, RoleChip, SourceChips, Speaker, Thumbs, useReportLabels, type SourceRef, type ThumbItem } from './report-bits';
import { OriginalMessages } from './ReportMessages';
import { SpeakerFilter, useReportView } from './report-view';

const RES_KEY: Record<string, string> = { paper: '论文', repo: '代码', article: '文章', internal: '内部', video: '视频', doc: '文档', other: '链接' };

export function ReportArticle({ view, embeds }: { view: ZonePostReportView; embeds: Record<string, EmbedData> }) {
  const t = useTranslations('zones');
  const labels = useReportLabels();
  const { report, speakers, librarySlugs, assetUrls } = view;
  // 按发言人筛选（report-view.tsx）：选了人 → 只剩这些人的观点 / Recap 条目；要点、活动、资料、数据、附录先藏起来
  const rv = useReportView();
  const sel = rv.speakers;
  const filtering = sel.size > 0;
  const bySel = (account: string | null | undefined) => !filtering || (!!account && sel.has(account.toLowerCase()));
  const selNames = filtering ? report.stats.bySpeaker.filter((s) => sel.has(s.account.toLowerCase())).map((s) => speakers[s.account.toLowerCase()]?.displayName || s.name) : [];
  const selViewpoints = filtering ? report.themes.reduce((n, th) => n + th.viewpoints.filter((v) => bySel(v.account)).length, 0) : 0;
  // 「看原文」就地展开（owner 2026-10-21：不要新建网页）：同一时刻只展开一处，key = 观点 / 活动 / 花絮的 id
  const [originalsOpen, setOriginalsOpen] = useState<string | null>(null);
  const originals = (key: string, msgRefs: string[]) => ({
    open: originalsOpen === key,
    toggle: () => setOriginalsOpen((cur) => (cur === key ? null : key)),
    panel: originalsOpen === key ? <OriginalMessages reportId={view.id} ids={msgRefs} onClose={() => setOriginalsOpen(null)} /> : null,
  });
  const attById = useMemo(() => new Map(report.attachments.map((a) => [a.id, a])), [report.attachments]);
  const themeNo = useMemo(() => new Map(report.themes.map((th, i) => [th.id, String(i + 1).padStart(2, '0')])), [report.themes]);

  const userOf = (account?: string | null): PublicAuthor | null => (account ? speakers[account.toLowerCase()] ?? null : null);
  const thumbsOf = (ids: string[]): ThumbItem[] =>
    ids
      .map((id) => attById.get(id))
      .filter((a): a is ReportAttachment => !!a)
      .map((a) => ({ id: a.id, file: a.file, kind: a.kind, url: assetUrls[a.id] ?? null, caption: `${a.name} · ${(a.time || '').slice(5, 16)}`, sizeBytes: a.size }));

  // ── 相册：整篇报告的图片按正文顺序排成一列，灯箱里可以左右切换（owner 2026-10-21）────────────
  const gallery = useMemo(() => {
    const order: string[] = [];
    const push = (ids: string[]) => ids.forEach((id) => !order.includes(id) && order.push(id));
    for (const th of report.themes) for (const v of th.viewpoints) push(v.attachments);
    for (const e of report.events) push(e.attachments);
    for (const it of report.recap?.items ?? []) push(it.attachments);
    push(report.attachments.filter((a) => a.placement.kind === 'appendix').map((a) => a.id));
    push(report.attachments.map((a) => a.id)); // 其余（没挂到任何地方的）
    return order
      .map((id) => attById.get(id))
      .filter((a): a is ReportAttachment => !!a && a.kind === 'image' && !!assetUrls[a.id])
      .map((a) => ({ id: a.id, src: withBasePath(assetUrls[a.id]), alt: a.file, caption: `${a.file} · ${a.name} · ${(a.time || '').slice(5, 16)}` }));
  }, [report, attById, assetUrls]);
  const [shown, setShown] = useState<{ index: number; rect: LightboxRect; flip: boolean } | null>(null);
  const galleryApi = useMemo(
    () => ({
      open: (id: string, rect: DOMRect) => {
        const index = gallery.findIndex((g) => g.id === id);
        if (index < 0) return false;
        setShown({ index, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, flip: true });
        return true;
      },
    }),
    [gallery],
  );
  const closeGallery = useCallback(() => setShown(null), []);
  const step = (d: number) => setShown((s) => (s ? { index: Math.min(gallery.length - 1, Math.max(0, s.index + d)), rect: s.rect, flip: false } : s));
  const lightboxImage: BodyImage | null = shown && gallery[shown.index] ? { src: gallery[shown.index].src, alt: gallery[shown.index].alt, rect: shown.rect, flip: shown.flip, caption: gallery[shown.index].caption } : null;
  const librarySlugOf = (ids: string[]): string | null => {
    for (const id of ids) {
      const a = attById.get(id);
      if (a && librarySlugs[a.file]) return librarySlugs[a.file];
    }
    return null;
  };
  const themeRef = (id?: string | null) =>
    id && themeNo.has(id) ? (
      <a href={`#${id}`} className="ml-1.5 inline-flex shrink-0 items-center gap-0.5 rounded-md border border-zinc-200 px-1 font-mono text-[10px] text-muted transition hover:border-zinc-900 hover:text-zinc-900 dark:border-zinc-800 dark:hover:border-zinc-100 dark:hover:text-zinc-100">
        <Hash className="h-2.5 w-2.5" />
        {themeNo.get(id)}
      </a>
    ) : null;

  const S = report.summary;
  const hasDue = S.actions.some((a) => a.due);

  const resourceGroups = report.themes
    .map((th) => {
      const seen = new Set<string>();
      const rows: (SourceRef & { kind: string })[] = [];
      for (const r of th.resources) if (!seen.has(r.url)) (seen.add(r.url), rows.push({ label: r.label, url: r.url, kind: r.kind ?? 'other' }));
      for (const v of th.viewpoints) for (const s of v.sources) if (s.url && !seen.has(s.url)) (seen.add(s.url), rows.push({ label: s.label, url: s.url, kind: 'other', who: v.speaker, when: v.dates[0] }));
      return { theme: th, rows };
    })
    .filter((g) => g.rows.length);

  const appendix = report.attachments.filter((a) => a.placement.kind === 'appendix' && assetUrls[a.id]);
  const st = report.stats;
  const maxDay = Math.max(1, ...st.byDay.map(([, n]) => n));
  const topSpeakers = st.bySpeaker.slice(0, 8);
  const maxSp = topSpeakers[0]?.count ?? 1;

  return (
    <ReportGalleryContext.Provider value={galleryApi}>
    <div className="space-y-12">
      {/* 窄屏（没有右栏）时的发言人筛选器 */}
      {rv.provided && <SpeakerFilter report={report} speakers={speakers} className="lg:hidden" />}

      {filtering && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-zinc-900 px-5 py-3 text-sm dark:border-zinc-100">
          <span className="font-medium">{t('report_filter_banner', { names: selNames.join('、'), count: selViewpoints })}</span>
          <button type="button" onClick={rv.clearSpeakers} className="text-xs text-muted underline-offset-2 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">
            {t('report_filter_clear')}
          </button>
        </div>
      )}

      {/* ── 本期要点 ─────────────────────────────────────────────────────── */}
      {!filtering && (
      <section id={REPORT_SECTION_IDS.brief} className="scroll-mt-28 rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <div className="border-b border-zinc-200 px-6 py-5 dark:border-zinc-800">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t('report_sec_brief')}</h2>
          {S.headline && (
            <p className="mt-2 border-l-4 border-zinc-900 pl-4 text-lg font-semibold leading-snug tracking-tight text-zinc-900 dark:border-zinc-100 dark:text-zinc-50">
              <RichText text={S.headline} />
            </p>
          )}
        </div>
        <div className="grid gap-6 px-6 py-5 md:grid-cols-[1.15fr_1fr]">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t('report_sec_highlights')}</h3>
            <ol className="mt-2 space-y-2.5">
              {S.highlights.map((h, i) => (
                <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                  <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 font-mono text-[11px] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">{i + 1}</span>
                  <span>
                    <RichText text={h.text} />
                    {themeRef(h.themeId)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          {S.judgments.length > 0 && (
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t('report_sec_judgments')}</h3>
              <ul className="mt-2 space-y-2.5">
                {S.judgments.map((j, i) => (
                  <li key={i} className="flex gap-3 text-sm leading-relaxed">
                    <span className="mt-2 h-2 w-2 shrink-0 bg-zinc-900 dark:bg-zinc-100" aria-hidden />
                    <span>
                      <RichText text={j.text} />
                      <span className="ml-1.5 whitespace-nowrap font-mono text-[11px] text-muted">{t('report_confidence', { level: labels.conf(j.confidence) })}</span>
                      {themeRef(j.themeId)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {S.actions.length > 0 && (
          <div className="border-t border-zinc-200 px-6 py-5 dark:border-zinc-800">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t('report_sec_actions')}</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-muted dark:border-zinc-800">
                    <th className="py-2 pr-3 font-medium">{t('report_col_action')}</th>
                    <th className="py-2 pr-3 font-medium">{t('report_col_owner')}</th>
                    <th className="py-2 pr-3 font-medium">{t('report_col_theme')}</th>
                    {hasDue && <th className="py-2 font-medium">{t('report_col_due')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {S.actions.map((a, i) => (
                    <tr key={i} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-900">
                      <td className="py-2 pr-3 leading-relaxed">
                        <RichText text={a.text} />
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        {a.owner ? <Speaker name={a.owner} account={a.ownerAccount} user={userOf(a.ownerAccount)} size="xs" showAccount={false} /> : '—'}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3">{themeRef(a.themeId) ?? '—'}</td>
                      {hasDue && <td className="whitespace-nowrap py-2 font-mono text-xs">{a.due ?? ''}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
      )}

      {/* ── 专题 ─────────────────────────────────────────────────────────── */}
      {report.themes.map((th, i) => (
        <ThemeSection
          key={th.id}
          theme={th}
          index={i}
          onlySpeakers={filtering ? sel : null}
          userOf={userOf}
          thumbsOf={thumbsOf}
          librarySlugOf={librarySlugOf}
          originals={originals}
          embeds={embeds}
          labels={labels}
        />
      ))}

      {/* ── 活动与通知 ──────────────────────────────────────────────────── */}
      {!filtering && report.events.length > 0 && (
        <section id={REPORT_SECTION_IDS.events} className="scroll-mt-28">
          <SectionTitle icon={<CalendarDays className="h-4 w-4" />} title={t('report_sec_events')} />
          <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-muted dark:border-zinc-800 dark:bg-zinc-900/60">
                  <th className="px-4 py-2.5 font-medium">{t('report_col_date')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('report_col_event')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('report_col_host')}</th>
                </tr>
              </thead>
              <tbody>
                {[...report.events]
                  .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
                  .map((e) => (
                    <tr key={e.id} className="border-b border-zinc-100 align-top last:border-b-0 dark:border-zinc-900">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{e.date ?? '—'}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-zinc-900 dark:text-zinc-50">{e.title}</div>
                        {e.note && (
                          <div className="mt-0.5 text-xs text-muted">
                            <RichText text={e.note} />
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          {e.url && <SourceChips sources={[{ label: e.title, url: e.url }]} label="" />}
                          {e.msgRefs.length > 0 && <OriginalsButton state={originals(`e:${e.id}`, e.msgRefs)} count={e.msgRefs.length} />}
                        </div>
                        <Thumbs items={thumbsOf(e.attachments)} size="sm" />
                        {originals(`e:${e.id}`, e.msgRefs).panel}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs">{e.host ?? '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Recap ──────────────────────────────────────────────────────── */}
      {report.recap && report.recap.items.some((it) => bySel(it.account)) && (
        <section id={REPORT_SECTION_IDS.recap} className="scroll-mt-28">
          <SectionTitle title={report.recap.title || 'Recap'} />
          <ol className="mt-4 divide-y divide-zinc-100 rounded-2xl border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
            {report.recap.items.filter((it) => bySel(it.account)).map((it) => (
              <li key={it.id} className="flex gap-3 px-4 py-3 text-sm">
                <span className="w-12 shrink-0 pt-0.5 font-mono text-[11px] text-muted">{(it.date ?? '').slice(5)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {it.speaker && <Speaker name={it.speaker} account={it.account} user={userOf(it.account)} size="xs" showAccount={false} />}
                    {it.msgRefs.length > 0 && <OriginalsButton state={originals(`r:${it.id}`, it.msgRefs)} count={it.msgRefs.length} />}
                  </div>
                  <p className="mt-0.5 leading-relaxed">
                    <RichText text={it.text} />
                  </p>
                  <SourceChips sources={it.sources} />
                  <Thumbs items={thumbsOf(it.attachments)} size="sm" />
                  {originals(`r:${it.id}`, it.msgRefs).panel}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ── 资源索引 ────────────────────────────────────────────────────── */}
      {!filtering && resourceGroups.length > 0 && (
        <section id={REPORT_SECTION_IDS.resources} className="scroll-mt-28">
          <SectionTitle title={t('report_sec_resources')} />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {resourceGroups.map(({ theme, rows }) => (
              <div key={theme.id} className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                <a href={`#${theme.id}`} className="text-sm font-semibold text-zinc-900 hover:underline dark:text-zinc-50">
                  <span className="mr-1.5 font-mono text-xs text-muted">{themeNo.get(theme.id)}</span>
                  {theme.title}
                </a>
                <ul className="mt-2 space-y-1.5">
                  {rows.map((r, i) => (
                    <li key={`${r.url}-${i}`} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 shrink-0 font-mono text-[10px] uppercase text-muted">{RES_KEY[r.kind] ?? r.kind}</span>
                      <SourceChips sources={[r]} label="" />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 数据概览 ────────────────────────────────────────────────────── */}
      {!filtering && (
      <section id={REPORT_SECTION_IDS.stats} className="scroll-mt-28">
        <SectionTitle title={t('report_sec_stats')} />
        <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-200 sm:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-800">
          {[
            [t('report_stat_messages'), st.messages],
            [t('report_stat_substantive'), st.substantive],
            [t('report_stat_speakers'), st.speakers],
            [t('report_stat_links'), st.links],
            [t('report_stat_attachments'), st.attachments || st.attachmentPlaceholders],
            [t('report_stat_active_days'), st.activeDays],
            [t('report_stat_peak'), `${st.peakDay.date.slice(5)} · ${st.peakDay.count}`],
            [t('report_col_theme'), report.themes.length],
          ].map(([k, v], i) => (
            <div key={i} className="bg-white px-4 py-3 dark:bg-zinc-950">
              <dt className="text-[11px] text-muted">{k}</dt>
              <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t('report_stat_top_speakers')}</h4>
            <ul className="mt-2 space-y-1.5">
              {topSpeakers.map((s) => (
                <li key={s.account} className="grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-2 text-xs">
                  <Speaker name={s.name} account={s.account} user={userOf(s.account)} size="xs" showAccount={false} />
                  <span className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <span className="block h-full rounded-full bg-zinc-900 dark:bg-zinc-100" style={{ width: `${((s.count / maxSp) * 100).toFixed(1)}%` }} />
                  </span>
                  <span className="text-right font-mono tabular-nums text-muted">{s.count}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t('report_stat_by_day')}</h4>
            <div className="mt-2 flex h-28 items-end gap-1 overflow-x-auto border-b border-zinc-200 pb-px dark:border-zinc-800">
              {st.byDay.map(([d, n]) => (
                <div key={d} className="flex w-5 shrink-0 flex-col items-center justify-end" title={`${d} · ${n}`}>
                  <span className="w-3 rounded-t-sm bg-zinc-900 dark:bg-zinc-100" style={{ height: `${Math.max(2, (n / maxDay) * 96)}px` }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
              <span>{st.byDay[0]?.[0]?.slice(5)}</span>
              <span>{st.byDay[st.byDay.length - 1]?.[0]?.slice(5)}</span>
            </div>
          </div>
        </div>
      </section>
      )}

      {/* ── 附录 ──────────────────────────────────────────────────────────── */}
      {!filtering && appendix.length > 0 && (
        <section id={REPORT_SECTION_IDS.appendix} className="scroll-mt-28">
          <SectionTitle title={t('report_sec_appendix')} />
          <Thumbs items={thumbsOf(appendix.map((a) => a.id))} />
        </section>
      )}
    </div>
    {/* 整篇报告一个灯箱：← → / 两侧按钮按正文顺序切换 */}
    <BodyImageLightbox image={lightboxImage} onClose={closeGallery} nav={shown && gallery.length > 1 ? { index: shown.index, count: gallery.length, onPrev: () => step(-1), onNext: () => step(1) } : null} />
    </ReportGalleryContext.Provider>
  );
}

function SectionTitle({ title, icon }: { title: string; icon?: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
      {icon ? <span className="text-muted">{icon}</span> : null}
      {title}
    </h2>
  );
}

function ThemeSection({
  theme: th,
  index,
  userOf,
  thumbsOf,
  librarySlugOf,
  originals,
  embeds,
  labels,
  onlySpeakers,
}: {
  theme: ReportTheme;
  index: number;
  userOf: (account?: string | null) => PublicAuthor | null;
  thumbsOf: (ids: string[]) => ThumbItem[];
  librarySlugOf: (ids: string[]) => string | null;
  originals: OriginalsFor;
  /** 按发言人筛选时选中的账号；null = 不筛。 */
  onlySpeakers: ReadonlySet<string> | null;
  embeds: Record<string, EmbedData>;
  labels: ReturnType<typeof useReportLabels>;
}) {
  const t = useTranslations('zones');
  const view = useReportView();
  const viewpoints = onlySpeakers ? th.viewpoints.filter((v) => onlySpeakers.has(v.account.toLowerCase())) : th.viewpoints;
  if (onlySpeakers && !viewpoints.length) return null; // 这个专题里没有所选人的观点
  const filtering = !!onlySpeakers;
  const open = filtering || view.isOpen(th.id); // 筛选时直接展开，别让人再点一次
  const speakerCount = new Set(viewpoints.map((v) => v.account)).size;
  const n = String(index + 1).padStart(2, '0');
  return (
    <section id={th.id} className="scroll-mt-28">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="rounded-md border border-zinc-900 px-1.5 font-mono text-xs font-semibold text-zinc-900 dark:border-zinc-100 dark:text-zinc-100">{n}</span>
        <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{th.title}</h2>
        <span className="font-mono text-xs text-muted">{t('report_theme_messages', { count: th.weight })}</span>
      </div>
      {th.tagline && (
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          <RichText text={th.tagline} />
        </p>
      )}

      {!filtering && th.macro.length > 0 && (
        <ul className="mt-4 space-y-2 rounded-2xl bg-zinc-50 px-5 py-4 dark:bg-zinc-900/60">
          {th.macro.map((m, i) => (
            <li key={i} className="flex gap-3 text-sm leading-relaxed">
              <span className="mt-0.5 shrink-0 self-start whitespace-nowrap rounded-md bg-zinc-900 px-1.5 py-px text-[11px] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">{labels.tag(m.tag)}</span>
              <span>
                <RichText text={m.text} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* 观点时间线：可折叠（默认收起，右栏「全部展开」或这里逐个展开）——报告太长时先看定位 + 宏观 + 启示 */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t('report_sec_timeline')}</h3>
        {view.provided && !filtering && (
          <button
            type="button"
            onClick={() => view.toggle(th.id)}
            aria-expanded={open}
            aria-controls={`${th.id}-timeline`}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-2 text-xs font-medium text-zinc-700 transition hover:border-zinc-900 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-100 dark:hover:text-zinc-100"
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {open ? t('report_timeline_collapse') : t('report_timeline_expand', { count: th.viewpoints.length, speakers: speakerCount })}
          </button>
        )}
      </div>
      {open ? (
        <ol id={`${th.id}-timeline`} className="relative mt-3 ml-3.5 space-y-6 border-l border-zinc-200 pl-7 dark:border-zinc-800">
          {viewpoints.map((v) => (
            <ViewpointItem key={v.id} v={v} user={userOf(v.account)} thumbs={thumbsOf(v.attachments)} librarySlug={librarySlugOf(v.attachments)} embeds={embeds} originals={originals(`v:${v.id}`, v.msgRefs)} />
          ))}
        </ol>
      ) : (
        // 收起时留一行"谁说了"的头像带，点开即展开
        <button type="button" onClick={() => view.toggle(th.id)} className="mt-3 flex w-full flex-wrap items-center gap-2 rounded-xl border border-dashed border-zinc-300 px-3 py-2 text-left text-xs text-muted transition hover:border-zinc-900 hover:text-zinc-900 dark:border-zinc-700 dark:hover:border-zinc-100 dark:hover:text-zinc-100">
          <span className="flex -space-x-1.5">
            {[...new Map(th.viewpoints.map((v) => [v.account, v])).values()].slice(0, 8).map((v) => (
              <Speaker key={v.account} name={v.speaker} account={v.account} user={userOf(v.account)} size="xs" showName={false} />
            ))}
          </span>
          <span>{t('report_timeline_collapsed', { count: th.viewpoints.length, speakers: speakerCount })}</span>
        </button>
      )}

      {!filtering && th.openQuestions.length > 0 && (
        <>
          <h3 className="mt-6 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('report_sec_open')}</h3>
          <ul className="mt-2 space-y-1.5">
            {th.openQuestions.map((q, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full border border-zinc-500" aria-hidden />
                <RichText text={q} />
              </li>
            ))}
          </ul>
        </>
      )}

      {!filtering && th.resources.length > 0 && (
        <>
          <h3 className="mt-6 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('report_sec_theme_resources')}</h3>
          <ul className="mt-2 space-y-1">
            {th.resources.map((r, i) => (
              <li key={`${r.url}-${i}`} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 shrink-0 font-mono text-[10px] uppercase text-muted">{RES_KEY[r.kind ?? 'other'] ?? r.kind}</span>
                <SourceChips sources={[{ label: r.label, url: r.url }]} label="" />
              </li>
            ))}
          </ul>
        </>
      )}

      {!filtering && th.conclusion && (
        <div className="mt-6 flex gap-4 rounded-2xl border-l-4 border-zinc-900 bg-zinc-50 px-5 py-4 dark:border-zinc-100 dark:bg-zinc-900/60">
          <span className="shrink-0 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">{t('report_sec_insight')}</span>
          <p className="text-sm font-medium leading-relaxed text-zinc-900 dark:text-zinc-50">
            <RichText text={th.conclusion} />
          </p>
        </div>
      )}
    </section>
  );
}

function ViewpointItem({ v, user, thumbs, librarySlug, embeds, originals }: { v: ReportViewpoint; user: PublicAuthor | null; thumbs: ThumbItem[]; librarySlug: string | null; embeds: Record<string, EmbedData>; originals: OriginalsState }) {
  return (
    <li className="relative border-b border-dashed border-zinc-200 pb-5 last:border-b-0 last:pb-0 dark:border-zinc-800">
      {/* 头像骑在时间线上 */}
      <span className="absolute -left-[2.45rem] top-0">
        <Speaker name={v.speaker} account={v.account} user={user} size="sm" showName={false} />
      </span>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold text-zinc-900 dark:text-zinc-50">{user?.displayName || v.speaker}</span>
        <span className="font-mono text-[11px] text-muted">{v.account}</span>
        <RoleChip role={v.role} />
        <span className="ml-auto font-mono text-[11px] text-muted">{v.dates.join(' / ')}</span>
      </div>
      <p className="mt-1.5 text-[15px] leading-relaxed text-zinc-800 dark:text-zinc-200">
        <RichText text={v.text} />
      </p>
      {v.quote && (
        <blockquote className="mt-2 flex gap-2 border-l-2 border-zinc-300 pl-3 text-sm leading-relaxed text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          <Quote className="mt-1 h-3 w-3 shrink-0 text-zinc-400" />
          <span>{v.quote}</span>
        </blockquote>
      )}
      <Thumbs items={thumbs} />
      <div className="flex flex-wrap items-center gap-x-3">
        <SourceChips sources={v.sources.map((s) => ({ ...s, who: v.speaker, when: v.dates[0] }))} librarySlug={librarySlug} embeds={embeds} />
        {v.msgRefs.length > 0 && <OriginalsButton state={originals} count={v.msgRefs.length} />}
      </div>
      {originals.panel}
    </li>
  );
}

interface OriginalsState {
  open: boolean;
  toggle: () => void;
  panel: React.ReactNode;
}
type OriginalsFor = (key: string, msgRefs: string[]) => OriginalsState;

/** 「看原文 N」/「收起原文」切换按钮（面板由调用方放在合适的位置）。 */
function OriginalsButton({ state, count }: { state: OriginalsState; count: number }) {
  const t = useTranslations('zones');
  return (
    <button type="button" className={`${BTN_GHOST} mt-1.5 h-6 px-1.5 text-[11px] ${state.open ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100' : ''}`} aria-expanded={state.open} onClick={state.toggle}>
      <MessageSquareQuote className="h-3 w-3" />
      {state.open ? t('report_messages_collapse') : t('report_view_original', { count })}
    </button>
  );
}
