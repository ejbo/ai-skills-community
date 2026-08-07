// 活动 — community events. Luma-style 3-column layout: left filter rail
// (date presets + custom range / 大类 / 主题 / 形式 / 城市 — all URL params),
// middle date-grouped timeline (sticky day labels + dashed rail), right mini
// month-calendar with event dots + 本月活动 agenda, both driven by the SAME
// filters (日历随筛选联动). Everything is RSC; client leaves are SearchBar and
// the custom DateRangePicker.

import Link from 'next/link';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { CalendarCheck2, ChevronLeft, ChevronRight, Pin, Plus, X } from 'lucide-react';
import { auth } from '@/lib/auth';
import { SearchBar } from '@/components/SearchBar';
import { EmptyState } from '@/components/EmptyState';
import {
  EVENT_CITIES,
  EVENT_KINDS,
  EVENT_MODES,
  EVENT_TOPICS,
  isEventCity,
  isEventKind,
  isEventMode,
  isEventTopic,
  type PublicEventItem,
} from '@/lib/events/types';
import {
  countEventsByCity,
  countEventsByKind,
  getCalendarMonth,
  listEvents,
  listPinnedUpcoming,
  type CalendarMonthData,
  type EventFilters,
  type EventTab,
} from '@/lib/event-queries';
import {
  addDaysUtc,
  addMonthsUtc,
  dayKey,
  dayKeyToDate,
  fmtDateShortL,
  fmtDateFullL,
  monthGrid,
  monthKey,
  monthKeyToDate,
  nowWall,
  startOfMonthUtc,
  weekdayShortL,
} from '@/lib/events/time';
import { EventCard } from './_components/EventCard';
import { DateRangePicker } from './_components/DateRangePicker';
import { EventTimeAgenda } from './_components/EventTime';
import { KIND_META } from './_components/badges';
import { eventLocalDayKey } from '@/lib/events/time';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('events');
  return { title: t('meta_title') };
}

// Next 14 交给 page 的 searchParams 运行时可能是 string[]（?q=a&q=b）——取第一个。
interface SearchParams {
  tab?: string | string[];
  preset?: string | string[];
  from?: string | string[];
  to?: string | string[];
  day?: string | string[];
  kind?: string | string[];
  topic?: string | string[];
  mode?: string | string[];
  city?: string | string[];
  q?: string | string[];
  cal?: string | string[];
  page?: string | string[];
  mine?: string | string[];
}

function firstParam(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? '').trim();
}

const PARAM_KEYS = ['tab', 'preset', 'from', 'to', 'day', 'kind', 'topic', 'mode', 'city', 'q', 'cal', 'page', 'mine'] as const;

/** Merge current searchParams with a patch ('' deletes); any change resets page. */
function eventsHref(sp: SearchParams, patch: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const k of PARAM_KEYS) {
    const v = firstParam(sp[k]);
    if (v) params.set(k, v);
  }
  params.delete('page');
  for (const [k, v] of Object.entries(patch)) {
    if (v) params.set(k, v);
    else params.delete(k);
  }
  const qs = params.toString();
  return qs ? `/events?${qs}` : '/events';
}

// 不选 = 全部；点击已选中的预设即取消。Display labels: t(`preset_${value}`).
const PRESETS = ['today', 'tomorrow', 'week', 'month'] as const;

/** 城市入库值是固定英文串（DB/筛选参数）；只翻译展示名。 */
function cityKey(city: string): string {
  return `city_${city.toLowerCase()}`;
}

/** Resolve a date preset to a wall-clock [from, to] (inclusive days). */
function presetRange(preset: string): { from: Date; to: Date } | null {
  const today = dayKeyToDate(dayKey(nowWall()))!;
  const dow = today.getUTCDay(); // 0 = Sunday
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'tomorrow': {
      const d = addDaysUtc(today, 1);
      return { from: d, to: d };
    }
    case 'week':
      // 今天起到本周日。
      return { from: today, to: addDaysUtc(today, dow === 0 ? 0 : 7 - dow) };
    case 'month':
      return { from: today, to: addDaysUtc(addMonthsUtc(today, 1), -1) };
    default:
      return null;
  }
}

