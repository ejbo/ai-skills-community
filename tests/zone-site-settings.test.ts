// 技术专区站级设置 — the pure half: per-locale hub copy sanitising and the
// own-locale → 中文 → i18n fallback chain the hero renders through.
import { describe, expect, it } from 'vitest';
import {
  ZONE_COPY_LIMITS,
  resolveZoneHubCopy,
  sanitizeZoneSiteCopy,
  type ZoneHubCopy,
} from '@/lib/zones/site-settings-shared';

const FALLBACK: ZoneHubCopy = {
  eyebrow: 'EYEBROW',
  title: 'TITLE',
  subtitle: 'SUBTITLE',
  createTitle: 'CREATE_TITLE',
  createDesc: 'CREATE_DESC',
};

describe('sanitizeZoneSiteCopy', () => {
  it('drops unknown locales, unknown fields, non-strings and blanks', () => {
    const out = sanitizeZoneSiteCopy({
      'zh-CN': { title: '  技术专区  ', bogus: 'x', subtitle: 42, eyebrow: '   ' },
      de: { title: 'nope' },
      en: 'not an object',
    });
    expect(out).toEqual({ 'zh-CN': { title: '技术专区' } });
  });

  it('caps every field at its limit', () => {
    const long = 'a'.repeat(ZONE_COPY_LIMITS.subtitle + 50);
    const out = sanitizeZoneSiteCopy({ en: { subtitle: long } });
    expect(out.en?.subtitle).toHaveLength(ZONE_COPY_LIMITS.subtitle);
  });

  it('never throws on garbage', () => {
    expect(sanitizeZoneSiteCopy(null)).toEqual({});
    expect(sanitizeZoneSiteCopy([1, 2])).toEqual({});
    expect(sanitizeZoneSiteCopy('str')).toEqual({});
  });
});

describe('resolveZoneHubCopy', () => {
  it('uses the viewer locale, then 中文, then the i18n fallback — per field', () => {
    const copy = sanitizeZoneSiteCopy({
      'zh-CN': { title: '加研技术专区', subtitle: '中文副标题' },
      en: { title: 'CARI Tech Zones' },
    });
    expect(resolveZoneHubCopy(copy, 'en', FALLBACK)).toEqual({
      ...FALLBACK,
      title: 'CARI Tech Zones', // own locale
      subtitle: '中文副标题', // 中文 fills the gap
    });
    expect(resolveZoneHubCopy(copy, 'fr', FALLBACK)).toEqual({
      ...FALLBACK,
      title: '加研技术专区',
      subtitle: '中文副标题',
    });
  });

  it('an empty setting renders the i18n defaults unchanged', () => {
    expect(resolveZoneHubCopy({}, 'zh-CN', FALLBACK)).toEqual(FALLBACK);
  });

  it('an unknown locale still gets the 中文 override', () => {
    const copy = sanitizeZoneSiteCopy({ 'zh-CN': { eyebrow: '各实验室' } });
    expect(resolveZoneHubCopy(copy, 'ja', FALLBACK).eyebrow).toBe('各实验室');
  });
});
