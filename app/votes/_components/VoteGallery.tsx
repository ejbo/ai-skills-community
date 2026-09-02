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
  Clock,
  Download,
  Eye,
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
import { useLocale, useTranslations } from 'next-intl';
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
  VOTE_HOVER_FALLBACK_SEC,
  formatVoteInstant,
  pickHoverPreview,
  reconcileDraft,
  stepDraftCount,
  voteCardAspectClass,
  voteTimezoneKey,
  type BallotChange,
  type BallotDraft,
  type BallotRules,
} from '@/lib/votes/shared';
import { Countdown } from './Countdown';
import { VoteBurst } from './VoteBurst';
import {
  BADGE_DONE,
  BADGE_PENDING,
  BUDGET_LEFT,
  BUDGET_OUT,
  RANK_MEDAL,
  RANK_PLAIN,
  STATUS_LIVE,
  STATUS_OVER,
  STATUS_SOON,
  VOTE_CTA,
  VOTE_DONE,
  VOTE_LOCKED,
  VOTE_PENDING,
  VOTE_PENDING_DASHED,
} from './vote-theme';
import { EntryComments } from './EntryComments';
import { SubmitDialog } from './SubmitDialog';
import { loginHref } from '@/lib/auth/callback-path';

type SortMode = 'default' | 'no' | 'votes';
const GRID_PAGE = 48;
// 悬停多久才真正开始加载预览：鼠标扫过一整排卡片时，没有哪张停留超过这个时间，
// 所以扫一遍不会触发任何一次网络请求（Geek Videos 卡片的同一个数字）。
const PREVIEW_DELAY_MS = 400;
// 灯箱里停留多久才算看过一件作品（挡住按住 ←/→ 一路翻过去的那些）。
const VIEW_DWELL_MS = 700;
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

// Module-level leaves — defining these inside VoteGallery would mint a new
// component type per render and remount their subtrees on every state change.

/**
 * 卡片版式 class —— 规则本身在 lib/votes/shared.ts，封面取景器用的是同一条，
 * 否则创作者拖出来的裁切和卡片显示的不是同一块画面。
 */
function aspectClass(entry: VoteEntryView): string {
  return voteCardAspectClass(entry.kind, entry.posterAspect);
}

