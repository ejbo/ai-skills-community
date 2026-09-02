import { describe, expect, it } from 'vitest';
import {
  ARTICLE_MIN,
  DOCK_DEFAULT,
  DOCK_HARD_MAX,
  DOCK_MIN,
  RUBBER_BAND_K,
  RUBBER_BAND_PX,
  clampDockWidth,
  dockMaxFor,
  readStoredWidth,
  rubberBand,
} from '@/components/zones/preview/split-shared';

describe('dockMaxFor', () => {
  it('reserves the article floor and caps at the hard max', () => {
    expect(dockMaxFor(1280)).toBe(640); // 1280 − 640
    expect(dockMaxFor(1920)).toBe(760); // capped
    expect(dockMaxFor(1440)).toBe(760);
    expect(dockMaxFor(1400)).toBe(1400 - ARTICLE_MIN);
  });
  it('never drops below DOCK_MIN so the clamp stays well-ordered', () => {
    expect(dockMaxFor(800)).toBe(DOCK_MIN);
    expect(dockMaxFor(0)).toBe(DOCK_MIN);
    expect(dockMaxFor(Number.NaN)).toBe(DOCK_MIN);
  });
  it('is bounded by the hard max', () => {
    expect(dockMaxFor(10_000)).toBe(DOCK_HARD_MAX);
  });
});

describe('clampDockWidth', () => {
  it('clamps below and above', () => {
    expect(clampDockWidth(100, 1440)).toBe(DOCK_MIN);
    expect(clampDockWidth(2000, 1440)).toBe(760);
    expect(clampDockWidth(900, 1280)).toBe(640);
    expect(clampDockWidth(500, 1440)).toBe(500);
  });
  it('falls back to the default on NaN / ∞', () => {
    expect(clampDockWidth(Number.NaN, 1440)).toBe(DOCK_DEFAULT);
    expect(clampDockWidth(Number.POSITIVE_INFINITY, 1440)).toBe(DOCK_DEFAULT);
    expect(clampDockWidth(Number.NEGATIVE_INFINITY, 1440)).toBe(DOCK_DEFAULT);
    // …and the fallback itself is clamped on a narrow viewport.
    expect(clampDockWidth(Number.NaN, 900)).toBe(DOCK_MIN);
  });
  it('rounds to whole pixels', () => {
    expect(clampDockWidth(500.6, 1440)).toBe(501);
  });
});

describe('rubberBand', () => {
  it('softens an overshoot with tanh', () => {
    expect(rubberBand(200, false)).toBeCloseTo(39.1, 1);
    expect(rubberBand(-200, false)).toBeCloseTo(-39.1, 1);
    expect(rubberBand(0, false)).toBe(0);
  });
  it('never exceeds 42 px for any overshoot', () => {
    const limit = RUBBER_BAND_PX * RUBBER_BAND_K; // the tanh asymptote, 42
    for (const over of [1, 50, 120, 400, 1000]) {
      // Realistic drags stay strictly under the asymptote…
      expect(Math.abs(rubberBand(over, false))).toBeLessThan(42);
      expect(Math.abs(rubberBand(-over, false))).toBeLessThan(42);
    }
    for (const over of [5000, 1e9, Number.MAX_SAFE_INTEGER]) {
      // …and tanh saturates to exactly 1 in floating point far past it.
      expect(Math.abs(rubberBand(over, false))).toBeLessThanOrEqual(limit);
    }
  });
  it('is zero under reduced motion', () => {
    for (const over of [1, 50, 200, -300]) expect(rubberBand(over, true)).toBe(0);
  });
});

describe('readStoredWidth', () => {
  it('returns the default on garbage', () => {
    expect(readStoredWidth('abc', 1440)).toBe(520);
    expect(readStoredWidth('', 1440)).toBe(520);
    expect(readStoredWidth(null, 1440)).toBe(520);
    expect(readStoredWidth(undefined, 1440)).toBe(520);
    expect(readStoredWidth('NaN', 1440)).toBe(520);
    expect(readStoredWidth('12px', 1440)).toBe(520);
  });
  it('parses and clamps a stored value', () => {
    expect(readStoredWidth('900', 1280)).toBe(640);
    expect(readStoredWidth('600', 1440)).toBe(600);
    expect(readStoredWidth(' 610 ', 1440)).toBe(610);
    expect(readStoredWidth('10', 1440)).toBe(DOCK_MIN);
  });
});
