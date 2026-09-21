import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBTITLE_STYLE,
  bilingualOrder,
  defaultSubtitleMode,
  isDefaultSubtitleStyle,
  matchingPositionPreset,
  parseSubtitleMode,
  parseSubtitleStyle,
  parseSubtitleStyleJson,
  resolveSubtitleMode,
  subtitleBaseFontPx,
  SUBTITLE_POSITION_PRESETS,
} from '@/lib/video/subtitle-style';
import { linkifyStamps, seekSecondsFromHref } from '@/lib/video/timestamps';

describe('subtitle style', () => {
  it('fills defaults and clamps every range', () => {
    expect(parseSubtitleStyle(null)).toEqual(DEFAULT_SUBTITLE_STYLE);
    expect(parseSubtitleStyle('nope')).toEqual(DEFAULT_SUBTITLE_STYLE);
    expect(parseSubtitleStyle([])).toEqual(DEFAULT_SUBTITLE_STYLE);
    const s = parseSubtitleStyle({ scale: 99, x: -40, y: 500, bgOpacity: 7, color: 'hotpink', outline: 'yes', bold: true });
    expect(s).toEqual({ scale: 2, x: 10, y: 88, bgOpacity: 1, color: 'white', outline: true, bold: true });
    expect(parseSubtitleStyle({ scale: 0.1, bgOpacity: -3 })).toMatchObject({ scale: 0.6, bgOpacity: 0 });
  });

  it('never lets a non-finite number through', () => {
    const s = parseSubtitleStyle({ scale: Number.NaN, x: Infinity, y: '12' });
    expect(s.scale).toBe(1);
    expect(s.x).toBe(DEFAULT_SUBTITLE_STYLE.x);
    expect(s.y).toBe(DEFAULT_SUBTITLE_STYLE.y);
  });

  it('survives corrupt storage', () => {
    expect(parseSubtitleStyleJson('{not json')).toEqual(DEFAULT_SUBTITLE_STYLE);
    expect(parseSubtitleStyleJson(null)).toEqual(DEFAULT_SUBTITLE_STYLE);
    expect(parseSubtitleStyleJson(JSON.stringify({ color: 'yellow', scale: 1.4 }))).toMatchObject({ color: 'yellow', scale: 1.4 });
  });

  it('round-trips what it produced', () => {
    const s = parseSubtitleStyle({ scale: 1.35, x: 33.3, y: 61.7, bgOpacity: 0.25, color: 'cyan', outline: false, bold: true });
    expect(parseSubtitleStyle(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(isDefaultSubtitleStyle(s)).toBe(false);
    expect(isDefaultSubtitleStyle(parseSubtitleStyle({}))).toBe(true);
  });

  it('presets are recognised, a dragged position is not', () => {
    expect(matchingPositionPreset(SUBTITLE_POSITION_PRESETS.top)).toBe('top');
    expect(matchingPositionPreset(DEFAULT_SUBTITLE_STYLE)).toBe('bottom');
    expect(matchingPositionPreset({ x: 31, y: 40 })).toBeNull();
  });

  it('font size follows the frame and stays readable', () => {
    expect(subtitleBaseFontPx(0)).toBe(18);
    expect(subtitleBaseFontPx(320)).toBe(13);
    expect(subtitleBaseFontPx(1280)).toBeCloseTo(31.36, 1);
    expect(subtitleBaseFontPx(5000)).toBe(46);
  });
});

describe('subtitle mode', () => {
  it('resolves against the tracks a video actually has', () => {
    expect(resolveSubtitleMode('both', { zh: true, en: true })).toBe('both');
    expect(resolveSubtitleMode('both', { zh: true, en: false })).toBe('zh');
    expect(resolveSubtitleMode('en', { zh: true, en: false })).toBe('zh');
    expect(resolveSubtitleMode('zh', { zh: false, en: true })).toBe('en');
    expect(resolveSubtitleMode('zh', { zh: false, en: false })).toBe('off');
    expect(resolveSubtitleMode('off', { zh: true, en: true })).toBe('off');
  });
  it('defaults to the viewer language; fr reads the English track', () => {
    expect(defaultSubtitleMode('zh-CN')).toBe('zh');
    expect(defaultSubtitleMode('en')).toBe('en');
    expect(defaultSubtitleMode('fr')).toBe('en');
    expect(bilingualOrder('zh-CN')).toEqual(['zh', 'en']);
    expect(bilingualOrder('fr')).toEqual(['en', 'zh']);
    expect(parseSubtitleMode('both')).toBe('both');
    expect(parseSubtitleMode('klingon')).toBeNull();
  });
});

describe('timestamp links', () => {
  it('turns cited stamps into seek links', () => {
    expect(linkifyStamps('讲到 [12:34] 和 [1:02:03] 两处')).toBe('讲到 [12:34](#t=754) 和 [1:02:03](#t=3723) 两处');
    expect(linkifyStamps('- [0:05] 开场')).toBe('- [0:05](#t=5) 开场');
  });
  it('leaves existing links, images, code and non-stamps alone', () => {
    expect(linkifyStamps('[12:34](https://example.com)')).toBe('[12:34](https://example.com)');
    expect(linkifyStamps('![12:34]')).toBe('![12:34]');
    expect(linkifyStamps('`arr[1:23]` and\n```\nx[10:20]\n```')).toBe('`arr[1:23]` and\n```\nx[10:20]\n```');
    expect(linkifyStamps('[12:75] is not a time')).toBe('[12:75] is not a time');
    expect(linkifyStamps('no stamps here')).toBe('no stamps here');
  });
  it('is idempotent', () => {
    const once = linkifyStamps('see [3:21]');
    expect(linkifyStamps(once)).toBe(once);
  });
  it('reads seconds back from the href, and only from that shape', () => {
    expect(seekSecondsFromHref('#t=754')).toBe(754);
    expect(seekSecondsFromHref('https://host/ai-community/videos/x#t=12')).toBe(12);
    expect(seekSecondsFromHref('#t=12abc')).toBeNull();
    expect(seekSecondsFromHref('#t=-5')).toBeNull();
    expect(seekSecondsFromHref('#top')).toBeNull();
    expect(seekSecondsFromHref(null)).toBeNull();
  });
});