function EntryMedia({ entry, alt, eager = false }: { entry: VoteEntryView; alt: string; eager?: boolean }) {
  const thumb = entry.kind === 'video' ? entry.posterUrl : entry.fileUrl;
  if (!thumb) {
    // 抓帧失败的视频：给一块带编号的渐变底，而不是一片什么都没有的空白
    // （VideoCard 无封面时用标题首字，同一个思路）。
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-200 to-zinc-300 text-2xl font-semibold tabular-nums text-zinc-500 dark:from-zinc-800 dark:to-zinc-700 dark:text-zinc-400">
        {entry.entryNo}
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
  /** 已发布但还没到开始时间 —— 作品可浏览，投票按钮置灰而不是消失。 */
  notStarted: boolean;
  loggedIn: boolean;
  canVote: boolean;
  resultsVisible: boolean;
  titlesVisible: boolean;
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

// 四态视觉语言（配色语义见 ./vote-theme）：实心玫红 = 投票（未投，整屏唯一的
// 高饱和 CTA）→ 淡琥珀 = 已选（在草稿里，还没提交）→ 淡翠绿 = 已投（已落库）；
// 待撤回是琥珀虚线 + 恢复入口。**不要**把这四态改回黑白：一页几十张卡全是墨色
// 按钮时，既看不出哪张投过，也看不出主行动在哪 —— 这正是这次改版要修的。
function VoteButton({ entry, draftCount, ctx, pop, size = 'sm', onStep }: VoteButtonProps) {
  const t = useTranslations('votes');
  const committed = entry.myVotes;
  const pending = draftCount !== committed;
  const canAdd = ctx.open && ctx.canVote && ctx.budgetLeft && draftCount < ctx.maxPerEntry && !ctx.submitting;
  // Taking back an unsubmitted vote is always allowed; going below the
  // committed count is 撤票 and needs allowRevoke.
  const canRemove =
    ctx.open && ctx.canVote && draftCount > 0 && (draftCount > committed || ctx.allowRevoke) && !ctx.submitting;
  // 卡片上的按钮做到 h-9/13px：原来的 h-8/11px 在一屏几十张卡里根本不显眼，
  // 而这一格就是整个页面唯一要人点的东西。三种状态共用同一尺寸，切换时不跳版。
  const base = size === 'lg' ? 'h-10 px-5 text-sm rounded-full' : 'h-9 px-4 text-[13px] rounded-full';
  // 加票那一下的按钮自身弹跳。纸屑归 <VoteBurst/>，两者共用同一个 pop 窗口。
  const popClass = pop ? 'animate-vote-pop' : '';

  const content = (() => {
    if (!ctx.open) {
      if (committed > 0) {
        // Ended / not started: state only, no action.
        return (
          <span className={`inline-flex items-center gap-1 ${base} ${VOTE_DONE} font-semibold`}>
            <Check className="h-3.5 w-3.5" />
            {t('my_votes_n', { count: committed })}
          </span>
        );
      }
      // 未开始：留一个置灰的按钮位，让人看得出“到点就能投”，而不是以为这个活动
      // 根本不能投票。已结束则什么都不显示（名次/票数已经说明一切）。
      return ctx.notStarted ? (
        <button
          type="button"
          disabled
          title={t('not_started_hint')}
          // 自己的一套 class，不复用 VOTE_CTA —— 那上面挂了 hover: 变体，禁用态跟着
          // 亮一下会让人以为还能点。
          className={`inline-flex items-center gap-1.5 ${base} ${VOTE_LOCKED} font-medium`}
        >
          <Clock className="h-3.5 w-3.5" />
          {t('vote_not_started')}
        </button>
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
          className={`inline-flex items-center gap-1.5 ${base} ${VOTE_PENDING_DASHED} font-medium`}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t('revoke_pending')}
        </button>
      );
    }

    if (ctx.maxPerEntry > 1 && draftCount > 0) {
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-full transition ${pending ? VOTE_PENDING : VOTE_DONE} ${
            size === 'lg' ? 'h-10 px-2' : 'h-9 px-2'
          } ${popClass}`}
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
          <span className="min-w-[1ch] text-center text-[13px] font-bold tabular-nums">{draftCount}</span>
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
          className={`inline-flex items-center gap-1.5 ${base} font-semibold transition ${
            pending ? VOTE_PENDING : `${VOTE_DONE} ${canRemove ? '' : 'cursor-default'}`
          } ${popClass} disabled:opacity-100`}
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
        className={`inline-flex items-center gap-1.5 ${base} ${VOTE_CTA} font-semibold`}
      >
        <Plus className="h-3.5 w-3.5" />
        {t('vote')}
      </button>
    );
  })();

  if (!content) return null;
  // 纸屑要盖在按钮上、又不能吃掉点击，所以外面套一层 relative 壳。壳是
  // inline-flex 且零内边距，不改变原来的行内排版。
  return (
    <span className="relative inline-flex shrink-0">
      {content}
      {pop && <VoteBurst />}
    </span>
  );
}

/**
 * 同一时刻只允许一张卡片播预览。鼠标扫过网格时前一张必须先 pause + 卸掉 src，
 * 否则一屏 48 张卡片会留下一串还在缓冲的 <video>（ShortsFeed 那句「每个可播放
 * 元素要 30-80 MB」是同一个道理）。
 */
let activePreview: { current: () => void } | null = null;

function motionOk(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
//
// 版式对齐 Geek Videos 的卡片（components/video/VideoCard.tsx）：画面框里不再压
// 播放按钮，鼠标悬停直接播片，作品名/作者挪到框下面。整张卡是 flex 列且
// 投票行 mt-auto，所以同一行里标题长短不同的卡片，按钮仍然对齐在同一条线上，
// 不会在卡片之间留出参差不齐的空档。
const EntryCard = memo(function EntryCard({ entry, draftCount, ctx, pop, onOpen, onStep }: EntryCardProps) {
  const t = useTranslations('votes');
  const pending = draftCount !== entry.myVotes;
  // previewing = 已过悬停延迟、这张卡该播了；playing = 真的有画面了。
  // 分成两个状态是为了不闪黑：<video> 挂上去到解出第一帧之间是空的，
  // 封面要一直留在下面，等 onPlaying 再交叉淡入。
  const [previewing, setPreviewing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preview = pickHoverPreview(entry);
  const title = ctx.titlesVisible ? entryTitle(entry, t) : t('untitled_entry', { no: entry.entryNo });

  // 释放解码器/缓冲：pause() 不够，必须摘掉 src 再 load()（ShortsCell 的卸载
  // 家法，VideoCard 少了这一步）。挂在 **callback ref** 上而不是 effect 清理里：
  // 卸载时 React 先把 ref 置空、再跑 passive cleanup，等到 useEffect 的返回函数
  // 执行时 videoRef.current 已经是 null，那条清理路径根本摸不到元素。callback ref
  // 的 null 调用发生在元素被摘下去的那一刻，是唯一拿得到它的时机。
  const releaseVideo = useCallback((el: HTMLVideoElement | null) => {
    const prev = videoRef.current;
    if (!el && prev) {
      prev.pause();
      prev.removeAttribute('src');
      prev.load();
    }
    videoRef.current = el;
  }, []);

  const stopRef = useRef<() => void>(() => undefined);
  stopRef.current = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // setPreviewing(false) 会卸载 <video>，releaseVideo 在那一刻放掉它。
    setPlaying(false);
    setPreviewing(false);
    if (activePreview === stopRef) activePreview = null;
  };

  function startHover(pointerType?: string) {
    // 触屏没有真正的“悬停”，浏览器合成出来的 pointerenter 会在点开灯箱前
    // 白拉一段视频 —— 只认鼠标。
    if (pointerType && pointerType !== 'mouse') return;
    if (!preview || !motionOk()) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (activePreview && activePreview !== stopRef) activePreview.current();
      activePreview = stopRef;
      setPreviewing(true);
    }, PREVIEW_DELAY_MS);
  }

  useEffect(() => {
    if (!previewing) return;
    const el = videoRef.current;
    if (!el) return;
    el.play().catch(() => {
      /* 自动播放可能被拦，静默即可 —— 封面继续显示 */
    });
  }, [previewing]);

  // 卸载（翻页、筛选、切换榜单视图）时同样要放掉解码器。
  useEffect(() => () => stopRef.current(), []);

  return (
    <div
      className="group cv-auto -m-1 flex h-full flex-col p-1"
      onPointerEnter={(e) => startHover(e.pointerType)}
      onPointerLeave={() => stopRef.current()}
    >
      <button
        type="button"
        // 打开灯箱前先停掉预览：灯箱在上面盖着，卡片不一定收到 pointerleave；
        // 键盘回车打开时更是既没有 pointerleave 也没有 blur（焦点没动），
        // 结果就是弹窗后面还有一路 <video> 在拉流。
        onClick={() => {
          stopRef.current();
          onOpen(entry.id);
        }}
        onFocus={(e) => {
          // 只有键盘/程序化聚焦才预热；触屏点一下也会聚焦，那不是“悬停”。
          if (e.currentTarget.matches(':focus-visible')) startHover('mouse');
        }}
        onBlur={() => stopRef.current()}
        // 画面 + 标题块一起是点击区（参照 VideoCard 的 <Link> 包法）：
        // 标题在框外面，但点标题当然也该打开作品。
        // 读屏念的是作品名，而不是把 #编号、名次、已选、时长、作者、浏览数
        // 一路串起来念一遍 —— 没有封面时更是只剩一个编号。
        aria-label={title}
        className="block w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
      >
        <div
          className={`relative overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-900 ${aspectClass(entry)}`}
        >
          <div
            className={`absolute inset-0 transition-opacity duration-300 ${
              playing ? 'opacity-0' : 'opacity-100'
            }`}
          >
            <EntryMedia entry={entry} alt={title} />
          </div>

          {/* <video> 只在这张卡真的要播时才存在。VideoCard 是常驻元素 + 延迟挂
              src；这里不行 —— 画廊的窗口是只增不减的，滚到底就有几百上千张卡
              同时挂着，常驻几百个媒体元素毫无意义。没有元素 = 零网络、零解码器。 */}
          {previewing && preview && (
            <video
              ref={releaseVideo}
              src={withBasePath(preview.src)}
              muted
              loop
              playsInline
              preload="none"
              tabIndex={-1}
              aria-hidden
              onPlaying={() => setPlaying(true)}
              onTimeUpdate={
                preview.isSource
                  ? (e) => {
                      // 回退播原片时只循环开头几秒 —— 预览片本身已经是短片。
                      const el = e.currentTarget;
                      if (el.currentTime >= VOTE_HOVER_FALLBACK_SEC) el.currentTime = 0;
                    }
                  : undefined
              }
              // 预览片必须和封面对齐同一块画面：封面是按 posterPos 裁的，
              // 视频要是一律居中 cover，鼠标一停画面就“跳”一下。
              style={
                entry.posterPos === 'contain'
                  ? undefined
                  : { objectPosition: /^\d/.test(entry.posterPos) ? entry.posterPos : '50% 50%' }
              }
              className={`absolute inset-0 h-full w-full transition-opacity duration-300 ${
                entry.posterPos === 'contain' ? 'object-contain' : 'object-cover'
              } ${playing ? 'opacity-100' : 'opacity-0'}`}
            />
          )}

          <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

          {/* 时长角标是「这是视频」在触屏上仅剩的提示（悬停预览在触屏不存在，
              画面上的播放按钮按要求去掉了）。所以 durationSec 未知时不能整块不渲染
              —— ffprobe 失败的作品会变得和图片作品长得一模一样 —— 退化成一个小
              播放三角，仍然是角标而不是压在画面中间的按钮。 */}
          {entry.kind === 'video' && (
            <span className="absolute bottom-1.5 right-1.5 flex items-center rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
              {entry.durationSec > 0 ? (
                fmtDuration(entry.durationSec)
              ) : (
                <Play className="h-2.5 w-2.5 translate-x-[0.5px] fill-current" />
              )}
            </span>
          )}
          <span className="absolute left-2 top-2 flex items-center gap-1.5" aria-hidden>
            <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
              #{entry.entryNo}
            </span>
            {ctx.over && ctx.resultsVisible && (entry.rank ?? 99) <= 3 && (entry.voteCount ?? 0) > 0 && (
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${RANK_MEDAL[entry.rank ?? 3]}`}
              >
                {entry.rank}
              </span>
            )}
          </span>
          {draftCount > 0 && (
            // 投过的作品在网格里要一眼看见 —— 琥珀 = 选了没交，翠绿 = 已落库，
            // 和下面的按钮同一套语义色。
            <span
              className={`absolute right-2 top-2 flex h-5 items-center gap-0.5 rounded-full px-1.5 text-[10px] font-bold ${
                pending ? BADGE_PENDING : BADGE_DONE
              }`}
            >
              <Check className="h-3 w-3" />
              {draftCount > 1 ? draftCount : ''}
            </span>
          )}
        </div>

        {/* 作品名/作者挪到画面下面（Geek Videos 家法）：画面不被文字压住，
            长标题也能完整换行显示，而不是被一行 truncate 切掉。 */}
        <div className="mt-2 min-w-0 px-0.5">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug tracking-tight">{title}</h3>
          {entry.authorName && (
            <p className="mt-0.5 truncate text-xs text-muted">
              {entry.authorName}
              {entry.authorNo ? ` · ${entry.authorNo}` : ''}
            </p>
          )}
          {entry.viewCount !== null && (
            <p
              className="mt-0.5 flex items-center gap-1 text-xs text-muted"
              title={t('views_owner_only')}
            >
              <Eye className="h-3.5 w-3.5" aria-hidden />
              {/* 数字对读屏隐藏：旁边的 sr-only 才是完整读法（否则会念成
                  「0 0 次浏览」），而且顺带把「只有发起人看得见」讲清楚 ——
                  光靠 title= 的话触屏和读屏用户根本读不到这层意思。 */}
              <span className="tabular-nums" aria-hidden>
                {entry.viewCount}
              </span>
              <span className="sr-only">
                {t('views_n', { count: entry.viewCount })}（{t('views_owner_only')}）
              </span>
            </p>
          )}
        </div>
      </button>

      <div className="mt-auto flex items-center justify-between gap-2 px-0.5 pt-2">
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
  const locale = useLocale();
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
  // 组件是否还在（异步回调回来时用；见浏览计数 effect）。
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
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

  // 到点自动切状态：守着 10:00 开投的人不该还要手动刷新页面。
  // 必须是**自愈**的，不能只排一发 setTimeout：客户端时钟快几秒、那一次请求
  // 429/离线、或标签页在后台被节流，服务端都会回 started:false —— 依赖项没变，
  // effect 不会重跑，页面就永远卡在「未开始」。所以过点之后改成轮询，直到服务端
  // 自己承认状态翻转；标签页重新可见时也补一次。
  const [boundaryTick, setBoundaryTick] = useState(0);
  useEffect(() => {
    const target = !view.started && view.startAt ? view.startAt : !view.over && view.endAt ? view.endAt : null;
    if (!target) return;
    const ms = new Date(target).getTime() - Date.now();
    if (!Number.isFinite(ms)) return;
    const rearm = () => setBoundaryTick((n) => n + 1);
    // 边界还远（>24h）：只挂 visibilitychange，等下次回到页面再看。
    if (ms > 86_400_000) {
      const onVisible = () => {
        if (document.visibilityState === 'visible') rearm();
      };
      document.addEventListener('visibilitychange', onVisible);
      return () => document.removeEventListener('visibilitychange', onVisible);
    }
    const timer = setTimeout(
      () => {
        void refresh().finally(rearm); // 没翻转就再排一轮
      },
      // 过点之后按 15s 复查，避免时钟偏差/瞬时失败导致一次定音。
      ms > 0 ? ms + 1_200 : 15_000,
    );
    const onVisible = () => {
      if (document.visibilityState === 'visible') rearm();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [view.started, view.startAt, view.over, view.endAt, refresh, boundaryTick]);

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
        router.push(loginHref(`/votes/${current.id}`));
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
        // 只有「加票」才庆祝。窗口要盖住纸屑的全程（620ms 动画 + 44ms 错开），
        // 提前收掉的话粒子会在半空被卸载，看起来像卡了一下。
        setPopId(entryId);
        setTimeout(() => setPopId((p) => (p === entryId ? null : p)), 700);
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

  // ── 浏览计数 ────────────────────────────────────────────────────────────
  // 打开灯箱 = 看了这件作品。服务端按 (viewer, entry, UTC 日) 去重，所以来回
  // 用 ←/→ 翻、或者刷新页面重开，都只算一次。
  //
  // effect 只依赖 lightboxId 这个 primitive：依赖 lightboxEntry 的话，30 秒轮询
  // 每次 mergeView 都可能换掉对象引用，effect 就会跟着重跑。再加一个 ref 里的
  // Set 兜住 React 严格模式的双次调用，同一次会话里同一件作品也只发一次。
  const pingedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!lightboxId) return;
    if (!viewRef.current.viewer.loggedIn) return;
    if (pingedRef.current.has(lightboxId)) return;
    const entryId = lightboxId;
    // 停留一下才算「看过」。effect 的触发单位是 lightboxId 变化，而 ←/→ 就是
    // 改这个 id：按住方向键翻页会以按键重复速率（~30/s）发请求，既把 240/min
    // 的限流打爆，也会给一堆只在眼前掠过 300ms 的作品记上浏览。计时器在 id
    // 再次变化时清掉，所以只有真正停下来看的那一件会计数。
    const timer = setTimeout(() => {
      if (pingedRef.current.has(entryId)) return;
      pingedRef.current.add(entryId);
      ping();
    }, VIEW_DWELL_MS);
    return () => clearTimeout(timer);

    function ping() {
    fetch(`/api/votes/${viewRef.current.id}/entries/${entryId}/view`, { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        // 只有服务端真的记上了才就地 +1（去重命中时不动），否则「今天第二次打开」
        // 会让发起人看到一个数据库里并不存在的数字。
        //
        // 这里刻意 **不** 按 effect 的清理来取消：关掉灯箱或按 → 翻到下一件，
        // lightboxId 一变清理就跑，可服务端那一次是实打实记上了的，而
        // pingedRef 又不会让它重发 —— 取消的话这张卡就一直显示旧数字。
        // 组件真的卸载了才丢弃（aliveRef）。
        if (!aliveRef.current || !data?.counted) return;
        // 看不到浏览数的人（绝大多数）不必为此重建整份派生列表：viewCount 是
        // null 时 map 是纯 no-op，setView 却会让 entryById / displayed / ranked
        // 全部重算。
        setView((prev) => {
          const hit = prev.entries.find((e) => e.id === entryId);
          if (!hit || hit.viewCount === null) return prev;
          return {
            ...prev,
            entries: prev.entries.map((e) =>
              e.id === entryId && e.viewCount !== null ? { ...e, viewCount: e.viewCount + 1 } : e,
            ),
          };
        });
      })
      .catch(() => {
        /* best-effort：浏览数记不上不该影响看作品 */
      });
    }
  }, [lightboxId]);

  async function share() {
    const ok = await copyText(window.location.href);
    pushToast(ok ? 'success' : 'error', ok ? t('share_copied') : t('toast_vote_failed'));
  }

  const budgetLeft = budget.remaining > 0;
  const cardCtx = useMemo<CardCtx>(
    () => ({
      open: view.open,
      over: view.over,
      notStarted: !view.over && !view.started,
      loggedIn: view.viewer.loggedIn,
      canVote: view.viewer.canVote,
      resultsVisible,
      titlesVisible: view.titlesVisible,
      maxPerEntry: view.maxPerEntry,
      allowRevoke: view.allowRevoke,
      budgetLeft,
      submitting,
    }),
    [
      view.open,
      view.over,
      view.started,
      view.viewer.loggedIn,
      view.viewer.canVote,
      resultsVisible,
      view.titlesVisible,
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

  // 绝对时间用活动自己的时区渲染（显式 timeZone ⇒ 服务端/客户端同串，无水合
  // 不一致），后面接时区短名才完整。
  const startsAtLabel =
    !view.over && !view.started && view.startAt
      ? `${formatVoteInstant(view.startAt, view.timezone ?? '', locale)} ${t(voteTimezoneKey(view.timezone))}`
      : null;
  const endsAtLabel = view.endAt
    ? `${formatVoteInstant(view.endAt, view.timezone ?? '', locale)} ${t(voteTimezoneKey(view.timezone))}`
    : null;

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
    ...(endsAtLabel && !view.over ? [t('rule_ends_at', { time: endsAtLabel })] : []),
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
            <Avatar name={view.creator.displayName} src={view.creator.avatarUrl} size="xs" handle={view.creator.handle} />
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

      {/* 未开始：作品可浏览、投票未开放 —— 说清楚“什么时候能投”，绝对时间带
          时区（发起人所在时区），倒计时给观众自己的相对感。 */}
      {startsAtLabel && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <Clock className="h-4 w-4 shrink-0 text-zinc-500" />
          {/* 相对倒计时归下面那颗状态药丸管 —— 同一个「距开始 1天2小时」渲染两遍
              （还各跑一个 1s interval）纯属噪音。这里只给绝对时间。 */}
          <span className="min-w-0 font-medium">{t('not_started_banner', { time: startsAtLabel })}</span>
        </div>
      )}

      {/* window + rules */}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        {/* 状态药丸带色（进行中=玫红 / 未开始=琥珀 / 已结束=中性）；下面那排
            规则药丸继续保持墨色描边 —— 元数据不上色，颜色才留得住意义。 */}
        {view.over ? (
          <span className={`rounded-full px-3 py-1.5 font-semibold ${STATUS_OVER}`}>{t('badge_ended')}</span>
        ) : !view.started && view.startAt ? (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-semibold tabular-nums ${STATUS_SOON}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
            <Countdown target={view.startAt} prefix={t('cd_to_start')} endedText={t('badge_ongoing')} />
          </span>
        ) : view.endAt ? (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-semibold tabular-nums ${STATUS_LIVE}`}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" aria-hidden />
            <Countdown target={view.endAt} prefix={t('cd_to_end')} endedText={t('badge_ended')} />
          </span>
        ) : (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-semibold ${STATUS_LIVE}`}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" aria-hidden />
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
            <Trophy className="h-4 w-4 text-amber-500" />
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
                className={`group overflow-hidden rounded-2xl border text-left transition ${
                  entry.rank === 1
                    ? 'border-amber-300/80 bg-amber-50/40 hover:border-amber-400 dark:border-amber-500/35 dark:bg-amber-500/[0.06] dark:hover:border-amber-500/60'
                    : entry.rank === 2
                      ? 'border-zinc-300/80 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500'
                      : 'border-orange-300/60 bg-orange-50/30 hover:border-orange-400/80 dark:border-orange-500/30 dark:bg-orange-500/[0.05] dark:hover:border-orange-500/50'
                }`}
              >
                <div className={`relative overflow-hidden bg-zinc-100 dark:bg-zinc-900 ${aspectClass(entry)}`}>
                  <EntryMedia entry={entry} alt={entryTitle(entry, t)} eager />
                  <span
                    className={`absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${RANK_MEDAL[entry.rank ?? 3] ?? RANK_MEDAL[3]}`}
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
                budgetLeft ? BUDGET_LEFT : BUDGET_OUT
              }`}
            >
              {view.budgetPeriod === 'daily'
                ? t('budget_remaining_daily', { remaining: budget.remaining, total: view.votesPerUser })
                : t('budget_remaining', { remaining: budget.remaining, total: view.votesPerUser })}
            </span>
          )}
          {showBudget && dirty && (
            <>
              <span className="text-xs font-semibold tabular-nums text-amber-700 dark:text-amber-300">
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
                className={`inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-xs font-semibold ${VOTE_CTA}`}
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
                    ? RANK_MEDAL[entry.rank ?? 3]
                    : RANK_PLAIN
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
              {draftCountOf(entry) > 0 && (
                <Check
                  className={`h-4 w-4 shrink-0 ${
                    draftCountOf(entry) !== entry.myVotes
                      ? 'text-amber-500'
                      : 'text-emerald-500 dark:text-emerald-400'
                  }`}
                />
              )}
              {entry.viewCount !== null && (
                <span
                  className="hidden shrink-0 items-center gap-1 text-xs text-muted sm:inline-flex"
                  title={t('views_owner_only')}
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                  <span className="tabular-nums" aria-hidden>
                    {entry.viewCount}
                  </span>
                  <span className="sr-only">{t('views_n', { count: entry.viewCount })}</span>
                </span>
              )}
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
                      {lightboxEntry.viewCount !== null && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 font-medium"
                          title={t('views_owner_only')}
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden />
                          <span className="tabular-nums" aria-hidden>
                            {lightboxEntry.viewCount}
                          </span>
                          <span className="sr-only">{t('views_n', { count: lightboxEntry.viewCount })}</span>
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
                  className={`inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold ${VOTE_CTA}`}
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
