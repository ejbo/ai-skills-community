'use client';

// The vote gallery — the whole interactive body of /votes/[id]: rules header,
// budget pill, search/sort, uniform-ratio entry grid, results podium and the
// prev/next lightbox. Results/authors arrive ALREADY gated by the server
// (voteCount/title/author are null when hidden for this viewer) — this
// component only renders what it was given, never hides client-side.
//
// Voting is 先选后提交: a click on a card only edits a LOCAL draft (instant,
// no network), the sticky toolbar shows the draft-adjusted budget and a single
// 提交投票 button ships every change in ONE request (POST .../ballots). The
// draft lives in sessionStorage per tab so a reload never loses a selection.

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  RotateCcw,
  Search,
  Send,
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
import { holdNavBarHidden } from '@/lib/nav-chrome';
import type { VoteActivityView, VoteEntryView } from '@/lib/vote-queries';
import {
  MAX_BALLOT_CHANGES,
  reconcileDraft,
  stepDraftCount,
  type BallotChange,
  type BallotDraft,
  type BallotRules,
} from '@/lib/votes/shared';
import { Countdown } from './Countdown';
import { EntryComments } from './EntryComments';
import { SubmitDialog } from './SubmitDialog';

type SortMode = 'default' | 'no' | 'votes';
const GRID_PAGE = 48;
const DRAFT_STORAGE_PREFIX = 'votes:draft:';
// NavBarShell = 12px top padding + 56px bar; hold it hidden a little early.
const NAVBAR_BAND_PX = 80;
type Translate = ReturnType<typeof useTranslations>;

/** Draft = desired count per entry, ONLY where it differs from the server's myVotes. */
type Draft = BallotDraft;

const ERROR_TOAST: Record<string, string> = {
  budget_exhausted: 'toast_budget_exhausted',
  entry_cap: 'toast_entry_cap',
  vote_closed: 'toast_vote_closed',
  revoke_forbidden: 'toast_revoke_forbidden',
  rate_limited: 'toast_rate_limited',
  entry_unavailable: 'toast_entry_unavailable',
  budget_reset: 'toast_budget_reset',
  huawei_required: 'toast_huawei_required',
};
// Server answers that mean the client's picture is stale — re-read before retrying.
const STALE_ERRORS = new Set([
  'vote_closed',
  'budget_exhausted',
  'entry_cap',
  'revoke_forbidden',
  'entry_unavailable',
  'budget_reset',
  'not_found',
]);

