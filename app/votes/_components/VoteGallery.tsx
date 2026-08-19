'use client';

// The vote gallery — the whole interactive body of /votes/[id]: rules header,
// budget pill, search/sort, uniform-ratio entry grid, results podium and the
// prev/next lightbox. Results/authors arrive ALREADY gated by the server
// (voteCount/title/author are null when hidden for this viewer) — this
// component only renders what it was given, never hides client-side.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Link as LinkIcon,
  Loader2,
  Megaphone,
  Minus,
  Pencil,
  Play,
  Plus,
  LayoutGrid,
  ListOrdered,
  Search,
  Trophy,
  Upload,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import { copyText } from '@/lib/clipboard';
import type { VoteActivityView, VoteEntryView } from '@/lib/vote-queries';
import { Countdown } from './Countdown';
import { EntryComments } from './EntryComments';
import { SubmitDialog } from './SubmitDialog';

type SortMode = 'default' | 'no' | 'votes';
const GRID_PAGE = 48;
type Translate = ReturnType<typeof useTranslations>;

function fmtDuration(sec: number): string {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function entryTitle(entry: VoteEntryView, t: Translate): string {
  return entry.title || t('untitled_entry', { no: entry.entryNo });
}

const RANK_STYLES: Record<number, string> = {
  1: 'bg-amber-400 text-zinc-900',
  2: 'bg-zinc-300 text-zinc-900',
  3: 'bg-amber-700/80 text-white',
};

// Module-level leaves — defining these inside VoteGallery would mint a new
// component type per render and remount their subtrees on every state change.

function EntryMedia({ entry, alt, eager = false }: { entry: VoteEntryView; alt: string; eager?: boolean }) {
  const thumb = entry.kind === 'video' ? entry.posterUrl : entry.fileUrl;
  if (thumb) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={withBasePath(thumb)}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600">
      <Play className="h-8 w-8" />
    </div>
  );
}

interface VoteButtonProps {
  entry: VoteEntryView;
  open: boolean;
  loggedIn: boolean;
  canVote: boolean;
  maxPerEntry: number;
  allowRevoke: boolean;
  budgetRemaining: number;
  busy: boolean;
  pop: boolean;
  size?: 'sm' | 'lg';
  onVote: (entry: VoteEntryView, action: 'add' | 'remove') => void;
}

