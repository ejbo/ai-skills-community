// 工作台 — the owner's private workspace inside the merged 个人主页.
//
// Pure presentation over `WorkspaceData` (lib/profile/workspace.ts): no queries,
// no session, no client JS. Order is "what needs me" → "what I have" → lists:
//   1. toolbar       仅你可见 + the four creation/shelf shortcuts
//   2. stat strip    six figures, each jumping to its section (#ws-*)
//   3. 待处理        incoming requests / reviews / outdated subscriptions, each
//                    linked to the surface where it is actually handled
//   4. two columns   left: what I made (Skills, 文档 + their 评论, 收藏)
//                    right: what is in flight (草稿箱, 订阅, 活动, 投票)
//
// Motion budget (SPEC §3.7): nothing here animates on tab switch — the TabBar
// indicator is the only motion; hover states are colour only.

import Link from 'next/link';
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Download,
  FilePen,
  FileText,
  Heart,
  Inbox,
  LibraryBig,
  Lock,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  Vote,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Avatar } from '@/components/Avatar';
import { SkillCard } from '@/components/SkillCard';
import { VisibilityBadge } from '@/components/VisibilityBadge';
import { DocCover } from '@/components/library/DocCover';
import { EventTimeCard } from '@/app/events/_components/EventTime';
import { CancelledBadge, KindBadge } from '@/app/events/_components/badges';
import { zoneHue } from '@/app/zones/_components/zone-color';
import { withBasePath } from '@/lib/base-path';
import { relativeTime } from '@/lib/i18n-date';
import { dayKeyToDate } from '@/lib/events/time';
import {
  WS_FAVORITES,
  WS_FOLD,
  attentionTotal,
  type WorkspaceData,
  type WsDocRow,
  type WsDraftRow,
  type WsEventRow,
  type WsSkillRow,
  type WsSubscriptionRow,
  type WsVoteRow,
} from '@/lib/profile/workspace';
import {
  WS_ATTENTION_PILL,
  WS_LIST,
  WS_ROW,
  WS_ROWS,
  WS_ROW_BTN,
  WS_TITLE_LINK,
  WsEmpty,
  WsFoldList,
  WsSection,
  WsStatusDot,
} from './ui';

type Dict = Awaited<ReturnType<typeof getTranslations<'dashboard'>>>;
type Labels = Awaited<ReturnType<typeof getTranslations<'labels'>>>;

export async function WorkspaceView({ data }: { data: WorkspaceData }) {
  const [t, tl, locale] = await Promise.all([
    getTranslations('dashboard'),
    getTranslations('labels'),
    getLocale(),
  ]);
  const ctx: Ctx = { t, tl, locale };

  return (
    <div className="space-y-8">
      <Toolbar t={t} />

      <div className="space-y-3">
        <StatStrip data={data} t={t} />
        <AttentionPanel data={data} t={t} />
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
        <div className="min-w-0 space-y-10">
          <SkillsSection rows={data.skills} total={data.totals.skills} ctx={ctx} />
          <DocsSection rows={data.docs} total={data.totals.docs} ctx={ctx} />
          {/* A passive feed, not a to-do: it sits next to the documents it is about
              and is left out entirely while there is nothing in it. */}
          {data.docComments.length > 0 && <DocCommentsSection data={data} ctx={ctx} />}
          <FavoritesSection data={data} ctx={ctx} />
        </div>
        <div className="min-w-0 space-y-10">
          <DraftsSection rows={data.drafts} total={data.totals.drafts} ctx={ctx} />
          <SubscriptionsSection
            rows={data.subscriptions}
            total={data.totals.subscriptions}
            updates={data.attention.subscriptionUpdates}
            ctx={ctx}
          />
          <EventsSection upcoming={data.upcomingEvents} past={data.pastEvents} total={data.upcomingEventTotal} ctx={ctx} />
          <VotesSection rows={data.votes} total={data.voteTotal} ctx={ctx} />
        </div>
      </div>
    </div>
  );
}

