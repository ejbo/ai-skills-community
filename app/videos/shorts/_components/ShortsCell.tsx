'use client';

// The ONE short-video player surface, reused by both hosts (same code path by
// design — never fork this into a homepage copy):
//   - the fullscreen 随刷 feed (variant: feed cell inside a snap container)
//   - embedded players (homepage 刷视频, GeekHub 短视频 tab) via `embed`
// It owns: tap/double-tap semantics, muted-first autoplay with a handled play()
// promise, drag-seek progress, the 抖音-style bare-icon action rail
// (like/comment/favorite/share/mute/字幕), uploader identity + date + expandable
// caption, subtitle tracks (中/EN, whisper+LLM generated) and view counting.
//
// React's `muted` JSX attribute is unreliable in the DOM, so the flag is also
// applied imperatively on the ref.

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bookmark,
  Captions,
  Eye,
  Forward,
  Heart,
  MessageCircle,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { withBasePath } from '@/lib/base-path';
import { relativeTime } from '@/lib/i18n-date';
import { formatCount, formatDuration } from '@/lib/video/types';
import type { ShortsCellApi, ShortView } from './types';

const DOUBLE_TAP_MS = 280;

type SubMode = 'off' | 'zh' | 'en';

interface Props {
  item: ShortView;
  active: boolean;
  /** Within the ±2 window — the only cells that mount a real <video>. */
  nearActive: boolean;
  muted: boolean;
  reduceMotion: boolean;
  onToggleMute: () => void;
  onOpenComments: () => void;
  /** Embedded host (homepage / tab widget): fill the given frame, no aspect box. */
  embed?: boolean;
  /** When set, the video does NOT loop — the host advances (auto-next). */
  onEnded?: () => void;
  /** Feed-only: imperative API registry for keyboard shortcuts. */
  index?: number;
  registerApi?: (index: number, api: ShortsCellApi | null) => void;
}