function VoteButton({
  entry,
  open,
  loggedIn,
  canVote,
  maxPerEntry,
  allowRevoke,
  budgetRemaining,
  busy,
  pop,
  size = 'sm',
  onVote,
}: VoteButtonProps) {
  const t = useTranslations('votes');
  const mine = entry.myVotes;
  const canAdd = open && canVote && budgetRemaining > 0 && mine < maxPerEntry;
  const canRemove = open && canVote && allowRevoke && mine > 0;
  const base = size === 'lg' ? 'h-10 px-5 text-sm rounded-full' : 'h-8 px-3 text-xs rounded-full';

  if (!open) {
    // Ended / not started: state only, no action.
    return mine > 0 ? (
      <span
        className={`inline-flex items-center gap-1 ${base} bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900`}
      >
        <Check className="h-3.5 w-3.5" />
        {t('my_votes_n', { count: mine })}
      </span>
    ) : null;
  }

  if (maxPerEntry > 1 && mine > 0) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 ${size === 'lg' ? 'h-10 px-2' : 'h-8 px-1.5'}`}
      >
        <button
          type="button"
          aria-label={t('revoke')}
          disabled={busy || !canRemove}
          onClick={(e) => {
            e.stopPropagation();
            onVote(entry, 'remove');
          }}
          className="flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-white/20 disabled:opacity-40 dark:hover:bg-zinc-900/10"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className={`tabular-nums text-xs font-semibold ${pop ? 'animate-pulse' : ''}`}>{mine}</span>
        <button
          type="button"
          aria-label={t('vote')}
          disabled={busy || !canAdd}
          onClick={(e) => {
            e.stopPropagation();
            onVote(entry, 'add');
          }}
          className="flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-white/20 disabled:opacity-40 dark:hover:bg-zinc-900/10"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  if (mine > 0) {
    return (
      <button
        type="button"
        disabled={busy || !canRemove}
        title={canRemove ? t('revoke') : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (canRemove) onVote(entry, 'remove');
        }}
        className={`inline-flex items-center gap-1.5 ${base} bg-zinc-900 font-medium text-white transition dark:bg-zinc-100 dark:text-zinc-900 ${
          canRemove ? 'hover:bg-zinc-700 dark:hover:bg-zinc-300' : 'cursor-default'
        } ${pop ? 'scale-110' : 'scale-100'} duration-200`}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        {t('voted')}
      </button>
    );
  }

  return (
    <button
      type="button"
      // 匿名用户保持可点（/votes 有登录墙，纯防御）— 点击走 castVote 的登录跳转；
      // 已登录但无 W3 才置灰并提示。
      disabled={busy || (loggedIn && !canAdd)}
      title={
        loggedIn && !canVote
          ? t('toast_huawei_required')
          : loggedIn && !canAdd && budgetRemaining <= 0
            ? t('toast_budget_exhausted')
            : undefined
      }
      onClick={(e) => {
        e.stopPropagation();
        onVote(entry, 'add');
      }}
      className={`inline-flex items-center gap-1.5 ${base} border border-zinc-300 bg-white/90 font-medium text-zinc-800 backdrop-blur transition hover:border-zinc-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900/90 dark:text-zinc-100 dark:hover:border-zinc-400`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
      {t('vote')}
    </button>
  );
}

export function VoteGallery({ initial }: { initial: VoteActivityView }) {
  const t = useTranslations('votes');
  const router = useRouter();
  const [view, setView] = useState<VoteActivityView>(initial);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortMode>('default');
  // Lightbox tracks the ENTRY ID, never a list index — re-sorts (own votes,
  // 30s poll refresh, search) must not silently swap the viewed entry.
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<'info' | 'comments'>('info');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [gridLimit, setGridLimit] = useState(GRID_PAGE);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [popId, setPopId] = useState<string | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const resultsVisible = view.resultsVisible;

  // ── refresh (poll only for live-leaderboard contests while open) ──
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/votes/${viewRef.current.id}`);
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (data?.activity) setView(data.activity as VoteActivityView);
    } catch {
      /* transient — next poll wins */
    }
  }, []);

  useEffect(() => {
    if (!(view.resultsMode === 'realtime' && view.open)) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30_000);
    return () => clearInterval(timer);
  }, [view.resultsMode, view.open, refresh]);

  // ── voting ──
  const castVote = useCallback(
    async (entry: VoteEntryView, action: 'add' | 'remove') => {
      const current = viewRef.current;
      if (!current.viewer.loggedIn) {
        pushToast('info', t('login_required'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(`/votes/${current.id}`)}`);
        return;
      }
      if (!current.viewer.canVote) {
        pushToast('error', t('toast_huawei_required'));
        return;
      }
      if (pending.has(entry.id)) return;
      setPending((prev) => new Set(prev).add(entry.id));
      try {
        const res = await fetch(`/api/votes/${current.id}/entries/${entry.id}/vote`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const code = String(data?.error ?? '');
          const key =
            code === 'budget_exhausted'
              ? 'toast_budget_exhausted'
              : code === 'entry_cap'
                ? 'toast_entry_cap'
                : code === 'vote_closed'
                  ? 'toast_vote_closed'
                  : code === 'revoke_forbidden'
                    ? 'toast_revoke_forbidden'
                    : code === 'rate_limited'
                      ? 'toast_rate_limited'
                      : 'toast_vote_failed';
          pushToast('error', t(key));
          if (code === 'vote_closed') void refresh();
          return;
        }
        if (action === 'add') {
          setPopId(entry.id);
          setTimeout(() => setPopId((p) => (p === entry.id ? null : p)), 450);
        }
        setView((prev) => ({
          ...prev,
          voteCount: data.activityVoteCount ?? prev.voteCount,
          voterCount: data.voterCount ?? prev.voterCount,
          viewer: {
            ...prev.viewer,
            budgetUsed: data.budgetUsed,
            budgetRemaining: data.budgetRemaining,
          },
          entries: prev.entries.map((e) =>
            e.id === entry.id
              ? { ...e, myVotes: data.myVotes, voteCount: data.voteCount ?? e.voteCount }
              : e,
          ),
        }));
      } catch {
        pushToast('error', t('toast_vote_failed'));
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(entry.id);
          return next;
        });
      }
    },
    [pending, refresh, router, t],
  );

  // ── derived list ──
  const displayed = useMemo(() => {
    const query = q.trim().toLowerCase();
    let list = view.entries;
    if (query) {
      list = list.filter(
        (e) =>
          String(e.entryNo) === query ||
          (e.title ?? '').toLowerCase().includes(query) ||
          (e.authorName ?? '').toLowerCase().includes(query) ||
          (e.authorNo ?? '').toLowerCase().includes(query),
      );
    }
    if (sort === 'no') list = list.slice().sort((a, b) => a.entryNo - b.entryNo);
    else if (sort === 'votes' && resultsVisible) {
      list = list.slice().sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0) || a.entryNo - b.entryNo);
    }
    return list;
  }, [view.entries, q, sort, resultsVisible]);

  // 榜单视图按票数排（仅结果可见时提供）；灯箱导航跟随当前视图的顺序。
  const ranked = useMemo(
    () =>
      displayed
        .slice()
        .sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0) || a.entryNo - b.entryNo),
    [displayed],
  );
  const listMode = viewMode === 'list' && resultsVisible;
  const shown = listMode ? ranked : displayed;

  const shownRef = useRef(shown);
  shownRef.current = shown;
  const lightboxIdRef = useRef(lightboxId);
  lightboxIdRef.current = lightboxId;

  const lightboxIndex = lightboxId === null ? -1 : shown.findIndex((e) => e.id === lightboxId);
  const lightboxEntry = lightboxIndex >= 0 ? shown[lightboxIndex] : null;

  // 大量作品时分批渲染（DOM 数量才是卡顿来源；数据本来就一次性到位）。
  useEffect(() => {
    setGridLimit(GRID_PAGE);
  }, [q, sort, viewMode]);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || gridLimit >= shown.length) return;
    const obs = new IntersectionObserver(
      (hits) => {
        if (hits.some((h) => h.isIntersecting)) {
          setGridLimit((l) => Math.min(l + GRID_PAGE, shownRef.current.length));
        }
      },
      { rootMargin: '600px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [gridLimit, shown.length]);

  const handleCommentCount = useCallback((entryId: string, delta: number) => {
    setView((prev) => ({
      ...prev,
      entries: prev.entries.map((e) =>
        e.id === entryId ? { ...e, commentCount: Math.max(0, e.commentCount + delta) } : e,
      ),
    }));
  }, []);

  // Close only when the viewed entry left the filtered list entirely.
  useEffect(() => {
    if (lightboxId !== null && lightboxIndex === -1) setLightboxId(null);
  }, [lightboxId, lightboxIndex]);

  const podium = useMemo(() => {
    if (!(view.over && resultsVisible)) return [];
    return view.entries
      .filter((e) => (e.rank ?? 99) <= 3 && (e.voteCount ?? 0) > 0)
      .slice()
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.entryNo - b.entryNo)
      .slice(0, 3);
  }, [view.over, view.entries, resultsVisible]);

  // ── lightbox keyboard + scroll lock ──
  const lightboxOpen = lightboxEntry !== null;
  useEffect(() => {
    if (!lightboxOpen) return;
    const step = (delta: number) => {
      const list = shownRef.current;
      const idx = list.findIndex((e) => e.id === lightboxIdRef.current);
      if (idx === -1) return;
      const next = list[idx + delta];
      if (next) setLightboxId(next.id);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxId(null);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightboxOpen]);

  async function share() {
    const ok = await copyText(window.location.href);
    pushToast(ok ? 'success' : 'error', ok ? t('share_copied') : t('toast_vote_failed'));
  }

  const voteButtonShared = {
    open: view.open,
    loggedIn: view.viewer.loggedIn,
    canVote: view.viewer.canVote,
    maxPerEntry: view.maxPerEntry,
    allowRevoke: view.allowRevoke,
    budgetRemaining: view.viewer.budgetRemaining,
    onVote: castVote,
  };

  // ── chips ──
  const ruleChips: string[] = [
    view.budgetPeriod === 'daily'
      ? t('rule_budget_daily', { count: view.votesPerUser })
      : t('rule_budget_total', { count: view.votesPerUser }),
    t('rule_max_per_entry', { count: view.maxPerEntry }),
    view.showAuthors ? t('rule_named') : t('rule_anonymous'),
    view.resultsMode === 'realtime'
      ? t('rule_results_realtime')
      : view.resultsMode === 'after_end'
        ? t('rule_results_after_end')
        : t('rule_results_creator_only'),
    ...(view.allowRevoke ? [] : [t('rule_no_revoke')]),
  ];

  return (
    <div>
      {view.status === 'draft' && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <span>{t('draft_banner')}</span>
          <Link href={`/votes/${view.id}/edit`} className="font-medium underline underline-offset-2">
            {t('draft_edit_link')}
          </Link>
        </div>
      )}

      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{view.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            <Avatar name={view.creator.displayName} src={view.creator.avatarUrl} size="xs" tone="neutral" />
            <Link href={`/users/${view.creator.handle}`} className="hover:underline">
              {view.creator.displayName}
            </Link>
            <DeptTag department={view.creator.department} lab={view.creator.lab} />
            <span>·</span>
            <span>{t('card_entries', { count: view.entryCount })}</span>
            <span>{t('card_voters', { count: view.voterCount })}</span>
            {view.voteCount !== null && <span>{t('card_votes', { count: view.voteCount })}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(view.submissionsOpen || view.mySubmissions.length > 0) && (
            <button
              type="button"
              onClick={() => setSubmitOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              <Upload className="h-4 w-4" />
              {view.submissionsOpen && view.viewer.submissionCount < view.maxSubmissionsPerUser
                ? t('sub_cta')
                : t('sub_cta_mine')}
              {view.mySubmissions.some((s) => s.status === 'rejected') && (
                <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-red-400" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => void share()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm transition hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
          >
            <LinkIcon className="h-4 w-4" />
            {t('share')}
          </button>
          {view.isOwner && (
            <>
              <a
                href={withBasePath(`/api/votes/${view.id}/export`)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm transition hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
              >
                <Download className="h-4 w-4" />
                {t('export_results')}
              </a>
              <Link
                href={`/votes/${view.id}/edit`}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                <Pencil className="h-4 w-4" />
                {t('manage')}
              </Link>
            </>
          )}
        </div>
      </div>

      {/* announcement */}
      {view.announcement && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <Megaphone className="h-4 w-4 shrink-0 text-zinc-500" />
          <span className="min-w-0 truncate">{view.announcement}</span>
        </div>
      )}

      {/* window + rules */}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        {view.over ? (
          <span className="rounded-full bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
            {t('badge_ended')}
          </span>
        ) : !view.started && view.startAt ? (
          <span className="rounded-full bg-zinc-900 px-3 py-1.5 font-medium tabular-nums text-white dark:bg-zinc-100 dark:text-zinc-900">
            <Countdown target={view.startAt} prefix={t('cd_to_start')} endedText={t('badge_ongoing')} />
          </span>
        ) : view.endAt ? (
          <span className="rounded-full bg-zinc-900 px-3 py-1.5 font-medium tabular-nums text-white dark:bg-zinc-100 dark:text-zinc-900">
            <Countdown target={view.endAt} prefix={t('cd_to_end')} endedText={t('badge_ended')} />
          </span>
        ) : (
          <span className="rounded-full bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
            {t('badge_no_deadline')}
          </span>
        )}
        {ruleChips.map((chip) => (
          <span
            key={chip}
            className="rounded-full border border-zinc-200 px-3 py-1.5 text-muted dark:border-zinc-800"
          >
            {chip}
          </span>
        ))}
        {view.isOwner && view.resultsMode !== 'realtime' && !(view.over && view.resultsMode === 'after_end') && (
          <span className="rounded-full border border-dashed border-zinc-300 px-3 py-1.5 text-muted dark:border-zinc-700">
            {t('results_owner_only')}
          </span>
        )}
      </div>

      {/* description */}
      {view.descriptionMd && (
        <div className="mt-5 rounded-2xl border border-zinc-200/70 p-5 dark:border-zinc-800/70">
          <MarkdownRenderer content={view.descriptionMd} />
        </div>
      )}

      {/* podium */}
      {podium.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Trophy className="h-4 w-4" />
            {t('podium_title')}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {podium.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  // 搜索过滤可能把该作品排除在 shown 之外 — 打开前清掉过滤。
                  setQ('');
                  setLightboxId(entry.id);
                }}
                className="group overflow-hidden rounded-2xl border border-zinc-200/70 text-left transition hover:border-zinc-400 dark:border-zinc-800/70 dark:hover:border-zinc-600"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-zinc-100 dark:bg-zinc-900">
                  <EntryMedia entry={entry} alt={entryTitle(entry, t)} eager />
                  <span
                    className={`absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${RANK_STYLES[entry.rank ?? 3] ?? RANK_STYLES[3]}`}
                  >
                    {entry.rank}
                  </span>
                </div>
                <div className="p-3">
                  <div className="line-clamp-1 text-sm font-semibold">
                    {view.titlesVisible ? entryTitle(entry, t) : t('untitled_entry', { no: entry.entryNo })}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted">
                    <span className="truncate">{entry.authorName ?? ''}</span>
                    <span className="shrink-0 font-semibold text-zinc-900 dark:text-zinc-100">
                      {t('card_votes', { count: entry.voteCount ?? 0 })}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* toolbar: budget + search + sort */}
      <div className="sticky top-16 z-30 mt-8 -mx-2 rounded-2xl border border-zinc-200/70 bg-white/85 px-4 py-3 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/85">
        <div className="flex flex-wrap items-center gap-3">
          {view.open && view.viewer.loggedIn && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-3.5 py-1.5 text-xs font-semibold tabular-nums text-white dark:bg-zinc-100 dark:text-zinc-900">
              {view.budgetPeriod === 'daily'
                ? t('budget_remaining_daily', {
                    remaining: view.viewer.budgetRemaining,
                    total: view.votesPerUser,
                  })
                : t('budget_remaining', {
                    remaining: view.viewer.budgetRemaining,
                    total: view.votesPerUser,
                  })}
            </span>
          )}
          {view.open && view.viewer.loggedIn && !view.viewer.canVote && (
            <span className="text-xs text-muted">{t('huawei_hint')}</span>
          )}
          {!view.open && !view.over && view.startAt && !view.started && (
            <span className="text-xs text-muted">{t('not_started_hint')}</span>
          )}
          {!resultsVisible && view.resultsMode === 'after_end' && !view.over && (
            <span className="text-xs text-muted">{t('results_hidden_hint')}</span>
          )}
          <div className="relative ml-auto min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('search_placeholder')}
              className="h-9 w-full rounded-lg border border-zinc-200 bg-transparent pl-9 pr-3 text-sm outline-none transition focus:border-zinc-500 dark:border-zinc-800 dark:focus:border-zinc-400"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="h-9 rounded-lg border border-zinc-200 bg-transparent px-2 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-950"
            aria-label={t('sort_label')}
          >
            <option value="default">{t('sort_default')}</option>
            <option value="no">{t('sort_no')}</option>
            {resultsVisible && <option value="votes">{t('sort_votes')}</option>}
          </select>
          {resultsVisible && (
            <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
              <button
                type="button"
                title={t('view_grid')}
                onClick={() => setViewMode('grid')}
                className={`flex h-8 w-8 items-center justify-center rounded-md transition ${
                  viewMode === 'grid'
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                title={t('view_list')}
                onClick={() => setViewMode('list')}
                className={`flex h-8 w-8 items-center justify-center rounded-md transition ${
                  viewMode === 'list'
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <ListOrdered className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* grid / 榜单 */}
      {shown.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-zinc-300 py-16 text-center text-sm text-muted dark:border-zinc-700">
          {t('empty_gallery')}
        </div>
      ) : listMode ? (
        <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-200/70 dark:border-zinc-800/70">
          {shown.slice(0, gridLimit).map((entry, idx) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setLightboxId(entry.id)}
              className="flex w-full items-center gap-3 border-b border-zinc-100 px-3 py-2.5 text-left transition last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/60 sm:gap-4 sm:px-4"
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
                  (entry.rank ?? 99) <= 3 && (entry.voteCount ?? 0) > 0
                    ? RANK_STYLES[entry.rank ?? 3]
                    : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                }`}
              >
                {entry.rank ?? idx + 1}
              </span>
              <span className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900">
                <EntryMedia entry={entry} alt={entryTitle(entry, t)} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  <span className="mr-1.5 text-xs tabular-nums text-muted">#{entry.entryNo}</span>
                  {view.titlesVisible ? entryTitle(entry, t) : t('untitled_entry', { no: entry.entryNo })}
                </span>
                {entry.authorName && (
                  <span className="block truncate text-xs text-muted">
                    {entry.authorName}
                    {entry.authorNo ? ` · ${entry.authorNo}` : ''}
                  </span>
                )}
              </span>
              {entry.myVotes > 0 && <Check className="h-4 w-4 shrink-0 text-zinc-400" />}
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {t('card_votes', { count: entry.voteCount ?? 0 })}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {shown.slice(0, gridLimit).map((entry) => (
            <div key={entry.id} className="group">
              <button
                type="button"
                onClick={() => setLightboxId(entry.id)}
                className="relative block w-full overflow-hidden rounded-xl bg-zinc-100 text-left dark:bg-zinc-900"
              >
                <div className="relative aspect-[4/3]">
                  <EntryMedia entry={entry} alt={entryTitle(entry, t)} />
                  {entry.kind === 'video' && (
                    <>
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition group-hover:scale-110">
                          <Play className="h-4 w-4 translate-x-[1px]" />
                        </span>
                      </span>
                      {entry.durationSec > 0 && (
                        <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
                          {fmtDuration(entry.durationSec)}
                        </span>
                      )}
                    </>
                  )}
                  <span className="absolute left-2 top-2 flex items-center gap-1.5">
                    <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
                      #{entry.entryNo}
                    </span>
                    {view.over && resultsVisible && (entry.rank ?? 99) <= 3 && (entry.voteCount ?? 0) > 0 && (
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${RANK_STYLES[entry.rank ?? 3]}`}
                      >
                        {entry.rank}
                      </span>
                    )}
                  </span>
                  {entry.myVotes > 0 && (
                    <span className="absolute right-2 top-2 flex h-5 items-center gap-0.5 rounded-full bg-zinc-900/90 px-1.5 text-[10px] font-semibold text-white dark:bg-white/90 dark:text-zinc-900">
                      <Check className="h-3 w-3" />
                      {entry.myVotes > 1 ? entry.myVotes : ''}
                    </span>
                  )}
                  {(view.titlesVisible || view.authorsVisible) && (
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-2 pt-8">
                      {view.titlesVisible && (
                        <span className="block truncate text-xs font-medium text-white">
                          {entryTitle(entry, t)}
                        </span>
                      )}
                      {entry.authorName && (
                        <span className="block truncate text-[10px] text-white/75">
                          {entry.authorName}
                          {entry.authorNo ? ` · ${entry.authorNo}` : ''}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </button>
              <div className="mt-2 flex items-center justify-between gap-2 px-0.5">
                <VoteButton
                  entry={entry}
                  busy={pending.has(entry.id)}
                  pop={popId === entry.id}
                  {...voteButtonShared}
                />
                {entry.voteCount !== null && (
                  <span className="shrink-0 text-xs font-medium tabular-nums text-muted">
                    {t('card_votes', { count: entry.voteCount })}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {gridLimit < shown.length && (
        <div ref={sentinelRef} className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setGridLimit((l) => Math.min(l + GRID_PAGE, shown.length))}
            className="inline-flex h-9 items-center rounded-lg border border-zinc-200 px-4 text-sm transition hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
          >
            {t('load_more', { rest: shown.length - gridLimit })}
          </button>
        </div>
      )}

      {/* lightbox */}
      {lightboxEntry &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex flex-col bg-black/95"
            role="dialog"
            aria-modal="true"
            onClick={() => setLightboxId(null)}
          >
            <div
              className="flex items-center justify-between px-4 py-2.5 text-sm text-white/85"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="tabular-nums">
                {t('lightbox_counter', { index: lightboxIndex + 1, total: shown.length })}
                <span className="ml-3 text-white/60">#{lightboxEntry.entryNo}</span>
              </span>
              <button
                type="button"
                aria-label={t('close')}
                onClick={() => setLightboxId(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/15"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* media + 详情/评论 panel */}
            <div className="flex min-h-0 flex-1 flex-col sm:flex-row" onClick={(e) => e.stopPropagation()}>
              <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-2 sm:pb-4">
                {lightboxEntry.kind === 'video' ? (
                  <video
                    key={lightboxEntry.id}
                    src={withBasePath(lightboxEntry.fileUrl)}
                    poster={lightboxEntry.posterUrl ? withBasePath(lightboxEntry.posterUrl) : undefined}
                    controls
                    autoPlay
                    muted
                    playsInline
                    className="max-h-full max-w-full rounded-lg"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={lightboxEntry.id}
                    src={withBasePath(lightboxEntry.fileUrl)}
                    alt={entryTitle(lightboxEntry, t)}
                    className="max-h-full max-w-full rounded-lg object-contain"
                  />
                )}
                {lightboxIndex > 0 && (
                  <button
                    type="button"
                    aria-label={t('prev')}
                    onClick={() => setLightboxId(shown[lightboxIndex - 1].id)}
                    className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/25"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                )}
                {lightboxIndex < shown.length - 1 && (
                  <button
                    type="button"
                    aria-label={t('next')}
                    onClick={() => setLightboxId(shown[lightboxIndex + 1].id)}
                    className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/25"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>
                )}
              </div>

              <aside className="flex h-72 w-full shrink-0 flex-col border-t border-white/10 sm:h-auto sm:w-[340px] sm:border-l sm:border-t-0">
                {(() => {
                  const commentsAvailable = view.allowComments || lightboxEntry.commentCount > 0;
                  const effectiveTab = commentsAvailable ? panelTab : 'info';
                  return (
                    <>
                <div className="flex items-center gap-1 border-b border-white/10 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setPanelTab('info')}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      effectiveTab === 'info' ? 'bg-white text-zinc-900' : 'text-white/65 hover:bg-white/10'
                    }`}
                  >
                    {t('panel_info')}
                  </button>
                  {commentsAvailable && (
                    <button
                      type="button"
                      onClick={() => setPanelTab('comments')}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                        effectiveTab === 'comments' ? 'bg-white text-zinc-900' : 'text-white/65 hover:bg-white/10'
                      }`}
                    >
                      {t('panel_comments')}
                      {lightboxEntry.commentCount > 0 ? ` ${lightboxEntry.commentCount}` : ''}
                    </button>
                  )}
                </div>
                {effectiveTab === 'info' ? (
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm text-white/85">
                    <h3 className="text-base font-semibold text-white">
                      {view.titlesVisible
                        ? entryTitle(lightboxEntry, t)
                        : t('untitled_entry', { no: lightboxEntry.entryNo })}
                    </h3>
                    {lightboxEntry.authorName ? (
                      <p className="text-xs text-white/65">
                        {lightboxEntry.authorName}
                        {lightboxEntry.authorNo ? ` · ${lightboxEntry.authorNo}` : ''}
                      </p>
                    ) : (
                      !view.authorsVisible && <p className="text-xs text-white/50">{t('rule_anonymous')}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {lightboxEntry.voteCount !== null && (
                        <span className="rounded-full bg-white/10 px-2.5 py-1 font-medium tabular-nums">
                          {t('card_votes', { count: lightboxEntry.voteCount })}
                        </span>
                      )}
                      {lightboxEntry.rank !== null && view.over && (
                        <span className="rounded-full bg-white/10 px-2.5 py-1 font-medium">
                          {t('rank_n', { rank: lightboxEntry.rank })}
                        </span>
                      )}
                      {lightboxEntry.myVotes > 0 && (
                        <span className="rounded-full bg-white/10 px-2.5 py-1 font-medium">
                          {t('my_votes_n', { count: lightboxEntry.myVotes })}
                        </span>
                      )}
                    </div>
                    {lightboxEntry.description && (
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white/85">
                        {lightboxEntry.description}
                      </p>
                    )}
                    {lightboxEntry.customAnswers && lightboxEntry.customAnswers.length > 0 && (
                      <dl className="space-y-1.5 border-t border-white/10 pt-3">
                        {lightboxEntry.customAnswers.map((a) => (
                          <div key={a.id} className="text-xs">
                            <dt className="text-white/50">{a.label}</dt>
                            <dd className="mt-0.5 whitespace-pre-wrap break-words text-white/85">{a.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                ) : (
                  <EntryComments
                    key={lightboxEntry.id}
                    activityId={view.id}
                    entryId={lightboxEntry.id}
                    allowComments={view.allowComments && view.status === 'published'}
                    onCountChange={handleCommentCount}
                  />
                )}
                    </>
                  );
                })()}
              </aside>
            </div>

            {/* action bar */}
            <div
              className="flex items-center justify-end gap-3 border-t border-white/10 px-5 py-3"
              onClick={(e) => e.stopPropagation()}
            >
              {lightboxEntry.voteCount !== null && (
                <span className="text-sm font-medium tabular-nums text-white/85">
                  {t('card_votes', { count: lightboxEntry.voteCount })}
                </span>
              )}
              <VoteButton
                entry={lightboxEntry}
                busy={pending.has(lightboxEntry.id)}
                pop={popId === lightboxEntry.id}
                size="lg"
                {...voteButtonShared}
              />
            </div>
          </div>,
          document.body,
        )}

      {submitOpen && (
        <SubmitDialog
          view={view}
          onClose={() => setSubmitOpen(false)}
          onChanged={() => void refresh()}
        />
      )}
    </div>
  );
}