interface Ctx {
  t: Dict;
  tl: Labels;
  locale: string;
}

// ─── top ────────────────────────────────────────────────────────────────────

const BTN_PRIMARY =
  'inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-zinc-900 px-3.5 text-sm font-medium text-white transition hover:bg-zinc-700 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 ' +
  'dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:focus-visible:ring-zinc-100 dark:focus-visible:ring-offset-zinc-950';
const BTN_SECONDARY =
  'inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-700 transition ' +
  'hover:border-zinc-400 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 ' +
  'dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-100';

function Toolbar({ t }: { t: Dict }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
          <Lock className="h-3 w-3" aria-hidden />
          {t('ws_private_chip')}
        </span>
        <p className="min-w-0 text-sm text-muted">{t('ws_intro')}</p>
      </div>
      {/* Phones: a tidy 2×2 of full-width actions instead of a ragged wrap. */}
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
        <Link href="/skills/new" className={BTN_PRIMARY}>
          <Plus className="h-4 w-4" aria-hidden />
          {t('new_skill')}
        </Link>
        <Link href="/library" className={BTN_SECONDARY}>
          <FileText className="h-3.5 w-3.5" aria-hidden />
          {t('ws_action_doc')}
        </Link>
        <Link href="/votes/new" className={BTN_SECONDARY}>
          <Vote className="h-3.5 w-3.5" aria-hidden />
          {t('ws_action_vote')}
        </Link>
        <Link href="/library/shelf" className={BTN_SECONDARY}>
          <LibraryBig className="h-3.5 w-3.5" aria-hidden />
          {t('my_shelf')}
        </Link>
      </div>
    </div>
  );
}

function StatStrip({ data, t }: { data: WorkspaceData; t: Dict }) {
  // Every figure is a real total (count queries) — the lists below are capped.
  const { totals } = data;
  const updates = data.attention.subscriptionUpdates;
  return (
    // Hairline instrument panel: gap-px over a border-coloured ground. Six tiles
    // divide evenly into 2 / 3 / 6 columns, so no empty cell ever shows.
    <nav
      aria-label={t('ws_stats_label')}
      className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-200 sm:grid-cols-3 lg:grid-cols-6 dark:border-zinc-800 dark:bg-zinc-800"
    >
      <StatTile
        href="#ws-skills"
        icon={Sparkles}
        label={t('ws_stat_skills')}
        value={totals.skills}
        sub={t('ws_stat_skills_sub', { published: totals.skillsPublished, drafts: data.draftCounts.skill })}
      />
      <StatTile
        href="#ws-docs"
        icon={BookOpen}
        label={t('ws_stat_docs')}
        value={totals.docs}
        sub={
          totals.docsProcessing > 0
            ? t('ws_stat_docs_processing', { count: totals.docsProcessing })
            : t('ws_stat_docs_ready', { count: totals.docsReady })
        }
      />
      <StatTile
        href="#ws-drafts"
        icon={FilePen}
        label={t('ws_stat_drafts')}
        value={totals.drafts}
        sub={t('ws_stat_drafts_sub', {
          skills: data.draftCounts.skill,
          zones: data.draftCounts.zonePost,
          votes: data.draftCounts.vote,
        })}
      />
      <StatTile
        href="#ws-subscriptions"
        icon={RefreshCw}
        label={t('ws_stat_subscriptions')}
        value={totals.subscriptions}
        sub={
          updates > 0
            ? t('stat_updates', { count: updates })
            : totals.subscriptions > 0
              ? t('ws_stat_all_current')
              : t('ws_stat_subscriptions_none')
        }
        alert={updates > 0}
      />
      <StatTile
        href="#ws-favorites"
        icon={Star}
        label={t('ws_stat_favorites')}
        value={data.favoriteTotal}
        sub={t('ws_stat_favorites_sub')}
      />
      <StatTile
        href="#ws-events"
        icon={CalendarDays}
        label={t('ws_stat_events')}
        value={data.upcomingEventTotal}
        sub={t('ws_stat_events_sub', { count: data.upcomingEventTotal })}
      />
    </nav>
  );
}

