import { describe, expect, it } from 'vitest';
import { normalizeClipRange } from '@/lib/media/clip-shared';
import {
  clipTimeInputValue,
  clipTimelineDuration,
  commitRange,
  dragEdge,
  dragEdgeByPixels,
  dragWindow,
  filmstripFrameCount,
  fitFrameLongEdge,
  frameCanvasSize,
  initialRangeFor,
  isWholeSource,
  loopJumpTarget,
  nudgeRange,
  parseClipTimeInput,
  rangesEqual,
  ratioOf,
  secondsForPixels,
  snapIntoRange,
  timeAtClientX,
} from '@/components/media/trim-math';
import { cardMediaErrorKey, clipFailureAction } from '@/app/settings/_components/editor-shared';
import { profileMediaSourceUrl } from '@/lib/profile/shared';

const B30 = { maxLength: 30, minLength: 1 };

/** Every range the trimmer emits must be a fixed point of the server's normaliser. */
function expectServerStable(range: { start: number; end: number }, duration: number) {
  expect(normalizeClipRange(range, duration, B30)).toEqual(range);
}

describe('timeline geometry', () => {
  it('floors the timeline to tenths so no window can end past the last frame', () => {
    expect(clipTimelineDuration(12.37)).toBe(12.3);
    expect(clipTimelineDuration(45)).toBe(45);
    expect(clipTimelineDuration(0)).toBe(0);
  });

  it('maps pointer x to time, clamped to the track', () => {
    expect(timeAtClientX(150, 100, 200, 40)).toBe(10);
    expect(timeAtClientX(50, 100, 200, 40)).toBe(0);
    expect(timeAtClientX(900, 100, 200, 40)).toBe(40);
    expect(timeAtClientX(150, 100, 0, 40)).toBe(0);
    expect(secondsForPixels(50, 200, 40)).toBe(10);
    expect(secondsForPixels(50, 0, 40)).toBe(0);
    expect(ratioOf(10, 40)).toBe(0.25);
    expect(ratioOf(99, 40)).toBe(1);
    expect(ratioOf(5, 0)).toBe(0);
  });
});

describe('initialRangeFor', () => {
  it('selects a short source whole and the first 30 s of a long one', () => {
    expect(initialRangeFor(null, 12.37, B30)).toEqual({ start: 0, end: 12.3 });
    expect(initialRangeFor(null, 45, B30)).toEqual({ start: 0, end: 30 });
    expect(initialRangeFor(null, 0, B30)).toBeNull();
  });

  it('re-normalises a stored range for this source, and falls back when it cannot', () => {
    expect(initialRangeFor({ start: 10, end: 90 }, 45, B30)).toEqual({ start: 10, end: 40 });
    expect(initialRangeFor({ start: 5, end: 20 }, 45, B30)).toEqual({ start: 5, end: 20 });
    expect(initialRangeFor({ start: Number.NaN, end: 3 }, 45, B30)).toEqual({ start: 0, end: 30 });
  });
});

describe('drags', () => {
  it('drags an edge from the gesture origin (dragging back restores the pulled edge)', () => {
    const origin = { start: 20, end: 40 };
    // start dragged far left pulls the end along to keep ≤ 30 s …
    expect(dragEdge(origin, 'start', 2, 60, B30)).toEqual({ start: 2, end: 32 });
    // … and dragging back within the same gesture restores it, because the origin is used
    expect(dragEdge(origin, 'start', 15, 60, B30)).toEqual({ start: 15, end: 40 });
    expect(dragEdge(origin, 'end', 39.5, 60, B30)).toEqual({ start: 20, end: 39.5 });
    // the minimum length holds
    expect(dragEdge(origin, 'end', 20.2, 60, B30)).toEqual({ start: 20, end: 21 });
  });

  it('never lets an edge land past a fractional source end', () => {
    const r = dragEdge({ start: 0, end: 10 }, 'end', 12.37, 12.37, B30);
    expect(r).toEqual({ start: 0, end: 12.3 });
    expectServerStable(r, 12.37);
  });

  it('moves the window without changing its length, inside the source', () => {
    const origin = { start: 5, end: 15 };
    expect(dragWindow(origin, 3.04, 45, B30)).toEqual({ start: 8, end: 18 });
    expect(dragWindow(origin, -99, 45, B30)).toEqual({ start: 0, end: 10 });
    expect(dragWindow(origin, 99, 45, B30)).toEqual({ start: 35, end: 45 });
    // a whole-source window of a fractional source cannot shift at all (no round-up past the end)
    const whole = { start: 0, end: 12.3 };
    const moved = dragWindow(whole, 1, 12.37, B30);
    expect(moved).toEqual(whole);
    expectServerStable(moved, 12.37);
  });
});