function fmtDuration(sec: number): string {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function entryTitle(entry: VoteEntryView, t: Translate): string {
  return entry.title || t('untitled_entry', { no: entry.entryNo });
}

function rulesOf(view: VoteActivityView): BallotRules {
  return { votesPerUser: view.votesPerUser, maxPerEntry: view.maxPerEntry, allowRevoke: view.allowRevoke };
}

interface DraftBudget {
  changes: BallotChange[];
  adds: number;
  removes: number;
  used: number;
  remaining: number;
  /** Votes above votesPerUser (only possible after the creator lowered it) — adds are refused, revokes still go through. */
  over: number;
}

/** Budget after the draft applies. Overrides for entries no longer shown are ignored. */
function draftBudget(view: VoteActivityView, draft: Draft, entryById: ReadonlyMap<string, VoteEntryView>): DraftBudget {
  let delta = 0;
  let adds = 0;
  let removes = 0;
  const changes: BallotChange[] = [];
  for (const id in draft) {
    const entry = entryById.get(id);
    const count = draft[id];
    if (!entry || count === entry.myVotes) continue;
    const d = count - entry.myVotes;
    delta += d;
    if (d > 0) adds += d;
    else removes -= d;
    changes.push({ entryId: id, count });
  }
  const used = view.viewer.budgetUsed + delta;
  return {
    changes,
    adds,
    removes,
    used,
    remaining: Math.max(0, view.votesPerUser - used),
    over: Math.max(0, used - view.votesPerUser),
  };
}

/** Keep the previous entry object when nothing changed so memoized cards skip re-rendering. */
function sameEntry(a: VoteEntryView, b: VoteEntryView): boolean {
  for (const key of Object.keys(b) as (keyof VoteEntryView)[]) {
    if (key === 'customAnswers') continue;
    if (a[key] !== b[key]) return false;
  }
  return JSON.stringify(a.customAnswers) === JSON.stringify(b.customAnswers);
}

function mergeView(prev: VoteActivityView, next: VoteActivityView): VoteActivityView {
  const prevById = new Map(prev.entries.map((e) => [e.id, e]));
  const entries = next.entries.map((e) => {
    const old = prevById.get(e.id);
    return old && sameEntry(old, e) ? old : e;
  });
  return { ...next, entries };
}

const RANK_STYLES: Record<number, string> = {
  1: 'bg-amber-400 text-zinc-900',
  2: 'bg-zinc-300 text-zinc-900',
  3: 'bg-amber-700/80 text-white',
};

// Module-level leaves — defining these inside VoteGallery would mint a new
// component type per render and remount their subtrees on every state change.

/** 卡片版式 class（横版 4:3 / 竖版 3:4 — posterAspect 决定）。 */
function aspectClass(entry: VoteEntryView): string {
  return entry.posterAspect === 'portrait' ? 'aspect-[3/4]' : 'aspect-[4/3]';
}

function EntryMedia({ entry, alt, eager = false }: { entry: VoteEntryView; alt: string; eager?: boolean }) {
  const thumb = entry.kind === 'video' ? entry.posterUrl : entry.fileUrl;
  if (!thumb) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600">
        <Play className="h-8 w-8" />
      </div>
    );
  }
  // posterPos 三态：'contain' = 完整显示（模糊铺底）；'x% y%' = 选区；'' = 居中。
  if (entry.posterPos === 'contain') {
    return (
      <div className="relative h-full w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={withBasePath(thumb)}
          alt=""
          aria-hidden
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-md"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={withBasePath(thumb)}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className="relative h-full w-full object-contain"
        />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={withBasePath(thumb)}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      className="h-full w-full object-cover"
      style={{ objectPosition: /^\d/.test(entry.posterPos) ? entry.posterPos : '50% 50%' }}
    />
  );
}

/**
 * Everything a card needs from the activity that is NOT per-entry. Rebuilt only
 * when one of these flags flips (not on every draft click), so memoized cards
 * stay put while the user selects.
 */
interface CardCtx {
  open: boolean;
  over: boolean;
  loggedIn: boolean;
  canVote: boolean;
  resultsVisible: boolean;
  titlesVisible: boolean;
  authorsVisible: boolean;
  maxPerEntry: number;
  allowRevoke: boolean;
  /** Draft-adjusted budget left > 0 — flips only when the budget runs out / frees up. */
  budgetLeft: boolean;
  submitting: boolean;
}

type StepFn = (entryId: string, delta: 1 | -1) => void;

interface VoteButtonProps {
  entry: VoteEntryView;
  draftCount: number;
  ctx: CardCtx;
  pop: boolean;
  size?: 'sm' | 'lg';
  onStep: StepFn;
}

// Three-level visual language: light outline = 投票 (not selected) → strong
// black outline = 已选 (in the draft, not yet submitted) → solid black = 已投
// (submitted). Pending 撤回 is a dashed outline with an undo affordance.
const BTN_NONE =
  'border border-zinc-300 bg-white/90 text-zinc-800 hover:border-zinc-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900/90 dark:text-zinc-100 dark:hover:border-zinc-400';
const BTN_PENDING =
  'border-2 border-zinc-900 bg-white text-zinc-900 hover:bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900';
const BTN_COMMITTED = 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900';

