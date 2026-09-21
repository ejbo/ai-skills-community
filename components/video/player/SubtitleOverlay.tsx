'use client';

// 字幕浮层 — cues are drawn by US, not by the browser (the rule the shorts player
// already follows): a native `::cue` cannot be moved by the viewer, cannot show
// two languages at once, and lives inside the <video> element, so it disappears
// the moment the FRAME (not the video) goes fullscreen — which is what a player
// with its own controls does.
//
// Geometry comes from lib/video/subtitle-style.ts: `x` is the block's horizontal
// centre and `y` the distance of its BOTTOM edge from the frame's bottom, both in
// % of the frame, so one stored value works inline, in fullscreen and on a phone.
// The block is then clamped in PIXELS against its own measured size: a wide cue
// parked near an edge must slide back into the frame, not get clipped by it.
//
// The viewer moves it by dragging the text itself (pointer capture; a 4 px slop
// so a tap is not a move; snaps to the horizontal centre). While the control bar
// is showing, a cue that would sit under it is lifted just above it and drops
// back when the bar hides — never a stored change.

import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { SUBTITLE_COLOR_HEX, SUBTITLE_X_MAX, SUBTITLE_X_MIN, SUBTITLE_Y_MAX, SUBTITLE_Y_MIN, type SubtitleStyle } from '@/lib/video/subtitle-style';

export interface SubtitleLine {
  lang: 'zh' | 'en';
  text: string;
}

interface Props {
  /** Frame size in CSS px (the player measures it once for everything). */
  frameWidth: number;
  frameHeight: number;
  lines: SubtitleLine[];
  style: SubtitleStyle;
  /** Font size in px for the primary line (already scaled). */
  fontPx: number;
  /** Keep the block's bottom at least this many px above the frame's bottom (the visible control bar). */
  liftPx: number;
  /**
   * Px on the frame's RIGHT that something else is covering (the settings popover).
   * The block wraps and slides left to stay clear of it — the viewer is restyling
   * these very lines and has to see them. Never a stored change, like `liftPx`.
   */
  rightInsetPx?: number;
  /** The viewer is editing: outline the block so it reads as something that can be grabbed. */
  editing: boolean;
  dragHint: string;
  onMove: (x: number, y: number) => void;
  onMoveEnd: () => void;
}

const EDGE_PAD = 8;
const DRAG_SLOP = 4;
const SNAP_CENTER = 1.6; // % of the frame

export function SubtitleOverlay({ frameWidth, frameHeight, lines, style, fontPx, liftPx, rightInsetPx = 0, editing, dragHint, onMove, onMoveEnd }: Props) {
  const blockRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; startX: number; startY: number; cx: number; bottom: number; moved: boolean } | null>(null);

  // The block's size depends on the text, the font and the frame — measure after every layout.
  useLayoutEffect(() => {
    const el = blockRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  });

  if (lines.length === 0 || frameWidth <= 0 || frameHeight <= 0) return null;

  // The usable width ends where the settings popover begins (never less than a readable column).
  const usableRight = Math.max(Math.min(frameWidth, 200), frameWidth - rightInsetPx);
  const halfW = size.w / 2;
  const wantCx = (style.x / 100) * frameWidth;
  const cx = size.w > 0 ? Math.min(Math.max(wantCx, halfW + EDGE_PAD), Math.max(halfW + EDGE_PAD, usableRight - halfW - EDGE_PAD)) : wantCx;
  const wantBottom = (style.y / 100) * frameHeight;
  const maxBottom = Math.max(EDGE_PAD, frameHeight - size.h - EDGE_PAD);
  const bottom = Math.min(Math.max(wantBottom, dragging ? EDGE_PAD : Math.max(EDGE_PAD, liftPx)), maxBottom);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.stopPropagation();
    drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, cx, bottom, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      d.moved = true;
      setDragging(true);
    }
    e.stopPropagation();
    let x = ((d.cx + dx) / frameWidth) * 100;
    const y = ((d.bottom - dy) / frameHeight) * 100;
    if (Math.abs(x - 50) < SNAP_CENTER) x = 50;
    onMove(Math.min(SUBTITLE_X_MAX, Math.max(SUBTITLE_X_MIN, x)), Math.min(SUBTITLE_Y_MAX, Math.max(SUBTITLE_Y_MIN, y)));
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    e.stopPropagation();
    if (d.moved) {
      setDragging(false);
      onMoveEnd();
    }
  }

  const color = SUBTITLE_COLOR_HEX[style.color];
  const outline = style.outline
    ? '0 0 2px rgba(0,0,0,.95), 0 0 2px rgba(0,0,0,.95), 1px 1px 2px rgba(0,0,0,.9), -1px -1px 2px rgba(0,0,0,.9), 0 2px 6px rgba(0,0,0,.55)'
    : 'none';
  const lineStyle = (secondary: boolean): CSSProperties => ({
    display: 'inline',
    // `box-decoration-break: clone` gives every wrapped line its own padded, rounded box.
    boxDecorationBreak: 'clone',
    WebkitBoxDecorationBreak: 'clone',
    padding: '0.14em 0.5em',
    borderRadius: '0.28em',
    backgroundColor: style.bgOpacity > 0 ? `rgba(0,0,0,${style.bgOpacity})` : 'transparent',
    color,
    opacity: secondary ? 0.92 : 1,
    textShadow: outline,
    fontWeight: style.bold ? 700 : 500,
    fontSize: secondary ? '0.8em' : '1em',
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap',
  });

  return (
    <div className="pointer-events-none absolute inset-0 z-[6] overflow-hidden" aria-hidden={false}>
      <div
        ref={blockRef}
        role="group"
        aria-label={dragHint}
        title={dragHint}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className={`pointer-events-auto absolute touch-none select-none text-center ${dragging ? 'cursor-grabbing' : 'cursor-grab'} ${
          editing || dragging ? 'rounded-lg outline-dashed outline-1 outline-offset-4 outline-white/60' : ''
        } ${dragging ? '' : 'transition-[bottom,left] duration-200 ease-out motion-reduce:transition-none'}`}
        style={{
          left: cx,
          bottom,
          transform: 'translateX(-50%)',
          width: 'max-content',
          maxWidth: Math.max(120, Math.min(frameWidth * 0.88, usableRight - EDGE_PAD * 2)),
          fontSize: fontPx,
        }}
      >
        {lines.map((line, i) => (
          <div key={line.lang} lang={line.lang === 'zh' ? 'zh-CN' : 'en'} className={i > 0 ? 'mt-[0.12em]' : ''}>
            <span style={lineStyle(i > 0)}>{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