describe('edge drags are relative to the press', () => {
  // A track as laid out in the dialog: `left` px from the viewport edge, `width` px wide.
  const edgeX = (sec: number, left: number, width: number, duration: number) => left + (sec / duration) * width;
  /** Press `grab` px from an edge, move the pointer `move` px: the range the trimmer emits. */
  function pressAndMove(origin: { start: number; end: number }, edge: 'start' | 'end', grab: number, move: number, left: number, width: number, duration: number) {
    const pressX = edgeX(origin[edge], left, width, duration) + grab;
    const relative = dragEdgeByPixels(origin, edge, pressX + move - pressX, width, duration, B30);
    // What the old absolute mapping ("edge = time under the pointer") produced for the same gesture.
    const absolute = dragEdge(origin, edge, timeAtClientX(pressX + move, left, width, duration), duration, B30);
    return { relative, absolute };
  }

  it('a 1 px move from a grab 8 px outside either edge keeps the range put (wide track: 1 px < half a step)', () => {
    const origin = { start: 10, end: 25 };
    for (const [edge, grab] of [
      ['start', -8],
      ['start', 8],
      ['end', 8],
      ['end', -8],
    ] as const) {
      const { relative, absolute } = pressAndMove(origin, edge, grab, 1, 120, 1200, 45);
      expect(relative).toEqual(origin);
      // the absolute mapping jumped by the grab offset (8 px ≈ 0.3 s here)
      expect(absolute).not.toEqual(origin);
    }
  });

  it('moves an edge by exactly the pointer travel, never by the grab offset (598 px, 45 s)', () => {
    const origin = { start: 16.9, end: 45 };
    const onePx = secondsForPixels(1, 598, 45);
    for (const grab of [-8, 8, -14]) {
      const { relative, absolute } = pressAndMove(origin, 'start', grab, 1, 40, 598, 45);
      expect(Math.abs(relative.start - origin.start)).toBeLessThanOrEqual(onePx + 0.05);
      expect(relative.end).toBe(origin.end);
      expect(Math.abs(absolute.start - origin.start)).toBeGreaterThanOrEqual(0.5);
    }
    // the review's gesture: +132.9 px (= 10 s) from a grab 8 px left of the start lands on 26.9, not 26.3
    expect(dragEdgeByPixels(origin, 'start', 132.9, 598, 45, B30).start).toBe(26.9);
    expect(dragEdgeByPixels({ start: 15, end: 45 }, 'end', -66.4, 598, 45, B30)).toEqual({ start: 15, end: 40 });
    // no travel = no change
    expect(dragEdgeByPixels(origin, 'end', 0, 598, 45, B30)).toBe(origin);
  });

  it('at the maximum length a 1 px nudge from a grab 20 px past the end does not drag the window', () => {
    // 400 px phone: 342 px track, 45 s source, 0–30 selected
    const origin = { start: 0, end: 30 };
    const { relative, absolute } = pressAndMove(origin, 'end', 20, 1, 29, 342, 45);
    const onePx = secondsForPixels(1, 342, 45);
    expect(relative.end - origin.end).toBeLessThanOrEqual(onePx + 0.05);
    expect(relative.start).toBeLessThanOrEqual(onePx + 0.05);
    expect(relative.end - relative.start).toBeLessThanOrEqual(30);
    expectServerStable(relative, 45);
    // the absolute mapping turned the same gesture into 2.8–32.8
    expect(absolute.start).toBeGreaterThan(2);
  });
});

describe('typed range fallback (no preview)', () => {
  it('parses seconds, a decimal comma and m:ss.s clocks', () => {
    expect(parseClipTimeInput('12')).toBe(12);
    expect(parseClipTimeInput(' 12.5 ')).toBe(12.5);
    expect(parseClipTimeInput('12,5')).toBe(12.5);
    expect(parseClipTimeInput('.5')).toBe(0.5);
    expect(parseClipTimeInput('0:10.0')).toBe(10);
    expect(parseClipTimeInput('1:05')).toBe(65);
    expect(parseClipTimeInput('75:00')).toBe(4500);
    expect(parseClipTimeInput('1:02:03.5')).toBe(3723.5);
  });

  it('refuses what is not a time', () => {
    for (const bad of ['', '  ', '-3', 'abc', '1:75', '1:60:00', '12s', '1..2', '1:2:3:4']) expect(parseClipTimeInput(bad)).toBeNull();
  });

  it('writes a field value the parser reads back', () => {
    expect(clipTimeInputValue(12)).toBe('12');
    expect(clipTimeInputValue(12.3)).toBe('12.3');
    expect(clipTimeInputValue(9.95)).toBe('10');
    expect(clipTimeInputValue(Number.NaN)).toBe('');
    expect(parseClipTimeInput(clipTimeInputValue(33.3))).toBe(33.3);
  });
});