function StatTile({
  href,
  icon: Icon,
  label,
  value,
  sub,
  alert = false,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: number;
  sub: string;
  alert?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group flex min-w-0 flex-col bg-[rgb(var(--surface))] px-4 py-3.5 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-900 dark:hover:bg-zinc-900/70 dark:focus-visible:ring-zinc-100"
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
        {alert && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />}
      </span>
      <span className="mt-2 font-mono text-[26px] font-semibold leading-none tracking-tight tabular-nums text-zinc-900 dark:text-zinc-50">
        {value.toLocaleString('en-US')}
      </span>
      <span
        className={`mt-1.5 truncate text-[11px] ${alert ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-muted'}`}
      >
        {sub}
      </span>
    </Link>
  );
}

function AttentionPanel({ data, t }: { data: WorkspaceData; t: Dict }) {
  const a = data.attention;
  const total = attentionTotal(a);
  if (total === 0) {
    return (
      <p className="flex items-center gap-2 px-1 text-sm text-muted">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
        {t('ws_attention_clear')}
      </p>
    );
  }

  const rows: { key: string; icon: LucideIcon; title?: string; text: string; href: string; action: string }[] = [
    ...a.skills.map((i) => ({
      key: `skill:${i.ref}`,
      icon: Inbox,
      title: i.title,
      text: t('pending_requests', { count: i.count }),
      href: `/skills/${i.ref}?tab=manage`,
      action: t('ws_att_handle'),
    })),
    ...a.docs.map((i) => ({
      key: `doc:${i.ref}`,
      icon: BookOpen,
      title: i.title,
      text: t('ws_att_doc_requests', { count: i.count }),
      href: `/library/${i.ref}`,
      action: t('ws_att_handle'),
    })),
    ...a.votes.map((i) => ({
      key: `vote:${i.ref}`,
      icon: Vote,
      title: i.title,
      text: t('ws_att_vote_submissions', { count: i.count }),
      href: `/votes/${i.ref}/edit`,
      action: t('ws_att_review'),
    })),
    ...(a.subscriptionUpdates > 0
      ? [
          {
            key: 'subscriptions',
            icon: RefreshCw,
            text: t('ws_att_updates', { count: a.subscriptionUpdates }),
            href: '#ws-subscriptions',
            action: t('ws_att_view'),
          },
        ]
      : []),
  ];

  return (
    <section aria-labelledby="ws-attention-title" className={WS_LIST}>
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800/70">
        <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
        <h2 id="ws-attention-title" className="text-sm font-semibold tracking-tight">
          {t('ws_attention_title')}
        </h2>
        <span className="font-mono text-xs tabular-nums text-muted">{total}</span>
      </div>
      {/* Hairline grid via gap-px over a tinted ground; an odd last row spans both
          columns so no empty grey cell is left behind. */}
      <ul className="grid gap-px bg-zinc-100 sm:grid-cols-2 dark:bg-zinc-800/70">
        {rows.map((r, i) => (
          <li
            key={r.key}
            className={`bg-[rgb(var(--surface))] ${rows.length % 2 === 1 && i === rows.length - 1 ? 'sm:col-span-2' : ''}`}
          >
            <Link
              href={r.href}
              className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-900/40"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                <r.icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                {r.title && (
                  <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{r.title}</span>
                )}
                <span className={`block truncate ${r.title ? 'text-xs text-amber-700 dark:text-amber-300' : 'text-sm font-medium text-zinc-900 dark:text-zinc-100'}`}>
                  {r.text}
                </span>
              </span>
              <span className="shrink-0 text-xs font-medium text-zinc-500 transition-colors group-hover:text-zinc-900 dark:text-zinc-400 dark:group-hover:text-zinc-100">
                {r.action} →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Beside a section title when its list is capped below the real total. */
function ShownHint({ shown, total, t }: { shown: number; total: number; t: Dict }) {
  if (total <= shown) return null;
  return <span className="text-[11px] text-muted">{t('ws_shown_n', { count: shown })}</span>;
}

// ─── left column ────────────────────────────────────────────────────────────

const SKILL_STATUS_TONE = { published: 'ok', draft: 'wait', archived: 'off' } as const;

function SkillsSection({ rows, total, ctx }: { rows: WsSkillRow[]; total: number; ctx: Ctx }) {
  const { t, tl, locale } = ctx;
  return (
    <WsSection
      id="ws-skills"
      icon={Sparkles}
      title={t('ws_sec_skills')}
      count={total}
      extra={<ShownHint shown={rows.length} total={total} t={t} />}
    >
      {rows.length === 0 ? (
        <WsEmpty hint={t('empty_my_skills')} cta={{ href: '/skills/new', label: t('empty_my_skills_cta') }} />
      ) : (
        <WsFoldList
          items={rows}
          visible={WS_FOLD.skills}
          moreLabel={t('ws_more', { count: Math.max(0, rows.length - WS_FOLD.skills) })}
          lessLabel={t('ws_less')}
          renderItem={(s) => (
            <li key={s.id} className={`${WS_ROW} flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4`}>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                  <Link href={`/skills/${s.slug}`} className={`${WS_TITLE_LINK} max-w-full text-sm`}>
                    {s.name}
                  </Link>
                  <WsStatusDot tone={SKILL_STATUS_TONE[s.status]} label={tl(`skillStatus.${s.status}`)} />
                  <VisibilityBadge visibility={s.visibility} />
                  {s.version && <span className="font-mono text-[11px] text-muted">v{s.version}</span>}
                </div>
                {s.summary && <p className="mt-0.5 truncate text-xs text-muted">{s.summary}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
                {s.pendingRequests > 0 && (
                  <Link href={`/skills/${s.slug}?tab=manage`} className={WS_ATTENTION_PILL}>
                    <Inbox className="h-3 w-3" aria-hidden />
                    {t('ws_requests_badge', { count: s.pendingRequests })}
                  </Link>
                )}
                <span className="inline-flex items-center gap-1 font-mono tabular-nums" title={t('ws_downloads')}>
                  <Download className="h-3 w-3" aria-hidden />
                  {s.downloads.toLocaleString('en-US')}
                </span>
                <span className="inline-flex items-center gap-1 font-mono tabular-nums" title={t('ws_likes')}>
                  <Heart className="h-3 w-3" aria-hidden />
                  {s.likes.toLocaleString('en-US')}
                </span>
                <span className="text-[11px]">{relativeTime(s.updatedAt, locale)}</span>
                <Link href={`/skills/${s.slug}/manage`} className={WS_ROW_BTN}>
                  {t('manage')}
                </Link>
              </div>
            </li>
          )}
        />
      )}
    </WsSection>
  );
}

function docStatusDot(d: WsDocRow, t: Dict) {
  if (d.status === 'ready') return null;
  if (d.status === 'failed') return <WsStatusDot tone="bad" label={t('doc_failed')} />;
  return <WsStatusDot tone="wait" label={t('doc_processing')} />;
}

function DocsSection({ rows, total, ctx }: { rows: WsDocRow[]; total: number; ctx: Ctx }) {
  const { t, tl } = ctx;
  return (
    <WsSection
      id="ws-docs"
      icon={BookOpen}
      title={t('ws_sec_docs')}
      count={total}
      extra={<ShownHint shown={rows.length} total={total} t={t} />}
      // Empty ⇒ the empty state's own CTA already leads to the library.
      link={rows.length === 0 ? undefined : { href: '/library', label: t('ws_go_library') }}
    >
      {rows.length === 0 ? (
        <WsEmpty hint={t('empty_my_docs')} cta={{ href: '/library', label: t('empty_my_docs_cta') }} />
      ) : (
        <WsFoldList
          items={rows}
          visible={WS_FOLD.docs}
          moreLabel={t('ws_more', { count: Math.max(0, rows.length - WS_FOLD.docs) })}
          lessLabel={t('ws_less')}
          renderItem={(d) => (
            <li key={d.id} className={`${WS_ROW} flex items-center gap-3 px-4 py-3`}>
              <Link href={`/library/${d.slug}`} className="shrink-0" tabIndex={-1} aria-hidden>
                <DocCover
                  title={d.title}
                  coverUrl={d.coverUrl}
                  docType={d.docType}
                  className="h-12 w-9 rounded-[4px] text-[10px] shadow-sm ring-1 ring-black/5 dark:ring-white/10"
                />
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={`/library/${d.slug}`} className={`${WS_TITLE_LINK} block text-sm`}>
                  {d.title}
                </Link>
                <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted">
                  <span>{tl(`docType.${d.docType}`)}</span>
                  {docStatusDot(d, t)}
                  {d.visibility !== 'public' && (
                    <span className="inline-flex items-center gap-1">
                      <Lock className="h-3 w-3" aria-hidden />
                      {tl(`visibility.${d.visibility}`)}
                    </span>
                  )}
                  <span className="tabular-nums">
                    {t('doc_counts', { shelved: d.shelfCount, views: d.viewCount, comments: d.commentCount })}
                  </span>
                  {d.ratingCount > 0 && (
                    <span className="tabular-nums">
                      {t('doc_rating', { rating: d.avgRating.toFixed(1), count: d.ratingCount })}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-2">
                {d.pendingRequests > 0 && (
                  <Link href={`/library/${d.slug}`} className={WS_ATTENTION_PILL}>
                    <Inbox className="h-3 w-3" aria-hidden />
                    {t('ws_requests_badge', { count: d.pendingRequests })}
                  </Link>
                )}
                <Link href={`/library/${d.slug}/edit`} className={WS_ROW_BTN}>
                  {t('edit')}
                </Link>
              </div>
            </li>
          )}
        />
      )}
    </WsSection>
  );
}

function FavoritesSection({ data, ctx }: { data: WorkspaceData; ctx: Ctx }) {
  const { t } = ctx;
  return (
    <WsSection
      id="ws-favorites"
      icon={Star}
      title={t('ws_sec_favorites')}
      count={data.favoriteTotal}
      extra={
        data.favoriteTotal > WS_FAVORITES ? (
          <span className="text-[11px] text-muted">{t('ws_latest_n', { count: WS_FAVORITES })}</span>
        ) : null
      }
      link={data.favorites.length === 0 ? undefined : { href: '/skills', label: t('ws_browse_skills') }}
    >
      {data.favorites.length === 0 ? (
        <WsEmpty hint={t('empty_favorited')} cta={{ href: '/skills', label: t('go_browse') }} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.favorites.map((f) => (
            <SkillCard
              key={f.slug}
              slug={f.slug}
              name={f.name}
              summary={f.summary}
              sourceType={f.sourceType}
              visibility={f.visibility}
              author={f.author}
              updatedAt={f.updatedAt}
              stats={f.stats}
            />
          ))}
        </div>
      )}
    </WsSection>
  );
}

// ─── right column ───────────────────────────────────────────────────────────

function DraftGlyph({ row }: { row: WsDraftRow }) {
  const base = 'flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg';
  if (row.kind === 'zonePost' && row.zone) {
    if (row.zone.iconUrl) {
      return (
        // eslint-disable-next-line @next/next/no-img-element -- stored root-relative upload, basePath applied here
        <img src={withBasePath(row.zone.iconUrl)} alt="" className={`${base} object-cover ring-1 ring-black/5 dark:ring-white/10`} />
      );
    }
    const initial = (Array.from(row.zone.name.trim())[0] ?? '#').toUpperCase();
    return (
      <span
        className={`${base} text-sm font-semibold text-white`}
        style={{ backgroundColor: zoneHue(row.zone.name, row.zone.themeColor) }}
        aria-hidden
      >
        {initial}
      </span>
    );
  }
  const Icon = row.kind === 'vote' ? Vote : Sparkles;
  return (
    <span className={`${base} bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300`} aria-hidden>
      <Icon className="h-4 w-4" />
    </span>
  );
}

function DraftsSection({ rows, total, ctx }: { rows: WsDraftRow[]; total: number; ctx: Ctx }) {
  const { t, locale } = ctx;
  return (
    <WsSection
      id="ws-drafts"
      icon={FilePen}
      title={t('ws_sec_drafts')}
      count={total}
      extra={<ShownHint shown={rows.length} total={total} t={t} />}
    >
      {rows.length === 0 ? (
        <WsEmpty hint={t('ws_drafts_empty')} />
      ) : (
        <WsFoldList
          items={rows}
          visible={WS_FOLD.drafts}
          moreLabel={t('ws_more', { count: Math.max(0, rows.length - WS_FOLD.drafts) })}
          lessLabel={t('ws_less')}
          renderItem={(d) => {
            const where =
              d.kind === 'zonePost' && d.zone
                ? d.zone.name
                : d.kind === 'vote'
                  ? t('ws_draft_kind_vote')
                  : t('ws_draft_kind_skill');
            return (
              <li key={`${d.kind}:${d.id}`} className={`${WS_ROW} flex items-center gap-3 px-4 py-2.5`}>
                <DraftGlyph row={d} />
                <div className="min-w-0 flex-1">
                  <Link
                    href={d.href}
                    className={`${WS_TITLE_LINK} block text-sm ${d.title ? '' : 'italic text-zinc-500 dark:text-zinc-400'}`}
                  >
                    {d.title || t('ws_draft_untitled')}
                  </Link>
                  <p className="mt-0.5 truncate text-[11px] text-muted">
                    {where} · {t('ws_draft_edited', { time: relativeTime(d.updatedAt, locale) })}
                  </p>
                </div>
                <Link href={d.href} className={WS_ROW_BTN}>
                  {t('ws_continue')}
                </Link>
              </li>
            );
          }}
        />
      )}
    </WsSection>
  );
}

function SubscriptionsSection({
  rows,
  total,
  updates,
  ctx,
}: {
  rows: WsSubscriptionRow[];
  total: number;
  updates: number;
  ctx: Ctx;
}) {
  const { t } = ctx;
  return (
    <WsSection
      id="ws-subscriptions"
      icon={RefreshCw}
      title={t('ws_sec_subscriptions')}
      count={total}
      extra={
        <>
          {updates > 0 && (
            <span className="rounded-full bg-amber-50 px-2 py-px text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
              {t('updates_available', { count: updates })}
            </span>
          )}
          <ShownHint shown={rows.length} total={total} t={t} />
        </>
      }
    >
      {rows.length === 0 ? (
        <WsEmpty hint={t('empty_subscribed')} cta={{ href: '/skills', label: t('go_browse') }} />
      ) : (
        <WsFoldList
          items={rows}
          visible={WS_FOLD.subscriptions}
          moreLabel={t('ws_more', { count: Math.max(0, rows.length - WS_FOLD.subscriptions) })}
          lessLabel={t('ws_less')}
          renderItem={(s) => (
            <li key={s.skillId} className={`${WS_ROW} flex items-center gap-3 px-4 py-2.5`}>
              <div className="min-w-0 flex-1">
                <Link href={`/skills/${s.slug}`} className={`${WS_TITLE_LINK} block text-sm`}>
                  {s.name}
                </Link>
                <p className="mt-0.5 truncate text-[11px] text-muted">{s.authorName}</p>
              </div>
              {s.hasUpdate ? (
                <Link
                  href={`/skills/${s.slug}`}
                  className={`${WS_ATTENTION_PILL} font-mono`}
                  title={t('subscribed_meta', {
                    author: s.authorName,
                    installed: s.installed ?? '?',
                    latest: s.latest ?? '?',
                  })}
                >
                  v{s.installed} → v{s.latest}
                </Link>
              ) : (
                <span className="shrink-0 font-mono text-[11px] text-muted">
                  {s.installed ? `v${s.installed}` : s.latest ? `v${s.latest}` : ''}
                </span>
              )}
            </li>
          )}
        />
      )}
    </WsSection>
  );
}

function DateBlock({ dayKey, locale, muted }: { dayKey: string; locale: string; muted: boolean }) {
  const d = dayKeyToDate(dayKey);
  if (!d) return <span className="h-11 w-11 shrink-0" aria-hidden />;
  // The key is a WALL date stored as a UTC midnight — format it in UTC or the
  // server's own zone shifts it by a day.
  const month = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(d);
  return (
    <span
      className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg border leading-none ${
        muted
          ? 'border-zinc-200 text-zinc-400 dark:border-zinc-800 dark:text-zinc-500'
          : 'border-zinc-300 text-zinc-900 dark:border-zinc-600 dark:text-zinc-100'
      }`}
      aria-hidden
    >
      <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">{month}</span>
      <span className="mt-0.5 font-mono text-base font-semibold tabular-nums">{d.getUTCDate()}</span>
    </span>
  );
}

function EventRow({ row, locale, muted }: { row: WsEventRow; locale: string; muted: boolean }) {
  const e = row.event;
  return (
    <li className={`${WS_ROW} flex items-start gap-3 px-4 py-2.5`}>
      <DateBlock dayKey={row.dayKey} locale={locale} muted={muted} />
      <div className="min-w-0 flex-1">
        <Link
          href={`/events/${e.id}`}
          className={`${WS_TITLE_LINK} block text-sm ${muted ? 'text-zinc-600 dark:text-zinc-400' : ''}`}
        >
          {e.title}
        </Link>
        <p className="mt-0.5 truncate text-[11px] text-muted">
          <EventTimeCard startAt={e.startAt} endAt={e.endAt} allDay={e.allDay} timezone={e.timezone} />
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <KindBadge kind={e.kind} />
          {e.cancelled && <CancelledBadge />}
        </div>
      </div>
    </li>
  );
}

function EventsSection({
  upcoming,
  past,
  total,
  ctx,
}: {
  upcoming: WsEventRow[];
  past: WsEventRow[];
  total: number;
  ctx: Ctx;
}) {
  const { t, locale } = ctx;
  const empty = upcoming.length === 0 && past.length === 0;
  const pastHeader =
    past.length > 0 ? (
      <li className="bg-zinc-50/80 px-4 py-1.5 text-[11px] font-medium text-muted dark:bg-zinc-900/40">
        {t('ws_events_past')}
      </li>
    ) : null;
  return (
    <WsSection
      id="ws-events"
      icon={CalendarDays}
      title={t('ws_sec_events')}
      count={total}
      link={empty ? undefined : { href: '/events?mine=1', label: t('ws_view_all') }}
    >
      {empty ? (
        <WsEmpty hint={t('ws_events_empty')} cta={{ href: '/events', label: t('ws_events_empty_cta') }} />
      ) : (
        <div className={WS_LIST}>
          <ul className={WS_ROWS}>
            {upcoming.slice(0, WS_FOLD.upcomingEvents).map((r) => (
              <EventRow key={r.event.id} row={r} locale={locale} muted={false} />
            ))}
            {upcoming.length === 0 && (
              <li className="px-4 py-3 text-sm text-muted">{t('ws_events_none_upcoming')}</li>
            )}
            {pastHeader}
            {past.map((r) => (
              <EventRow key={r.event.id} row={r} locale={locale} muted />
            ))}
          </ul>
        </div>
      )}
    </WsSection>
  );
}

// Same semantics as the votes board (vote-theme.ts: 玫红 live / 琥珀 soon / 中性
// over) but restated here: its dark tints are written `/12`, which is not on
// Tailwind's opacity scale and silently compiles to nothing, leaving a light
// pill with light text in dark mode.
const VOTE_STATE_CLS: Record<WsVoteRow['state'], string> = {
  live: 'border border-rose-300/70 bg-rose-50 text-rose-700 dark:border-rose-500/35 dark:bg-rose-500/15 dark:text-rose-300',
  soon: 'border border-amber-300/80 bg-amber-50 text-amber-800 dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-200',
  over: 'border border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-300',
  draft: 'border border-dashed border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400',
};

function VotesSection({ rows, total, ctx }: { rows: WsVoteRow[]; total: number; ctx: Ctx }) {
  const { t } = ctx;
  return (
    <WsSection
      id="ws-votes"
      icon={Vote}
      title={t('ws_sec_votes')}
      count={total}
      link={total > 0 ? { href: '/votes?tab=mine', label: t('ws_view_all') } : undefined}
    >
      {rows.length === 0 ? (
        <WsEmpty hint={t('ws_votes_empty')} cta={{ href: '/votes/new', label: t('ws_votes_empty_cta') }} />
      ) : (
        <WsFoldList
          items={rows}
          visible={WS_FOLD.votes}
          moreLabel={t('ws_more', { count: Math.max(0, rows.length - WS_FOLD.votes) })}
          lessLabel={t('ws_less')}
          renderItem={(v) => (
            <li key={v.id} className={`${WS_ROW} flex items-center gap-3 px-4 py-2.5`}>
              <Link
                href={`/votes/${v.id}`}
                tabIndex={-1}
                aria-hidden
                className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-100 text-zinc-400 ring-1 ring-black/5 dark:bg-zinc-800 dark:text-zinc-500 dark:ring-white/10"
              >
                {v.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- login-gated vote media, basePath applied here
                  <img src={withBasePath(v.coverUrl)} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <Vote className="h-4 w-4" />
                )}
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={`/votes/${v.id}`} className={`${WS_TITLE_LINK} block text-sm`}>
                  {v.title}
                </Link>
                <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
                  <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium ${VOTE_STATE_CLS[v.state]}`}>
                    {t(`ws_vote_${v.state}`)}
                  </span>
                  {v.pendingSubmissions > 0 && (
                    <Link href={`/votes/${v.id}/edit`} className={`${WS_ATTENTION_PILL} h-[18px] px-1.5 text-[10px]`}>
                      {t('ws_vote_pending_badge', { count: v.pendingSubmissions })}
                    </Link>
                  )}
                  <span className="ml-0.5 truncate tabular-nums">
                    {t('ws_vote_meta', { entries: v.entryCount, voters: v.voterCount })}
                  </span>
                </p>
              </div>
              <Link href={`/votes/${v.id}/edit`} className={WS_ROW_BTN}>
                {t('edit')}
              </Link>
            </li>
          )}
        />
      )}
    </WsSection>
  );
}

