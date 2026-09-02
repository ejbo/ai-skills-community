'use client';

// Hover toolbar drawn INSIDE the fullscreen wrapper (fsRef) — the only chrome
// reachable while a file is fullscreen (nothing outside the fullscreened
// element paints). Top-right cluster on `bg-zinc-950/80 text-white` — an
// overlay on media, the shorts rail's onDark tone, not a hue. Shown on
// pointermove, fades out (opacity, 150 ms) after 1.5 s idle, pinned while it
// has focus; reduced motion = always visible. So is a COARSE pointer: a touch
// device has no pointermove to bring it back, a tap inside an iframe never
// reaches this document, and on iPhone (no Fullscreen API ⇒ maximize, no ESC)
// the exit button here is the only way out. No portal: it is a child of the
// wrapper, so the top layer already contains it — the wrapper must not scroll
// itself (PreviewBody keeps the scroller inside), else `absolute` rides away.

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Download, ExternalLink, Minimize2 } from 'lucide-react';

const IDLE_MS = 1500;
const COARSE_QUERY = '(pointer: coarse)';

export function PreviewToolbar({
  title,
  meta,
  downloadHref,
  openHref,
  onExit,
}: {
  title: string;
  /** Mono secondary (file size). */
  meta?: string | null;
  /** `<a download>` target — file kinds only. */
  downloadHref?: string | null;
  /** 新标签打开 target (a same-origin file url or the source page). */
  openHref?: string | null;
  onExit: () => void;
}) {
  const t = useTranslations('zones');
  const reduce = useReducedMotion();
  const [coarse, setCoarse] = useState(false);
  const [visible, setVisible] = useState(true);
  const [pinned, setPinned] = useState(false);
  const timer = useRef<number>(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia(COARSE_QUERY);
    const sync = () => setCoarse(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const always = !!reduce || coarse;

  useEffect(() => {
    if (always) return;
    const arm = () => {
      setVisible(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setVisible(false), IDLE_MS);
    };
    // Listen on the fullscreened wrapper (the parent): moves over the page
    // outside it never matter, and the iframe's own document never bubbles.
    const host = rootRef.current?.parentElement ?? document;
    host.addEventListener('pointermove', arm as EventListener);
    host.addEventListener('pointerdown', arm as EventListener);
    arm();
    return () => {
      window.clearTimeout(timer.current);
      host.removeEventListener('pointermove', arm as EventListener);
      host.removeEventListener('pointerdown', arm as EventListener);
    };
  }, [always]);

  const shown = always || visible || pinned;
  const btn =
    'inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs font-medium text-white/90 transition hover:bg-white/15 hover:text-white focus-visible:bg-white/15 focus-visible:outline-none';

  return (
    <div
      ref={rootRef}
      onFocus={() => setPinned(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPinned(false);
      }}
      className={`absolute right-3 top-3 z-[1] flex h-9 items-center gap-1 rounded-full bg-zinc-950/80 px-2 text-white transition-opacity duration-150 ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
      data-preview-toolbar
    >
      <span className="max-w-[40vw] truncate px-1 text-xs">{title}</span>
      {meta && <span className="font-mono text-[11px] tabular-nums text-white/70">{meta}</span>}
      {downloadHref && (
        <a href={downloadHref} download className={btn} title={t('attach_download')}>
          <Download className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">{t('attach_download')}</span>
        </a>
      )}
      {openHref && (
        <a href={openHref} target="_blank" rel="noopener noreferrer" className={btn} title={t('panel_open_new_tab')}>
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">{t('panel_open_new_tab')}</span>
        </a>
      )}
      <button type="button" onClick={onExit} className={btn} title={t('panel_exit_fullscreen')} aria-label={t('panel_exit_fullscreen')}>
        <Minimize2 className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden sm:inline">{t('panel_exit_fullscreen')}</span>
      </button>
    </div>
  );
}