describe('nudgeRange (keyboard)', () => {
  const r = { start: 10, end: 20 };

  it('steps 0.1 s, 1 s with Shift and 10 s with PageUp/PageDown', () => {
    expect(nudgeRange(r, 'start', 'ArrowRight', false, 45, B30)).toEqual({ start: 10.1, end: 20 });
    expect(nudgeRange(r, 'start', 'ArrowLeft', true, 45, B30)).toEqual({ start: 9, end: 20 });
    expect(nudgeRange(r, 'end', 'ArrowUp', false, 45, B30)).toEqual({ start: 10, end: 20.1 });
    expect(nudgeRange(r, 'window', 'ArrowRight', true, 45, B30)).toEqual({ start: 11, end: 21 });
    expect(nudgeRange(r, 'window', 'PageUp', false, 45, B30)).toEqual({ start: 20, end: 30 });
  });

  it('Home/End jump each target to the extreme it can reach', () => {
    expect(nudgeRange(r, 'start', 'Home', false, 45, B30)).toEqual({ start: 0, end: 20 });
    expect(nudgeRange(r, 'start', 'End', false, 45, B30)).toEqual({ start: 19, end: 20 });
    expect(nudgeRange(r, 'end', 'Home', false, 45, B30)).toEqual({ start: 10, end: 11 });
    expect(nudgeRange(r, 'end', 'End', false, 45, B30)).toEqual({ start: 15, end: 45 });
    expect(nudgeRange(r, 'window', 'Home', false, 45, B30)).toEqual({ start: 0, end: 10 });
    expect(nudgeRange(r, 'window', 'End', false, 45, B30)).toEqual({ start: 35, end: 45 });
  });

  it('ignores keys it does not own and stays server-stable on fractional sources', () => {
    expect(nudgeRange(r, 'start', 'Enter', false, 45, B30)).toBeNull();
    expect(nudgeRange(r, 'window', 'a', false, 45, B30)).toBeNull();
    const n = nudgeRange({ start: 0.2, end: 12.3 }, 'end', 'ArrowRight', true, 12.37, B30);
    expect(n).toEqual({ start: 0.2, end: 12.3 });
    expectServerStable(n!, 12.37);
    // 0.1 steps never accumulate float noise
    let cur = { start: 0, end: 5 };
    for (let i = 0; i < 7; i++) cur = nudgeRange(cur, 'window', 'ArrowRight', false, 45, B30)!;
    expect(cur).toEqual({ start: 0.7, end: 5.7 });
  });
});

describe('preview loop', () => {
  const r = { start: 10, end: 20 };

  it('wraps at the end and when playback sits clearly before the start', () => {
    expect(loopJumpTarget(19.99, r)).toBe(10);
    expect(loopJumpTarget(25, r)).toBe(10);
    expect(loopJumpTarget(9.5, r)).toBe(10);
    expect(loopJumpTarget(9.9, r)).toBeNull(); // a seek landing just before a keyframe is not a wrap
    expect(loopJumpTarget(15, r)).toBeNull();
  });

  it('snaps a seek made while looping into the selection', () => {
    expect(snapIntoRange(3, r)).toBe(10);
    expect(snapIntoRange(20, r)).toBe(10);
    expect(snapIntoRange(12.5, r)).toBe(12.5);
  });

  it('knows a whole-source selection', () => {
    expect(isWholeSource({ start: 0, end: 12.3 }, 12.37)).toBe(true);
    expect(isWholeSource({ start: 0, end: 12 }, 12.37)).toBe(false);
    expect(isWholeSource({ start: 0.1, end: 12.3 }, 12.37)).toBe(false);
  });

  it('compares ranges by value', () => {
    expect(rangesEqual({ start: 1, end: 2 }, { start: 1, end: 2 })).toBe(true);
    expect(rangesEqual({ start: 1, end: 2 }, null)).toBe(false);
    expect(rangesEqual(null, null)).toBe(true);
    expect(commitRange({ start: Number.NaN, end: 1 }, 10, B30, { start: 0, end: 5 })).toEqual({ start: 0, end: 5 });
  });
});