export default async function EventsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth();
  const viewer = { id: session?.user?.id ?? null, isAdmin: Boolean(session?.user?.isAdmin) };
  const t = await getTranslations('events');
  const tl = await getTranslations('labels');
  const tb = await getTranslations('browse');
  const locale = await getLocale();

  // ── filters from URL ────────────────────────────────────────────────────
  const tab: EventTab = firstParam(searchParams.tab) === 'past' ? 'past' : 'upcoming';
  const kindRaw = firstParam(searchParams.kind);
  const kind = isEventKind(kindRaw) ? kindRaw : undefined;
  const topicRaw = firstParam(searchParams.topic);
  const topic = isEventTopic(topicRaw) ? topicRaw : undefined;
  const modeRaw = firstParam(searchParams.mode);
  const mode = isEventMode(modeRaw) ? modeRaw : undefined;
  const cityRaw = firstParam(searchParams.city);
  const city = isEventCity(cityRaw) ? cityRaw : undefined;
  const q = firstParam(searchParams.q).slice(0, 64) || undefined;
  const day = dayKeyToDate(firstParam(searchParams.day)) ?? undefined;
  let from = dayKeyToDate(firstParam(searchParams.from)) ?? undefined;
  let to = dayKeyToDate(firstParam(searchParams.to)) ?? undefined;
  if (from && to && to.getTime() < from.getTime()) [from, to] = [to, from];
  const preset = firstParam(searchParams.preset);
  const presetApplied = !day && !from && !to ? presetRange(preset) : null;
  if (presetApplied) {
    from = presetApplied.from;
    to = presetApplied.to;
  }
  const pageNum = Math.max(1, Number.parseInt(firstParam(searchParams.page), 10) || 1);
  const calMonth =
    monthKeyToDate(firstParam(searchParams.cal)) ?? startOfMonthUtc(day ?? from ?? nowWall());

  // 我参加的 — anonymous viewers can't have joined anything; ignore the param.
  const mine = Boolean(viewer.id) && firstParam(searchParams.mine) === '1';
  const filters: EventFilters = {
    tab,
    kind,
    topic,
    mode,
    city,
    q,
    from,
    to,
    day,
    mineFor: mine ? (viewer.id as string) : undefined,
  };
  const hasDateFilter = Boolean(day || from || to);
  const showPinned =
    tab === 'upcoming' && !hasDateFilter && !kind && !topic && !mode && !city && !q && !mine && pageNum === 1;

  const [list, kindCounts, cityCounts, cal, pinned] = await Promise.all([
    listEvents(filters, viewer, pageNum),
    countEventsByKind(filters),
    countEventsByCity(filters),
    getCalendarMonth(calMonth, filters),
    showPinned ? listPinnedUpcoming(viewer) : Promise.resolve([]),
  ]);
  const pinnedIds = new Set(pinned.map((e) => e.id));

  // ── date grouping (items pre-sorted by event-local date in the query layer;
  // the 推荐活动 strip's cards are skipped so pinned events don't render twice;
  // an active day filter collapses everything under the SELECTED day so the
  // sticky header can't contradict the filter chip) ──
  const todayKey = dayKey(nowWall());
  const tomorrowKey = dayKey(addDaysUtc(dayKeyToDate(todayKey)!, 1));
  const currentYear = nowWall().getUTCFullYear();
  const groups: { key: string; items: PublicEventItem[] }[] = [];
  for (const item of list.items) {
    if (showPinned && pinnedIds.has(item.id)) continue;
    const k = day ? dayKey(day) : eventLocalDayKey(item.startAt, item.timezone, item.allDay);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.items.push(item);
    else groups.push({ key: k, items: [item] });
  }
  function groupLabel(key: string): { main: string; sub: string } {
    const d = dayKeyToDate(key)!;
    const short = `${weekdayShortL(d, locale)} · ${fmtDateShortL(d, locale)}`;
    if (key === todayKey) return { main: t('today'), sub: short };
    if (key === tomorrowKey) return { main: t('tomorrow'), sub: short };
    return {
      main: d.getUTCFullYear() === currentYear ? fmtDateShortL(d, locale) : fmtDateFullL(d, locale),
      sub: weekdayShortL(d, locale),
    };
  }

  // ── active filter chips ─────────────────────────────────────────────────
  const chips: { label: string; href: string }[] = [];
  if (mine) chips.push({ label: t('my_events'), href: eventsHref(searchParams, { mine: '' }) });
  if (q) chips.push({ label: t('chip_search', { q }), href: eventsHref(searchParams, { q: '' }) });
  if (kind) chips.push({ label: tl(`eventKind.${kind}`), href: eventsHref(searchParams, { kind: '' }) });
  if (topic) chips.push({ label: t(`topic_${topic}`), href: eventsHref(searchParams, { topic: '' }) });
  if (mode) chips.push({ label: tl(`eventMode.${mode}`), href: eventsHref(searchParams, { mode: '' }) });
  if (city) chips.push({ label: t(cityKey(city)), href: eventsHref(searchParams, { city: '' }) });
  if (day) chips.push({ label: fmtDateShortL(day, locale), href: eventsHref(searchParams, { day: '' }) });
  else if (presetApplied) chips.push({ label: t(`preset_${preset}`), href: eventsHref(searchParams, { preset: '' }) });
  else if (from || to) {
    const label = `${from ? fmtDateShortL(from, locale) : '…'} – ${to ? fmtDateShortL(to, locale) : '…'}`;
    chips.push({ label, href: eventsHref(searchParams, { from: '', to: '' }) });
  }

  const allKindCount = Object.values(kindCounts).reduce((a, b) => a + b, 0);
  const publishHref = session?.user
    ? '/events/new'
    : `/auth/login?callbackUrl=${encodeURIComponent('/events/new')}`;

  return (
    <div className="container py-8">
      {/* header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </div>
        <Link
          href={publishHref}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600"
        >
          <Plus className="h-4 w-4" />
          {t('publish')}
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[210px_minmax(0,1fr)] xl:grid-cols-[210px_minmax(0,1fr)_280px]">
        {/* ── left: filter rail ── */}
        <aside className="hidden lg:block">
          <nav className="sticky top-20 space-y-5">
            <RailSection title={t('rail_time')}>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => {
                  const active = Boolean(presetApplied && preset === p);
                  return (
                    <Link
                      key={p}
                      href={eventsHref(searchParams, { preset: active ? '' : p, day: '', from: '', to: '' })}
                      className={chipCls(active)}
                    >
                      {t(`preset_${p}`)}
                    </Link>
                  );
                })}
              </div>
              <div className="mt-2.5">
                <DateRangePicker />
              </div>
            </RailSection>

            <RailSection title={t('rail_kind')}>
              <RailLink
                href={eventsHref(searchParams, { kind: '' })}
                active={!kind}
                count={allKindCount}
              >
                <span>{t('all_events')}</span>
              </RailLink>
              {EVENT_KINDS.map((k) => (
                <RailLink
                  key={k.value}
                  href={eventsHref(searchParams, { kind: kind === k.value ? '' : k.value })}
                  active={kind === k.value}
                  count={kindCounts[k.value] ?? 0}
                >
                  <span className="inline-flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-sm ${KIND_META[k.value].dot}`} />
                    {tl(`eventKind.${k.value}`)}
                  </span>
                </RailLink>
              ))}
            </RailSection>

            <RailSection title={t('rail_topic')}>
              <div className="flex flex-wrap gap-1.5">
                {EVENT_TOPICS.map((tp) => (
                  <Link
                    key={tp.slug}
                    href={eventsHref(searchParams, { topic: topic === tp.slug ? '' : tp.slug })}
                    className={chipCls(topic === tp.slug)}
                  >
                    {t(`topic_${tp.slug}`)}
                  </Link>
                ))}
              </div>
            </RailSection>

            <RailSection title={t('rail_mode')}>
              <RailLink href={eventsHref(searchParams, { mode: '' })} active={!mode}>
                <span>{t('any')}</span>
              </RailLink>
              {EVENT_MODES.map((m) => (
                <RailLink
                  key={m.value}
                  href={eventsHref(searchParams, { mode: mode === m.value ? '' : m.value })}
                  active={mode === m.value}
                >
                  <span>{tl(`eventMode.${m.value}`)}</span>
                </RailLink>
              ))}
            </RailSection>

            <RailSection title={t('rail_city')}>
              <RailLink href={eventsHref(searchParams, { city: '' })} active={!city}>
                <span>{t('any')}</span>
              </RailLink>
              {EVENT_CITIES.map((c) => (
                <RailLink
                  key={c}
                  href={eventsHref(searchParams, { city: city === c ? '' : c })}
                  active={city === c}
                  count={cityCounts[c] ?? 0}
                >
                  <span className="truncate">{t(cityKey(c))}</span>
                </RailLink>
              ))}
            </RailSection>
          </nav>
        </aside>

        {/* ── middle: list ── */}
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
              <Link
                href={eventsHref(searchParams, { tab: '', preset: '', day: '', from: '', to: '' })}
                className={
                  tab === 'upcoming'
                    ? 'rounded-md bg-accent-500 px-3 py-1 text-xs font-medium text-white'
                    : 'rounded-md px-3 py-1 text-xs text-muted transition hover:text-zinc-900 dark:hover:text-zinc-100'
                }
              >
                {t('tab_upcoming')}
              </Link>
              <Link
                href={eventsHref(searchParams, { tab: 'past', preset: '', day: '', from: '', to: '' })}
                className={
                  tab === 'past'
                    ? 'rounded-md bg-accent-500 px-3 py-1 text-xs font-medium text-white'
                    : 'rounded-md px-3 py-1 text-xs text-muted transition hover:text-zinc-900 dark:hover:text-zinc-100'
                }
              >
                {t('tab_past')}
              </Link>
            </div>
            {session?.user && (
              <Link
                href={eventsHref(searchParams, { mine: mine ? '' : '1' })}
                className={`inline-flex h-[30px] items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
                  mine
                    ? 'border-accent-500 bg-accent-500/10 text-accent-600 dark:text-accent-400'
                    : 'border-zinc-200 text-muted hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:hover:text-zinc-100'
                }`}
              >
                <CalendarCheck2 className="h-3.5 w-3.5" />
                {t('my_events')}
              </Link>
            )}
            <div className="w-full max-w-xs">
              <SearchBar placeholder={t('search_placeholder')} />
            </div>
          </div>

          {/* mobile: kind chips (the rail is lg-only) */}
          <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1 lg:hidden">
            <Link href={eventsHref(searchParams, { kind: '' })} className={chipCls(!kind)}>
              {tb('all')}
            </Link>
            {EVENT_KINDS.map((k) => (
              <Link
                key={k.value}
                href={eventsHref(searchParams, { kind: kind === k.value ? '' : k.value })}
                className={chipCls(kind === k.value)}
              >
                {tl(`eventKind.${k.value}`)}
              </Link>
            ))}
          </div>

          {chips.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              {chips.map((c) => (
                <Link
                  key={c.label}
                  href={c.href}
                  className="inline-flex items-center gap-1 rounded-full bg-accent-500/10 px-2.5 py-1 text-xs font-medium text-accent-600 transition hover:bg-accent-500/20 dark:text-accent-400"
                >
                  {c.label}
                  <X className="h-3 w-3" />
                </Link>
              ))}
              <Link href="/events" className="text-xs text-muted underline-offset-2 hover:underline">
                {t('clear_all')}
              </Link>
            </div>
          )}

          {showPinned && pinned.length > 0 && (
            <section className="mb-6 space-y-3">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <Pin className="h-4 w-4 text-accent-500" />
                {t('featured')}
              </h2>
              {pinned.map((ev) => (
                <EventCard key={ev.id} event={ev} showDate />
              ))}
            </section>
          )}

          {groups.length === 0 ? (
            pinned.length > 0 ? null : (
              <EmptyState
                title={mine ? t('empty_mine_title') : t('empty_title')}
                description={
                  mine ? t('empty_mine_hint') : tab === 'past' ? t('empty_past_hint') : t('empty_hint')
                }
                actionLabel={session?.user ? t('publish') : undefined}
                actionHref={session?.user ? '/events/new' : undefined}
              />
            )
          ) : (
            <div>
              {groups.map((g) => {
                const label = groupLabel(g.key);
                return (
                  <section key={g.key} className="flex gap-4 sm:gap-5">
                    <div className="w-16 shrink-0 sm:w-20">
                      <div className="sticky top-20 pt-1">
                        <div className="text-sm font-semibold">{label.main}</div>
                        <div className="text-xs text-muted">{label.sub}</div>
                      </div>
                    </div>
                    <div className="relative min-w-0 flex-1 space-y-3 pb-8 pl-4 before:absolute before:bottom-0 before:left-0 before:top-2 before:border-l-2 before:border-dashed before:border-zinc-200 dark:before:border-zinc-800 sm:pl-5">
                      <span className="absolute -left-[3px] top-2 h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                      {g.items.map((ev) => (
                        <EventCard key={ev.id} event={ev} />
                      ))}
                    </div>
                  </section>
                );
              })}

              {list.pageCount > 1 && (
                <div className="flex items-center justify-center gap-4 pb-2 text-sm">
                  {list.page > 1 ? (
                    <Link
                      href={eventsHref(searchParams, { page: String(list.page - 1) })}
                      className="text-muted transition hover:text-accent-600"
                    >
                      {tb('prev_page')}
                    </Link>
                  ) : (
                    <span className="text-zinc-300 dark:text-zinc-700">{tb('prev_page')}</span>
                  )}
                  <span className="text-xs text-muted tabular-nums">
                    {t('page_indicator', { page: list.page, pageCount: list.pageCount })}
                  </span>
                  {list.page < list.pageCount ? (
                    <Link
                      href={eventsHref(searchParams, { page: String(list.page + 1) })}
                      className="text-muted transition hover:text-accent-600"
                    >
                      {tb('next_page')}
                    </Link>
                  ) : (
                    <span className="text-zinc-300 dark:text-zinc-700">{tb('next_page')}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── right: mini calendar + month agenda ── */}
        <aside className="hidden xl:block">
          <div className="sticky top-20 space-y-4">
            <MiniCalendar
              sp={searchParams}
              month={calMonth}
              counts={cal.counts}
              selectedDayKey={day ? dayKey(day) : ''}
            />
            <MonthAgenda sp={searchParams} cal={cal} />
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── local server subcomponents ────────────────────────────────────────────

function chipCls(active: boolean): string {
  return `inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs transition ${
    active
      ? 'border-accent-500 bg-accent-500/10 font-medium text-accent-600 dark:text-accent-400'
      : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900'
  }`;
}

function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 px-2.5 text-[11px] font-medium uppercase tracking-wider text-muted">{title}</h3>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function RailLink({
  href,
  active,
  count,
  children,
}: {
  href: string;
  active: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition ${
        active
          ? 'bg-accent-500/10 font-medium text-accent-600 dark:text-accent-400'
          : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
      }`}
    >
      {children}
      {count !== undefined && (
        <span className="font-mono text-[11px] tabular-nums text-muted">{count}</span>
      )}
    </Link>
  );
}

// 周一起头的星期表头；展示文案走 i18n（key 顺序即列顺序）。
const WEEK_HEADER_KEYS = ['wd_mon', 'wd_tue', 'wd_wed', 'wd_thu', 'wd_fri', 'wd_sat', 'wd_sun'] as const;

async function MiniCalendar({
  sp,
  month,
  counts,
  selectedDayKey,
}: {
  sp: SearchParams;
  month: Date;
  counts: Record<string, number>;
  selectedDayKey: string;
}) {
  const t = await getTranslations('events');
  const locale = await getLocale();
  const cells = monthGrid(month);
  const todayK = dayKey(nowWall());
  const monthTitle = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(month);
  return (
    <div className="surface rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">{monthTitle}</span>
        <span className="flex items-center gap-1">
          <Link
            href={eventsHref(sp, { cal: monthKey(addMonthsUtc(month, -1)) })}
            aria-label={t('prev_month')}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link
            href={eventsHref(sp, { cal: monthKey(addMonthsUtc(month, 1)) })}
            aria-label={t('next_month')}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </span>
      </div>
      <div className="grid grid-cols-7 text-center">
        {WEEK_HEADER_KEYS.map((w) => (
          <span key={w} className="pb-1.5 text-[11px] text-muted">
            {t(w)}
          </span>
        ))}
        {cells.map((c) => {
          const has = Boolean(counts[c.key]);
          const selected = c.key === selectedDayKey;
          const isToday = c.key === todayK;
          return (
            <Link
              key={c.key}
              href={eventsHref(sp, selected ? { day: '' } : { day: c.key, preset: '', from: '', to: '' })}
              title={has ? t('day_event_count', { count: counts[c.key] }) : undefined}
              className={`relative mx-auto flex h-8 w-8 items-center justify-center rounded-lg text-xs transition ${
                selected
                  ? 'bg-accent-500 font-semibold text-white'
                  : c.inMonth
                    ? `hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                        isToday
                          ? 'font-semibold text-accent-600 dark:text-accent-400'
                          : 'text-zinc-700 dark:text-zinc-200'
                      }`
                    : 'text-zinc-300 dark:text-zinc-600'
              }`}
            >
              {c.day}
              {has && (
                <span
                  className={`absolute bottom-1 h-1 w-1 rounded-full ${selected ? 'bg-white' : 'bg-accent-500'}`}
                />
              )}
            </Link>
          );
        })}
      </div>
      {selectedDayKey && (
        <Link
          href={eventsHref(sp, { day: '' })}
          className="mt-2 block text-center text-xs text-muted underline-offset-2 hover:underline"
        >
          {t('clear_date_filter')}
        </Link>
      )}
    </div>
  );
}

async function MonthAgenda({ sp, cal }: { sp: SearchParams; cal: CalendarMonthData }) {
  const t = await getTranslations('events');
  const locale = await getLocale();
  if (cal.agenda.length === 0) {
    return (
      <div className="surface rounded-2xl p-4">
        <h3 className="text-sm font-semibold">{t('month_agenda')}</h3>
        <p className="mt-2 text-xs text-muted">{t('month_agenda_empty')}</p>
      </div>
    );
  }
  return (
    <div className="surface rounded-2xl p-4">
      <h3 className="text-sm font-semibold">{t('month_agenda')}</h3>
      <ul className="mt-3 space-y-3">
        {cal.agenda.slice(0, 10).map((entry) => {
          const d = dayKeyToDate(entry.key)!;
          return (
            <li key={entry.key}>
              <Link
                href={eventsHref(sp, { day: entry.key, preset: '', from: '', to: '' })}
                className="text-xs font-medium text-muted transition hover:text-accent-600"
              >
                {fmtDateShortL(d, locale)} {weekdayShortL(d, locale)}
              </Link>
              <ul className="mt-1 space-y-1">
                {entry.items.slice(0, 3).map((it) => (
                  <li key={`${entry.key}-${it.id}`} className="flex gap-2 text-[13px]">
                    <span className="w-9 shrink-0 pt-px text-xs text-muted tabular-nums">
                      <EventTimeAgenda
                        startAt={it.startAt}
                        allDay={it.allDay}
                        timezone={it.timezone}
                        startDayKey={it.startDayKey}
                        entryDayKey={entry.key}
                      />
                    </span>
                    <Link
                      href={`/events/${it.id}`}
                      className={`min-w-0 flex-1 truncate transition hover:text-accent-600 ${
                        it.cancelled ? 'text-muted line-through' : ''
                      }`}
                    >
                      {it.title}
                    </Link>
                  </li>
                ))}
                {entry.items.length > 3 && (
                  <li className="pl-11 text-xs text-muted">
                    {t('more_events', { count: entry.items.length - 3 })}
                  </li>
                )}
              </ul>
            </li>
          );
        })}
        {cal.agenda.length > 10 && (
          <li className="text-xs text-muted">{t('more_days', { count: cal.agenda.length - 10 })}</li>
        )}
      </ul>
    </div>
  );
}
