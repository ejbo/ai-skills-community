import { describe, expect, it } from 'vitest';
import {
  defaultClipRange,
  filmstripTimes,
  formatClipTime,
  normalizeClipRange,
  normalizeCover,
  parseStoredClip,
  resizeClipRange,
  roundClipTime,
  shiftClipRange,
} from '@/lib/media/clip-shared';

const B30 = { maxLength: 30, minLength: 1 };

describe('roundClipTime', () => {
  it('rounds to tenths and never goes negative', () => {
    expect(roundClipTime(1.26)).toBe(1.3);
    expect(roundClipTime(9.95)).toBe(10);
    expect(roundClipTime(0.05)).toBe(0.1);
    expect(roundClipTime(-3)).toBe(0);
    expect(Object.is(roundClipTime(-0.01), 0)).toBe(true);
  });
});

describe('defaultClipRange', () => {
  it('takes the whole of a short source and the first maxLength of a long one', () => {
    expect(defaultClipRange(12.34, B30)).toEqual({ start: 0, end: 12.3 });
    expect(defaultClipRange(95, B30)).toEqual({ start: 0, end: 30 });
    expect(defaultClipRange(0, B30)).toEqual({ start: 0, end: 0 });
  });
});

describe('normalizeClipRange', () => {
  it('rejects non-numbers and sources without a duration', () => {
    expect(normalizeClipRange({ start: '1', end: 5 }, 60, B30)).toBeNull();
    expect(normalizeClipRange(null, 60, B30)).toBeNull();
    expect(normalizeClipRange({ start: 0, end: 5 }, 0, B30)).toBeNull();
    expect(normalizeClipRange({ start: NaN, end: 5 }, 60, B30)).toBeNull();
  });

  it('caps the length at maxLength and keeps the window inside the source', () => {
    expect(normalizeClipRange({ start: 10, end: 90 }, 120, B30)).toEqual({ start: 10, end: 40 });
    expect(normalizeClipRange({ start: -5, end: 3 }, 120, B30)).toEqual({ start: 0, end: 3 });
    expect(normalizeClipRange({ start: 118, end: 200 }, 120, B30)).toEqual({ start: 118, end: 120 });
  });

  it('enforces the minimum length, pulling the start back at the very end', () => {
    expect(normalizeClipRange({ start: 5, end: 5.2 }, 60, B30)).toEqual({ start: 5, end: 6 });
    expect(normalizeClipRange({ start: 60, end: 60 }, 60, B30)).toEqual({ start: 59, end: 60 });
  });

  it('a source shorter than minLength yields its whole length', () => {
    expect(normalizeClipRange({ start: 0, end: 10 }, 0.6, B30)).toEqual({ start: 0, end: 0.6 });
  });
});

describe('normalizeCover', () => {
  it('defaults half a second in, clamps inside the range', () => {
    expect(normalizeCover(undefined, { start: 10, end: 20 })).toBe(10.5);
    expect(normalizeCover(undefined, { start: 0, end: 0.4 })).toBe(0.2);
    expect(normalizeCover(99, { start: 10, end: 20 })).toBe(19.9);
    expect(normalizeCover(2, { start: 10, end: 20 })).toBe(10);
  });
});

describe('shift / resize', () => {
  it('shifting keeps the length and stays inside the source', () => {
    expect(shiftClipRange({ start: 10, end: 20 }, 5, 60)).toEqual({ start: 15, end: 25 });
    expect(shiftClipRange({ start: 10, end: 20 }, 100, 60)).toEqual({ start: 50, end: 60 });
    expect(shiftClipRange({ start: 10, end: 20 }, -100, 60)).toEqual({ start: 0, end: 10 });
  });

  it('dragging an edge past maxLength pulls the other edge along', () => {
    expect(resizeClipRange({ start: 40, end: 60 }, 'start', 10, 120, B30)).toEqual({ start: 10, end: 40 });
    expect(resizeClipRange({ start: 40, end: 60 }, 'end', 100, 120, B30)).toEqual({ start: 70, end: 100 });
  });

  it('an edge can never cross the other within minLength', () => {
    expect(resizeClipRange({ start: 40, end: 60 }, 'start', 59.9, 120, B30)).toEqual({ start: 59, end: 60 });
    expect(resizeClipRange({ start: 40, end: 60 }, 'end', 40, 120, B30)).toEqual({ start: 40, end: 41 });
  });
});

describe('formatting and filmstrip', () => {
  it('formats m:ss.s and h:mm:ss.s', () => {
    expect(formatClipTime(0)).toBe('0:00.0');
    expect(formatClipTime(75.25)).toBe('1:15.3');
    expect(formatClipTime(3725)).toBe('1:02:05.0');
  });

  it('spaces thumbnails at slot centres', () => {
    expect(filmstripTimes(10, 5)).toEqual([1, 3, 5, 7, 9]);
    expect(filmstripTimes(0, 5)).toEqual([]);
  });
});

describe('parseStoredClip', () => {
  it('round-trips a valid stored clip and rejects garbage', () => {
    expect(parseStoredClip({ start: 2, end: 12, cover: 3, duration: 40 })).toEqual({ start: 2, end: 12, cover: 3, duration: 40 });
    expect(parseStoredClip({ start: 2, end: 12, cover: 'x', duration: 40 })).toBeNull();
    expect(parseStoredClip('nope')).toBeNull();
  });
});