function DocCommentsSection({ data, ctx }: { data: WorkspaceData; ctx: Ctx }) {
  const { t, locale } = ctx;
  const rows = data.docComments;
  return (
    <WsSection id="ws-doc-comments" icon={MessageSquare} title={t('ws_sec_doc_comments')} count={rows.length}>
      <div className={WS_LIST}>
          <ul className={WS_ROWS}>
            {rows.map((c) => (
              <li key={c.id} className={`${WS_ROW} flex items-start gap-3 px-4 py-3`}>
                <Avatar
                  name={c.author.displayName}
                  src={c.author.avatarUrl}
                  size="sm"
                  handle={c.author.handle}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-1 text-[11px] text-muted">
                    <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">
                      {c.author.displayName}
                    </span>
                    <span className="shrink-0">·</span>
                    <span className="shrink-0">{relativeTime(c.createdAt, locale)}</span>
                  </p>
                  <Link
                    href={`/library/${c.doc.slug}?focus=${c.id}`}
                    className="mt-0.5 line-clamp-2 text-sm text-zinc-800 decoration-zinc-300 underline-offset-2 hover:underline dark:text-zinc-200 dark:decoration-zinc-600"
                  >
                    {c.excerpt}
                  </Link>
                  <p className="mt-0.5 truncate text-[11px] text-muted">{t('on_doc', { title: c.doc.title })}</p>
                </div>
              </li>
            ))}
          </ul>
      </div>
    </WsSection>
  );
}