export function ShortsCell({
  item,
  active,
  nearActive,
  muted,
  reduceMotion,
  onToggleMute,
  onOpenComments,
  embed = false,
  onEnded,
  index = 0,
  registerApi,
}: Props) {
  const t = useTranslations('shorts');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef(0);
  const lastTimeRef = useRef(0);
  const playedAccumRef = useRef(0);
  const viewedRef = useRef(false);
  const heartSeqRef = useRef(0);
  const likeBusyRef = useRef(false);
  const favBusyRef = useRef(false);
  const dragRef = useRef(false);

  const [paused, setPaused] = useState(true);
  const [needsTap, setNeedsTap] = useState(false);
  const [progress, setProgress] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [liked, setLiked] = useState(item.likedByMe);
  const [likeCount, setLikeCount] = useState(item.likeCount);
  const [favorited, setFavorited] = useState(item.favoritedByMe);
  const [favoriteCount, setFavoriteCount] = useState(item.favoriteCount);
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number }[]>([]);
  const [subMode, setSubMode] = useState<SubMode>('off');

  // The feed's keyboard handler calls togglePlay through a registered closure
  // that may be stale — read the live muted value from a ref, never the prop.
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const subTracks = [
    ...(item.subtitleZhUrl ? ([{ lang: 'zh', label: '中文', src: item.subtitleZhUrl }] as const) : []),
    ...(item.subtitleEnUrl
      ? ([{ lang: 'en', label: 'English', src: item.subtitleEnUrl }] as const)
      : []),
  ];

  // Subtitle preference: stored choice wins, else the viewer's UI locale —
  // normalized against the tracks this item actually has.
  useEffect(() => {
    let mode: SubMode = locale.startsWith('zh') ? 'zh' : 'en';
    try {
      const stored = localStorage.getItem('shorts:subtitle');
      if (stored === 'off' || stored === 'zh' || stored === 'en') mode = stored;
    } catch {
      /* storage unavailable */
    }
    if (mode === 'zh' && !item.subtitleZhUrl) mode = item.subtitleEnUrl ? 'en' : 'off';
    if (mode === 'en' && !item.subtitleEnUrl) mode = item.subtitleZhUrl ? 'zh' : 'off';
    setSubMode(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // Drive the <track> elements imperatively (React has no `mode` prop).
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const apply = () => {
      for (const tr of Array.from(el.textTracks)) {
        tr.mode = tr.language === subMode ? 'showing' : 'disabled';
      }
    };
    apply();
    el.textTracks.addEventListener('addtrack', apply);
    return () => el.textTracks.removeEventListener('addtrack', apply);
  }, [subMode, nearActive, item.subtitleZhUrl, item.subtitleEnUrl]);

  function cycleSubtitle() {
    const order: SubMode[] = [
      'off',
      ...(item.subtitleZhUrl ? (['zh'] as const) : []),
      ...(item.subtitleEnUrl ? (['en'] as const) : []),
    ];
    const next = order[(order.indexOf(subMode) + 1) % order.length];
    setSubMode(next);
    try {
      localStorage.setItem('shorts:subtitle', next);
    } catch {
      /* ignore */
    }
  }

  function attemptPlay() {
    const el = videoRef.current;
    if (!el) return;
    setNeedsTap(false);
    el.muted = mutedRef.current;
    const p = el.play();
    if (p) {
      p.catch((err: unknown) => {
        // AbortError (a pause/src change raced the play) is benign; only a
        // NotAllowedError means "the browser wants an explicit tap".
        if ((err as Error | null)?.name === 'NotAllowedError') {
          setNeedsTap(true);
          setPaused(true);
        }
      });
    }
  }

  function togglePlay() {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) attemptPlay();
    else el.pause();
  }

  async function toggleLike(onlyLike = false) {
    if (likeBusyRef.current) return;
    if (onlyLike && liked) return; // double-tap never UN-likes
    likeBusyRef.current = true;
    const prev = { liked, likeCount };
    setLiked(!prev.liked);
    setLikeCount(prev.likeCount + (prev.liked ? -1 : 1));
    try {
      const res = await fetch(`/api/videos/${item.slug}/like`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setLiked(prev.liked);
        setLikeCount(prev.likeCount);
        pushToast('error', t('login_required'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      if (!res.ok) throw new Error('failed');
      setLiked(Boolean(data.liked));
      if (typeof data.likeCount === 'number') setLikeCount(data.likeCount);
    } catch {
      setLiked(prev.liked);
      setLikeCount(prev.likeCount);
      pushToast('error', t('op_failed'));
    } finally {
      likeBusyRef.current = false;
    }
  }

  async function toggleFavorite() {
    if (favBusyRef.current) return;
    favBusyRef.current = true;
    const prev = { favorited, favoriteCount };
    setFavorited(!prev.favorited);
    setFavoriteCount(prev.favoriteCount + (prev.favorited ? -1 : 1));
    try {
      const res = await fetch(`/api/videos/${item.slug}/favorite`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setFavorited(prev.favorited);
        setFavoriteCount(prev.favoriteCount);
        pushToast('error', t('login_required'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      if (!res.ok) throw new Error('failed');
      setFavorited(Boolean(data.favorited));
      if (typeof data.favoriteCount === 'number') setFavoriteCount(data.favoriteCount);
    } catch {
      setFavorited(prev.favorited);
      setFavoriteCount(prev.favoriteCount);
      pushToast('error', t('op_failed'));
    } finally {
      favBusyRef.current = false;
    }
  }

  async function share() {
    const url = `${window.location.origin}${withBasePath(`/videos/shorts?v=${item.id}`)}`;
    try {
      await navigator.clipboard.writeText(url);
      pushToast('success', t('link_copied'));
    } catch {
      pushToast('error', t('op_failed'));
    }
  }

  function burstHeart(clientX: number, clientY: number, box: DOMRect) {
    const id = ++heartSeqRef.current;
    setHearts((prev) => [...prev, { id, x: clientX - box.left, y: clientY - box.top }]);
    setTimeout(() => setHearts((prev) => prev.filter((h) => h.id !== id)), 900);
  }

  function onSurfaceClick(e: React.MouseEvent<HTMLDivElement>) {
    const now = Date.now();
    const box = e.currentTarget.getBoundingClientRect();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      burstHeart(e.clientX, e.clientY, box);
      void toggleLike(true);
      return;
    }
    lastTapRef.current = now;
    tapTimerRef.current = setTimeout(() => {
      tapTimerRef.current = null;
      togglePlay();
    }, DOUBLE_TAP_MS);
  }

  // Imperative API for the feed's keyboard shortcuts (Space / L).
  useEffect(() => {
    if (!registerApi) return;
    registerApi(index, { togglePlay, toggleLike: () => void toggleLike() });
    return () => registerApi(index, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, liked, likeCount, paused, needsTap]);

  // Activation: play when active (muted-first), fully stop when deactivated.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (active) {
      el.muted = mutedRef.current;
      el.defaultMuted = true;
      if (reduceMotion) {
        // WCAG / reduced-motion: never autoplay — require an explicit tap.
        setPaused(true);
        setNeedsTap(true);
        return;
      }
      attemptPlay();
    } else {
      el.pause();
      try {
        el.currentTime = 0;
      } catch {
        /* not seekable yet */
      }
      setProgress(0);
      playedAccumRef.current = 0;
      lastTimeRef.current = 0;
      setNeedsTap(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduceMotion]);

  useEffect(() => {
    const el = videoRef.current;
    if (el) el.muted = muted;
  }, [muted, nearActive]);

  // Release the decoder/buffer when the cell leaves the mount window.
  useEffect(() => {
    const el = videoRef.current;
    return () => {
      if (!el) return;
      el.pause();
      el.removeAttribute('src');
      el.load();
    };
  }, [nearActive]);

  function onTimeUpdate() {
    const el = videoRef.current;
    if (!el || !el.duration || Number.isNaN(el.duration)) return;
    setProgress(el.currentTime / el.duration);
    const dt = el.currentTime - lastTimeRef.current;
    lastTimeRef.current = el.currentTime;
    // A view = 2s of ACCUMULATED real playback (loop wrap → negative dt is
    // skipped); ping once per mount, deduped server-side per user per day.
    if (!el.paused && dt > 0 && dt < 1.5) {
      playedAccumRef.current += dt;
      if (playedAccumRef.current >= 2 && !viewedRef.current) {
        viewedRef.current = true;
        fetch(`/api/shorts/${item.id}/view`, { method: 'POST' }).catch(() => undefined);
      }
    }
  }

  function seekTo(clientX: number, target: HTMLElement) {
    const el = videoRef.current;
    if (!el || !el.duration) return;
    const rect = target.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    try {
      el.currentTime = ratio * el.duration;
      setProgress(ratio);
    } catch {
      /* not seekable */
    }
  }

  const caption = item.summary.trim();
  const showExpand = caption.length > 64 || caption.includes('\n');
  const posterSrc = withBasePath(item.posterUrl) || undefined;

  return (
    <div
      className={
        embed
          ? 'relative h-full w-full overflow-hidden bg-black'
          : 'relative h-full w-full overflow-hidden bg-black md:mx-auto md:aspect-[9/16] md:w-auto md:max-w-full'
      }
    >
      {/* Media surface (tap = pause/play, double-tap = like) */}
      <div className="absolute inset-0" onClick={onSurfaceClick}>
        {nearActive && item.videoUrl ? (
          <video
            ref={videoRef}
            src={withBasePath(item.videoUrl)}
            poster={posterSrc}
            loop={!onEnded}
            muted
            playsInline
            preload={active ? 'auto' : 'metadata'}
            className="h-full w-full object-contain"
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onTimeUpdate={onTimeUpdate}
            onEnded={onEnded}
          >
            {subTracks.map((tr) => (
              <track key={tr.lang} kind="subtitles" srcLang={tr.lang} label={tr.label} src={withBasePath(tr.src)} />
            ))}
          </video>
        ) : posterSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- same-origin stored poster
          <img src={posterSrc} alt={item.title} className="h-full w-full object-contain" />
        ) : (
          <div className="h-full w-full" />
        )}
      </div>

      {/* Double-tap heart bursts */}
      <AnimatePresence>
        {hearts.map((h) => (
          <motion.div
            key={h.id}
            initial={{ scale: 0.4, opacity: 0.9, rotate: -12 + (h.id % 5) * 6 }}
            animate={{ scale: 1.6, opacity: 0, y: -80 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="pointer-events-none absolute z-[6]"
            style={{ left: h.x - 36, top: h.y - 36 }}
          >
            <Heart className="h-[72px] w-[72px] fill-rose-500 text-rose-500 drop-shadow-lg" />
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Paused glyph / tap-to-play */}
      {active && paused && !needsTap && (
        <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
          <Play className="h-16 w-16 text-white/70 drop-shadow-lg" fill="currentColor" />
        </div>
      )}
      {active && needsTap && (
        <button
          type="button"
          onClick={attemptPlay}
          className="absolute inset-0 z-[6] flex items-center justify-center bg-black/30"
          aria-label={t('tap_to_play')}
        >
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-black/60 ring-1 ring-white/30">
            <Play className="ml-1 h-9 w-9 text-white" fill="currentColor" />
          </span>
        </button>
      )}

      {/* Right action rail — 抖音-style: bare solid icons + drop shadow. */}
      <div
        className={`absolute z-[7] flex flex-col items-center ${
          embed ? 'bottom-20 right-2 gap-4' : 'bottom-24 right-2.5 gap-5 md:right-4'
        }`}
      >
        <Link
          href={`/users/${item.uploader.handle}`}
          className="mb-0.5 rounded-full ring-2 ring-white/90 drop-shadow-lg transition hover:ring-accent-400"
          aria-label={item.uploader.displayName}
        >
          <Avatar name={item.uploader.displayName} src={item.uploader.avatarUrl} size={embed ? 'md' : 'lg'} />
        </Link>
        <RailButton
          label={t('like')}
          count={likeCount}
          active={liked}
          onClick={() => void toggleLike()}
          icon={
            <Heart
              className={`${embed ? 'h-7 w-7' : 'h-8 w-8'} transition ${
                liked ? 'fill-rose-500 text-rose-500' : 'fill-white text-white'
              }`}
            />
          }
        />
        <RailButton
          label={t('comments')}
          count={item.commentCount}
          onClick={onOpenComments}
          icon={<MessageCircle className={`${embed ? 'h-7 w-7' : 'h-8 w-8'} fill-white text-white`} />}
        />
        <RailButton
          label={t('favorite')}
          count={favoriteCount}
          active={favorited}
          onClick={() => void toggleFavorite()}
          icon={
            <Bookmark
              className={`${embed ? 'h-7 w-7' : 'h-8 w-8'} transition ${
                favorited ? 'fill-amber-400 text-amber-400' : 'fill-white text-white'
              }`}
            />
          }
        />
        <RailButton
          label={t('share')}
          onClick={() => void share()}
          icon={<Forward className={`${embed ? 'h-7 w-7' : 'h-8 w-8'} fill-white text-white`} />}
        />
        {subTracks.length > 0 && (
          <RailButton
            label={t('subtitles')}
            active={subMode !== 'off'}
            onClick={cycleSubtitle}
            caption={subMode === 'off' ? t('subtitles_off') : subMode === 'zh' ? '中' : 'EN'}
            icon={
              <Captions
                className={`${embed ? 'h-6 w-6' : 'h-7 w-7'} ${
                  subMode !== 'off' ? 'text-accent-400' : 'text-white'
                }`}
              />
            }
          />
        )}
        <button
          type="button"
          onClick={onToggleMute}
          className="mt-0.5 text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)] transition active:scale-90"
          aria-label={muted ? t('unmute') : t('mute')}
        >
          {muted ? <VolumeX className="h-6 w-6" /> : <Volume2 className="h-6 w-6" />}
        </button>
      </div>

      {/* Caption overlay: uploader + date, expandable description, counts */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-[5] bg-gradient-to-t from-black/80 via-black/35 to-transparent pl-4 pr-16 ${
          embed ? 'pb-5 pt-14' : 'pb-8 pt-20'
        }`}
      >
        <div className="pointer-events-auto max-w-xl space-y-1.5 text-white">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/users/${item.uploader.handle}`}
              className="text-[15px] font-semibold drop-shadow hover:underline"
            >
              {item.uploader.displayName}
            </Link>
            {!item.uploader.isPrivate && (
              <span className="text-xs text-white/60">@{item.uploader.handle}</span>
            )}
            {item.publishedAt && (
              <span className="text-xs text-white/50">· {relativeTime(item.publishedAt, locale)}</span>
            )}
            <DeptTag department={item.uploader.department} lab={item.uploader.lab} />
          </div>
          {caption && (
            <div>
              <p
                className={`whitespace-pre-wrap text-sm leading-relaxed text-white/90 ${
                  expanded ? 'max-h-40 overflow-y-auto' : 'line-clamp-2'
                }`}
              >
                {caption}
              </p>
              {showExpand && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-0.5 text-xs font-medium text-white/60 hover:text-white"
                >
                  {expanded ? t('collapse') : t('expand')}
                </button>
              )}
            </div>
          )}
          <p className="flex items-center gap-3 text-[11px] text-white/50">
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3 w-3" />
              {formatCount(item.viewCount)}
            </span>
            {item.durationSec > 0 && <span>{formatDuration(item.durationSec)}</span>}
            {embed && (
              <Link
                href={`/videos/shorts?v=${item.id}`}
                className="pointer-events-auto font-medium text-accent-300 hover:text-accent-200 hover:underline"
              >
                {t('strip_view_all')} →
              </Link>
            )}
          </p>
        </div>
      </div>

      {/* Progress bar + seek (click / drag) */}
      <div
        className="absolute inset-x-0 bottom-0 z-[8] h-6 cursor-pointer touch-none"
        role="slider"
        aria-label={t('progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          dragRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          seekTo(e.clientX, e.currentTarget);
        }}
        onPointerMove={(e) => {
          if (dragRef.current) seekTo(e.clientX, e.currentTarget);
        }}
        onPointerUp={(e) => {
          dragRef.current = false;
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* already released */
          }
        }}
      >
        <div className="absolute bottom-[7px] left-3 right-3 h-[3px] overflow-hidden rounded-full bg-white/25">
          <div className="h-full rounded-full bg-white/90" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

function RailButton({
  icon,
  label,
  count,
  caption,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  /** Small text under the icon when there is no count (e.g. 字幕 mode). */
  caption?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={count !== undefined ? `${label} ${count}` : label}
      aria-pressed={active}
      className="flex flex-col items-center gap-0.5 transition hover:scale-105 active:scale-90"
    >
      <span className="drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)]">{icon}</span>
      {count !== undefined && (
        <span className="text-xs font-semibold tabular-nums text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
          {formatCount(count)}
        </span>
      )}
      {caption !== undefined && count === undefined && (
        <span className="text-[10px] font-semibold text-white/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
          {caption}
        </span>
      )}
    </button>
  );
}