describe('filmstripFrameCount', () => {
  it('fits frames at the video aspect, clamped to 4–12', () => {
    expect(filmstripFrameCount(598, 16 / 9)).toBe(7);
    expect(filmstripFrameCount(598, 9 / 16)).toBe(12);
    expect(filmstripFrameCount(340, 16 / 9)).toBe(4);
    expect(filmstripFrameCount(340, 9 / 16)).toBe(12);
    expect(filmstripFrameCount(340, 1)).toBe(7);
    expect(filmstripFrameCount(0, 16 / 9)).toBe(4);
    expect(filmstripFrameCount(598, 0)).toBe(4);
  });
});

describe('frame capture sizes', () => {
  it('keeps the video aspect for filmstrip frames without upscaling', () => {
    expect(frameCanvasSize(1920, 1080, 96)).toEqual({ width: 171, height: 96 });
    expect(frameCanvasSize(720, 1280, 96)).toEqual({ width: 54, height: 96 });
    expect(frameCanvasSize(160, 90, 96)).toEqual({ width: 160, height: 90 });
    expect(frameCanvasSize(0, 0, 96)).toEqual({ width: 1, height: 1 });
  });

  it('bounds a poster by its long edge', () => {
    expect(fitFrameLongEdge(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 });
    expect(fitFrameLongEdge(1080, 1920, 1280)).toEqual({ width: 720, height: 1280 });
    expect(fitFrameLongEdge(640, 360, 1280)).toEqual({ width: 640, height: 360 });
  });
});

describe('名片 clip errors (editor-shared)', () => {
  it('words clip failures as clip failures, not as uploads', () => {
    expect(cardMediaErrorKey('rate_limited', 'clip')).toBe('ce_err_clip_rate_limited');
    expect(cardMediaErrorKey('invalid_input', 'clip')).toBe('ce_err_clip_invalid');
    expect(cardMediaErrorKey('payload_too_large', 'clip')).toBe('ce_err_clip_invalid');
    expect(cardMediaErrorKey('clip_in_progress', 'clip')).toBe('ce_err_clip_in_progress');
    expect(cardMediaErrorKey('media_busy', 'clip')).toBe('ce_err_media_busy');
    expect(cardMediaErrorKey('media_missing', 'clip')).toBe('ce_err_media_missing');
    expect(cardMediaErrorKey('clip_failed', 'clip')).toBe('ce_err_clip_failed');
    expect(cardMediaErrorKey('network_error', 'clip')).toBe('ce_err_network');
    expect(cardMediaErrorKey('something_new', 'clip')).toBe('ce_err_clip_failed');
    // the upload context keeps its own wording
    expect(cardMediaErrorKey('rate_limited')).toBe('ce_err_rate_limited');
    expect(cardMediaErrorKey('invalid_input')).toBe('ce_err_upload_failed');
  });

  it('falls back to a poster-only card when the server cannot cut a NEW video', () => {
    expect(clipFailureAction('ffmpeg_unavailable', 501, 'new')).toBe('poster_fallback');
    expect(clipFailureAction('ffmpeg_unavailable', 501, 'retrim')).toBe('poster_fallback');
    expect(clipFailureAction('whatever', 501, 'new')).toBe('poster_fallback');
    expect(clipFailureAction('clip_failed', 500, 'new')).toBe('poster_fallback');
    // a re-trim still has its working clip: pick another segment instead
    expect(clipFailureAction('clip_failed', 500, 'retrim')).toBe('retry');
  });

  it('closes only when retrying the same request cannot succeed', () => {
    for (const code of ['invalid_input', 'payload_too_large', 'media_missing', 'media_claimed', 'unauthenticated']) {
      expect(clipFailureAction(code, 400, 'new')).toBe('close');
      expect(clipFailureAction(code, 400, 'retrim')).toBe('close');
    }
    for (const code of ['media_busy', 'clip_in_progress', 'rate_limited', 'network_error', 'disk_full']) {
      expect(clipFailureAction(code, 503, 'new')).toBe('retry');
    }
  });

  it('builds the owner-only source URL from the one shared helper', () => {
    expect(profileMediaSourceUrl('video/abcdef1234-xyz_09.mp4')).toBe('/api/me/profile/media/source?key=video%2Fabcdef1234-xyz_09.mp4');
  });
});
