import { describe, expect, it } from 'vitest';
import {
  coverAspectOf,
  coverObjectPosition,
  coverPosOf,
  coverPosPercent,
  defaultCoverFor,
  formatCoverPos,
  isContainPos,
  parseCoverAspect,
  parseCoverPos,
  postCoverRatio,
  videoCoverRatio,
} from '@/lib/media/cover-pos';
import { parsePosterPos } from '@/lib/votes/shared';

describe('cover contract', () => {
  it('accepts exactly the three pos shapes', () => {
    expect(parseCoverPos(undefined)).toBe('');
    expect(parseCoverPos(null)).toBe('');
    expect(parseCoverPos('')).toBe('');
    expect(parseCoverPos(' contain ')).toBe('contain');
    expect(parseCoverPos('50% 30%')).toBe('50% 30%');
    expect(parseCoverPos('050% 007%')).toBe('50% 7%');
    expect(parseCoverPos('0% 100%')).toBe('0% 100%');
  });

  it('rejects anything that could reach a style attribute as free CSS', () => {
    for (const bad of ['101% 0%', '50%', '50% 30% 10%', 'center', 'left top', '50px 30px', '-5% 10%', '50% 30%; background:url(x)', 'cover', 12, {}, []]) {
      expect(parseCoverPos(bad), String(bad)).toBeNull();
    }
  });

  it('the votes export is the same function (one contract, not a copy)', () => {
    expect(parsePosterPos).toBe(parseCoverPos);
  });

  it('aspect: closed set on write, forgiving on read', () => {
    expect(parseCoverAspect(undefined)).toBe('landscape');
    expect(parseCoverAspect('')).toBe('landscape');
    expect(parseCoverAspect('portrait')).toBe('portrait');
    expect(parseCoverAspect('square')).toBeNull();
    expect(parseCoverAspect(3)).toBeNull();
    expect(coverAspectOf('square')).toBe('landscape');
    expect(coverAspectOf('portrait')).toBe('portrait');
    expect(coverPosOf('junk')).toBe('');
    expect(coverPosOf('contain')).toBe('contain');
  });

  it('render helpers never emit junk', () => {
    expect(coverObjectPosition('20% 80%')).toBe('20% 80%');
    expect(coverObjectPosition('')).toBe('50% 50%');
    expect(coverObjectPosition('contain')).toBe('50% 50%');
    expect(coverObjectPosition('url(evil)')).toBe('50% 50%');
    expect(coverPosPercent('20% 80%')).toEqual({ x: 20, y: 80 });
    expect(coverPosPercent('contain')).toEqual({ x: 50, y: 50 });
    expect(formatCoverPos(-4, 120.6)).toBe('0% 100%');
    expect(formatCoverPos(Number.NaN, 33.4)).toBe('50% 33%');
    expect(isContainPos('contain')).toBe(true);
    expect(isContainPos('')).toBe(false);
  });

  it('frames per surface', () => {
    expect(videoCoverRatio('landscape')).toBeCloseTo(16 / 9);
    expect(videoCoverRatio('portrait')).toBeCloseTo(3 / 4);
    expect(postCoverRatio('landscape')).toBe(2);
    expect(postCoverRatio('portrait')).toBeCloseTo(3 / 4);
  });

  it('a tall image starts as portrait + show-all, so a poster is never butchered by default', () => {
    expect(defaultCoverFor(1080, 1920)).toEqual({ aspect: 'portrait', pos: 'contain' });
    expect(defaultCoverFor(1200, 1600)).toEqual({ aspect: 'portrait', pos: 'contain' });
    expect(defaultCoverFor(1920, 1080)).toEqual({ aspect: 'landscape', pos: '' });
    expect(defaultCoverFor(1000, 1000)).toEqual({ aspect: 'landscape', pos: '' });
    expect(defaultCoverFor(1000, 1100)).toEqual({ aspect: 'landscape', pos: '' }); // barely tall: not a poster
    expect(defaultCoverFor(0, 0)).toEqual({ aspect: 'landscape', pos: '' });
    expect(defaultCoverFor(Number.NaN, 5)).toEqual({ aspect: 'landscape', pos: '' });
  });
});