function VoteButton({ entry, draftCount, ctx, pop, size = 'sm', onStep }: VoteButtonProps) {
  const t = useTranslations('votes');
  const committed = entry.myVotes;
  const pending = draftCount !== committed;
  const canAdd = ctx.open && ctx.canVote && ctx.budgetLeft && draftCount < ctx.maxPerEntry && !ctx.submitting;
  // Taking back an unsubmitted vote is always allowed; going below the
  // committed count is 撤票 and needs allowRevoke.
  const canRemove =
    ctx.open && ctx.canVote && draftCount > 0 && (draftCount > committed || ctx.allowRevoke) && !ctx.submitting;
  const base = size === 'lg' ? 'h-10 px-5 text-sm rounded-full' : 'h-8 px-3 text-xs rounded-full';

  if (!ctx.open) {
    // Ended / not started: state only, no action.
    return committed > 0 ? (
      <span className={`inline-flex items-center gap-1 ${base} ${BTN_COMMITTED} font-medium`}>
        <Check className="h-3.5 w-3.5" />
        {t('my_votes_n', { count: committed })}
      </span>
    ) : null;
  }

  // 撤回待提交：the committed vote(s) are dropped in the draft — offer 恢复.
  if (draftCount === 0 && committed > 0) {
    return (
      <button
        type="button"
        title={t('restore_vote')}
        disabled={ctx.submitting}
        onClick={(e) => {
          e.stopPropagation();
          onStep(entry.id, 1);
        }}
        className={`inline-flex items-center gap-1.5 ${base} border border-dashed border-zinc-400 text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-800 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-zinc-300 dark:hover:text-zinc-100`}
      >
        <RotateCcw className="h-3.5 w-3.5" />
        {t('revoke_pending')}
      </button>
    );
  }

  if (ctx.maxPerEntry > 1 && draftCount > 0) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full transition ${pending ? BTN_PENDING : BTN_COMMITTED} ${
          size === 'lg' ? 'h-10 px-2' : 'h-8 px-1.5'
        }`}
        title={pending ? t('selected_pending') : undefined}
      >
        <button
          type="button"
          aria-label={t('revoke')}
          disabled={!canRemove}
          onClick={(e) => {
            e.stopPropagation();
            onStep(entry.id, -1);
          }}
          className="flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-black/10 disabled:opacity-40 dark:hover:bg-white/15"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className={`min-w-[1ch] text-center text-xs font-semibold tabular-nums ${pop ? 'animate-pulse' : ''}`}>
          {draftCount}
        </span>
        <button
          type="button"
          aria-label={t('vote')}
          disabled={!canAdd}
          onClick={(e) => {
            e.stopPropagation();
            onStep(entry.id, 1);
          }}
          className="flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-black/10 disabled:opacity-40 dark:hover:bg-white/15"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  if (draftCount > 0) {
    return (
      <button
        type="button"
        disabled={!canRemove}
        title={canRemove ? (pending ? t('unselect') : t('revoke')) : t('rule_no_revoke')}
        onClick={(e) => {
          e.stopPropagation();
          if (canRemove) onStep(entry.id, -1);
        }}
        className={`inline-flex items-center gap-1.5 ${base} font-medium transition duration-200 ${
          pending ? BTN_PENDING : `${BTN_COMMITTED} ${canRemove ? 'hover:bg-zinc-700 dark:hover:bg-zinc-300' : 'cursor-default'}`
        } ${pop ? 'scale-110' : 'scale-100'} disabled:opacity-100`}
      >
        <Check className="h-3.5 w-3.5" />
        {pending ? t('selected') : t('voted')}
      </button>
    );
  }

  return (
    <button
      type="button"
      // 匿名用户保持可点（/votes 有登录墙，纯防御）— 点击走 step 的登录跳转；
      // 已登录但无 W3 才置灰并提示。
      disabled={ctx.loggedIn && !canAdd}
      title={
        ctx.loggedIn && !ctx.canVote
          ? t('toast_huawei_required')
          : ctx.loggedIn && !canAdd && !ctx.budgetLeft
            ? t('toast_budget_exhausted')
            : undefined
      }
      onClick={(e) => {
        e.stopPropagation();
        onStep(entry.id, 1);
      }}
      className={`inline-flex items-center gap-1.5 ${base} ${BTN_NONE} font-medium transition`}
    >
      <Plus className="h-3.5 w-3.5" />
      {t('vote')}
    </button>
  );
}

interface EntryCardProps {
  entry: VoteEntryView;
  draftCount: number;
  ctx: CardCtx;
  pop: boolean;
  onOpen: (entryId: string) => void;
  onStep: StepFn;
}

// One grid cell. memo + stable callbacks: a draft click re-renders ONLY the
// card it touched (and the toolbar), not the whole gallery.
const EntryCard = memo(function EntryCard({ entry, draftCount, ctx, pop, onOpen, onStep }: EntryCardProps) {
  const t = useTranslations('votes');
  const pending = draftCount !== entry.myVotes;
  return (
    <div className="group cv-auto -m-1 p-1">
      <button
        type="button"
        onClick={() => onOpen(entry.id)}
        className="relative block w-full overflow-hidden rounded-xl bg-zinc-100 text-left dark:bg-zinc-900"
      >
        <div className={`relative ${aspectClass(entry)}`}>
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
            {ctx.over && ctx.resultsVisible && (entry.rank ?? 99) <= 3 && (entry.voteCount ?? 0) > 0 && (
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${RANK_STYLES[entry.rank ?? 3]}`}
              >
                {entry.rank}
              </span>
            )}
          </span>
          {draftCount > 0 && (
            <span
              className={`absolute right-2 top-2 flex h-5 items-center gap-0.5 rounded-full px-1.5 text-[10px] font-semibold ${
                pending
                  ? 'border-2 border-zinc-900 bg-white text-zinc-900 dark:border-white dark:bg-zinc-900 dark:text-white'
                  : 'bg-zinc-900/90 text-white dark:bg-white/90 dark:text-zinc-900'
              }`}
            >
              <Check className="h-3 w-3" />
              {draftCount > 1 ? draftCount : ''}
            </span>
          )}
          {(ctx.titlesVisible || ctx.authorsVisible) && (
            <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-2 pt-8">
              {ctx.titlesVisible && (
                <span className="block truncate text-xs font-medium text-white">{entryTitle(entry, t)}</span>
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
        <VoteButton entry={entry} draftCount={draftCount} ctx={ctx} pop={pop} onStep={onStep} />
        {entry.voteCount !== null && (
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted">
            {t('card_votes', { count: entry.voteCount })}
          </span>
        )}
      </div>
    </div>
  );
});

export function VoteGallery({ initial }: { initial: VoteActivityView }) {
  const t = useTranslations('votes');
  const router = useRouter();
  const [view, setView] = useState<VoteActivityView>(initial);
  const [q, setQ] = useState('');
  // Filtering a few hundred cards is cheap, but keeping the input's own
  // keystroke ahead of the grid re-render is what makes typing feel instant.
  const deferredQ = useDeferredValue(q);
  const [sort, setSort] = useState<SortMode>('default');
  // Lightbox tracks the ENTRY ID, never a list index — re-sorts (own votes,
  // 30s poll refresh, search) must not silently swap the viewed entry.
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<'info' | 'comments'>('info');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [gridLimit, setGridLimit] = useState(GRID_PAGE);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [submitting, setSubmitting] = useState(false);
  const [popId, setPopId] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const submittingRef = useRef(false);
  // `step` is the one callback every memoized card receives — read the
  // translator through a ref so its identity never depends on next-intl's.
  const tRef = useRef(t);
  tRef.current = t;

  const resultsVisible = view.resultsVisible;

  const entryById = useMemo(() => new Map(view.entries.map((e) => [e.id, e])), [view.entries]);
  const entryByIdRef = useRef(entryById);
  entryByIdRef.current = entryById;

  // ── draft budget (what the toolbar and every button key off) ──
  const budget = useMemo(() => draftBudget(view, draft, entryById), [view, draft, entryById]);
  const dirty = budget.changes.length > 0;

  // ── refresh (poll only for live-leaderboard contests while open) ──
  // A submit that lands while a poll is in flight bumps the epoch, so the
  // older snapshot can never overwrite the authoritative post-submit state.
  const epochRef = useRef(0);
  const refresh = useCallback(async () => {
    const epoch = epochRef.current;
    try {
      const res = await fetch(`/api/votes/${viewRef.current.id}`);
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (epoch !== epochRef.current) return;
      if (data?.activity) setView((prev) => mergeView(prev, data.activity as VoteActivityView));
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

  // ── draft persistence (per tab, per activity + viewer + budget bucket) ──
  const storageKey =
    view.viewer.loggedIn && view.viewer.id
      ? `${DRAFT_STORAGE_PREFIX}${view.id}:${view.viewer.id}:${view.viewer.dayKey}`
      : null;
  // The persist effect may only run once the draft for THIS key is committed —
  // gate on state that flips in the same batch as the hydrated draft, not on
  // a ref (a ref flips before the setDraft lands and would wipe storage first).
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!storageKey) {
      setHydratedKey(null);
      return;
    }
    let next: Draft = {};
    if (viewRef.current.open) {
      try {
        const raw = sessionStorage.getItem(storageKey);
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        if (parsed && typeof parsed === 'object') {
          for (const [id, count] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof count === 'number' && Number.isInteger(count) && count >= 0) next[id] = count;
          }
        }
      } catch {
        /* storage blocked — the draft just lives in memory */
      }
    }
    // Always replace: a key change (daily bucket rollover) must not carry
    // overrides computed against the old bucket into the new one.
    setDraft(next);
    setHydratedKey(storageKey);
  }, [storageKey]);
  useEffect(() => {
    if (!storageKey || hydratedKey !== storageKey) return;
    try {
      if (Object.keys(draft).length === 0) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }, [draft, storageKey, hydratedKey]);

  // Re-validate the draft against the server truth whenever it changes:
  // overrides that now equal myVotes or whose entry vanished are dropped, and
  // pending ADDS are trimmed to the (possibly lowered) cap/budget so the
  // toolbar never offers a submit that can only fail.
  useEffect(() => {
    const current = viewRef.current;
    const committed = new Map<string, number>();
    for (const e of current.entries) committed.set(e.id, e.myVotes);
    const result = reconcileDraft(rulesOf(current), current.open, current.viewer.budgetUsed, committed, draftRef.current);
    if (result.changed) setDraft(result.next);
    if (result.trimmed) pushToast('info', tRef.current('toast_draft_trimmed'));
  }, [entryById, view.open, view.votesPerUser, view.maxPerEntry, view.viewer.budgetUsed]);

  // Unsubmitted selections are the one thing this flow can silently lose.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ── voting (local draft) ──
  const step = useCallback<StepFn>(
    (entryId, delta) => {
      const current = viewRef.current;
      const tt = tRef.current;
      if (!current.viewer.loggedIn) {
        pushToast('info', tt('login_required'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(`/votes/${current.id}`)}`);
        return;
      }
      if (!current.viewer.canVote) {
        pushToast('error', tt('toast_huawei_required'));
        return;
      }
      if (!current.open) {
        pushToast('error', tt('toast_vote_closed'));
        return;
      }
      if (submittingRef.current) return;
      const entries = entryByIdRef.current;
      const entry = entries.get(entryId);
      if (!entry) return;
      const prev = draftRef.current;
      if (delta > 0 && !(entryId in prev) && Object.keys(prev).length >= MAX_BALLOT_CHANGES) {
        pushToast('error', tt('toast_too_many_changes', { count: MAX_BALLOT_CHANGES }));
        return;
      }
      const decided = stepDraftCount(
        rulesOf(current),
        entry.myVotes,
        prev[entryId] ?? entry.myVotes,
        delta,
        draftBudget(current, prev, entries).remaining,
      );
      if (!decided.ok) {
        if (decided.error !== 'nothing_to_remove') pushToast('error', tt(ERROR_TOAST[decided.error]));
        return;
      }
      setDraft((p) => {
        // Re-derive from the latest state (StrictMode / batched clicks).
        const again = stepDraftCount(
          rulesOf(current),
          entry.myVotes,
          p[entryId] ?? entry.myVotes,
          delta,
          draftBudget(current, p, entries).remaining,
        );
        if (!again.ok) return p;
        const next = { ...p };
        if (again.next === entry.myVotes) delete next[entryId];
        else next[entryId] = again.next;
        return next;
      });
      if (delta > 0) {
        setPopId(entryId);
        setTimeout(() => setPopId((p) => (p === entryId ? null : p)), 450);
      }
    },
    [router],
  );

  const discard = useCallback(() => setDraft({}), []);

  const submit = useCallback(async () => {
    const current = viewRef.current;
    const { changes } = draftBudget(current, draftRef.current, entryByIdRef.current);
    if (changes.length === 0 || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/votes/${current.id}/ballots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ day: current.viewer.dayKey, changes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = String(data?.error ?? '');
        pushToast('error', t(ERROR_TOAST[code] ?? 'toast_vote_failed'));
        if (code === 'entry_unavailable' && typeof data?.entryId === 'string') {
          const gone = data.entryId as string;
          setDraft((p) => {
            if (!(gone in p)) return p;
            const next = { ...p };
            delete next[gone];
            return next;
          });
        }
        // The draft was computed against another day's bucket — it means
        // nothing now; the refresh brings the new dayKey / myVotes.
        if (code === 'budget_reset') setDraft({});
        if (STALE_ERRORS.has(code)) await refresh();
        return;
      }
      epochRef.current += 1;
      const myBallots = (data.myBallots ?? {}) as Record<string, number>;
      const entryVotes = (data.entryVotes ?? null) as Record<string, number> | null;
      setView((prev) => ({
        ...prev,
        voteCount: data.activityVoteCount ?? prev.voteCount,
        voterCount: data.voterCount ?? prev.voterCount,
        viewer: {
          ...prev.viewer,
          budgetUsed: data.budgetUsed,
          budgetRemaining: data.budgetRemaining,
        },
        entries: prev.entries.map((e) => {
          const myVotes = myBallots[e.id] ?? 0;
          const voteCount = entryVotes && e.id in entryVotes ? entryVotes[e.id] : e.voteCount;
          return myVotes === e.myVotes && voteCount === e.voteCount ? e : { ...e, myVotes, voteCount };
        }),
      }));
      setDraft({});
      pushToast('success', t('toast_submitted'));
    } catch {
      pushToast('error', t('toast_vote_failed'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [refresh, t]);

  // ── derived list ──
  const displayed = useMemo(() => {
    const query = deferredQ.trim().toLowerCase();
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
  }, [view.entries, deferredQ, sort, resultsVisible]);

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
  }, [deferredQ, sort, viewMode]);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
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

  // ── sticky toolbar: dock at the top and hold the main navbar hidden ──
  // A 1px sentinel sits directly above the toolbar; once it scrolls out at the
  // top the toolbar is pinned (sticky top-0). While pinned, the global navbar
  // must NOT come back on scroll-up (it would stack on the toolbar and cover
  // more of the works) — released the moment the toolbar unpins.
  const toolbarSentinelRef = useRef<HTMLDivElement>(null);
  const [nearTop, setNearTop] = useState(false);
  useEffect(() => {
    const el = toolbarSentinelRef.current;
    if (!el) return;
    // Docked ⇔ the sentinel scrolled out at the very top.
    const dock = new IntersectionObserver(([hit]) => {
      setStuck(!hit.isIntersecting && hit.boundingClientRect.bottom <= 0);
    });
    // Hold the navbar from the moment the toolbar enters the band the navbar
    // would occupy (its 68px + slack), so neither scroll direction ever shows
    // the two bars overlapping.
    const band = new IntersectionObserver(
      ([hit]) => {
        setNearTop(!hit.isIntersecting && hit.boundingClientRect.bottom <= NAVBAR_BAND_PX);
      },
      { rootMargin: `-${NAVBAR_BAND_PX}px 0px 0px 0px` },
    );
    dock.observe(el);
    band.observe(el);
    return () => {
      dock.disconnect();
      band.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!nearTop) return;
    return holdNavBarHidden();
  }, [nearTop]);

  const handleCommentCount = useCallback((entryId: string, delta: number) => {
    setView((prev) => ({
      ...prev,
      entries: prev.entries.map((e) =>
        e.id === entryId ? { ...e, commentCount: Math.max(0, e.commentCount + delta) } : e,
      ),
    }));
  }, []);

  const openLightbox = useCallback((entryId: string) => setLightboxId(entryId), []);

  // Close only when the viewed entry left the filtered list entirely — and
  // never while the deferred filter is still catching up with the input (the
  // podium click clears the search and opens in the same tick).
  useEffect(() => {
    if (q !== deferredQ) return;
    if (lightboxId !== null && lightboxIndex === -1) setLightboxId(null);
  }, [q, deferredQ, lightboxId, lightboxIndex]);

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

  const budgetLeft = budget.remaining > 0;
  const cardCtx = useMemo<CardCtx>(
    () => ({
      open: view.open,
      over: view.over,
      loggedIn: view.viewer.loggedIn,
      canVote: view.viewer.canVote,
      resultsVisible,
      titlesVisible: view.titlesVisible,
      authorsVisible: view.authorsVisible,
      maxPerEntry: view.maxPerEntry,
      allowRevoke: view.allowRevoke,
      budgetLeft,
      submitting,
    }),
    [
      view.open,
      view.over,
      view.viewer.loggedIn,
      view.viewer.canVote,
      resultsVisible,
      view.titlesVisible,
      view.authorsVisible,
      view.maxPerEntry,
      view.allowRevoke,
      budgetLeft,
      submitting,
    ],
  );
  const draftCountOf = (entry: VoteEntryView) => draft[entry.id] ?? entry.myVotes;
  const showBudget = view.open && view.viewer.loggedIn;
  // react-markdown re-parses on every render; the description only changes
  // with the payload, so build the element once per text.
  const description = useMemo(
    () =>
      view.descriptionMd ? (
        <div className="mt-5 rounded-2xl border border-zinc-200/70 p-5 dark:border-zinc-800/70">
          <MarkdownRenderer content={view.descriptionMd} />
        </div>
      ) : null,
    [view.descriptionMd],
  );

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
            <Avatar name={view.creator.displayName} src={view.creator.avatarUrl} size="xs" />
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
      {description}

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
                <div className={`relative overflow-hidden bg-zinc-100 dark:bg-zinc-900 ${aspectClass(entry)}`}>
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

      {/* toolbar: budget + submit + search + sort. Sticky at the very top (the
          main navbar is held hidden while it is pinned); opaque background on
          purpose — backdrop-blur over a scrolling image grid is the classic
          jank source. */}
      <div ref={toolbarSentinelRef} aria-hidden className="mt-8 h-px w-full" />
      <div
        // Docked: bleed to the container edge; the inner width (-mx-6 + px-8 ≡
        // -mx-2 + px-4) and the box height (border-t stays, transparent) are
        // identical to the resting card so nothing re-wraps or shifts.
        className={`sticky top-0 z-30 border border-zinc-200/70 bg-white py-2 transition-shadow dark:border-zinc-800/70 dark:bg-zinc-950 ${
          stuck
            ? '-mx-6 rounded-none border-x-0 border-t-transparent px-8 shadow-md shadow-black/5 dark:border-t-transparent dark:shadow-black/40'
            : '-mx-2 rounded-2xl px-4'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          {showBudget && (
            <span
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold tabular-nums ${
                budgetLeft
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'
              }`}
            >
              {view.budgetPeriod === 'daily'
                ? t('budget_remaining_daily', { remaining: budget.remaining, total: view.votesPerUser })
                : t('budget_remaining', { remaining: budget.remaining, total: view.votesPerUser })}
            </span>
          )}
          {showBudget && dirty && (
            <>
              <span className="text-xs font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
                {[
                  budget.adds > 0 ? t('pending_adds', { count: budget.adds }) : null,
                  budget.removes > 0 ? t('pending_removes', { count: budget.removes }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={submitting}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-zinc-900 px-4 text-xs font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {submitting ? t('submitting_votes') : t('submit_votes')}
              </button>
              <button
                type="button"
                onClick={discard}
                disabled={submitting}
                className="inline-flex h-8 items-center rounded-full border border-zinc-200 px-3 text-xs transition hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-800 dark:hover:bg-zinc-800"
              >
                {t('discard_draft')}
              </button>
            </>
          )}
          {showBudget && budget.over > 0 && (
            <span className="text-xs text-muted">{t('over_budget_hint', { count: budget.over })}</span>
          )}
          {showBudget && !dirty && view.viewer.canVote && budgetLeft && (
            <span className="hidden text-xs text-muted lg:inline">{t('batch_hint')}</span>
          )}
          {showBudget && !view.viewer.canVote && <span className="text-xs text-muted">{t('huawei_hint')}</span>}
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
              className="h-8 w-full rounded-lg border border-zinc-200 bg-transparent pl-9 pr-3 text-sm outline-none transition focus:border-zinc-500 dark:border-zinc-800 dark:focus:border-zinc-400"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="h-8 rounded-lg border border-zinc-200 bg-transparent px-2 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-950"
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
                className={`flex h-7 w-7 items-center justify-center rounded-md transition ${
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
                className={`flex h-7 w-7 items-center justify-center rounded-md transition ${
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
              {draftCountOf(entry) > 0 && <Check className="h-4 w-4 shrink-0 text-zinc-400" />}
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {t('card_votes', { count: entry.voteCount ?? 0 })}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {shown.slice(0, gridLimit).map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              draftCount={draftCountOf(entry)}
              ctx={cardCtx}
              pop={popId === entry.id}
              onOpen={openLightbox}
              onStep={step}
            />
          ))}
        </div>
      )}

      {gridLimit < shown.length && (
        <div ref={loadMoreRef} className="mt-6 flex justify-center">
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
              className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 px-5 py-3"
              onClick={(e) => e.stopPropagation()}
            >
              {lightboxEntry.voteCount !== null && (
                <span className="text-sm font-medium tabular-nums text-white/85">
                  {t('card_votes', { count: lightboxEntry.voteCount })}
                </span>
              )}
              {showBudget && dirty && (
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={submitting}
                  className="inline-flex h-10 items-center gap-1.5 rounded-full border border-white/30 px-4 text-sm font-medium text-white transition hover:bg-white/15 disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t('submit_votes_n', { count: budget.adds + budget.removes })}
                </button>
              )}
              <VoteButton
                entry={lightboxEntry}
                draftCount={draftCountOf(lightboxEntry)}
                ctx={cardCtx}
                pop={popId === lightboxEntry.id}
                size="lg"
                onStep={step}
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
